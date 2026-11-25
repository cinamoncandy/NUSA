import React, { useEffect, useMemo, useRef, useState } from "react";
import { AppState, View } from "react-native";
import { Canvas, Circle, Group, Path, RadialGradient, Skia, vec } from "@shopify/react-native-skia";
import { fillRise } from "./waveCoreModel";
import { LATTICE_FILL_MS, LATTICE_MAX_PULSES, LATTICE_PULSE_MS, LATTICE_TILT, buildLattice, fillWash, latticeYaw, nodeLight, nodeOpacity, nodeRadius, pulsesForCounts, rotate, unrotate, type LatticePulse, type Vec3 } from "./latticeSphereModel";
import { wavePalette } from "./designSystem";

const WHITE = "#F4F8FB";
const EDGE = "#E8EEF4";
const BACK = "#C9D4DE";
const ICE = "#BFE9FF";

/**
 * The lattice sphere, the motion graphic of "지금" (design E; owner chose a sphere instead of the island on 2026-11-25).
 * It lights only from real rises: a rise in the decision count sends a ring of light over the sphere from the point facing the
 * viewer; a rise in PAPER orders makes that ring pink; a real fill washes the sphere white. It turns slowly only while live and
 * allowed to move (reduce-motion, or before the OS answers, draws one fixed pose). Without data it is grey, dim and still.
 * Presentation only: it reads no data of its own and invents nothing.
 */
