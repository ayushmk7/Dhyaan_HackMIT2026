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
import { RefreshControl, View } from 'react-native';
import {
  Btn, Card, EmptyState, ErrorState, LoadingState, Screen, Txt,
} from '@/components';
import { api } from '@/lib/api';
import { API_BASE } from '@/lib/config';
import { family } from '@/lib/copy/family';
import { ago, scrubRooms, whenOf } from '@/lib/format';
import { useCameraMonitor, useCameras, useNow, useResidentLocation } from '@/lib/hooks';
import type { CameraMonitorTick, CameraSummary, ResidentLocation } from '@/lib/types';
import { useLive } from '@/store/live';
import { useSession } from '@/store/session';
import { radius, sp, useTheme } from '@/theme';

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
function LiveFrame({ cameraId, live }: { cameraId: string; live: boolean }) {
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
    <View style={[styles.pane, { backgroundColor: t.accentWash }]}>
      <Image
        source={{ uri: `${API_BASE}/cameras/${cameraId}/frame?n=${n}` }}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
        // `contain`, not `cover`. The hub hands over a 16:9 frame and the pane
        // is 16:9, so in the ordinary case the two agree exactly and nothing is
        // cropped — but a webcam that hands over 4:3 was having a fifth of the
        // room cut off its sides, which on a camera page is the one thing that
        // must not happen silently.
        contentFit="contain"
        cachePolicy="none"
        transition={0}
        // One view, reused for every frame. Without this `expo-image` treats
        // each URL as a new image and tears the old one down first, which is
        // the flicker this screen cannot have.
        recyclingKey={cameraId}
        onLoad={() => setHavePicture(true)}
        onError={() => setHavePicture(false)}
      />

      {/* The one thing burned onto the picture. Everything else reads below it,
          where it has room, rather than covering a third of the room. */}
      <View style={[styles.recPill, { backgroundColor: t.raised }]}>
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: recColor }} />
        <Txt kind="micro" style={{ color: recColor }}>
          {live ? copy.rec : copy.simulated}
        </Txt>
      </View>

      {!havePicture && (
        <View style={styles.noPicture}>
          <Txt kind="caption" tone="muted" style={{ textAlign: 'center' }}>{copy.noPicture}</Txt>
        </View>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// The readings
// ---------------------------------------------------------------------------

/**
 * One highlight: its name small and quiet, its value under it in the machine
 * face. Two of these to a row, so the whole console is four rows rather than
 * three headed tables — the readings are a glance, not a report.
 */
function Cell({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.cell}>
      <Txt kind="micro" tone="muted" numberOfLines={1}>{label}</Txt>
      <Txt kind="stamp" numberOfLines={1} style={{ marginTop: 1 }}>{value}</Txt>
    </View>
  );
}

// Each reading is the tick's own word or number, or the glyph that says the
// worker left the field empty. None of these can produce a value the tick did
// not carry.
const NONE = copy.none;
const word = (v: string | null | undefined) =>
  v ? String(v).replace(/_/g, ' ').toUpperCase() : NONE;
const list = (v: string[] | undefined) =>
  v && v.length ? v.join(', ').toUpperCase() : NONE;
const pad = (n: number) => String(n).padStart(2, '0');

/**
 * Eating, as a yes or a no, because that is the question a family actually
 * asks. Derived from the activity the model committed to, never from the food
 * words alone: a sandwich on the table is not a meal, and the row directly
 * under this one shows those words so the answer can be checked rather than
 * taken on faith.
 */
const eatingOf = (t: CameraMonitorTick) =>
  t.activity == null ? NONE
    : t.activity === 'eating' || t.activity === 'drinking' ? copy.yes
      : copy.no;

/** Seconds since the worker stamped this tick, on the phone's clock. */
const ageOf = (t: CameraMonitorTick, now: number) => {
  const s = Math.round((now - new Date(t.ts).getTime()) / 1000);
  if (!Number.isFinite(s)) return NONE;
  return `${pad(Math.min(99, Math.max(0, s)))} S`;
};

/**
 * Where the BEACONS put her, which is the one reading on this screen that does
 * not come from the camera at all: the ESP32s report RSSI, `app/location.py`
 * classifies it against the room survey, and the answer is a room and a
 * confidence. Room level by design — there is no position to show and nothing
 * here could draw one.
 *
 * On the console deliberately, and nowhere else: D-001 keeps room names off
 * every other family surface, and the sentence beside this one is still
 * scrubbed of them.
 */
const whereOf = (loc: ResidentLocation | null | undefined) => {
  if (!loc?.label) return NONE;
  const pct = typeof loc.confidence === 'number' ? ` ${Math.round(loc.confidence * 100)}%` : '';
  return `${loc.label.toUpperCase()}${pct}`;
};

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
  const location = useResidentLocation(residentId);
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
          <EmptyState title={copy.paused(whenOf(pausedUntil))}>
            {cam.paused_by === 'resident' ? copy.herPause : copy.pausedBody}
          </EmptyState>
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

    const k = copy.keys;
    return (
      <View>
        <LiveFrame cameraId={cam.id} live={!tick.simulated} />
        {/* The sentence sits UNDER the picture. Burned across the bottom of the
            pane it covered a third of the room and had to be clamped to two
            lines; here it has the width of the screen. */}
        <Txt kind="body" accessibilityLiveRegion="polite" style={{ marginTop: sp(4) }}>
          {sentenceOf(tick)}
        </Txt>

        {/* Everything the hub window prints, as eight highlights on one plate.
            The three headed tables this replaced said the same things down a
            screen and a half of scrolling. */}
        <Card style={{ marginTop: sp(5) }}>
          <View style={styles.grid}>
            <Cell label={k.posture} value={word(tick.posture)} />
            <Cell label={k.activity} value={word(tick.activity)} />
            <Cell label={k.eating} value={eatingOf(tick)} />
            <Cell label={k.where} value={whereOf(location.data)} />
            <Cell label={k.people} value={pad(tick.person_count)} />
            <Cell label={k.seating} value={list(tick.seating)} />
            <Cell label={k.food} value={list(tick.food)} />
            <Cell label={k.dishes} value={list(tick.dishes)} />
          </View>
        </Card>

        {/* The worker's own state, on one line. It is context for the eight
            above, not a reading about her, so it does not get a plate. */}
        <Txt kind="micro" tone="muted" numberOfLines={1} style={{ marginTop: sp(3) }}>
          {[word(tick.gate),
            typeof tick.confidence === 'number' ? tick.confidence.toFixed(2) : NONE,
            ageOf(tick, now),
            (tick.model ?? '').trim() || NONE].join('  ·  ')}
        </Txt>

        <Txt kind="caption" tone="muted" style={{ marginTop: sp(5) }}>{copy.privacy}</Txt>
      </View>
    );
  })();

  // One switch, and it is the only control on the screen. Underneath it is the
  // pause the API already has, so "off" has an end: the longest the contract
  // allows is 24 hours (PauseIn caps it), and the camera coming back by itself
  // is a safety property, not an oversight — a camera nobody remembers to turn
  // on is the failure this product cannot have. The line under the switch says
  // when, so the button never implies more than it does.
  //
  // Her own pause is not offered here at all (§8.3): the family can lift a
  // pause they set and cannot lift hers, and a button that 403s is worse than
  // no button.
  const hers = pausedUntil && cam?.paused_by === 'resident';
  const bar = cam && !hers ? (
    <View style={{ gap: sp(2.5) }}>
      {pausedUntil ? (
        <Btn
          label={copy.turnOn}
          busy={busy === 'switch'}
          onPress={() => run('switch', () => api.resumeCamera(cam.id))}
        />
      ) : (
        <Btn
          kind="quiet"
          label={copy.turnOff}
          busy={busy === 'switch'}
          onPress={() => run('switch', () => api.pauseCamera(cam.id, 24))}
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
  recPill: {
    position: 'absolute' as const,
    top: sp(3),
    left: sp(3),
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: sp(1.5),
    // The light sits ON the picture, so it carries its own ground. Without it
    // the dot and its word land on whatever the camera happens to see.
    paddingHorizontal: sp(2),
    paddingVertical: sp(1),
    borderRadius: radius.pill,
  },
  noPicture: {
    position: 'absolute' as const,
    left: sp(6),
    right: sp(6),
    top: 0,
    bottom: 0,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  grid: {
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    rowGap: sp(4),
  },
  // Exactly half, so the second column starts on the same line down every row.
  // A value too long for its half truncates rather than reflowing the grid.
  cell: { width: '50%' as const, paddingRight: sp(3) },
};
