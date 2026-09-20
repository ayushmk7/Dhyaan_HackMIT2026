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
// Voice: machine, and only here. DESIGN.md bans ALL-CAPS over human prose; the
// telemetry strip is not prose, it is instrumentation, and mono/uppercase is
// the honest face for it. The one human line on the screen is the privacy line
// under the pane, and it is a claim, not an apology.
//
// What a person reads lives in lib/copy/family.ts under `camera`. The
// telemetry keys and readings (FPS, MODEL, REC, PERSON 01, the gate names) are
// the machine's own and stay here on purpose.
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { RefreshControl, StyleSheet, View, ViewStyle } from 'react-native';
import Animated, {
  Easing, FadeIn, FadeOut, useAnimatedStyle, useSharedValue, withTiming,
} from 'react-native-reanimated';
import {
  Btn, Card, Chip, CornerTicks, DataLabel, EmptyState, ErrorState,
  Glass, LoadingState, Marquee, Rule, Stagger, Screen, Txt, useReducedMotion,
} from '@/components';
import { family } from '@/lib/copy/family';
import { ago, timeOf } from '@/lib/format';
import { api } from '@/lib/api';
import { useCameraMonitor, useCameras } from '@/lib/hooks';
import type { CameraMonitorTick, CameraSummary, GateState, NormBox } from '@/lib/types';
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

/**
 * A clock the screen can read without calling `Date.now()` mid-render. One
 * interval, one number, and everything derived from "is this still true?"
 * hangs off it.
 */
function useNow(everyMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(id);
  }, [everyMs]);
  return now;
}

// ---------------------------------------------------------------------------
// Burned-in clock
// ---------------------------------------------------------------------------

const pad = (n: number) => String(n).padStart(2, '0');
const stampOf = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}  ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

function useStamp(): string {
  const [text, setText] = useState(() => stampOf(new Date()));
  useEffect(() => {
    const id = setInterval(() => setText(stampOf(new Date())), 1000);
    return () => clearInterval(id);
  }, []);
  return text;
}

// ---------------------------------------------------------------------------
// The pane
// ---------------------------------------------------------------------------

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);

/** Fill the parent. Written once; four overlays in this file need it. */
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
          borderColor: t.amber,
          backgroundColor: t.amberGhost,
        }}
      />
      <View style={[styles.boxTag, { backgroundColor: t.amber }]}>
        {/* Telemetry: the box's own index, not a word. */}
        <Txt kind="micro" style={{ color: t.night }}>{`PERSON ${pad(index + 1)}`}</Txt>
      </View>
    </Animated.View>
  );
}

/** Rule-of-thirds guides. Faint on purpose: a grid you notice is a grid in the way. */
function Grid() {
  const t = useTheme();
  const line = (s: ViewStyle) => (
    <View style={[{ position: 'absolute', backgroundColor: t.nightLine, opacity: 0.55 }, s]} />
  );
  return (
    <View pointerEvents="none" style={FILL}>
      {line({ left: '33.33%', top: 0, bottom: 0, width: 1 })}
      {line({ left: '66.66%', top: 0, bottom: 0, width: 1 })}
      {line({ top: '33.33%', left: 0, right: 0, height: 1 })}
      {line({ top: '66.66%', left: 0, right: 0, height: 1 })}
    </View>
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
 * DESIGN.md's machine face is for instrumentation only.
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
        <Txt kind="body" tone="nightInk" accessibilityLiveRegion="polite" numberOfLines={2}>
          {text}
        </Txt>
      </Animated.View>
    </View>
  );
}

function MonitorPane({ tick }: { tick: CameraMonitorTick }) {
  const t = useTheme();
  const stamp = useStamp();
  const [size, setSize] = useState({ w: 0, h: 0 });
  const slots: (NormBox | null)[] = Array.from(
    { length: MAX_BOXES },
    (_, i) => (tick.boxes[i] as NormBox | undefined) ?? null,
  );
  const people = tick.person_count;
  const live = !tick.simulated;
  const recColor = live ? t.moss : t.ochre;

  return (
    <Glass tone="night" radius={radius.glass} lift="float" style={{ padding: sp(1.5) }}>
      <View
        accessibilityRole="image"
        accessibilityLabel={copy.paneLabel(people, tick.sentence)}
        onLayout={(e) => {
          const { width, height } = e.nativeEvent.layout;
          setSize({ w: width, h: height });
        }}
        style={[styles.pane, { backgroundColor: t.night }]}
      >
        <Grid />

        {size.w > 0 && slots.map((b, i) => (
          <BoxFrame key={i} box={b} index={i} paneW={size.w} paneH={size.h} />
        ))}

        <CornerTicks color={t.amber} size={16} inset={sp(2.5)} weight={rule.ink} />

        {/* Top chrome: the REC light left, the burned-in clock right. Both
            readings are telemetry, not words. */}
        <View style={[styles.paneRow, { top: sp(3) }]}>
          <View style={styles.recPill}>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: recColor }} />
            <Txt kind="micro" style={{ color: recColor }}>
              {live ? 'REC' : 'SIMULATED'}
            </Txt>
          </View>
          <Txt kind="stamp" tone="nightMuted">{stamp}</Txt>
        </View>

        {/* Bottom chrome: the sentence track burned across the pane. */}
        <View style={[styles.captionBar, { backgroundColor: t.nightScrim }]}>
          <Rule color={t.amber} style={{ opacity: 0.5 }} />
          <SentenceTrack text={tick.sentence?.trim() || copy.noSentence} />
        </View>
      </View>
    </Glass>
  );
}

