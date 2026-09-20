// The camera console — the in-app CCTV, simulated honestly.
//
// The product's hard law (VLM_PLAN §5.3): the vision worker is the only process
// that ever holds pixels. No frame is written to disk, none crosses a socket
// except loopback to Ollama, and the API therefore cannot return one. So this
// screen shows no video, and there is deliberately no endpoint it could ask.
// What it renders instead is the derived scene: normalised box geometry, the
// worker's sentence, and telemetry about the worker itself.
//
// Two rules this file keeps structurally:
//   - No room name (D-001). `CameraMonitorTick` has no zone field and nothing
//     here invents one; the backend already runs `sentence` through
//     `rag.scrub_rooms` before it ever leaves the hub.
//   - Never a fabricated tick. A console reading a confident 12 fps while
//     nothing is running is worse than one that says it has heard nothing —
//     only one of the two can be trusted at 3 am. Every "no tick" path below
//     ends in words, not in zeros.
//
// Voice: machine, and only here. docs/frontend-DESIGN.md bans ALL-CAPS over human prose; the
// telemetry strip is not prose, it is instrumentation, and mono/uppercase is
// the honest face for it. The one human line on the screen is the privacy line
// under the pane, and it is a claim, not an apology.
//
// Colour: the pane is the screen's one plate, and it is the accent wash, not a
// night ground. Nothing here names a dark colour; every fill and every text
// colour comes from the theme or from the surface the text rests on, so the
// console follows the scheme instead of being the one black thing on a light
// screen.
//
// What a person reads lives in lib/copy/family.ts under `camera`, and so do
// the telemetry KEYS (FPS, MODEL, REC): they are names of things. The VALUES
// next to them are never copy — every one is a field off the monitor tick, or
// the one glyph that says the worker left the field empty.
import { useQueryClient } from '@tanstack/react-query';
import { router, useIsFocused } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { RefreshControl, StyleSheet, View, ViewStyle } from 'react-native';
import Animated, {
  Easing, FadeIn, FadeOut, useAnimatedStyle, useSharedValue, withTiming,
} from 'react-native-reanimated';
import {
  Btn, Card, EmptyState, ErrorState, LoadingState, Marquee, Rule, Stagger, Screen, Txt,
  useReducedMotion,
} from '@/components';
import { family } from '@/lib/copy/family';
import { ago, scrubRooms, timeOf } from '@/lib/format';
import { api } from '@/lib/api';
import { useCameraMonitor, useCameras, useNow } from '@/lib/hooks';
import type { CameraMonitorTick, CameraSummary, NormBox } from '@/lib/types';
import { useLive } from '@/store/live';
import { useSession } from '@/store/session';
import { motion, radius, rule, sp, useTheme } from '@/theme';

const copy = family.camera;

// 16:9 is what a webcam and Continuity Camera both hand the worker.
const PANE_RATIO = 16 / 9;
// The backend caps `boxes` at six (MonitorIn), so six animated slots is the
// whole universe. Fixed count = fixed hook count = no conditional hooks.
const MAX_BOXES = 6;

// ---------------------------------------------------------------------------
// Tick hygiene
// ---------------------------------------------------------------------------

const isBox = (b: unknown): b is NormBox =>
  Array.isArray(b) && b.length === 4 && b.every((n) => typeof n === 'number' && n >= 0 && n <= 1);

/**
 * The only tick this screen will render is one that actually looks like a tick.
 *
 * `GET /cameras/{id}/monitor` on the real hub answers with the envelope
 * `{camera, online, tick}` (backend/app/routers/camera.py); `lib/http.ts`
 * unwraps it and the mock returns the bare shape, so both hand this screen a
 * bare tick or null. The envelope branch below is kept anyway: it costs one
 * line and it is the difference between a contract drift showing up as an
 * empty state and showing up as `NaN fps`, which is exactly the fabricated
 * console this screen exists not to be.
 */
function asTick(raw: unknown): CameraMonitorTick | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if ('tick' in o) return asTick(o.tick);
  if (typeof o.fps !== 'number' || !Array.isArray(o.boxes) || typeof o.ts !== 'string') return null;
  return { ...(o as unknown as CameraMonitorTick), boxes: (o.boxes as unknown[]).filter(isBox) };
}

const pad = (n: number) => String(n).padStart(2, '0');

// ---------------------------------------------------------------------------
// The pane
// ---------------------------------------------------------------------------

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);

