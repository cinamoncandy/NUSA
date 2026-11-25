import React, { useEffect, useMemo, useRef, useState } from "react";
import { AppState, Text, View } from "react-native";
import { Canvas, Circle, Group, Path, Points, RadialGradient, Skia, vec } from "@shopify/react-native-skia";
import { fillRise } from "./waveCoreModel";
import { LATTICE_FILL_MS, LATTICE_MAX_PULSES, LATTICE_PULSE_MS, LATTICE_REST_YAW, LATTICE_STATIC_MS, LATTICE_TILT, LATTICE_YAW_RATE, buildLattice, studyMarkers, fillWash, nodeLight, nodeOpacity, nodeRadius, pulsesForCounts, rotate, staticPulseMs, unrotate, type LatticePulse, type Vec3 } from "./latticeSphereModel";
import { latticePalette, wavePalette } from "./designSystem";

// Depth buckets for the plain (unlit) nodes: one Points draw per bucket instead of one Circle per node.
const BUCKETS: readonly { readonly min: number; readonly max: number; readonly z: number }[] = [
  { min: -2, max: 0, z: -0.5 }, { min: 0, max: 1 / 3, z: 1 / 6 }, { min: 1 / 3, max: 2 / 3, z: 0.5 }, { min: 2 / 3, max: 2, z: 5 / 6 },
];

/**
 * The lattice sphere, the motion graphic of "지금" (design E; owner chose a sphere instead of the island on 2026-11-25).
 * It lights only from real rises: a rise in the decision count sends a ring of light over the sphere from the point facing the
 * viewer; a rise in PAPER orders makes that ring pink; a real fill washes the sphere white. It turns slowly only while live and
 * allowed to move; under reduce-motion (or before the OS answers) nothing moves at all: a real rise shows a brief static
 * highlight at the origin instead of a travelling ring. Without data it is grey, dim and still. `still` keeps it from turning
 * (an ornament on a screen that has no health signal). Presentation only: it reads no data of its own and invents nothing.
 */