// ---------------------------------------------------------------------------
// The gate cascade (VLM_PLAN §3.3)
// ---------------------------------------------------------------------------

// The worker's own stage names and the model behind each. Instrumentation.
const GATES: { key: GateState; label: string; note: string }[] = [
  { key: 'idle', label: 'IDLE', note: 'sampling' },
  { key: 'motion', label: 'MOTION', note: 'MOG2' },
  { key: 'person', label: 'PERSON', note: 'YOLO11n' },
  { key: 'thinking', label: 'THINKING', note: 'VLM' },
];

function GateCascade({ gate }: { gate: GateState }) {
  const t = useTheme();
  const active = GATES.findIndex((g) => g.key === gate);
  return (
    <View style={{ flexDirection: 'row', gap: sp(2) }}>
      {GATES.map((g, i) => {
        const on = i === active;
        const passed = active > i;
        const fg = on ? t.amber : passed ? t.ink : t.inkMuted;
        return (
          <View key={g.key} style={{ flex: 1 }}>
            <Rule
              weight={on ? 'heavy' : 'ink'}
              color={on ? t.amber : passed ? t.ink : t.line}
            />
            <View style={{ paddingTop: sp(2) }}>
              <Txt kind="micro" style={{ color: fg }}>{g.label}</Txt>
              <Txt kind="micro" tone="muted" style={{ marginTop: 2, opacity: 0.7 }}>{g.note}</Txt>
            </View>
          </View>
        );
      })}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Telemetry
// ---------------------------------------------------------------------------

function Cell({ label, value, ruled }: { label: string; value: string; ruled: boolean }) {
  const t = useTheme();
  return (
    <View style={[styles.cell, ruled && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.line }]}>
      <Txt kind="micro" tone="muted">{label}</Txt>
      <Txt
        kind="mono"
        numberOfLines={1}
        style={{ marginTop: sp(1), fontSize: 15, lineHeight: 20 }}
      >
        {value}
      </Txt>
    </View>
  );
}

// Keys and readings are the worker's own. Not copy.
function Telemetry({ tick }: { tick: CameraMonitorTick }) {
  const cells: { label: string; value: string }[] = [
    { label: 'FPS', value: tick.fps.toFixed(1) },
    { label: 'LATENCY', value: tick.latency_ms == null ? '—' : `${tick.latency_ms} ms` },
    { label: 'BATCH', value: `${tick.batch_frames} f` },
    { label: 'PEOPLE', value: `${tick.person_count}` },
    { label: 'GATE', value: tick.gate.toUpperCase() },
    { label: 'CONF', value: tick.confidence == null ? '—' : tick.confidence.toFixed(2) },
    { label: 'ACTIVITY', value: (tick.activity ?? '—').replace(/_/g, ' ').toUpperCase() },
    { label: 'SOURCE', value: tick.simulated ? 'SIMULATED' : 'CAMERA' },
    { label: 'MODEL', value: tick.model || '—' },
  ];
  return (
    <View>
      <Rule />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {cells.map((c, i) => (
          <Cell key={c.label} label={c.label} value={c.value} ruled={i < cells.length - 3} />
        ))}
      </View>
      <Rule weight="hair" />
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
  const { residentId } = useSession();
  const cameras = useCameras();

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
  const polledTick = monitor.isError ? null : asTick(monitor.data);
  const tick = polledTick ? (socketTick ?? polledTick) : null;
  const now = useNow(5000);

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
            meta={copy.meta.camera(cam.id)}
          >
            {copy.consentOffBody}
          </EmptyState>
        </Card>
      );
    }
    if (pausedUntil) {
      return (
        <Card>
          <EmptyState title={copy.paused(timeOf(pausedUntil))} meta={copy.meta.camera(cam.id)}>
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
      <Stagger gap={5}>
        <View>
          <MonitorPane tick={tick} />
          {/* The one human line on the screen, and the product's best claim. */}
          <Txt kind="caption" tone="muted" style={{ marginTop: sp(3) }}>
            {copy.privacy}
          </Txt>
        </View>

        <View>
          <Marquee title={copy.pipeline} meta={tick.gate} first />
          <GateCascade gate={tick.gate} />
        </View>

        <View>
          <Marquee title={copy.telemetry} meta={cam.id} first />
          <Telemetry tick={tick} />
        </View>
      </Stagger>
    );
  })();

  // The controls stay available in every state a camera exists in — the canned
  // simulations are the on-stage fallback for exactly the moment the webcam
  // sulks and the screen above is one of the empty ones.
  const bar = cam ? (
    <View style={{ gap: sp(2.5) }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp(2), flexWrap: 'wrap' }}>
        <DataLabel>{copy.simulate}</DataLabel>
        <Chip label={copy.meal} onPress={() => run('meal', () => api.simulateCamera('meal'))} />
        <Chip label={copy.visitor} onPress={() => run('visitor', () => api.simulateCamera('visitor'))} />
        <Chip label={copy.outOfView} onPress={() => run('out', () => api.simulateCamera('out_of_view'))} />
      </View>
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

  // `Screen` owns the bar and its clearance: the tab bar raises the bottom
  // inset, and a hand-rolled paddingBottom here lost it.
  return (
    <Screen
      native
      wash
      floatingBar={bar}
      floatingBarInset={false}
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
    // that resizes under a sentence swap is a caption bar that twitches.
    height: sp(14),
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
  cell: {
    width: '33.333%' as const,
    paddingVertical: sp(2.5),
    paddingRight: sp(2),
  },
};