/** Fill the parent: the sentence layers stack absolutely inside their track. */
const FILL: ViewStyle = { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 };

/**
 * One person box. Normalised geometry in, a hard stroked rectangle out, moved
 * by interpolation rather than teleported — a box that jumps once a second
 * reads as a slideshow, and this is meant to read as a camera.
 *
 * Opacity floors at 0.01, never 0: `expo-glass-effect` kills the liquid effect
 * on a glass view with a zero-opacity ancestor, and this lives inside one.
 */
function BoxFrame({
  box, index, paneW, paneH,
}: { box: NormBox | null; index: number; paneW: number; paneH: number }) {
  const t = useTheme();
  const reduced = useReducedMotion();
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const w = useSharedValue(0);
  const h = useSharedValue(0);
  const o = useSharedValue(0.01);

  useEffect(() => {
    const cfg = { duration: motion.duration.base, easing: Easing.bezier(...motion.ease) };
    const put = (sv: typeof x, v: number) => { sv.value = reduced ? v : withTiming(v, cfg); };
    if (!box || !paneW || !paneH) {
      o.value = reduced ? 0.01 : withTiming(0.01, { duration: motion.duration.quick });
      return;
    }
    const [x0, y0, x1, y1] = box.map(clamp01) as NormBox;
    // A box arriving with its corners the wrong way round is the worker's bug,
    // not a reason to render a negative rectangle.
    const left = Math.min(x0, x1);
    const top = Math.min(y0, y1);
    put(x, left * paneW);
    put(y, top * paneH);
    put(w, Math.max(Math.abs(x1 - x0) * paneW, 2));
    put(h, Math.max(Math.abs(y1 - y0) * paneH, 2));
    o.value = reduced ? 1 : withTiming(1, { duration: motion.duration.quick });
  }, [box, paneW, paneH, reduced, x, y, w, h, o]);

  const style = useAnimatedStyle(() => ({
    position: 'absolute',
    left: x.value,
    top: y.value,
    width: w.value,
    height: h.value,
    opacity: o.value,
  }));

  return (
    <Animated.View pointerEvents="none" style={style}>
      <View
        style={{
          flex: 1,
          borderWidth: rule.ink,
          borderColor: t.accent,
          backgroundColor: t.accentGhost,
        }}
      />
      <View style={[styles.boxTag, { backgroundColor: t.accent }]}>
        {/* Telemetry: the box's own index, not a word. */}
        <Txt kind="micro" style={{ color: t.onAccent }}>{`PERSON ${pad(index + 1)}`}</Txt>
      </View>
    </Animated.View>
  );
}

/**
 * The sentence track. A real cross-fade: the outgoing line dissolves while the
 * incoming one arrives, the way a CCTV overlay swaps burned-in text. Two
 * absolutely-stacked layers, keyed on the sentence — Reanimated keeps the
 * outgoing one mounted for the length of its exit, so they genuinely overlap
 * instead of flickering through the background.
 *
 * Not mono: this is the one string on the pane a person reads as language, and
 * docs/frontend-DESIGN.md's machine face is for instrumentation only.
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

function MonitorPane({ tick }: { tick: CameraMonitorTick }) {
  const t = useTheme();
  const [size, setSize] = useState({ w: 0, h: 0 });
  const slots: (NormBox | null)[] = Array.from(
    { length: MAX_BOXES },
    (_, i) => (tick.boxes[i] as NormBox | undefined) ?? null,
  );
  const people = tick.person_count;
  const live = !tick.simulated;
  // A live feed is ink (a fact); a simulated one is the accent (Dhyaan
  // pointing out that it is not the camera). Neither is a hue.
  const recColor = live ? t.ink : t.accent;

  // The one plate on the screen: the accent wash, bare. No corner ticks, no
  // burned-in clock; the geometry, the REC light and the sentence sit straight
  // on the wash and read in the surface's own ink.
  return (
    <View
      accessibilityRole="image"
      accessibilityLabel={copy.paneLabel(people, tick.sentence)}
      onLayout={(e) => {
        const { width, height } = e.nativeEvent.layout;
        setSize({ w: width, h: height });
      }}
      style={[styles.pane, { backgroundColor: t.accentWash }]}
    >
      {size.w > 0 && slots.map((b, i) => (
        <BoxFrame key={i} box={b} index={i} paneW={size.w} paneH={size.h} />
      ))}

      {/* Top chrome: the REC light, and only that. It is the one reading on
          the pane that changes what a person should believe about it. */}
      <View style={[styles.paneRow, { top: sp(3) }]}>
        <View style={styles.recPill}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: recColor }} />
          <Txt kind="micro" style={{ color: recColor }}>
            {live ? copy.rec : copy.simulated}
          </Txt>
        </View>
      </View>

      {/* Bottom chrome: the sentence track, under one accent rule. */}
      <View style={styles.captionBar}>
        <Rule color={t.accent} />
        <SentenceTrack text={sentenceOf(tick)} />
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Telemetry
// ---------------------------------------------------------------------------