export function LatticeSphere({ decisionCount, orderCount, fillCount = null, live, width, reducedMotion, still = false, testID = "now-core" }: {
  readonly decisionCount: number | null;
  readonly orderCount: number | null;
  readonly fillCount?: number | null;
  readonly live: boolean;
  readonly width: number;
  readonly reducedMotion: boolean | null;
  /** No turning and no frame loop, whatever the motion setting; the colours still follow `live`. */
  readonly still?: boolean;
  readonly testID?: string;
}) {
  const lattice = useMemo(() => buildLattice(), []);
  const size = Math.max(0, Math.min(width, 360));
  const moving = reducedMotion === false;
  const turning = moving && live && !still;
  // The turn angle only ever grows from where it was: starting or stopping never makes the sphere jump.
  const turn = useRef<{ acc: number; since: number | null }>({ acc: 0, since: null });
  const yawAt = (now: number): number => LATTICE_REST_YAW + turn.current.acc + (turn.current.since == null ? 0 : ((now - turn.current.since) / 1000) * LATTICE_YAW_RATE);
  useEffect(() => {
    const now = Date.now(), t = turn.current;
    if (turning) { if (t.since == null) t.since = now; }
    else if (t.since != null) { t.acc += ((now - t.since) / 1000) * LATTICE_YAW_RATE; t.since = null; }
  }, [turning]);
  const pulses = useRef<readonly LatticePulse[]>([]);
  const fillAt = useRef<number | null>(null);
  const lastDecisions = useRef<number | null>(decisionCount);
  const lastOrders = useRef<number | null>(orderCount);
  const lastFills = useRef<number | null>(fillCount);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const [frame, setFrame] = useState(0);
  // Bumped by every real rise so the frame loop restarts after it has settled.
  const [kick, setKick] = useState(0);
  const [active, setActive] = useState(AppState.currentState === "active");
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => setActive(s === "active"));
    return () => { sub.remove(); timers.current.forEach(clearTimeout); timers.current = []; };
  }, []);
  // Without motion a highlight is drawn for a moment and then cleared by one timed redraw (no frame loop).
  const settleLater = () => { if (!moving) timers.current.push(setTimeout(() => setFrame((n) => n + 1), LATTICE_STATIC_MS + 60)); };
  // A real rise starts a ring at the point facing the viewer now (kept fixed on the sphere in model space).
  useEffect(() => {
    const now = Date.now();
    const fresh = pulsesForCounts(lastDecisions.current, decisionCount, lastOrders.current, orderCount, now, unrotate([0, 0, 1], yawAt(now), LATTICE_TILT));
    lastDecisions.current = decisionCount;
    lastOrders.current = orderCount;
    if (fresh.length === 0) return;
    pulses.current = [...pulses.current.filter((p) => now - p.born < LATTICE_PULSE_MS + LATTICE_STATIC_MS), ...fresh].slice(-LATTICE_MAX_PULSES);
    setFrame((n) => n + 1);
    setKick((n) => n + 1);
    settleLater();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [decisionCount, orderCount, live, moving]);
  useEffect(() => {
    const n = fillRise(lastFills.current, fillCount);
    lastFills.current = fillCount;
    if (n === 0) return;
    fillAt.current = Date.now();
    setFrame((k) => k + 1);
    setKick((k) => k + 1);
    settleLater();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fillCount]);
  // Frames: only while the sphere may move. Turning runs about 30 per second; a fading ring or wash runs frames until it ends. Without motion there is no loop.
  useEffect(() => {
    if (!active || !moving) return undefined;
    let alive = true, handle = 0, last = 0;
    const loop = (ts: number) => {
      if (!alive) return;
      const now = Date.now();
      pulses.current = pulses.current.filter((p) => now - p.born < LATTICE_PULSE_MS);
      const animating = pulses.current.length > 0 || (fillAt.current != null && now - fillAt.current < LATTICE_FILL_MS);
      if (!turning && !animating) { setFrame((n) => n + 1); return; }
      if (ts - last >= 33) { last = ts; setFrame((n) => n + 1); }
      handle = requestAnimationFrame(loop);
    };
    handle = requestAnimationFrame(loop);
    return () => { alive = false; cancelAnimationFrame(handle); };
  }, [active, moving, turning, kick]);

  const scene = useMemo(() => {
    const now = Date.now();
    const yaw = yawAt(now);
    // Without motion a pulse is a still highlight at its origin for a short time; with motion it is the travelling ring.
    const shown = pulses.current.map((p) => ({ ...p, born: now - (moving ? now - p.born : staticPulseMs(now - p.born)) })).filter((p) => now - p.born <= LATTICE_PULSE_MS);
    const washMs = fillAt.current == null ? Infinity : moving ? now - fillAt.current : staticPulseMs(now - fillAt.current);
    const wash = fillWash(washMs);
    const cx = size / 2, cy = size / 2, R = size * 0.42;
    const P: Vec3[] = lattice.vertices.map((v) => rotate(v, yaw, LATTICE_TILT));
    const xy = P.map((p) => [cx + p[0] * R, cy - p[1] * R] as const);
    const front = Skia.Path.Make(), back = Skia.Path.Make();
    for (const [a, b] of lattice.edges) {
      const target = (P[a]![2] + P[b]![2]) / 2 > 0 ? front : back;
      target.moveTo(xy[a]![0], xy[a]![1]); target.lineTo(xy[b]![0], xy[b]![1]);
    }
    const nodes = lattice.vertices.map((v, i) => {
      const l = live ? nodeLight(v, shown, now) : { light: 0, order: 0 };
      return { x: xy[i]![0], y: xy[i]![1], z: P[i]![2], l: Math.min(1, Math.max(l.light, live ? wash : 0)), pink: l.order > 0.15 && l.order >= l.light * 0.6 };
    });
    // Plain nodes are drawn as a few point sets by depth; only the lit ones become separate circles.
    const plain = BUCKETS.map(() => [] as { x: number; y: number }[]);
    const lit: typeof nodes = [];
    for (const n of nodes) {
      if (n.l > 0.05 && n.z > -0.2) { lit.push(n); continue; }
      const b = BUCKETS.findIndex((k) => n.z > k.min && n.z <= k.max);
      plain[b < 0 ? 0 : b]!.push({ x: n.x, y: n.y });
    }
    // Edges between two lit nodes glow with them: two merged paths (ice and pink) instead of one path per edge.
    const glowIce = Skia.Path.Make(), glowPink = Skia.Path.Make();
    let glowCount = 0;
    if (live && (shown.length > 0 || wash > 0)) {
      for (const [a, b] of lattice.edges) {
        if (Math.min(nodes[a]!.l, nodes[b]!.l) < 0.12 || (P[a]![2] + P[b]![2]) / 2 <= -0.1) continue;
        const target = nodes[a]!.pink || nodes[b]!.pink ? glowPink : glowIce;
        target.moveTo(xy[a]![0], xy[a]![1]); target.lineTo(xy[b]![0], xy[b]![1]);
        glowCount += 1;
      }
    }
    return { cx, cy, R, front, back, plain, lit, glowIce, glowPink, glowCount };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frame, size, live, moving, lattice]);

  const validCount = decisionCount != null && Number.isSafeInteger(decisionCount);
  const label = `판단 구. ${validCount ? `오늘 판단 ${decisionCount.toLocaleString("en-US")}번` : "판단 수를 받지 못했어요"}${orderCount == null || !Number.isSafeInteger(orderCount) ? "" : `, 모의 주문 ${orderCount.toLocaleString("en-US")}번`}. 구의 빛은 새 판단(하늘색), 주문(분홍), 체결(흰색)이 생길 때만 켜져요`;
  const tone = live ? latticePalette.edge : wavePalette.idle;
  return <View style={{ width: size, height: size, alignSelf: "center" }} testID={testID} accessible accessibilityLabel={label}>
    <Canvas style={{ width: size, height: size }} pointerEvents="none">
      <Circle cx={scene.cx} cy={scene.cy} r={scene.R * 1.12} opacity={live ? 0.5 : 0.18}>
        <RadialGradient c={vec(scene.cx, scene.cy)} r={scene.R * 1.12} colors={["rgba(159,180,200,0.18)", "transparent"]} positions={[0.55, 1]} />
      </Circle>
      <Circle cx={scene.cx} cy={scene.cy} r={scene.R} color="rgba(14,18,22,0.55)" />
      <Circle cx={scene.cx} cy={scene.cy} r={scene.R} style="stroke" strokeWidth={1} color={tone} opacity={live ? 0.35 : 0.2} />
      <Path path={scene.back} style="stroke" strokeWidth={0.6} color={live ? latticePalette.back : wavePalette.idle} opacity={live ? 0.13 : 0.1} />
      <Path path={scene.front} style="stroke" strokeWidth={0.7} color={tone} opacity={live ? 0.5 : 0.22} />
      {scene.glowCount > 0 ? <>
        <Path path={scene.glowIce} style="stroke" strokeWidth={1.3} strokeCap="round" color={latticePalette.ice} opacity={0.7} />
        <Path path={scene.glowPink} style="stroke" strokeWidth={1.3} strokeCap="round" color={wavePalette.pink} opacity={0.7} />
      </> : null}
      {scene.plain.map((pts, b) => pts.length === 0 ? null : <Points key={`b${b}`} points={pts} mode="points" style="stroke" strokeCap="round" strokeWidth={2 * nodeRadius(BUCKETS[b]!.z, 1)} color={live ? (BUCKETS[b]!.z > 0 ? latticePalette.white : latticePalette.back) : wavePalette.idle} opacity={nodeOpacity(BUCKETS[b]!.z, live)} />)}
      {scene.lit.map((n, i) => <Group key={`l${i}`}>
        <Circle cx={n.x} cy={n.y} r={3 + 5 * n.l} color={n.pink ? wavePalette.pink : latticePalette.ice} opacity={0.35 * n.l} />
        <Circle cx={n.x} cy={n.y} r={nodeRadius(n.z, 1) + 1.2 * n.l} color={n.pink ? wavePalette.pink : latticePalette.flash} opacity={Math.min(1, 0.4 + n.l)} />
      </Group>)}
    </Canvas>
  </View>;
}

