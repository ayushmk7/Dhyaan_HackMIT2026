// The camera console — what the hub is looking at, as the hub sees it.
//
// This screen used to render geometry only: normalised boxes on a wash, and a
// sentence. The law it was built around (VLM_PLAN §5.3) was that the vision
// worker is the only process that ever holds pixels, so there was deliberately
// no endpoint the app could ask for a picture.
//
// That law is relaxed for this build, on purpose, and it is worth saying
// plainly here: the hub now posts the SAME annotated frame it draws in its own
// window to `POST /ingest/camera/frame`, the API keeps exactly one of them in
// RAM, and this screen pulls it about five times a second. A frame therefore
// crosses the network. What has not changed: no frame is written to disk on
// either side, none is stored in Mongo, and a camera whose consent is off or
// which is paused cannot post one at all (the API fails closed on that, not
// this screen). The honest version of that trade is in `copy.privacy`, which
// is the one human line on the page.
//
// Two rules this file still keeps structurally:
//   - No room name (D-001). The tick has no zone field, and the sentence is run
//     through `scrubRooms` here as well as on the hub.
//   - Never a fabricated reading. No picture and no tick means words saying so,
//     never a still frame left over from a minute ago — the API drops a frame
//     older than five seconds for exactly that reason.
//
// The page is deliberately almost empty: the picture, the sentence burned under
// it, one claim, and the pause control. The telemetry table that used to sit
// under it (FPS, LATENCY, BATCH and the rest) was the engineer's instrument on
// the family's screen.
//
// What a person reads lives in lib/copy/family.ts under `camera`.
import { useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { router, useIsFocused } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { RefreshControl, View, ViewStyle } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import {
  Btn, Card, EmptyState, ErrorState, LoadingState, Rule, Screen, Txt, useReducedMotion,
} from '@/components';
import { api } from '@/lib/api';
import { API_BASE } from '@/lib/config';
import { family } from '@/lib/copy/family';
import { ago, scrubRooms, timeOf } from '@/lib/format';
import { useCameraMonitor, useCameras, useNow } from '@/lib/hooks';
import type { CameraMonitorTick, CameraSummary } from '@/lib/types';
import { useLive } from '@/store/live';
import { useSession } from '@/store/session';
import { motion, radius, sp, useTheme } from '@/theme';

const copy = family.camera;

// 16:9 is what a webcam and Continuity Camera both hand the worker.
const PANE_RATIO = 16 / 9;

// Five a second. The worker encodes at that rate too (VISION_STREAM), so asking
// faster only spends battery re-fetching a frame the hub has not replaced yet.
const FRAME_MS = 200;

// ---------------------------------------------------------------------------
// Tick hygiene
// ---------------------------------------------------------------------------

/**
 * The only tick this screen will render is one that actually looks like a tick.
 *
 * `GET /cameras/{id}/monitor` on the real hub answers with the envelope
 * `{camera, online, tick}`; `lib/http.ts` unwraps it and the mock returns the
 * bare shape. The envelope branch costs one line and is the difference between
 * a contract drift showing up as an empty state and showing up as `NaN`.
 */
function asTick(raw: unknown): CameraMonitorTick | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if ('tick' in o) return asTick(o.tick);
  if (typeof o.fps !== 'number' || typeof o.ts !== 'string') return null;
  return { ...(o as unknown as CameraMonitorTick), boxes: [] };
}

/**
 * The worker's sentence, or the honest line that says it has not written one.
 * The hub already runs `sentence` through `rag.scrub_rooms`; the same regex is
 * run again here so a contract drift on the server cannot put a room name on a
 * family screen. Belt and braces, costing one call.
 */
const sentenceOf = (tick: CameraMonitorTick) => {
  const raw = (tick.sentence ?? '').trim();
  return raw ? scrubRooms(raw) : copy.noSentence;
};

// ---------------------------------------------------------------------------
// The pane
// ---------------------------------------------------------------------------

/** Fill the parent: the sentence layers stack absolutely inside their track. */
const FILL: ViewStyle = { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 };

/**
 * The sentence track. A real cross-fade: the outgoing line dissolves while the
 * incoming one arrives, the way a CCTV overlay swaps burned-in text.
 */
