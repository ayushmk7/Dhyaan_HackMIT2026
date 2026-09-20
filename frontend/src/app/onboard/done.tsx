// The one write. Everything onboarding collected (consent, her description,
// the camera's room, and every fact) goes to the server here, in one place,
// so there is exactly one thing that can fail and exactly one retry to build.
//
// It does not pretend to have succeeded: if the write fails you stay on this
// screen with the error and a Try again, and the only way past it says plainly
// that the answers live on this phone until it works.
//
// Consent is MERGED, never replaced. The session's grants are `null` for any
// question not answered in this run (a plain sign-in, or the stack entered
// part-way from Settings), and this screen used to write every null as
// `false`, switching falls, the camera and memory off on the server for a
// resident whose family had already said yes. Now it reads the server's
// consent first, keeps whatever it does not have a newer answer for, and the
// patch only carries the grants this run actually answered; the server and
// the mock both merge a partial consent, so even a failed read cannot turn
// anything off.
//
// The hero owns the screen. Under it, one sentence and one machine line for
// how many notes are about to be saved. The step counter above the hero, the
// three-line "what to expect" list and the caption under the note count are
// gone: the last step of a sequence is a full stop, not another page to read.
import { router } from 'expo-router';
import React, { useState } from 'react';

import { Btn, DataLabel, Entrance, ErrorState, Screen, Txt } from '@/components';
import { api } from '@/lib/api';
import { onboard } from '@/lib/copy/staff';
import type { Profile } from '@/lib/types';
import { sp } from '@/theme/tokens';
import { useSession, type Grants } from '@/store/session';

const copy = onboard.done;

const GRANT_KEYS: (keyof Grants)[] = ['falls', 'camera', 'memory'];

/**
 * The consent patch: the server's current grants, overwritten only by the
 * ones answered in this run. With no server copy (a fresh resident, or the
 * read failed) the patch is just the answered subset, which the server merges.
 */
export function mergeConsent(
  grants: Grants, existing: Profile['consent'] | null, signedBy: string, relationship: string,
): Partial<Profile['consent']> {
  const consent: Partial<Profile['consent']> = {};
  for (const k of GRANT_KEYS) {
    const answered = grants[k];
    if (answered !== null) consent[k] = answered;
    else if (existing) consent[k] = existing[k];
  }
  // Who signed is only known when the consent screen ran this time; a blank
  // must not erase the name already on file.
  if (signedBy.trim()) consent.signed_by = signedBy.trim();
  if (relationship.trim()) consent.relationship = relationship.trim();
  return consent;
}

export default function Done() {
  const session = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const facts = session.factDrafts.filter((f) => f.text.trim().length > 0);
  const appearance = facts.find((f) => f.key === 'appearance')?.text;
  // The consent screen ran this time: it cannot be left without a signer.
  const consentedNow = session.consentGivenBy.trim().length > 0;

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      // Best effort: a fresh resident may have no profile yet, and a read
      // that fails must not block the write, which merges on the server.
      const existing = await api.getProfile(session.residentId).catch(() => null);
      const consent = mergeConsent(
        session.grants, existing?.consent ?? null, session.consentGivenBy, session.consentRelationship,
      );
      await api.putProfile(session.residentId, {
        // Her name was typed on the consent screen; without that screen the
        // session only holds its default, which is not hers to overwrite.
        ...(consentedNow ? { name: session.residentName } : {}),
        ...(appearance ? { appearance: appearance.slice(0, 200) } : {}),
        ...(Object.keys(consent).length ? { consent } : {}),
        ...(session.camera.zone
          ? { camera: { zone: session.camera.zone, zone_hint: session.camera.zoneHint } }
          : {}),
      });
      if (facts.length) {
        await api.addFacts(session.residentId, facts, session.consentGivenBy);
      }
      setSaved(true);
      session.finishOnboarding();
      router.replace('/(family)/home');
    } catch (e) {
      setError(e instanceof Error ? e.message : copy.saveError);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      native
      wash
      floatingBar={
        <Btn
          label={saved ? copy.openApp : copy.saveAndOpen}
          busy={busy}
          onPress={save}
        />
      }
    >
      <Entrance index={0} style={{ marginTop: sp(6) }}>
        <Txt kind="hero" accessibilityRole="header">
          {copy.hero}
        </Txt>
        <Txt kind="body" tone="muted" style={{ marginTop: sp(5) }}>
          {copy.getToKnow(session.residentName)}
        </Txt>
      </Entrance>

      <Entrance index={1} style={{ marginTop: sp(12) }}>
        <DataLabel value={String(facts.length)}>{copy.notesToSave}</DataLabel>
      </Entrance>

      {!!error && (
        <Entrance index={2} style={{ marginTop: sp(8), gap: sp(2) }}>
          <ErrorState inline message={error} onRetry={save} />
          <Txt kind="caption" tone="muted">{/* voice-ok */}
            {copy.nothingSaved}
          </Txt>
          <Btn
            kind="quiet"
            label={copy.skipWithoutSaving}
            onPress={() => { session.finishOnboarding(); router.replace('/(family)/home'); }}
          />
        </Entrance>
      )}
    </Screen>
  );
}