/**
 * The learning screen's sphere: one numbered marker per registered study (the same numbers as the list below), the next verdict
 * ringed in ice-blue. A fixed pose, no loop and no motion at all. It shows only how many studies there are and which one is next;
 * the dates and states stay in the list. Presentation only.
 */
export function StudyLattice({ count, nextIndex, width, testID = "learning-lattice" }: { readonly count: number; /** Zero-based index of the next study, or null. */ readonly nextIndex: number | null; readonly width: number; readonly testID?: string }) {
  const lattice = useMemo(() => buildLattice(), []);
  const size = Math.max(0, Math.min(width, 260));
  const scene = useMemo(() => {
    const cx = size / 2, cy = size / 2, R = size * 0.43;
    const yaw = LATTICE_REST_YAW;
    const P: Vec3[] = lattice.vertices.map((v) => rotate(v, yaw, LATTICE_TILT));
    const front = Skia.Path.Make(), back = Skia.Path.Make();
    for (const [a, b] of lattice.edges) {
      const target = (P[a]![2] + P[b]![2]) / 2 > 0 ? front : back;
      target.moveTo(cx + P[a]![0] * R, cy - P[a]![1] * R); target.lineTo(cx + P[b]![0] * R, cy - P[b]![1] * R);
    }
    const markers = studyMarkers(count, yaw, LATTICE_TILT).map((m) => ({ node: m.node, x: cx + m.x * R, y: cy - m.y * R }));
    return { cx, cy, R, P, front, back, markers };
  }, [size, count, lattice]);
  const shownCount = scene.markers.length;
  const label = `연구 구. 사전 등록 연구 ${count}개${shownCount < count ? `, 구에는 앞의 ${shownCount}개만 표시해요` : ""}, 번호는 아래 목록과 같아요${nextIndex == null || nextIndex >= shownCount ? "" : `. 다음 판정은 ${nextIndex + 1}번`}`;
  return <View style={{ width: size, height: size, alignSelf: "center" }} testID={testID} accessible accessibilityLabel={label}>
    <Canvas style={{ width: size, height: size }} pointerEvents="none">
      <Circle cx={scene.cx} cy={scene.cy} r={scene.R} color="rgba(14,18,22,0.55)" />
      <Circle cx={scene.cx} cy={scene.cy} r={scene.R} style="stroke" strokeWidth={1} color={latticePalette.edge} opacity={0.3} />
      <Path path={scene.back} style="stroke" strokeWidth={0.6} color={latticePalette.back} opacity={0.12} />
      <Path path={scene.front} style="stroke" strokeWidth={0.7} color={latticePalette.edge} opacity={0.45} />
      {scene.P.map((p, i) => <Circle key={i} cx={scene.cx + p[0] * scene.R} cy={scene.cy - p[1] * scene.R} r={nodeRadius(p[2], 0.85)} color={p[2] > 0 ? latticePalette.white : latticePalette.back} opacity={nodeOpacity(p[2], true)} />)}
      {scene.markers.map((m, k) => <Group key={`m${k}`}>
        <Circle cx={m.x} cy={m.y} r={10} color={latticePalette.markerFill} />
        <Circle cx={m.x} cy={m.y} r={10} style="stroke" strokeWidth={k === nextIndex ? 1.6 : 1} color={k === nextIndex ? latticePalette.ice : latticePalette.white} opacity={k === nextIndex ? 1 : 0.6} />
      </Group>)}
    </Canvas>
    {scene.markers.map((m, k) => <Text key={`t${k}`} allowFontScaling={false} numberOfLines={1} style={{ position: "absolute", left: m.x - 10, top: m.y - 7, width: 20, height: 14, lineHeight: 14, textAlign: "center", color: k === nextIndex ? latticePalette.ice : latticePalette.white, fontSize: k >= 9 ? 9 : 11, fontWeight: "600", fontVariant: ["tabular-nums"] }} importantForAccessibility="no-hide-descendants">{k + 1}</Text>)}
  </View>;
}
