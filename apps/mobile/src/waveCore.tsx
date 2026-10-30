import React, { useEffect, useMemo, useRef, useState } from "react";
import { AppState, StyleSheet, Text, View } from "react-native";
import { BlurMask, Canvas, Group, LinearGradient, Path, RadialGradient, Rect, Skia, vec, type SkPath } from "@shopify/react-native-skia";
import { WAVE_REACH, fillLock, fillRise, historyTicks, pulseKick, pulsesForRise, restAmplitude, softLimit, springStep, waveEnvelope, WAVE_HISTORY_MS, WAVE_PULSE_MS, type WavePulse } from "./waveCoreModel";
import { calmColors } from "./uiKitModel";
import { readableFont, wavePalette } from "./designSystem";

/**
 * UNUSED since 2026-10-28 (the Now tab draws IslandCore); kept so the wave can be restored.
 * The wave, the motion graphic of "지금" (owner-chosen 2026-10-26): overlapping blue, cyan and violet light waves. A real rise in the
 * decision count kicks the waves up and sends a pulse of light along them; a real rise in PAPER orders adds a pink wave and glow;
 * the strip below keeps one tick per rise seen in the last minute. Without data the waves lie flat and grey. Presentation only: it
 * draws counts the screen already has and invents nothing. Reduce-motion (or before the OS answers) draws one settled frame, and
 * frames stop while the app is in the background.
 */
const FRAME_MS = 33;
const STEPS = 96;
interface WaveSpec { readonly color: string; readonly f: number; readonly s: number; readonly o: number; readonly a: number; readonly kind: "front" | "back" | "order" }
const WAVES: readonly WaveSpec[] = [
  { color: wavePalette.deepBlue, f: 3.1, s: -0.7, o: 2.2, a: 0.25, kind: "back" },
  { color: wavePalette.lilac, f: 0.8, s: 0.5, o: 5.0, a: 0.28, kind: "back" },
  { color: wavePalette.blue, f: 1.6, s: 1.0, o: 0, a: 1, kind: "front" },
  { color: wavePalette.cyan, f: 2.3, s: -1.3, o: 1.7, a: 0.75, kind: "front" },
  { color: wavePalette.violet, f: 1.2, s: 0.8, o: 3.1, a: 0.9, kind: "front" },
  { color: wavePalette.pink, f: 2.0, s: 1.6, o: 4.4, a: 0, kind: "order" },
];

function wavePath(w: WaveSpec, width: number, cy: number, amp: number, reach: number, phase: number, pulses: readonly WavePulse[], now: number, lock: number): SkPath {
  const f = w.f + (1.6 - w.f) * lock, s = w.s + (1 - w.s) * lock, o = w.o * (1 - lock);
  const path = Skia.Path.Make();
  for (let i = 0; i <= STEPS; i += 1) {
    const x = i / STEPS;
    const y = cy + softLimit(Math.sin(x * Math.PI * 2 * f + phase * s + o) * waveEnvelope(x, pulses, now) * amp, reach);
    if (i === 0) path.moveTo(x * width, y); else path.lineTo(x * width, y);
  }
  return path;
}

