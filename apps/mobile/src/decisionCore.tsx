import React, { useEffect, useMemo, useRef, useState } from "react";
import { Text, View, StyleSheet } from "react-native";
import { BlendMode, Canvas, PaintStyle, Picture, PointMode, Skia, StrokeCap, createPicture, TileMode, type SkCanvas, type SkPaint, type SkPicture, type SkPoint } from "@shopify/react-native-skia";
import {
  BURST_MS, CORE_POINTS, MAX_WAVES, WAVE_MS, buildCoreLinks, burstsForOrders, coreMotion, fibonacciSphere, projectCore, waveLight, wavesForDecisions,
  type CoreBurst, type CoreTone, type CoreWave, type Vec3,
} from "./decisionCoreModel";
import { calmColors } from "./uiKitModel";
import { fieldFonts } from "./fieldFonts";
import { readableFont } from "./designSystem";

/**
 * The decision core, the main motion graphic of "지금" (owner-chosen 2026-10-21): a slowly turning sphere of points joined like a neural
 * mesh. A real new decision sends a wave of light across its surface; a real new PAPER order throws lime sparks out of it; when buying
 * is held the sphere cools to amber and slows. Presentation only: it draws the counts the screen already has and invents nothing.
 * Under reduce-motion (or before the OS answers) it draws one settled frame.
 */
const FRAME_MS = 33;
const PITCH = 0.42;
const POINTS = fibonacciSphere(CORE_POINTS);
const LINKS = buildCoreLinks(POINTS);
const pickPoint = (): Vec3 => POINTS[Math.floor(Math.random() * POINTS.length)]!;