/**
 * The worker's sentence, or the honest line that says it has not written one.
 * The hub already runs `sentence` through `rag.scrub_rooms`; the same regex is
 * run again here (lib/format) so a contract drift on the server cannot put a
 * room name on a family screen. Belt and braces, costing one call.
 */
const sentenceOf = (tick: CameraMonitorTick) => {
  const raw = (tick.sentence ?? '').trim();
  return raw ? scrubRooms(raw) : copy.noSentence;
};

// Readings. Each takes the tick's field and returns the machine's own word or
// number, or the empty glyph when the worker left the field unfilled. None of
// these can produce a value the tick did not carry.
const NONE = copy.none;
const gateOf = (t: CameraMonitorTick) => String(t.gate ?? '').toUpperCase() || NONE;
const peopleOf = (t: CameraMonitorTick) =>
  typeof t.person_count === 'number' ? pad(t.person_count) : NONE;
const activityOf = (t: CameraMonitorTick) =>
  t.activity ? String(t.activity).replace(/_/g, ' ').toUpperCase() : NONE;
const confOf = (t: CameraMonitorTick) =>
  typeof t.confidence === 'number' ? t.confidence.toFixed(2) : NONE;
const fpsOf = (t: CameraMonitorTick) => t.fps.toFixed(1);
const latencyOf = (t: CameraMonitorTick) =>
  typeof t.latency_ms === 'number' ? `${t.latency_ms} MS` : NONE;
const batchOf = (t: CameraMonitorTick) =>
  typeof t.batch_frames === 'number' ? pad(t.batch_frames) : NONE;
const modelOf = (t: CameraMonitorTick) => (t.model ?? '').trim() || NONE;
/** Seconds since the worker stamped this tick, on the phone's clock. Two digits, so the cell never grows. */
const ageOf = (t: CameraMonitorTick, now: number) => {
  const s = Math.round((now - new Date(t.ts).getTime()) / 1000);
  if (!Number.isFinite(s)) return NONE;
  return `${pad(Math.min(99, Math.max(0, s)))} S`;
};

/** One reading: its name on the left, its value on the right. */
function Reading({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <View style={[styles.reading, last ? null : styles.readingRule]}>
      <Txt kind="micro" tone="muted" numberOfLines={1} style={{ flex: 1 }}>{label}</Txt>
      <Txt kind="stamp" numberOfLines={1} style={{ textAlign: 'right' }}>{value}</Txt>
    </View>
  );
}

// A two-column table, not a four-across grid.
//
// The grid gave every reading a quarter of the row, so "qwen2.5vl:3b" and
// "2596 MS" truncated while "04" sat in the same width with room to spare. A
// name on the left and its value on the right lets each take what it needs,
// reads down a single column, and cannot truncate at any sensible width.
//
// The row count is fixed and every row is one line tall whatever it says, so a
// reading changing width once a second still moves nothing. Rows are never
// mounted or unmounted on the tick; an unfilled field shows the glyph in the
// same slot.
function Telemetry({ tick, now }: { tick: CameraMonitorTick; now: number }) {
  const k = copy.keys;
  const rows: { label: string; value: string }[] = [
    // What the pipeline is doing, and what it thinks it sees.
    { label: k.gate, value: gateOf(tick) },
    { label: k.people, value: peopleOf(tick) },
    { label: k.activity, value: activityOf(tick) },
    { label: k.conf, value: confOf(tick) },
    // How it is running.
    { label: k.fps, value: fpsOf(tick) },
    { label: k.latency, value: latencyOf(tick) },
    { label: k.batch, value: batchOf(tick) },
    { label: k.age, value: ageOf(tick, now) },
    { label: k.model, value: modelOf(tick) },
  ];
  return (
    <View>
      {rows.map((r, i) => (
        <Reading key={r.label} label={r.label} value={r.value} last={i === rows.length - 1} />
      ))}
    </View>
  );
}

