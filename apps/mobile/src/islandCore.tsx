import React, { useEffect, useMemo, useRef, useState } from "react";
import { AppState, StyleSheet, Text, View } from "react-native";
import { BlurMask, Canvas, Circle, Group, LinearGradient, Path, RadialGradient, Rect, Skia, vec, type SkPath } from "@shopify/react-native-skia";
import { type IslandStill, ISLAND_PULSE_MS, ISLAND_LAND_EPS, ISLAND_ROWS, ISLAND_SEA_END, ISLAND_SHORE, ISLAND_STEPS, islandHeight, islandMinFrameGapMs, landRuns, rowBase, rowColor, rowLift, rowLight, rowOpacity, rowSpan, swellDepth } from "./islandCoreModel";
import { fillLock, fillRise, historyTicks, pulseKick, pulsesForRise, restAmplitude, springStep, WAVE_HISTORY_MS, type WavePulse } from "./waveCoreModel";
import { calmColors } from "./uiKitModel";
import { islandPalette, readableFont, wavePalette } from "./designSystem";

/**
 * The island, the motion graphic of "지금" (owner-chosen 2026-10-28; NUSA means "island"): stacked hairlines draw a small island over
 * a calm sea. A real rise in the decision count sends a band of light across the island from the front to the back; a real rise in
 * PAPER orders makes that band pink; a real fill washes the island white; the strip below keeps one dot per rise seen in the last
 * minute. The summit badge shows today's real decision count and is hidden without one. Without data the island sinks flat and grey.
 * Presentation only: it invents nothing. Reduce-motion (or before the OS answers) draws one settled frame, and frames stop while the
 * app is in the background.
 */
// Draw every display frame while the device keeps up; if the average gap says it cannot (about 40 fps or less), hold a steady 30 fps instead, which looks smoother than an uneven 40.
const PINK = [255, 95, 162];
const WHITE = [236, 240, 255];
const LIT = [205, 222, 255];
const GROUND = islandPalette.ground;
// Fixed star positions (share of width, share of the sky height, radius); drawn only while live.
const STARS: readonly (readonly [number, number, number])[] = Array.from({ length: 28 }, (_, i) => {
  const r = (n: number) => { const v = Math.sin((i + 1) * 12.9898 * n) * 43758.5453; return v - Math.floor(v); };
  return [0.06 + 0.88 * r(1), Math.pow(r(2), 1.4), r(3) < 0.15 ? 1 : 0.55] as const;
});

interface Row { readonly key: number; readonly body: SkPath; readonly line: SkPath | null; readonly color: string; readonly opacity: number; readonly glow: number; readonly halo: number; readonly width: number }

