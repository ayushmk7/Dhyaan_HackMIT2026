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
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { RefreshControl, StyleSheet, View, ViewStyle } from 'react-native';
import Animated, {
  Easing, FadeIn, FadeOut, useAnimatedStyle, useSharedValue, withTiming,
} from 'react-native-reanimated';
import {
  Btn, Card, Chip, CornerTicks, DataLabel, ErrorState, FLOATING_BAR_CLEARANCE, FloatingBar,
  Glass, LoadingState, Marquee, Rule, Stagger, Screen, Txt, useReducedMotion,
} from '@/components';
import { ago, timeOf } from '@/lib/format';
import { api } from '@/lib/api';
import { useCameraMonitor, useCameras } from '@/lib/hooks';
import type { CameraMonitorTick, CameraSummary, GateState, NormBox } from '@/lib/types';
import { useLive } from '@/store/live';
import { useSession } from '@/store/session';
import { motion, palette, radius, rule, sp } from '@/theme/tokens';

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
 * `{camera, online, tick}` (backend/app/routers/camera.py), while `lib/http.ts`
 * types the call as the bare `CameraMonitorTick` and the mock returns the bare
 * shape. Rather than reach into `lib/` — not this agent's files — the console
 * accepts either and refuses anything that is neither. A half-parsed tick
 * renders as `NaN fps`, which is exactly the fabricated console this screen
 * exists to not be.
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
          borderColor: palette.amber,
          backgroundColor: 'rgba(154,107,30,0.06)',
        }}
      />
      <View style={styles.boxTag}>
        <Txt kind="micro" style={{ color: palette.night }}>{`PERSON ${pad(index + 1)}`}</Txt>
      </View>
    </Animated.View>
  );
}