function SentenceTrack({ text }: { text: string }) {
  const reduced = useReducedMotion();
  const dur = motion.duration.base;
  return (
    <View style={styles.caption}>
      <Animated.View
        key={text}
        entering={reduced ? undefined : FadeIn.duration(dur)}
        exiting={reduced ? undefined : FadeOut.duration(dur)}
        style={[FILL, styles.captionPad]}
      >
        <Txt kind="body" accessibilityLiveRegion="polite" numberOfLines={2}>
          {text}
        </Txt>
      </Animated.View>
    </View>
  );
}

/**
 * The picture. One `Image` whose URL carries a counter, swapped five times a
 * second: `expo-image` keeps the frame it has on screen until the next one has
 * decoded, so this reads as a camera rather than as a slideshow with white
 * between the slides. `cachePolicy="none"` because every one of these is
 * different and none is worth keeping.
 *
 * When the API has no fresh frame it answers 404, `onError` fires, and the pane
 * falls back to the wash with the sentence still on it. That is the honest
 * state: it says "no picture", it does not leave the last one up.
 */
function LiveFrame({ cameraId, tick, live }: {
  cameraId: string; tick: CameraMonitorTick; live: boolean;
}) {
  const t = useTheme();
  const isFocused = useIsFocused();
  const [n, setN] = useState(0);
  const [havePicture, setHavePicture] = useState(false);

  useEffect(() => {
    if (!isFocused) return;
    const id = setInterval(() => setN((v) => v + 1), FRAME_MS);
    return () => clearInterval(id);
  }, [isFocused]);

  // A live feed is ink (a fact); a simulated one is the accent (Dhyaan pointing
  // out that it is not the camera). Neither is a hue.
  const recColor = live ? t.ink : t.accent;

  return (
    <View
      accessibilityRole="image"
      accessibilityLabel={copy.paneLabel(tick.person_count, sentenceOf(tick))}
      style={[styles.pane, { backgroundColor: t.accentWash }]}
    >
      <Image
        source={{ uri: `${API_BASE}/cameras/${cameraId}/frame?n=${n}` }}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
        contentFit="cover"
        cachePolicy="none"
        transition={0}
        // One view, reused for every frame. Without this `expo-image` treats
        // each URL as a new image and tears the old one down first, which is
        // the flicker this screen cannot have.
        recyclingKey={cameraId}
        onLoad={() => setHavePicture(true)}
        onError={() => setHavePicture(false)}
      />

      {/* Top chrome: the REC light, and only that. */}
      <View style={[styles.paneRow, { top: sp(3) }]}>
        <View style={[styles.recPill, { backgroundColor: t.raised }]}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: recColor }} />
          <Txt kind="micro" style={{ color: recColor }}>
            {live ? copy.rec : copy.simulated}
          </Txt>
        </View>
      </View>

      {/* Bottom chrome: the sentence track, under one accent rule. */}
      <View style={[styles.captionBar, { backgroundColor: t.raised }]}>
        <Rule color={t.accent} />
        <SentenceTrack text={havePicture ? sentenceOf(tick) : copy.noPicture} />
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------

const openSettings = () => router.push('/(family)/settings');