// ---------------------------------------------------------------------------
// The states where there is nothing to watch. Written before the console was.
// ---------------------------------------------------------------------------

const openSettings = () => router.push('/(family)/settings');

// ---------------------------------------------------------------------------

export default function CameraConsole() {
  const qc = useQueryClient();
  const { residentId, residentName } = useSession();
  const cameras = useCameras();
  const isFocused = useIsFocused();

  const cam: CameraSummary | undefined =
    cameras.data?.find((c) => c.resident_id === residentId) ?? cameras.data?.[0];

  const monitor = useCameraMonitor(cam?.id);
  const socketTick = asTick(useLive((s) => (cam ? s.monitor[cam.id] : undefined)));
  // The hub drops any tick older than 15 s (MONITOR_STALE_S), so a null from the
  // 2 s poll IS the authoritative "nothing is posting" — and it is decided on
  // the one machine that owns both clocks, which no staleness check on this
  // phone could match. The socket is the fast path for the CONTENT of a tick we
  // already know is live, never the evidence that anything is live at all:
  // left alone, the last push would sit in the store forever and this console
  // would keep reading 12 fps over a worker that died an hour ago.
  // Between the two, the newer stamp wins: a socket that went quiet must not
  // keep an older tick in front of a poll that is still arriving.
  const polledTick = monitor.isError ? null : asTick(monitor.data);
  const tick = polledTick
    ? (socketTick && socketTick.ts >= polledTick.ts ? socketTick : polledTick)
    : null;
  // 1 s: the age cell counts in seconds, and the tick itself lands about that often.
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
      return (
        <ErrorState
          message={copy.camerasError}
          onRetry={() => cameras.refetch()}
        />
      );
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
          <EmptyState title={copy.paused(timeOf(pausedUntil))}>
            {copy.pausedBody}
          </EmptyState>
        </Card>
      );
    }
    if (monitor.isLoading && !tick) {
      return <LoadingState label={copy.listening} />;
    }
    if (monitor.isError) {
      return (
        <ErrorState
          message={copy.monitorError}
          onRetry={() => monitor.refetch()}
        />
      );
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

    return (
      <Stagger gap={9}>
        <View>
          <MonitorPane tick={tick} />
          {/* The one human line on the screen, and the product's best claim. */}
          <Txt kind="caption" tone="muted" style={{ marginTop: sp(4) }}>
            {copy.privacy}
          </Txt>
        </View>

        {/* One section for the machine: the tick's readings under one heading. */}
        <View>
          <Marquee title={copy.watching(residentName)} first />
          <Telemetry tick={tick} now={now} />
        </View>
      </Stagger>
    );
  })();

  // Pause is the only control here now. The three canned simulations (meal,
  // visitor, out of view) were an on-stage fallback for a sulking webcam, and
  // they were demo chrome sitting in the family's own floating bar: a family
  // screen should not offer to invent observations about her.
  // `POST /admin/simulate` still exists and the debug panel in Settings still
  // reaches it, so the fallback is not lost, just not on this screen.
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

  // `Screen` owns the bar and its clearance. The default inset is the RAISED
  // one TabBarInsets provides, which is exactly what lifts this bar above the
  // floating tab bar — `floatingBarInset={false}` zeroed it, and the simulate
  // row and the pause button rendered underneath the tab capsule.
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
  },
  captionBar: {
    position: 'absolute' as const,
    left: 0,
    right: 0,
    bottom: 0,
  },
  caption: {
    // Fixed, because the layers inside are absolute and because a caption bar
    // that resizes under a sentence swap is a caption bar that twitches. Sized
    // for two lines of body.
    height: sp(16),
  },
  captionPad: {
    paddingHorizontal: sp(3.5),
    justifyContent: 'center' as const,
  },
  boxTag: {
    position: 'absolute' as const,
    top: 0,
    left: 0,
    paddingHorizontal: sp(1),
    paddingVertical: 1,
  },
  // A hairline between readings, none under the last: the table should look
  // like a table, not like nine separate things.
  readingRule: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(0,0,0,0.06)',
  },
  reading: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    gap: sp(4),
    minHeight: 34,
    paddingVertical: sp(1.5),
  },
};