export function IslandCore({ decisionCount, orderCount, fillCount = null, live, compact = false, width, reducedMotion, still = null, testID = "now-core" }: {
  readonly decisionCount: number | null;
  readonly orderCount: number | null;
  /** Today's PAPER fill count; each rise washes the island white. */
  readonly fillCount?: number | null;
  readonly live: boolean;
  /** Shorter box for the no-data state, so a flat island does not leave a large empty panel. */
  readonly compact?: boolean;
  readonly width: number;
  readonly reducedMotion: boolean | null;
  /** A still island (실거래, 선물): no motion and no pulses; height, colour and badge come from the given real values. */
  readonly still?: IslandStill | null;
  readonly testID?: string;
}) {
  const motion = still == null ? reducedMotion : true;
  const height = Math.round(width * (still != null ? 0.6 : compact ? 0.55 : 0.88));
  const pulses = useRef<readonly WavePulse[]>([]);
  const ticks = useRef<readonly WavePulse[]>([]);
  const lastDecisions = useRef<number | null>(decisionCount);
  const lastOrders = useRef<number | null>(orderCount);
  const lastFills = useRef<number | null>(fillCount);
  const fillAt = useRef<number | null>(null);
  const fillTicks = useRef<readonly number[]>([]);
  const state = useRef({ amp: restAmplitude(live, 0), v: 0, energy: 0, pink: 0, flat: live ? 0 : 1, phase: 0, speed: 0.4 });
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
    if (motion !== false) { setFrame((n) => n + 1); return; }
    pulses.current = [...pulses.current, ...fresh].slice(-8);
    const st = state.current;
    for (const p of fresh) { st.v += pulseKick(p.order) * 0.6; st.energy = Math.min(1.5, st.energy + 0.4); if (p.order) st.pink = 1; }
  }, [decisionCount, orderCount, motion]);
  useEffect(() => {
    const n = fillRise(lastFills.current, fillCount);
    lastFills.current = fillCount;
    if (n === 0) return;
    const now = Date.now();
    fillTicks.current = [...fillTicks.current, ...Array.from({ length: n }, (_, i) => now + i * 260)].filter((t) => now - t <= WAVE_HISTORY_MS);
    if (motion !== false) { setFrame((k) => k + 1); return; }
    fillAt.current = now;
    state.current.v += 4;
  }, [fillCount, motion]);
  useEffect(() => {
    if (motion !== false) { setFrame((n) => n + 1); return undefined; }
    if (!active) return undefined;
    let alive = true, last = 0, handle = 0, gap = 16, minGap = 0, prev = 0;
    const loop = (ts: number) => {
      if (!alive) return;
      if (!liveRef.current && state.current.flat > 0.99 && pulses.current.length === 0 && state.current.pink < 0.02) { setFrame((n) => n + 1); return; }
      // Measure the display's own cadence on every callback (not only on drawn frames), or a throttle would read as a slow device and never lift.
      if (prev !== 0) { gap += (Math.min(ts - prev, 100) - gap) * 0.05; minGap = islandMinFrameGapMs(gap); }
      prev = ts;
      if (ts - last >= minGap) {
        const dt = last === 0 ? 0 : Math.min(0.1, (ts - last) / 1000); last = ts;
        const st = state.current, isLive = liveRef.current, now = Date.now();
        const next = springStep(st.amp, st.v, restAmplitude(isLive, st.energy), dt);
        st.amp = next.amp; st.v = next.velocity;
        st.energy *= Math.exp(-dt / 3); st.pink *= Math.exp(-dt / 1.8);
        st.flat += ((isLive ? 0 : 1) - st.flat) * Math.min(1, dt * 2.5);
        st.speed += ((isLive ? 0.4 + Math.min(1, st.energy) * 1.2 : 0) - st.speed) * Math.min(1, dt * 1.5);
        st.phase += dt * st.speed;
        pulses.current = pulses.current.filter((p) => now - p.born < ISLAND_PULSE_MS);
        setFrame((n) => n + 1);
      }
      handle = requestAnimationFrame(loop);
    };
    handle = requestAnimationFrame(loop);
    return () => { alive = false; cancelAnimationFrame(handle); };
  }, [motion, active, live]);
  useEffect(() => {
    // Reduce-motion only redraws on events, so age out the last-minute dots every few seconds while any are left.
    if (motion !== false) {
      const timer = setInterval(() => { if (ticks.current.length > 0 || fillTicks.current.length > 0) setFrame((n) => n + 1); }, 5000);
      return () => clearInterval(timer);
    }
    return undefined;
  }, [motion]);

  const scene = useMemo(() => {
    const st = state.current, now = Date.now();
    if (motion !== false) { st.flat = live ? 0 : 1; st.amp = restAmplitude(live, 0); }
    const grey = still != null ? still.grey : st.flat > 0.5;
    const lock = fillAt.current == null ? 0 : fillLock(now - fillAt.current);
    // restAmplitude is 0.11 at rest and about 0.41 at full energy; map it to a gentle 0.8..1.15 island height.
    const amp = still != null ? 0.2 + 0.95 * Math.max(0, Math.min(1, still.lift)) : (0.8 + Math.min(0.35, Math.max(0, st.amp - 0.11))) * (1 - st.flat * 0.95);
    const swells = pulses.current.map((p) => ({ pos: swellDepth(p, now), order: p.order })).filter((s): s is { pos: number; order: boolean } => s.pos != null);
    const rows: Row[] = [];
    let summit: { x: number; y: number; lift: number } | null = null;
    for (let r = 0; r < ISLAND_ROWS; r += 1) {
      const d = r / (ISLAND_ROWS - 1), base = rowBase(d) * height, [a, b] = rowSpan(d), lift = rowLift(d) * height;
      let light = 0, order = 0;
      for (const s of swells) { const l = rowLight(d, s.pos); light = Math.max(light, l); if (s.order) order = Math.max(order, l); }
      const hs: number[] = [], xs: number[] = [], ys: number[] = [];
      for (let i = 0; i <= ISLAND_STEPS; i += 1) {
        const u = i / ISLAND_STEPS, h = islandHeight(u, d, st.phase, amp, swells.map((s) => ({ pos: s.pos, k: 0.25 }))) * lift;
        hs.push(h / lift); xs.push((a + (b - a) * u) * width); ys.push(base - h);
        if ((!grey || still != null) && d > 0.3 && (summit == null || h > summit.lift)) summit = { x: xs[i], y: ys[i], lift: h };
      }
      const body = Skia.Path.Make();
      body.moveTo(xs[0], ys[0]);
      for (let i = 1; i < xs.length; i += 1) body.lineTo(xs[i], ys[i]);
      body.lineTo(xs[xs.length - 1], height * ISLAND_SHORE + 2); body.lineTo(xs[0], height * ISLAND_SHORE + 2); body.close();
      let line: SkPath | null = null;
      for (const [s, e] of landRuns(hs, grey && still == null ? -1 : ISLAND_LAND_EPS)) {
        line ??= Skia.Path.Make();
        line.moveTo(xs[s], ys[s]);
        for (let i = s + 1; i <= e; i += 1) line.lineTo(xs[i], ys[i]);
      }
      const color = grey ? wavePalette.idle : lock > 0.05 ? rowColor(d, WHITE, lock * 0.8) : order > 0.3 ? rowColor(d, PINK, order) : rowColor(d, LIT, light * 0.9);
      rows.push({ key: r, body, line, color, opacity: grey ? (still != null ? 0.3 + 0.5 * Math.pow(d, 0.9) : 0.45) : rowOpacity(d, r, light), glow: grey ? 0 : 8 * light + 5 * lock, halo: grey || d <= 0.6 ? 0 : 0.14 * d, width: (r % 5 === 4 ? 1.5 : 0.75) * (0.6 + 0.9 * d) + light });
    }
    const sea = Array.from({ length: 7 }, (_, k) => {
      const t = k / 6, y = height * (ISLAND_SHORE + 0.02 + (ISLAND_SEA_END - ISLAND_SHORE - 0.02) * Math.pow(t, 1.5));
      const half = width * (0.16 + 0.28 * (1 - t)) * (0.75 + 0.25 * Math.sin(k * 1.7)), cx = width / 2 + Math.sin(k * 2.3) * width * 0.04;
      const p = Skia.Path.Make();
      for (let i = 0; i <= 30; i += 1) { const u = i / 30, x = cx - half + 2 * half * u, yy = y + Math.sin(u * 16 + k + st.phase * 2) * 0.6; if (i === 0) p.moveTo(x, yy); else p.lineTo(x, yy); }
      return { key: k, path: p, x0: cx - half, x1: cx + half, opacity: grey ? 0.25 : 0.12 + 0.5 * (1 - t) };
    });
    return { rows, sea, grey, lock, summit, pink: st.pink, glow: Math.min(0.5, 0.1 + st.amp * 0.5) * (1 - st.flat), ticks: historyTicks(ticks.current, now), fills: fillTicks.current.filter((t) => now - t <= WAVE_HISTORY_MS).map((t) => ({ x: 1 - (now - t) / WAVE_HISTORY_MS, fresh: Math.max(0, 1 - (now - t) / 2500) })) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frame, width, height, live, motion, still]);

  const shoreY = height * ISLAND_SHORE;
  const stripY = Math.round(height * 0.93);
  const validCount = decisionCount != null && Number.isSafeInteger(decisionCount);
  const badgeText = still != null ? still.badge : validCount ? `오늘 판단 ${decisionCount.toLocaleString("en-US")}` : null;
  const label = still != null ? `섬 그림. ${still.badge ?? "서버 값이 없어요"}` : `판단 섬. ${validCount ? `오늘 판단 ${decisionCount.toLocaleString("en-US")}번` : "판단 수를 받지 못했어요"}${orderCount == null || !Number.isSafeInteger(orderCount) ? "" : `, 모의 주문 ${orderCount.toLocaleString("en-US")}번`}. 아래 점은 최근 1분 동안 늘어난 판단(파랑), 주문(분홍), 체결(흰색)이에요`;
  return <View style={{ width, height }} testID={testID} accessible accessibilityLabel={label}>
    <Canvas style={{ width, height }} pointerEvents="none">
      <Rect x={0} y={0} width={width} height={height} color={GROUND} />
      {scene.grey ? null : <Rect x={0} y={0} width={width} height={height} opacity={scene.glow * 1.6}>
        <RadialGradient c={vec(width / 2, height * 0.35)} r={width * 0.6} colors={[scene.pink > 0.05 ? wavePalette.pink : wavePalette.glow, "transparent"]} />
      </Rect>}
      {scene.grey || still != null ? null : STARS.map(([sx, sy, r], i) => <Circle key={`st${i}`} cx={sx * width} cy={4 + sy * height * 0.2} r={r} color={islandPalette.star} opacity={0.15 + 0.3 * ((i * 7) % 5) / 4} />)}
      {scene.rows.map((row) => <Group key={row.key}>
        <Path path={row.body} color={GROUND} />
        {row.line == null ? null : <>
          {row.halo > 0 ? <Path path={row.line} style="stroke" strokeWidth={row.width + 3} strokeCap="round" color={row.color} opacity={row.opacity * row.halo} /> : null}
          {row.glow > 0.5 ? <Path path={row.line} style="stroke" strokeWidth={row.width + 2} strokeCap="round" color={row.color} opacity={row.opacity * 0.4}><BlurMask blur={row.glow} style="normal" /></Path> : null}
          <Path path={row.line} style="stroke" strokeWidth={row.width} strokeCap="round" strokeJoin="round" color={row.color} opacity={row.opacity} />
        </>}
      </Group>)}
      <Rect x={width * 0.02} y={shoreY + 2} width={width * 0.96} height={1.2}>
        <LinearGradient start={vec(width * 0.02, 0)} end={vec(width * 0.98, 0)} colors={["transparent", scene.grey ? wavePalette.idle : islandPalette.horizon, "transparent"]} />
      </Rect>
      {scene.sea.map((s) => <Path key={`sea${s.key}`} path={s.path} style="stroke" strokeWidth={0.8} opacity={s.opacity}>
        <LinearGradient start={vec(s.x0, 0)} end={vec(s.x1, 0)} colors={["transparent", scene.grey ? wavePalette.idle : wavePalette.cyan, "transparent"]} />
      </Path>)}
      {scene.summit == null ? null : <>
        <Rect x={scene.summit.x - 1} y={shoreY + 4} width={2} height={height * (ISLAND_SEA_END - ISLAND_SHORE)} opacity={0.35}>
          <LinearGradient start={vec(0, shoreY)} end={vec(0, height * ISLAND_SEA_END)} colors={[islandPalette.reflection, "transparent"]} />
        </Rect>
        <Circle cx={scene.summit.x} cy={scene.summit.y} r={12}><RadialGradient c={vec(scene.summit.x, scene.summit.y)} r={12} colors={[islandPalette.summitCore, scene.pink > 0.05 ? islandPalette.summitPink : islandPalette.summitBlue, "transparent"]} /></Circle>
        <Circle cx={scene.summit.x} cy={scene.summit.y} r={1.8} color={calmColors.text} />
      </>}
      {still != null ? null : <><Rect x={width * 0.04} y={stripY} width={width * 0.92} height={1}>
        <LinearGradient start={vec(width * 0.04, 0)} end={vec(width * 0.96, 0)} colors={["transparent", calmColors.line, calmColors.line, "transparent"]} positions={[0, 0.1, 0.9, 1]} />
      </Rect>
      {scene.ticks.map((t, i) => { const x = width * 0.04 + width * 0.92 * t.x, c = t.order ? wavePalette.pink : wavePalette.blue; return <Group key={i}>
        <Circle cx={x} cy={stripY} r={6}><RadialGradient c={vec(x, stripY)} r={6} colors={[c, "transparent"]} /></Circle>
        <Circle cx={x} cy={stripY} r={1.8 + t.fresh} color={c} opacity={0.6 + 0.4 * t.fresh} />
      </Group>; })}
      {scene.fills.map((t, i) => { const x = width * 0.04 + width * 0.92 * t.x; return <Circle key={`f${i}`} cx={x} cy={stripY} r={2.6 + t.fresh} color={calmColors.text} opacity={0.7 + 0.3 * t.fresh} />; })}</>}
    </Canvas>
    {scene.summit != null && badgeText != null ? <View style={[styles.badge, { left: Math.max(4, Math.min(width - 164, scene.summit.x - 80)), top: Math.max(0, scene.summit.y - 40) }]} importantForAccessibility="no-hide-descendants">
      <Text style={styles.badgeText} numberOfLines={1}>{badgeText}</Text>
    </View> : null}
    {still != null ? null : <Text style={[styles.stripLabel, { top: stripY + 6 }]} importantForAccessibility="no-hide-descendants">최근 1분 · 앱이 본 시각</Text>}
  </View>;
}

const styles = StyleSheet.create({
  badge: { position: "absolute", width: 160, alignItems: "center", paddingVertical: 2, borderRadius: 10, borderWidth: 1, borderColor: "rgba(170,190,255,0.45)", backgroundColor: "rgba(20,22,40,0.6)" },
  badgeText: { color: calmColors.text, fontSize: readableFont(12), fontWeight: "600" },
  stripLabel: { position: "absolute", left: 4, color: calmColors.muted, fontSize: readableFont(11) },
});