/** Rule-of-thirds guides. Faint on purpose: a grid you notice is a grid in the way. */
function Grid() {
  const line = (s: ViewStyle) => (
    <View style={[{ position: 'absolute', backgroundColor: palette.nightLine, opacity: 0.55 }, s]} />
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
  const stamp = useStamp();
  const [size, setSize] = useState({ w: 0, h: 0 });
  const slots: (NormBox | null)[] = Array.from(
    { length: MAX_BOXES },
    (_, i) => (tick.boxes[i] as NormBox | undefined) ?? null,
  );
  const people = tick.person_count;
  const live = !tick.simulated;

  return (
    <Glass tone="night" radius={radius.glass} lift="float" style={{ padding: sp(1.5) }}>
      <View
        accessibilityRole="image"
        accessibilityLabel={
          `Derived camera view. ${people === 1 ? 'One person' : `${people} people`} in frame. ` +
          `${tick.sentence || 'No sentence yet.'} No video is shown.`
        }
        onLayout={(e) => {
          const { width, height } = e.nativeEvent.layout;
          setSize({ w: width, h: height });
        }}
        style={styles.pane}
      >
        <Grid />

        {size.w > 0 && slots.map((b, i) => (
          <BoxFrame key={i} box={b} index={i} paneW={size.w} paneH={size.h} />
        ))}

        <CornerTicks color={palette.amber} size={16} inset={sp(2.5)} weight={rule.ink} />

        {/* Top chrome: the REC light left, the burned-in clock right. */}
        <View style={[styles.paneRow, { top: sp(3) }]}>
          <View style={styles.recPill}>
            <View
              style={{
                width: 8, height: 8, borderRadius: 4,
                backgroundColor: live ? palette.moss : palette.ochre,
              }}
            />
            <Txt kind="micro" style={{ color: live ? palette.moss : palette.ochre }}>
              {live ? 'REC' : 'SIMULATED'}
            </Txt>
          </View>
          <Txt kind="stamp" tone="nightMuted">{stamp}</Txt>
        </View>

        {/* Bottom chrome: the sentence track burned across the pane. */}
        <View style={styles.captionBar}>
          <Rule color={palette.amber} style={{ opacity: 0.5 }} />
          <SentenceTrack text={tick.sentence?.trim() || 'No sentence yet — the model has not been asked.'} />
        </View>
      </View>
    </Glass>
  );
}

// ---------------------------------------------------------------------------
// The gate cascade (VLM_PLAN §3.3)
// ---------------------------------------------------------------------------

const GATES: { key: GateState; label: string; note: string }[] = [
  { key: 'idle', label: 'IDLE', note: 'sampling' },
  { key: 'motion', label: 'MOTION', note: 'MOG2' },
  { key: 'person', label: 'PERSON', note: 'YOLO11n' },
  { key: 'thinking', label: 'THINKING', note: 'VLM' },
];

function GateCascade({ gate }: { gate: GateState }) {
  const active = GATES.findIndex((g) => g.key === gate);
  return (
    <View style={{ flexDirection: 'row', gap: sp(2) }}>
      {GATES.map((g, i) => {
        const on = i === active;
        const passed = active > i;
        const fg = on ? palette.amber : passed ? palette.ink : palette.inkMuted;
        return (
          <View key={g.key} style={{ flex: 1 }}>
            <Rule
              weight={on ? 'heavy' : 'ink'}
              color={on ? palette.amber : passed ? palette.ink : palette.line}
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
  return (
    <View style={[styles.cell, ruled && styles.cellRuled]}>
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

function Notice({ title, detail, meta, action }: {
  title: string; detail: string; meta?: string; action?: React.ReactNode;
}) {
  return (
    <Card>
      <Txt kind="title">{title}</Txt>
      <Txt kind="body" tone="muted" style={{ marginTop: sp(2) }}>{detail}</Txt>
      {!!action && <View style={{ marginTop: sp(4) }}>{action}</View>}
      {!!meta && <DataLabel style={{ marginTop: sp(3) }}>{meta}</DataLabel>}
    </Card>
  );
}

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
      setTrouble('That didn’t go through. The hub may not be reachable.');
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
      return <LoadingState label="Looking for her camera…" />;
    }
    if (cameras.isError) {
      return (
        <ErrorState
          message="Couldn’t reach the hub to ask what cameras exist."
          onRetry={() => cameras.refetch()}
        />
      );
    }
    if (!cam) {
      return (
        <Notice
          title="No camera is set up."
          detail="Nothing is watching, and nothing is posting. Point a camera at one common room in Settings, then start the vision worker on her computer — this screen fills in the moment it says something."
          action={<Btn kind="quiet" label="Open Settings" onPress={openSettings} />}
        />
      );
    }
    if (!cam.consent) {
      return (
        <Notice
          title="The camera is off."
          detail="Consent for the camera hasn’t been given, so the worker doesn’t run and there is nothing to show. Her band still watches for falls."
          action={<Btn kind="quiet" label="Open Settings" onPress={openSettings} />}
          meta={`CAMERA ${cam.id}`}
        />
      );
    }
    if (pausedUntil) {
      return (
        <Notice
          title={`Paused until ${timeOf(pausedUntil)}.`}
          detail="While it’s paused the worker stops looking, so no ticks arrive and this stays empty. It starts again on its own, or you can resume it below."
          meta={`CAMERA ${cam.id}`}
        />
      );
    }
    if (monitor.isLoading && !tick) {
      return <LoadingState label="Listening for the worker…" />;
    }
    if (monitor.isError) {
      return (
        <ErrorState
          message="Couldn’t reach the hub to ask what the worker is doing. Nothing is being shown rather than something out of date."
          onRetry={() => monitor.refetch()}
        />
      );
    }
    if (!tick) {
      return (
        <Notice
          title="The worker isn’t posting anything."
          detail="Nothing has arrived from her computer in the last few seconds. Start the vision worker there and this fills in by itself. Until then there is nothing to show, and inventing a reading would be worse than an empty screen."
          meta={
            cam.last_heartbeat_at
              ? `LAST HEARTBEAT ${ago(cam.last_heartbeat_at)}`
              : 'NO HEARTBEAT YET'
          }
        />
      );
    }

    return (
      <Stagger gap={5}>
        <View>
          <MonitorPane tick={tick} />
          {/* The one human line on the screen, and the product's best claim. */}
          <Txt kind="caption" tone="muted" style={{ marginTop: sp(3) }}>
            No picture is kept, and none ever leaves her computer. What you are watching is the
            shape the camera found and the sentence it wrote about it — that is the whole of what
            Dhyaan ever has.
          </Txt>
        </View>

        <View>
          <Marquee title="Pipeline" meta={tick.gate} first />
          <GateCascade gate={tick.gate} />
        </View>

        <View>
          <Marquee title="Telemetry" meta={cam.id} first />
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
        <DataLabel>Simulate</DataLabel>
        <Chip label="Meal" onPress={() => run('meal', () => api.simulateCamera('meal'))} />
        <Chip label="Visitor" onPress={() => run('visitor', () => api.simulateCamera('visitor'))} />
        <Chip label="Out of view" onPress={() => run('out', () => api.simulateCamera('out_of_view'))} />
      </View>
      {pausedUntil ? (
        <Btn
          label="Resume the camera"
          busy={busy === 'resume'}
          onPress={() => run('resume', () => api.resumeCamera(cam.id))}
        />
      ) : (
        <Btn
          kind="quiet"
          label="Pause for 2 hours"
          busy={busy === 'pause'}
          onPress={() => run('pause', () => api.pauseCamera(cam.id, 2))}
        />
      )}
      {!!trouble && <Txt kind="caption" tone="muted">{trouble}</Txt>}
    </View>
  ) : null;

  return (
    <View style={{ flex: 1 }}>
      <Screen
        native
        style={{ paddingBottom: FLOATING_BAR_CLEARANCE + sp(6) }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {body}
      </Screen>
      {/* inset={false}: the tab bar already owns the bottom safe area. */}
      {!!bar && <FloatingBar inset={false}>{bar}</FloatingBar>}
    </View>
  );
}

const styles = {
  pane: {
    width: '100%' as const,
    aspectRatio: PANE_RATIO,
    backgroundColor: palette.night,
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
    backgroundColor: 'rgba(16,22,29,0.82)',
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
    backgroundColor: palette.amber,
    paddingHorizontal: sp(1),
    paddingVertical: 1,
  },
  cell: {
    width: '33.333%' as const,
    paddingVertical: sp(2.5),
    paddingRight: sp(2),
  },
  cellRuled: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: palette.line,
  },
};