export function DecisionCore({ tone, decisionCount, orderCount, width, reducedMotion, testID = "now-core" }: {
  readonly tone: CoreTone;
  /** Today's decision count; each rise sends a wave across the sphere. Null draws the sphere resting. */
  readonly decisionCount: number | null;
  /** Today's PAPER order count; each rise throws sparks. */
  readonly orderCount: number | null;
  readonly width: number;
  readonly reducedMotion: boolean | null;
  readonly testID?: string;
}) {
  const height = Math.round(width * 0.9);
  const [picture, setPicture] = useState<SkPicture | null>(null);
  const waves = useRef<CoreWave[]>([]);
  const bursts = useRef<CoreBurst[]>([]);
  const lastDecisions = useRef<number | null>(decisionCount);
  const lastOrders = useRef<number | null>(orderCount);
  const heat = useRef(0);
  const toneRef = useRef(tone);
  toneRef.current = tone;
  const born = useRef(Date.now());
  const paints = useMemo(() => {
    const mk = (style: PaintStyle) => { const p = Skia.Paint(); p.setAntiAlias(true); p.setStyle(style); p.setBlendMode(BlendMode.Plus); return p; };
    const line = mk(PaintStyle.Stroke), dot = mk(PaintStyle.Stroke), fill = mk(PaintStyle.Fill), glow = mk(PaintStyle.Fill);
    dot.setStrokeCap(StrokeCap.Round);
    return { line, dot, fill, glow };
  }, []);
  const colors = useMemo(() => ({ ink: calmColors.text, lime: calmColors.order, amber: calmColors.attention }), []);

  useEffect(() => {
    const now = Date.now();
    if (reducedMotion === false) {
      waves.current = [...waves.current, ...wavesForDecisions(lastDecisions.current, decisionCount, now, pickPoint)].slice(-MAX_WAVES);
      if (decisionCount != null && lastDecisions.current != null && decisionCount > lastDecisions.current) heat.current = 1;
    }
    lastDecisions.current = decisionCount;
  }, [decisionCount, reducedMotion]);
  useEffect(() => {
    if (reducedMotion === false) bursts.current = [...bursts.current, ...burstsForOrders(lastOrders.current, orderCount, Date.now(), pickPoint, Math.random)].slice(-2);
    lastOrders.current = orderCount;
  }, [orderCount, reducedMotion]);

  useEffect(() => {
    if (width <= 0) return undefined;
    const still = reducedMotion !== false;
    const draw = (nowMs: number) => setPicture(createPicture((canvas) => renderCore(canvas, { tone: toneRef.current, width, height, t: still ? 2 : (nowMs - born.current) / 1000, nowMs, still, waves: waves.current, bursts: bursts.current, heat: heat.current, paints, colors })));
    if (reducedMotion == null) return undefined; // nothing moves until the OS has answered
    if (still) { draw(Date.now()); return undefined; }
    let alive = true, last = 0, frame = 0;
    const loop = (ts: number) => {
      if (!alive) return;
      if (ts - last >= FRAME_MS) {
        const dt = last === 0 ? 0 : (ts - last) / 1000; last = ts;
        const nowMs = Date.now();
        heat.current *= Math.pow(0.35, dt);
        waves.current = waves.current.filter((w) => nowMs - w.born < WAVE_MS);
        bursts.current = bursts.current.filter((b) => nowMs - b.born < BURST_MS);
        draw(nowMs);
      }
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => { alive = false; cancelAnimationFrame(frame); };
  }, [width, height, reducedMotion, paints, colors]);

  const chip = tone === "limit" ? "HOLD" : tone === "live" ? "LIVE" : "—";
  const label = `판단 코어. ${decisionCount == null ? "판단 수를 받지 못했어요" : `오늘 판단 ${decisionCount.toLocaleString("en-US")}번`}${orderCount == null ? "" : `, 모의 주문 ${orderCount.toLocaleString("en-US")}번`}${tone === "limit" ? ". 새 매수는 멈춰 있어요" : ""}`;
  return <View style={{ width, height }} testID={testID} accessible accessibilityLabel={label}>
    <Canvas style={{ width, height }} pointerEvents="none">{picture ? <Picture picture={picture} /> : null}</Canvas>
    <Text style={[fieldFonts.mono, styles.chip, { color: tone === "limit" ? calmColors.attention : tone === "live" ? calmColors.text : calmColors.muted, borderColor: tone === "limit" ? calmColors.attention : calmColors.line }]} importantForAccessibility="no-hide-descendants">{chip}</Text>
  </View>;
}

interface RenderInput {
  readonly tone: CoreTone; readonly width: number; readonly height: number; readonly t: number; readonly nowMs: number; readonly still: boolean;
  readonly waves: readonly CoreWave[]; readonly bursts: readonly CoreBurst[]; readonly heat: number;
  readonly paints: { readonly line: SkPaint; readonly dot: SkPaint; readonly fill: SkPaint; readonly glow: SkPaint };
  readonly colors: { readonly ink: string; readonly lime: string; readonly amber: string };
}

function renderCore(canvas: SkCanvas, { tone, width, height, t, nowMs, still, waves, bursts, heat, paints, colors }: RenderInput): void {
  const { line, dot, fill, glow } = paints;
  const cx = width / 2, cy = height / 2, radius = Math.min(width, height) * 0.33;
  const motion = coreMotion(tone);
  const accent = tone === "limit" ? colors.amber : colors.lime;
  const breathe = still ? 1 : 1 + Math.sin(t * motion.breath) * motion.depth - motion.shrink;
  const yaw = still ? 0.6 : t * motion.spin;
  const set = (p: SkPaint, hex: string, alpha: number) => { const c = Skia.Color(hex); p.setColor(c); p.setAlphaf(Math.max(0, Math.min(1, alpha))); };

  // Aura: a soft pool of the tone colour behind the sphere.
  // Each gradient is made, used for one draw and disposed at once, so nothing native piles up at 30 fps.
  const drawGlow = (r: number, a0: number) => { const sh = Skia.Shader.MakeRadialGradient({ x: cx, y: cy }, r, [withAlpha(accent, a0), withAlpha(accent, a0 * 0.3), withAlpha(accent, 0)], [0, 0.45, 1], TileMode.Clamp); glow.setShader(sh); canvas.drawCircle(cx, cy, r, glow); glow.setShader(null); sh.dispose(); };
  drawGlow(radius * 1.7, 0.16 + heat * 0.12);

  // Orbit ring with one slow point (the hours going round).
  line.setStrokeWidth(1); set(line, colors.ink, 0.07);
  canvas.save(); canvas.translate(cx, cy); canvas.rotate(-20, 0, 0);
  canvas.drawOval({ x: -radius * 1.32, y: -radius * 0.34, width: radius * 2.64, height: radius * 0.68 }, line);
  const oa = still ? 0.8 : t * (tone === "limit" ? 0.035 : 0.14);
  set(fill, accent, 0.9); canvas.drawCircle(Math.cos(oa) * radius * 1.32, Math.sin(oa) * radius * 0.34, 2.4, fill);
  canvas.restore();

  const proj = POINTS.map((p, i) => {
    const n = still ? 0 : (Math.sin(p[0] * 4 + t * 0.9) + Math.sin(p[1] * 5 - t * 0.75) + Math.sin(p[2] * 3 + t * 0.6)) * 0.018 * (tone === "limit" ? 0.3 : 1);
    const q = projectCore(p, yaw, PITCH, cx, cy, radius, breathe + n);
    return { ...q, e: still ? 0 : waveLight(p, waves, nowMs), i };
  });

  // Mesh: faint links, brighter on the near side and where a wave passes.
  const groups: SkPoint[][] = [[], [], []];
  const lit: { a: typeof proj[number]; b: typeof proj[number] }[] = [];
  for (const [i, j] of LINKS) {
    const a = proj[i]!, b = proj[j]!, front = (-(a.z + b.z) / 2 + 1) / 2;
    if (Math.max(a.e, b.e) > 0.1) { lit.push({ a, b }); continue; }
    groups[front > 0.66 ? 2 : front > 0.33 ? 1 : 0]!.push({ x: a.x, y: a.y }, { x: b.x, y: b.y });
  }
  line.setStrokeWidth(0.6);
  [0.04, 0.08, 0.13].forEach((alpha, g) => { if (groups[g]!.length > 0) { set(line, colors.ink, alpha); canvas.drawPoints(PointMode.Lines, groups[g]!, line); } });
  lit.forEach(({ a, b }) => { set(line, accent, 0.06 + Math.max(a.e, b.e) * 0.6); canvas.drawLine(a.x, a.y, b.x, b.y, line); });

  // Points: three depth groups in ink, then the wave-lit ones in the tone colour with a halo.
  const pg: SkPoint[][] = [[], [], []]; const hot: typeof proj = [];
  for (const q of proj) { if (q.e > 0.05) { hot.push(q); continue; } const front = (-q.z + 1) / 2; pg[front > 0.66 ? 2 : front > 0.33 ? 1 : 0]!.push({ x: q.x, y: q.y }); }
  [[0.9, 0.2], [1.3, 0.38], [1.8, 0.7]].forEach(([w, alpha], g) => { if (pg[g]!.length > 0) { dot.setStrokeWidth(w! * q0(width)); set(dot, colors.ink, alpha!); canvas.drawPoints(PointMode.Points, pg[g]!, dot); } });
  hot.forEach((q) => {
    dot.setStrokeWidth((1.6 + q.e * 3) * q0(width)); set(dot, accent, 0.4 + q.e * 0.6); canvas.drawPoints(PointMode.Points, [{ x: q.x, y: q.y }], dot);
    if (q.e > 0.35) { set(fill, accent, q.e * 0.18); canvas.drawCircle(q.x, q.y, 6 + q.e * 8, fill); }
  });

  // Core glow, stronger right after a decision.
  drawGlow(radius * 0.55, 0.35 + heat * 0.35);

  // Sparks for a new PAPER order: short lime strokes flying out of the sphere.
  for (const b of bursts) {
    const age = (nowMs - b.born) / 1000; if (age < 0 || age > BURST_MS / 1000) continue;
    const fade = 1 - age / (BURST_MS / 1000);
    for (let s = 0; s < b.dirs.length; s += 1) {
      const d = b.dirs[s]!, sp = b.speeds[s]!, k = age * sp * 0.9;
      const head = projectCore([b.origin[0] + d[0] * k, b.origin[1] + d[1] * k, b.origin[2] + d[2] * k], yaw, PITCH, cx, cy, radius, breathe);
      const tail = projectCore([b.origin[0] + d[0] * (k - 0.08), b.origin[1] + d[1] * (k - 0.08), b.origin[2] + d[2] * (k - 0.08)], yaw, PITCH, cx, cy, radius, breathe);
      line.setStrokeWidth(1.6); set(line, colors.lime, fade); canvas.drawLine(tail.x, tail.y, head.x, head.y, line);
      set(fill, colors.lime, fade * 0.4); canvas.drawCircle(head.x, head.y, 3, fill);
    }
  }
}

const q0 = (width: number) => Math.max(0.8, width / 360);
function withAlpha(hex: string, a: number) { const c = Skia.Color(hex); return Skia.Color(`rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${Math.max(0, Math.min(1, a))})`); }

const styles = StyleSheet.create({
  chip: { position: "absolute", right: 2, top: 0, fontSize: readableFont(10), letterSpacing: 1.2, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 6, paddingVertical: 2 },
});
