import React, { useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { BlendMode, BlurStyle, Canvas, PaintStyle, Picture, PointMode, Skia, StrokeCap, createPicture, type SkPicture, type SkPoint } from "@shopify/react-native-skia";
import { fieldFonts } from "./fieldFonts";
import { calmPalette } from "./designSystem";
import { FLOW_EDGES, FLOW_NODES, FLOW_PAPER, HOLO_COLORS, buildFlowField, easeOutCubic, flowClockSec, flowClusterPoint, flowEdgeGlow, flowEdgeOpen, flowLabelPlacement, flowNodeColor, flowNodeGlow, flowPulsePosition, flowStrandCurve, flowStrandPoint, holoFillMarker, holoFrameBudgetMs, holoInk, initialHoloState, isHoloQuiet, observeHolo, tickHolo, type HoloTone, type Rgb } from "./holoModel";

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
    setPicture(createPicture((canvas) => {
      // Streams: one batched path per stream and brightness group, plus the particles riding them.
      FLOW_EDGES.forEach(([from, to], e) => {
        const lit = pulses.reduce((m, p) => Math.max(m, flowEdgeGlow(p, e)), 0);
        const open = flowEdgeOpen(e, tone, s.tintMix);
        const fromColor = from < 0 ? FLOW_NODES[0]!.color : flowNodeColor(from, tone, s.tintMix);
        let color = mix(fromColor, flowNodeColor(to, tone, s.tintMix), 0.5);
        const order = e === FLOW_EDGES.length - 1 ? burst : 0;
        if (order > 0.02) color = mix(color, accent, order);
        const bright = Skia.Path.Make(), dim = Skia.Path.Make();
        const riders: SkPoint[] = [];
        field.strands[e]!.forEach((strand, k) => {
          const c = flowStrandCurve(e, strand, tSec);
          const path = strand.alpha > 0.6 ? bright : dim;
          path.moveTo(c.sx * S, c.sy * S); path.quadTo(c.cx * S, c.cy * S, c.ex * S, c.ey * S);
          if (!reducedMotion && k % 3 === 0 && open > 0.5) {
            const p = flowStrandPoint(c, ((tSec * 0.18 * strand.speed + strand.phase) % 1 + 1) % 1);
            riders.push({ x: p.x * S, y: p.y * S });
          }
        });
        paints.line.setStrokeWidth(hairline);
        set(paints.line, color, grow * open * (0.05 + lit * 0.12 + order * 0.12)); canvas.drawPath(bright, paints.line);
        set(paints.line, color, grow * open * (0.025 + lit * 0.06 + order * 0.06)); canvas.drawPath(dim, paints.line);
        if (riders.length > 0) { paints.dot.setStrokeWidth(hairline * 2.4); set(paints.dot, mix(color, [255, 255, 255], 0.4), grow * (0.45 + lit * 0.4)); canvas.drawPoints(PointMode.Points, riders, paints.dot); }
      });
      // Clusters: a soft halo, then the particles in a bright and a dim batch.
      const rotation = tSec * 0.05;
      FLOW_NODES.forEach((node, i) => {
        const lit = pulses.reduce((m, p) => Math.max(m, flowNodeGlow(p, i)), 0);
        const flare = i === FLOW_PAPER ? burst : 0;
        const color = flare > 0.02 ? mix(flowNodeColor(i, tone, s.tintMix), accent, flare) : flowNodeColor(i, tone, s.tintMix);
        const cx = node.x * S, cy = node.y * S, r = node.r * S * (0.6 + 0.4 * grow);
        paints.glow.setStyle(PaintStyle.Fill);
        set(paints.glow, color, grow * (0.12 + lit * 0.14 + flare * 0.3)); canvas.drawCircle(cx, cy, r * 0.9, paints.glow);
        const pts = field.points[i]!, n = pts.length / 4, near: SkPoint[] = [], far: SkPoint[] = [];
        for (let k = 0; k < n; k += 1) {
          const p = flowClusterPoint(i, pts, k, rotation, 0.6 + 0.4 * grow);
          (p.light * (0.5 + pts[k * 4 + 3]!) > 0.7 ? near : far).push({ x: p.x * S, y: p.y * S });
        }
        paints.dot.setStrokeWidth(hairline * 1.8);
        set(paints.dot, color, grow * (0.7 + lit * 0.3)); canvas.drawPoints(PointMode.Points, near, paints.dot);
        set(paints.dot, color, grow * (0.32 + lit * 0.3)); canvas.drawPoints(PointMode.Points, far, paints.dot);
      });
      // A PAPER order: a lime ring opening around the paper cluster and a beam rising from it.
      if (burst > 0.02) {
        const foot = holoFillMarker(S), paper = FLOW_NODES[FLOW_PAPER]!;
        paints.line.setStrokeWidth(Math.max(1, S / 260));
        set(paints.line, accent, grow * 0.8 * burst); canvas.drawCircle(paper.x * S, paper.y * S, paper.r * S * (1.1 + 0.7 * burst), paints.line);
        set(paints.line, accent, grow * 0.55 * burst); canvas.drawLine(foot.x, foot.y, foot.x, 0, paints.line);
      }
    }, { width: size, height: size }));
  };

  useEffect(() => {
    const now = Date.now();
    state.current = observeHolo(state.current, decisionCount, fillCount, now);
    if (reducedMotion || decisionCount == null) {
      // Still figure: no pulses or ring in flight, tone colour applied.
      state.current = Object.freeze({ ...state.current, waves: Object.freeze([]), burst: 0, burstTarget: 0, flash: 0, birth: 1, tintMix: 1 });
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