export default function CameraConsole() {
  const qc = useQueryClient();
  const { residentId } = useSession();
  const cameras = useCameras();
  const isFocused = useIsFocused();

  const cam: CameraSummary | undefined =
    cameras.data?.find((c) => c.resident_id === residentId) ?? cameras.data?.[0];

  const monitor = useCameraMonitor(cam?.id);
  const socketTick = asTick(useLive((s) => (cam ? s.monitor[cam.id] : undefined)));
  // The hub drops any tick older than 15 s (MONITOR_STALE_S), so a null from the
  // 2 s poll IS the authoritative "nothing is posting" — and it is decided on
  // the one machine that owns both clocks. The socket is the fast path for the
  // CONTENT of a tick we already know is live, never the evidence that anything
  // is live at all. Between the two, the newer stamp wins.
  const polledTick = monitor.isError ? null : asTick(monitor.data);
  const tick = polledTick
    ? (socketTick && socketTick.ts >= polledTick.ts ? socketTick : polledTick)
    : null;
  // Only while the console is on screen: the tab stays mounted behind you, and
  // a clock nobody is reading is just battery.
  const now = useNow(1000, isFocused);

  const [busy, setBusy] = useState<string | null>(null);
  const [trouble, setTrouble] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const run = useCallback(async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setTrouble(null);
    try {
      await fn();
      await qc.invalidateQueries({ queryKey: ['cameras'] });
      await qc.invalidateQueries({ queryKey: ['monitor'] });
      await qc.invalidateQueries({ queryKey: ['presence'] });
    } catch {
      setTrouble(copy.trouble);
    } finally {
      setBusy(null);
    }
  }, [qc]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await qc.invalidateQueries();
    setRefreshing(false);
  }, [qc]);

  const pausedUntil =
    cam?.paused_until && new Date(cam.paused_until).getTime() > now ? cam.paused_until : null;

  // ---- what the screen is actually allowed to say -------------------------
  const body = (() => {
    if (cameras.isLoading && !cameras.data) {
      return <LoadingState label={copy.loading} />;
    }
    if (cameras.isError) {
      return <ErrorState message={copy.camerasError} onRetry={() => cameras.refetch()} />;
    }
    if (!cam) {
      return (
        <Card>
          <EmptyState
            title={copy.noCamera}
            action={<Btn kind="quiet" label={copy.openSettings} onPress={openSettings} />}
          >
            {copy.noCameraBody}
          </EmptyState>
        </Card>
      );
    }
    if (!cam.consent) {
      return (
        <Card>
          <EmptyState
            title={copy.consentOff}
            action={<Btn kind="quiet" label={copy.openSettings} onPress={openSettings} />}
          >
            {copy.consentOffBody}
          </EmptyState>
        </Card>
      );
    }
    if (pausedUntil) {
      return (
        <Card>
          <EmptyState title={copy.paused(timeOf(pausedUntil))}>{copy.pausedBody}</EmptyState>
        </Card>
      );
    }
    if (monitor.isLoading && !tick) {
      return <LoadingState label={copy.listening} />;
    }
    if (monitor.isError) {
      return <ErrorState message={copy.monitorError} onRetry={() => monitor.refetch()} />;
    }
    if (!tick) {
      return (
        <Card>
          <EmptyState
            title={copy.notPosting}
            meta={
              cam.last_heartbeat_at
                ? copy.meta.lastHeartbeat(ago(cam.last_heartbeat_at))
                : copy.meta.noHeartbeat
            }
          >
            {copy.notPostingBody}
          </EmptyState>
        </Card>
      );
    }

    // The whole screen: the picture, and one line about what it costs.
    return (
      <View>
        <LiveFrame cameraId={cam.id} tick={tick} live={!tick.simulated} />
        <Txt kind="caption" tone="muted" style={{ marginTop: sp(4) }}>
          {copy.privacy}
        </Txt>
      </View>
    );
  })();

  // Pause is the only control here. The three canned simulations were an
  // on-stage fallback for a sulking webcam, and they were demo chrome in the
  // family's own bar: a family screen should not offer to invent observations
  // about her. `POST /admin/simulate` still exists behind Settings' debug panel.
  const bar = cam ? (
    <View style={{ gap: sp(2.5) }}>
      {pausedUntil ? (
        <Btn
          label={copy.resume}
          busy={busy === 'resume'}
          onPress={() => run('resume', () => api.resumeCamera(cam.id))}
        />
      ) : (
        <Btn
          kind="quiet"
          label={copy.pauseTwoHours}
          busy={busy === 'pause'}
          onPress={() => run('pause', () => api.pauseCamera(cam.id, 2))}
        />
      )}
      {!!trouble && <ErrorState inline message={trouble} />}
    </View>
  ) : null;

  return (
    <Screen
      native
      wash
      floatingBar={bar}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      {body}
    </Screen>
  );
}

// Geometry only. Every colour is resolved inside the component that draws it,
// through useTheme(), so the console follows the colour scheme.
const styles = {
  pane: {
    width: '100%' as const,
    aspectRatio: PANE_RATIO,
    borderRadius: radius.card,
    overflow: 'hidden' as const,
  },
  paneRow: {
    position: 'absolute' as const,
    left: sp(4),
    right: sp(4),
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
  },
  recPill: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: sp(1.5),
    // The light sits ON the picture now, so it carries its own ground. Without
    // it the dot and its word land on whatever the camera happens to see.
    paddingHorizontal: sp(2),
    paddingVertical: sp(1),
    borderRadius: radius.pill,
  },
  captionBar: {
    position: 'absolute' as const,
    left: 0,
    right: 0,
    bottom: 0,
  },
  caption: {
    // Fixed, because the layers inside are absolute and because a caption bar
    // that resizes under a sentence swap is a caption bar that twitches.
    height: sp(16),
  },
  captionPad: {
    paddingHorizontal: sp(3.5),
    justifyContent: 'center' as const,
  },
};