export function WaveCore({ decisionCount, orderCount, fillCount = null, live, compact = false, width, reducedMotion, testID = "now-core" }: {
  readonly decisionCount: number | null;
  readonly orderCount: number | null;
  /** Today's PAPER fill count; each rise draws the waves into one line and sends a shockwave. */
  readonly fillCount?: number | null;
  readonly live: boolean;
  /** Shorter box for the no-data state, so a flat line does not leave a large empty panel. */
  readonly compact?: boolean;
  readonly width: number;
  readonly reducedMotion: boolean | null;
  readonly testID?: string;
}) {
  const height = Math.round(width * (compact ? 0.5 : 0.78));
  const cy = Math.round(height * 0.46);
  const pulses = useRef<readonly WavePulse[]>([]);
  const ticks = useRef<readonly WavePulse[]>([]);
  const lastDecisions = useRef<number | null>(decisionCount);
  const lastOrders = useRef<number | null>(orderCount);
  const lastFills = useRef<number | null>(fillCount);
  const fillAt = useRef<number | null>(null);
  const fillTicks = useRef<readonly number[]>([]);
  const state = useRef({ amp: restAmplitude(live, 0), v: 0, energy: 0, pink: 0, flat: live ? 0 : 1, phase: 0 });
  const liveRef = useRef(live);
  liveRef.current = live;
  const [frame, setFrame] = useState(0);
  const [active, setActive] = useState(AppState.currentState === "active");

  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => setActive(s === "active"));
    return () => sub.remove();
  }, []);
  useEffect(() => {
    const now = Date.now();
    const fresh = pulsesForRise(lastDecisions.current, decisionCount, lastOrders.current, orderCount, now);
    lastDecisions.current = decisionCount;
    lastOrders.current = orderCount;
    if (fresh.length === 0) return;
    ticks.current = [...ticks.current, ...fresh].filter((t) => now - t.born <= WAVE_HISTORY_MS);
    if (reducedMotion !== false) { setFrame((n) => n + 1); return; }
    pulses.current = [...pulses.current, ...fresh].slice(-8);
    const st = state.current;
    for (const p of fresh) { st.v += pulseKick(p.order); st.energy = Math.min(1.5, st.energy + 0.4); if (p.order) st.pink = 1; }
  }, [decisionCount, orderCount, reducedMotion]);
  useEffect(() => {
    const n = fillRise(lastFills.current, fillCount);
    lastFills.current = fillCount;
    if (n === 0) return;
    const now = Date.now();
    fillTicks.current = [...fillTicks.current, ...Array.from({ length: n }, (_, i) => now + i * 260)].filter((t) => now - t <= WAVE_HISTORY_MS);
    if (reducedMotion !== false) { setFrame((k) => k + 1); return; }
    fillAt.current = now;
    state.current.v += 4;
  }, [fillCount, reducedMotion]);
  useEffect(() => {
    if (reducedMotion !== false) { setFrame((n) => n + 1); return undefined; }
    if (!active) return undefined;
    let alive = true, last = 0, handle = 0;
    const loop = (ts: number) => {
      if (!alive) return;
      if (!liveRef.current && state.current.flat > 0.99 && pulses.current.length === 0 && state.current.pink < 0.02) { setFrame((n) => n + 1); return; }
      if (ts - last >= FRAME_MS) {
        const dt = last === 0 ? 0 : Math.min(0.1, (ts - last) / 1000); last = ts;
        const st = state.current, isLive = liveRef.current, now = Date.now();
        const next = springStep(st.amp, st.v, restAmplitude(isLive, st.energy), dt);
        st.amp = next.amp; st.v = next.velocity;
        st.energy *= Math.exp(-dt / 3); st.pink *= Math.exp(-dt / 1.8);
        st.flat += ((isLive ? 0 : 1) - st.flat) * Math.min(1, dt * 2.5);
        st.phase += dt * (isLive ? 0.7 + st.energy * 4 : 0);
        pulses.current = pulses.current.filter((p) => now - p.born < WAVE_PULSE_MS);
        setFrame((n) => n + 1);
      }
      handle = requestAnimationFrame(loop);
    };
    handle = requestAnimationFrame(loop);
    return () => { alive = false; cancelAnimationFrame(handle); };
  }, [reducedMotion, active, live]);

  useEffect(() => {
    // Reduce-motion only redraws on events, so age out the last-minute ticks every few seconds while any are left.
    if (reducedMotion !== false) {
      const timer = setInterval(() => { if (ticks.current.length > 0 || fillTicks.current.length > 0) setFrame((n) => n + 1); }, 5000);
      return () => clearInterval(timer);
    }
    return undefined;
  }, [reducedMotion]);

  const scene = useMemo(() => {
    const st = state.current, now = Date.now();
    if (reducedMotion !== false) { st.flat = live ? 0 : 1; st.amp = restAmplitude(live, 0); }
    const amp = height * 0.105 * st.amp * (1 - st.flat * 0.97);
    const waves = WAVES.map((w) => {
      const mul = w.kind === "order" ? st.pink : w.a * (1 - st.pink * 0.25);
      return { w, mul, path: mul < 0.01 ? null : wavePath(w, width, cy, amp * mul * (w.kind === "order" ? 1.35 : 1), height * WAVE_REACH, st.phase, pulses.current, now, fillAt.current == null ? 0 : fillLock(now - fillAt.current)) };
    });
    const lock = fillAt.current == null ? 0 : fillLock(now - fillAt.current);
    const shockK = fillAt.current == null ? 1 : (now - fillAt.current) / 1100;
    return { lock, shockK, fills: fillTicks.current.filter((t) => now - t <= WAVE_HISTORY_MS).map((t) => ({ x: 1 - (now - t) / WAVE_HISTORY_MS, fresh: Math.max(0, 1 - (now - t) / 2500) })), waves, glow: Math.min(0.5, 0.08 + st.amp * 0.5) * (1 - st.flat), pink: st.pink, flat: st.flat, ticks: historyTicks(ticks.current, now) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frame, width, height, cy, live, reducedMotion]);

  const grey = scene.flat > 0.5;
  const stripY = Math.round(height * 0.86);
  const label = `판단 파형. ${decisionCount == null || !Number.isSafeInteger(decisionCount) ? "판단 수를 받지 못했어요" : `오늘 판단 ${decisionCount.toLocaleString("en-US")}번`}${orderCount == null || !Number.isSafeInteger(orderCount) ? "" : `, 모의 주문 ${orderCount.toLocaleString("en-US")}번`}. 아래 눈금은 최근 1분 동안 늘어난 판단(파랑), 주문(분홍), 체결(흰색)이에요`;
  return <View style={{ width, height }} testID={testID} accessible accessibilityLabel={label}>
    <Canvas style={{ width, height }} pointerEvents="none">
      <Rect x={0} y={0} width={width} height={height} opacity={scene.glow * 2}>
        <RadialGradient c={vec(width / 2, cy)} r={width * 0.55} colors={[wavePalette.glow, "transparent"]} />
      </Rect>
      {scene.pink > 0.02 ? <Rect x={0} y={0} width={width} height={height} opacity={scene.pink * 0.3}>
        <RadialGradient c={vec(width / 2, cy)} r={width * 0.45} colors={[wavePalette.pink, "transparent"]} />
      </Rect> : null}
      <Group blendMode="plus">
        {scene.waves.map(({ w, mul, path }) => path == null ? null : <Group key={`${w.color}-${w.f}`}>
          <Path path={path} style="stroke" strokeWidth={w.kind === "back" ? 12 : 10} strokeCap="round" color={grey ? wavePalette.idle : w.color} opacity={0.12 * Math.min(1, mul + 0.2)}><BlurMask blur={6} style="normal" /></Path>
          {w.kind === "back" ? null : <Path path={path} style="stroke" strokeWidth={1.6} strokeCap="round" color={grey ? wavePalette.idle : w.color} opacity={0.9 * Math.min(1, mul + 0.2)} />}
        </Group>)}
      </Group>
      {scene.lock > 0.05 ? <Rect x={0} y={0} width={width} height={height} opacity={scene.lock * 0.35}>
        <RadialGradient c={vec(width / 2, cy)} r={width * 0.5} colors={[calmColors.text, "transparent"]} />
      </Rect> : null}
      {scene.lock > 0.05 && scene.waves[2]?.path ? <Path path={scene.waves[2].path} style="stroke" strokeWidth={2.4} strokeCap="round" color={calmColors.text} opacity={scene.lock}><BlurMask blur={3} style="solid" /></Path> : null}
      {scene.shockK < 1 ? [cy - height * WAVE_REACH * scene.shockK, cy + height * WAVE_REACH * scene.shockK].map((y, i) => <Rect key={`s${i}`} x={width * 0.1} y={y - 0.75} width={width * 0.8} height={1.5} color={calmColors.text} opacity={(1 - scene.shockK) * 0.6} />) : null}
      <Rect x={0} y={cy - 0.5} width={width} height={1}>
        <LinearGradient start={vec(0, cy)} end={vec(width, cy)} colors={["transparent", calmColors.text, "transparent"]} positions={[0, 0.5, 1]} />
      </Rect>
      <Rect x={width * 0.04} y={stripY} width={width * 0.92} height={1} color={calmColors.line} />
      {scene.ticks.map((t, i) => {
        const h = (t.order ? 16 : 10) * (1 + t.fresh * 0.8);
        return <Rect key={i} x={width * 0.04 + width * 0.92 * t.x - 1} y={stripY - h} width={2} height={h} color={t.order ? wavePalette.pink : wavePalette.blue} opacity={0.5 + 0.5 * t.fresh} />;
      })}
      {scene.fills.map((t, i) => <Rect key={`f${i}`} x={width * 0.04 + width * 0.92 * t.x - 1} y={stripY - 22 * (1 + t.fresh * 0.5)} width={2} height={22 * (1 + t.fresh * 0.5)} color={calmColors.text} opacity={0.6 + 0.4 * t.fresh} />)}
    </Canvas>
    <Text style={[styles.stripLabel, { bottom: Math.max(0, height - stripY - 24) }]} importantForAccessibility="no-hide-descendants">최근 1분 · 앱이 본 시각</Text>
  </View>;
}

const styles = StyleSheet.create({
  stripLabel: { position: "absolute", left: 4, bottom: 2, color: calmColors.muted, fontSize: readableFont(11) },
});
