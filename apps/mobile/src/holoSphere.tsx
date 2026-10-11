import React, { useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { BlendMode, BlurStyle, Canvas, PaintStyle, Picture, PointMode, Skia, StrokeCap, createPicture, type SkPicture, type SkPoint } from "@shopify/react-native-skia";
import { fieldFonts } from "./fieldFonts";
import { calmPalette } from "./designSystem";
import { FLOW_COMETS_PER_EDGE, FLOW_COMET_TAIL_POINTS, FLOW_EDGES, FLOW_NODES, FLOW_PAPER, FLOW_SPARKS, HOLO_COLORS, HOLO_ORDER_MS, buildFlowField, easeOutCubic, flowAmbientComet, flowArrivalRing, flowBreath, flowClockSec, flowClusterPoint, flowCometProgress, flowCometStrand, flowEdgeGlow, flowEdgeOpen, flowLabelPlacement, flowNodeColor, flowNodeGlow, flowOrderRing, flowParticleSwirl, flowParticleTwinkle, flowPulsePosition, flowSpark, flowStrandCurve, flowStrandPoint, flowTailLight, flowTailProgress, holoFillMarker, holoFrameBudgetMs, holoInk, initialHoloState, isHoloQuiet, observeHolo, tickHolo, type HoloTone, type Rgb } from "./holoModel";

export interface HoloSphereProps {
  /** Real runtime decision count; each increase sends a bright pulse down the chain. Null draws it still. */
  readonly decisionCount: number | null;
  /** Real PAPER order count; each increase ignites the paper cluster with a lime ring and beam, then it settles. */
  readonly fillCount: number | null;
  readonly tone: HoloTone;
  /** Still figure: reduce-motion, or a secondary-tab mark. */
  readonly reducedMotion: boolean;
  readonly size: number;
  /** Detail level: scales the particle and hairline counts (1600 is full detail; small marks pass less). */
  readonly points?: number;
  readonly testID?: string;
}

const LABEL_MIN_SIZE = 220;

/**
 * NUSA "흐름" (Flow) hero, chosen by the owner on 2026-10-07 from reference videos: hairline data streams flowing into glowing
 * particle clusters, one per stage of the chain market -> research -> risk -> paper -> ledger (holoModel.ts).
 * A runtime decision sends a bright pulse down the chain; a PAPER order ignites the paper cluster with a lime ring and beam and
 * lights its hand-off to the ledger; hold / halt tint risk onward amber / red and a halt dims the streams out of risk.
 * Each stream is drawn as one batched path and each cluster as one point batch, so a frame is a few dozen draws.
 * The component name is kept for its callers.
 */
export function HoloSphere({ decisionCount, fillCount, tone, reducedMotion, size, points = 1600, testID = "holo-sphere" }: HoloSphereProps) {
  const state = useRef(initialHoloState());
  const stillDrawn = useRef(false);
  const field = useMemo(() => buildFlowField(Math.min(1, points / 1600)), [points]);
  const paints = useMemo(() => {
    const line = Skia.Paint(); line.setAntiAlias(true); line.setStyle(PaintStyle.Stroke); line.setBlendMode(BlendMode.Plus);
    const dot = Skia.Paint(); dot.setAntiAlias(true); dot.setStyle(PaintStyle.Stroke); dot.setStrokeCap(StrokeCap.Round); dot.setBlendMode(BlendMode.Plus);
    const glow = Skia.Paint(); glow.setAntiAlias(true); glow.setBlendMode(BlendMode.Plus);
    // A soft bloom when the renderer supports a blur mask; without it the halo and beam still draw crisply.
    try { glow.setMaskFilter(Skia.MaskFilter.MakeBlur(BlurStyle.Normal, Math.max(6, size / 24), true)); } catch { /* no blur */ }
    return { line, dot, glow };
  }, [size]);
  const rgba = useMemo(() => new Float32Array(4), []);
  const [picture, setPicture] = useState<SkPicture | null>(null);

  const render = (nowMs: number) => {
    const s = state.current, S = size;
    const grow = easeOutCubic(s.birth), tSec = reducedMotion ? 0 : flowClockSec(s);
    const ink = holoInk(tone, s.tintMix);
    const accent = tone === "normal" ? HOLO_COLORS.lime : ink;
    const set = (p: typeof paints.line, c: Rgb, a: number) => { rgba[0] = c[0] / 255; rgba[1] = c[1] / 255; rgba[2] = c[2] / 255; rgba[3] = Math.max(0, Math.min(1, a)); p.setColor(rgba); };
    const mix = (a: Rgb, b: Rgb, m: number): Rgb => [a[0] + (b[0] - a[0]) * m, a[1] + (b[1] - a[1]) * m, a[2] + (b[2] - a[2]) * m];
    const pulses: number[] = [];
    if (!reducedMotion) for (const wave of s.waves) { const p = flowPulsePosition(wave, nowMs); if (p != null) pulses.push(p); }
    const burst = reducedMotion ? 0 : s.burst;
    const hairline = Math.max(0.5, S / 500);
    const density = Math.min(1, points / 1600);
    const tailPoints = density < 0.5 ? 1 : FLOW_COMET_TAIL_POINTS;
    const orderAge = !reducedMotion && s.orderBornMs != null ? (nowMs - s.orderBornMs) / 1000 : null;
    setPicture(createPicture((canvas) => {
      // Comets: a bright head with a fading tail, batched into three brightness groups plus the heads.
      const heads: SkPoint[] = [], tails: SkPoint[][] = [[], [], []];
      const addComet = (curve: ReturnType<typeof flowStrandCurve>, u: number) => {
        for (let j = 0; j < tailPoints; j += 1) {
          const p = flowStrandPoint(curve, flowTailProgress(u, j, tailPoints));
          const point = { x: p.x * S, y: p.y * S };
          if (j === 0) heads.push(point); else tails[Math.min(2, Math.floor(flowTailLight(j, tailPoints) * 3))]!.push(point);
        }
      };
      // Streams: one batched path per stream and brightness group, plus the ambient comets riding them.
      FLOW_EDGES.forEach(([from, to], e) => {
        const lit = pulses.reduce((m, p) => Math.max(m, flowEdgeGlow(p, e)), 0);
        const open = flowEdgeOpen(e, tone, s.tintMix);
        const fromColor = from < 0 ? FLOW_NODES[0]!.color : flowNodeColor(from, tone, s.tintMix);
        let color = mix(fromColor, flowNodeColor(to, tone, s.tintMix), 0.5);
        const order = e === FLOW_EDGES.length - 1 ? burst : 0;
        if (order > 0.02) color = mix(color, accent, order);
        const bright = Skia.Path.Make(), dim = Skia.Path.Make();
        field.strands[e]!.forEach((strand, k) => {
          const c = flowStrandCurve(e, strand, tSec);
          const path = strand.alpha > 0.6 ? bright : dim;
          path.moveTo(c.sx * S, c.sy * S); path.quadTo(c.cx * S, c.cy * S, c.ex * S, c.ey * S);
          if (!reducedMotion && k % 4 === 0 && open > 0.5) addComet(c, flowAmbientComet(strand, tSec));
        });
        paints.line.setStrokeWidth(hairline);
        set(paints.line, color, grow * open * (0.05 + lit * 0.12 + order * 0.12)); canvas.drawPath(bright, paints.line);
        set(paints.line, color, grow * open * (0.025 + lit * 0.06 + order * 0.06)); canvas.drawPath(dim, paints.line);
        // A decision launches bright comets down every stream, stream by stream, so the pulse visibly travels the chain.
        if (!reducedMotion && open > 0.5) for (const wave of s.waves) {
          const strands = field.strands[e]!;
          for (let i = 0; i < FLOW_COMETS_PER_EDGE; i += 1) {
            const u = flowCometProgress(wave, e, i, nowMs);
            if (u != null) addComet(flowStrandCurve(e, strands[flowCometStrand(e, i, strands.length)]!, tSec), u);
          }
        }
      });
      const cometColor = mix(ink, [255, 255, 255], 0.5);
      paints.dot.setStrokeWidth(hairline * 1.6);
      [0.22, 0.4, 0.62].forEach((alpha, g) => { if (tails[g]!.length > 0) { set(paints.dot, cometColor, grow * alpha); canvas.drawPoints(PointMode.Points, tails[g]!, paints.dot); } });
      if (heads.length > 0) { paints.dot.setStrokeWidth(hairline * 3); set(paints.dot, [255, 255, 255], grow * 0.95); canvas.drawPoints(PointMode.Points, heads, paints.dot); }
      // Clusters: a breathing halo, particles that each swirl at their own rate and twinkle, and a ring where a pulse lands.
      FLOW_NODES.forEach((node, i) => {
        const lit = pulses.reduce((m, p) => Math.max(m, flowNodeGlow(p, i)), 0);
        const flare = i === FLOW_PAPER ? burst : 0;
        const color = flare > 0.02 ? mix(flowNodeColor(i, tone, s.tintMix), accent, flare) : flowNodeColor(i, tone, s.tintMix);
        const breath = reducedMotion ? 1 : flowBreath(i, tSec, lit * 0.8, flare);
        const cx = node.x * S, cy = node.y * S, r = node.r * S * (0.6 + 0.4 * grow) * breath;
        paints.glow.setStyle(PaintStyle.Fill);
        set(paints.glow, color, grow * (0.12 + lit * 0.2 + flare * 0.35)); canvas.drawCircle(cx, cy, r * 0.9, paints.glow);
        const arrival = reducedMotion ? null : flowArrivalRing(lit);
        if (arrival != null) { paints.line.setStrokeWidth(hairline * 2); set(paints.line, color, grow * arrival.alpha); canvas.drawCircle(cx, cy, node.r * S * arrival.scale, paints.line); }
        const pts = field.points[i]!, n = pts.length / 4, near: SkPoint[] = [], far: SkPoint[] = [];
        for (let k = 0; k < n; k += 1) {
          const m = pts[k * 4 + 3]!;
          const p = flowClusterPoint(i, pts, k, tSec * 0.07 * flowParticleSwirl(m), (0.6 + 0.4 * grow) * breath);
          (p.light * (0.5 + m) * (reducedMotion ? 1 : flowParticleTwinkle(m, tSec)) > 0.7 ? near : far).push({ x: p.x * S, y: p.y * S });
        }
        paints.dot.setStrokeWidth(hairline * 1.8);
        set(paints.dot, color, grow * (0.7 + lit * 0.3)); canvas.drawPoints(PointMode.Points, near, paints.dot);
        set(paints.dot, color, grow * (0.32 + lit * 0.3)); canvas.drawPoints(PointMode.Points, far, paints.dot);
      });
      // A PAPER order: three staggered lime rings, a beam rising from the paper cluster, and sparks thrown outward.
      if (orderAge != null) {
        const foot = holoFillMarker(S), paper = FLOW_NODES[FLOW_PAPER]!;
        paints.line.setStrokeWidth(Math.max(1, S / 260));
        for (let ring = 0; ring < 3; ring += 1) {
          const o = flowOrderRing(ring, orderAge);
          if (o != null) { set(paints.line, accent, grow * o.alpha); canvas.drawCircle(paper.x * S, paper.y * S, paper.r * S * o.scale, paints.line); }
        }
        const beam = Math.max(0, 1 - orderAge / (HOLO_ORDER_MS / 1000)), rise = easeOutCubic(orderAge / 0.5);
        if (beam > 0.02) { set(paints.line, accent, grow * 0.7 * beam); canvas.drawLine(foot.x, foot.y, foot.x, foot.y - (foot.y) * rise, paints.line); }
        const sparks: SkPoint[][] = [[], [], []];
        const sparkCount = Math.max(16, Math.round(FLOW_SPARKS * density));
        for (let i = 0; i < sparkCount; i += 1) {
          const sp = flowSpark(i, orderAge);
          if (sp != null) sparks[Math.min(2, Math.floor(sp.life * 3))]!.push({ x: sp.x * S, y: sp.y * S });
        }
        paints.dot.setStrokeWidth(hairline * 2.2);
        [0.35, 0.65, 1].forEach((alpha, g) => { if (sparks[g]!.length > 0) { set(paints.dot, accent, grow * alpha); canvas.drawPoints(PointMode.Points, sparks[g]!, paints.dot); } });
      }
    }, { width: size, height: size }));
  };

  useEffect(() => {
    const now = Date.now();
    state.current = observeHolo(state.current, decisionCount, fillCount, now);
    if (reducedMotion || decisionCount == null) {
      // Still figure: no pulses or ring in flight, tone colour applied.
      state.current = Object.freeze({ ...state.current, waves: Object.freeze([]), burst: 0, burstTarget: 0, flash: 0, birth: 1, tintMix: 1, orderBornMs: null });
      stillDrawn.current = true;
      render(now);
      return undefined;
    }
    // HOME starts with reduced motion assumed until the OS preference resolves; replay the entrance once when live motion begins.
    if (stillDrawn.current) { stillDrawn.current = false; state.current = Object.freeze({ ...state.current, birth: 0 }); }
    let alive = true, last = 0, frame = 0;
    const loop = (t: number) => {
      if (!alive) return;
      const budget = holoFrameBudgetMs(isHoloQuiet(state.current));
      if (t - last >= budget) {
        const dt = last === 0 ? budget : t - last;
        last = t;
        const nowMs = Date.now();
        state.current = tickHolo(state.current, tone, dt, nowMs);
        render(nowMs);
      }
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => { alive = false; cancelAnimationFrame(frame); };
  }, [decisionCount, fillCount, tone, reducedMotion, size, field]); // eslint-disable-line react-hooks/exhaustive-deps

  return <View style={[styles.stage, { width: size, height: size }]} pointerEvents="none" testID={testID} importantForAccessibility="no-hide-descendants">
    <Canvas style={{ width: size, height: size }}>{picture ? <Picture picture={picture} /> : null}</Canvas>
    {size >= LABEL_MIN_SIZE ? FLOW_NODES.map((node, i) => {
      const width = Math.round(node.label.length * 6.4 + 18);
      return <View key={node.id} style={[styles.label, { width }, flowLabelPlacement(size, i, width)]}>
        <View style={[styles.labelDot, { backgroundColor: `rgb(${node.color.join(",")})` }]} />
        <Text style={[fieldFonts.mono, styles.labelText]}>{node.label}</Text>
      </View>;
    }) : null}
  </View>;
}

const styles = StyleSheet.create({
  stage: { alignItems: "center", justifyContent: "center" },
  label: { position: "absolute", flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: 2, paddingHorizontal: 4, backgroundColor: "rgba(8,10,14,0.78)" },
  labelDot: { width: 5, height: 5, borderRadius: 3 },
  labelText: { fontSize: 10, color: calmPalette.text },
});