export function LatticeSphere({ decisionCount, orderCount, fillCount = null, live, width, reducedMotion, testID = "now-core" }: {
  readonly decisionCount: number | null;
  readonly orderCount: number | null;
  readonly fillCount?: number | null;
  readonly live: boolean;
  readonly width: number;
  readonly reducedMotion: boolean | null;
  readonly testID?: string;
}) {
  const lattice = useMemo(() => buildLattice(), []);
  const size = Math.max(0, Math.min(width, 360));
  const moving = reducedMotion === false;
  const t0 = useRef(Date.now());
  const pulses = useRef<readonly LatticePulse[]>([]);
  const fillAt = useRef<number | null>(null);
  const lastDecisions = useRef<number | null>(decisionCount);
  const lastOrders = useRef<number | null>(orderCount);
  const lastFills = useRef<number | null>(fillCount);
  const [frame, setFrame] = useState(0);
  // Bumped by every real rise so the frame loop restarts after it has settled.
  const [kick, setKick] = useState(0);
  const [active, setActive] = useState(AppState.currentState === "active");
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => setActive(s === "active"));
    return () => sub.remove();
  }, []);
  // A real rise starts a ring at the point facing the viewer now (kept fixed on the sphere in model space).
  useEffect(() => {
    const now = Date.now();
    const yaw = latticeYaw((now - t0.current) / 1000, live, moving);
    const fresh = pulsesForCounts(lastDecisions.current, decisionCount, lastOrders.current, orderCount, now, unrotate([0, 0, 1], yaw, LATTICE_TILT));
    lastDecisions.current = decisionCount;
    lastOrders.current = orderCount;
    if (fresh.length === 0) return;
    pulses.current = [...pulses.current, ...fresh].slice(-LATTICE_MAX_PULSES);
    setFrame((n) => n + 1);
    setKick((n) => n + 1);
  }, [decisionCount, orderCount, live, moving]);
  useEffect(() => {
    const n = fillRise(lastFills.current, fillCount);
    lastFills.current = fillCount;
    if (n === 0) return;
    fillAt.current = Date.now();
    setFrame((k) => k + 1);
    setKick((k) => k + 1);
  }, [fillCount]);
  // Frames: while live and allowed to move, about 30 per second; otherwise only while a ring or wash is still fading, then settle.
  useEffect(() => {
    if (!active) return undefined;
    let alive = true, handle = 0, last = 0;
    const loop = (ts: number) => {
      if (!alive) return;
      const now = Date.now();
      const animating = pulses.current.some((p) => now - p.born < LATTICE_PULSE_MS) || (fillAt.current != null && now - fillAt.current < LATTICE_FILL_MS);
      if (moving && live ? ts - last >= 33 : animating && ts - last >= 33) { last = ts; setFrame((n) => n + 1); }
      else if (!animating && !(moving && live)) return;
      handle = requestAnimationFrame(loop);
    };
    handle = requestAnimationFrame(loop);
    return () => { alive = false; cancelAnimationFrame(handle); };
  }, [active, moving, live, kick]);

  const scene = useMemo(() => {
    const now = Date.now();
    const yaw = latticeYaw((now - t0.current) / 1000, live, moving);
    const live_ = pulses.current.filter((p) => now - p.born < LATTICE_PULSE_MS);
    pulses.current = live_;
    const wash = fillAt.current == null ? 0 : fillWash(now - fillAt.current);
    const cx = size / 2, cy = size / 2, R = size * 0.42;
    const P: Vec3[] = lattice.vertices.map((v) => rotate(v, yaw, LATTICE_TILT));
    const xy = P.map((p) => [cx + p[0] * R, cy - p[1] * R] as const);
    const front = Skia.Path.Make(), back = Skia.Path.Make();
    const lit: { readonly path: ReturnType<typeof Skia.Path.Make>; readonly a: number; readonly pink: boolean }[] = [];
    for (const [a, b] of lattice.edges) {
      const z = (P[a]![2] + P[b]![2]) / 2;
      const target = z > 0 ? front : back;
      target.moveTo(xy[a]![0], xy[a]![1]); target.lineTo(xy[b]![0], xy[b]![1]);
    }
    const nodes = lattice.vertices.map((v, i) => {
      const l = live ? nodeLight(v, live_, now) : { light: 0, order: 0 };
      return { x: xy[i]![0], y: xy[i]![1], z: P[i]![2], l: Math.min(1, Math.max(l.light, wash)), pink: l.order > 0.15 && l.order >= l.light * 0.6 };
    });
    // Edges between two lit nodes glow with them.
    if (live && (live_.length > 0 || wash > 0)) {
      for (const [a, b] of lattice.edges) {
        const m = Math.min(nodes[a]!.l, nodes[b]!.l);
        if (m < 0.12 || (P[a]![2] + P[b]![2]) / 2 <= -0.1) continue;
        const p = Skia.Path.Make(); p.moveTo(xy[a]![0], xy[a]![1]); p.lineTo(xy[b]![0], xy[b]![1]);
        lit.push({ path: p, a: m, pink: nodes[a]!.pink || nodes[b]!.pink });
      }
    }
    return { cx, cy, R, front, back, nodes, lit, wash };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frame, size, live, moving, lattice]);

  const validCount = decisionCount != null && Number.isSafeInteger(decisionCount);
  const label = `판단 구. ${validCount ? `오늘 판단 ${decisionCount.toLocaleString("en-US")}번` : "판단 수를 받지 못했어요"}${orderCount == null || !Number.isSafeInteger(orderCount) ? "" : `, 모의 주문 ${orderCount.toLocaleString("en-US")}번`}. 구의 빛은 새 판단(하늘색), 주문(분홍), 체결(흰색)이 생길 때만 켜져요`;
  const tone = live ? EDGE : wavePalette.idle;
  return <View style={{ width: size, height: size, alignSelf: "center" }} testID={testID} accessible accessibilityLabel={label}>
    <Canvas style={{ width: size, height: size }} pointerEvents="none">
      <Circle cx={scene.cx} cy={scene.cy} r={scene.R * 1.12} opacity={live ? 0.5 : 0.18}>
        <RadialGradient c={vec(scene.cx, scene.cy)} r={scene.R * 1.12} colors={["rgba(159,180,200,0.18)", "transparent"]} positions={[0.55, 1]} />
      </Circle>
      <Circle cx={scene.cx} cy={scene.cy} r={scene.R} color="rgba(14,18,22,0.55)" />
      <Circle cx={scene.cx} cy={scene.cy} r={scene.R} style="stroke" strokeWidth={1} color={tone} opacity={live ? 0.35 : 0.2} />
      <Path path={scene.back} style="stroke" strokeWidth={0.6} color={live ? BACK : wavePalette.idle} opacity={live ? 0.13 : 0.1} />
      <Path path={scene.front} style="stroke" strokeWidth={0.7} color={tone} opacity={live ? 0.5 : 0.22} />
      {scene.lit.map((e, i) => <Path key={`e${i}`} path={e.path} style="stroke" strokeWidth={1.3} strokeCap="round" color={e.pink ? wavePalette.pink : ICE} opacity={0.85 * e.a} />)}
      {scene.nodes.map((n, i) => <Group key={i}>
        <Circle cx={n.x} cy={n.y} r={nodeRadius(n.z, 1)} color={live ? (n.z > 0 ? WHITE : BACK) : wavePalette.idle} opacity={nodeOpacity(n.z, live)} />
        {n.l > 0.05 && n.z > -0.2 ? <>
          <Circle cx={n.x} cy={n.y} r={3 + 5 * n.l} color={n.pink ? wavePalette.pink : ICE} opacity={0.35 * n.l} />
          <Circle cx={n.x} cy={n.y} r={nodeRadius(n.z, 1) + 1.2 * n.l} color={n.pink ? wavePalette.pink : "#FFFFFF"} opacity={Math.min(1, 0.4 + n.l)} />
        </> : null}
      </Group>)}
    </Canvas>
  </View>;
}
