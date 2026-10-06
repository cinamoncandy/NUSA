import React, { useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { BlendMode, BlurStyle, Canvas, PaintStyle, Picture, PointMode, Skia, StrokeCap, createPicture, type SkPicture } from "@shopify/react-native-skia";
import { HOLO_COLORS, FLOW_ALPHA_LEVELS, FLOW_BAND_Y, FLOW_ROWS, FLOW_TICKS, FLOW_WALL_END, easeOutCubic, flowArcX, flowBandRows, flowBucketAlpha, flowBucketThick, flowClockSec, flowLineBucket, flowLines, flowSegment, flowTick, holoFillMarker, holoFrameBudgetMs, holoInk, initialHoloState, isHoloQuiet, observeHolo, pulseFor, tickHolo, wallBar, wallRows, type HoloTone } from "./holoModel";

export interface HoloSphereProps {
  /** Real runtime decision count; each increase lights one row of the wall and moves the ruler marker to it. Null draws it still. */
  readonly decisionCount: number | null;
  /** Real PAPER order count; each increase sends a lime band across the field to a marker on the right edge, then it settles. */
  readonly fillCount: number | null;
  readonly tone: HoloTone;
  /** Still figure: reduce-motion, or a secondary-tab mark. */
  readonly reducedMotion: boolean;
  readonly size: number;
  /** Detail level: below 600 the field is drawn as a small mark (fewer hairlines and rows, no ticks). */
  readonly points?: number;
  readonly testID?: string;
}

type Pt = { x: number; y: number };

/**
 * NUSA flow-field mark, after the owner's reference: fine hairlines stream in from the left toward a curved ruler, a white marker
 * rides the ruler, and a wall of thin bars stands on its right. A runtime decision lights one wall row and the hairlines beside
 * it; a PAPER order sends a lime band across the whole field. See holoModel.ts for the geometry and how runtime facts drive it.
 * The component name is kept for its callers.
 *
 * Drawing is batched: hairlines are grouped by quantised alpha and width and drawn as line lists, the unlit bars as two line lists,
 * and the ruler's arcs and ticks are built once per size, so a frame makes about two dozen draw calls instead of several hundred.
 */
export function HoloSphere({ decisionCount, fillCount, tone, reducedMotion, size, points = 1600, testID = "holo-sphere" }: HoloSphereProps) {
  const state = useRef(initialHoloState());
  const markY = useRef<number | null>(null);
  const stillDrawn = useRef(false);
  const paints = useMemo(() => {
    const make = (stroke: boolean, blur = 0) => {
      const p = Skia.Paint(); p.setBlendMode(BlendMode.Plus); p.setAntiAlias(true);
      if (stroke) { p.setStyle(PaintStyle.Stroke); p.setStrokeCap(StrokeCap.Butt); }
      // A soft glow when the renderer supports a blur mask; without it the crisp passes still draw the figure.
      if (blur > 0) { try { p.setMaskFilter(Skia.MaskFilter.MakeBlur(BlurStyle.Normal, blur, true)); } catch { /* no blur */ } }
      return p;
    };
    return { fill: make(false), line: make(true), glowLine: make(true, 2.2), bloomSmall: make(false, 3) };
  }, []);
  const rgba = useMemo(() => new Float32Array(4), []);
  const [picture, setPicture] = useState<SkPicture | null>(null);
  // A small mark (the header or the menu) draws every few lines and rows and skips the ticks.
  const detail = points >= 600 ? 1 : 0;
  const lines = useMemo(() => flowLines().filter((_, i) => detail === 1 || i % 6 === 0), [detail]);
  const rows = useMemo(() => wallRows().map((row, index) => ({ row, index })).filter(({ index }) => detail === 1 || index % 3 === 0), [detail]);
  // Per-size geometry built once: the ruler's arcs and ticks never change.
  const fixed = useMemo(() => {
    const u = size / 300;
    const arc = (offset: number): Pt[] => { const pts: Pt[] = []; for (let i = 0; i <= 40; i += 1) { const y = i / 40; pts.push({ x: flowArcX(y) * size + offset * u, y: y * size }); } return pts; };
    const longTicks: Pt[] = [], shortTicks: Pt[] = [];
    if (detail === 1) for (let i = 0; i < FLOW_TICKS; i += 1) {
      const t = flowTick(i), x = flowArcX(t.y) * size, half = (t.long ? 9 : 5) * u, into = t.long ? longTicks : shortTicks;
      into.push({ x: x - half, y: t.y * size }, { x: x + half, y: t.y * size });
    }
    return { arcOuter: arc(-5), arcInner: arc(5), arcBand: arc(0), longTicks, shortTicks };
  }, [size, detail]);
  // Reused every frame so drawing allocates no points: one point pair per hairline and per bar, grouped into buckets by look.
  const scratch = useMemo(() => ({
    linePool: lines.map(() => [{ x: 0, y: 0 }, { x: 0, y: 0 }] as [Pt, Pt]),
    lineBuckets: Array.from({ length: FLOW_ALPHA_LEVELS * 2 }, () => [] as Pt[]),
    barPool: rows.map(() => [{ x: 0, y: 0 }, { x: 0, y: 0 }] as [Pt, Pt]),
    barBright: [] as Pt[],
    barDim: [] as Pt[],
  }), [lines, rows]);

  const render = (nowMs: number, dtMs: number) => {
    const s = state.current, S = size, u = S / 300;
    const grow = easeOutCubic(s.birth), tSec = reducedMotion ? 0 : flowClockSec(s);
    const ink = holoInk(tone, s.tintMix);
    const accent = tone === "normal" ? HOLO_COLORS.lime : ink;
    const set = (p: typeof paints.fill, c: readonly [number, number, number], a: number) => { rgba[0] = c[0] / 255; rgba[1] = c[1] / 255; rgba[2] = c[2] / 255; rgba[3] = Math.max(0, Math.min(1, a)); p.setColor(rgba); };
    const pulses = reducedMotion ? [] : s.waves.map((wave) => pulseFor(wave, nowMs)).filter((p): p is NonNullable<typeof p> => p != null);
    const lit = new Map<number, { glow: number; reach: number }>();
    for (const p of pulses) { const old = lit.get(p.row); if (old == null || old.glow < p.glow) lit.set(p.row, { glow: p.glow, reach: p.reach }); }
    // The ruler marker eases to the row the latest decision lit (or rests mid-height before any).
    const targetY = ((s.markRow ?? FLOW_ROWS / 2) + 0.5) / FLOW_ROWS;
    markY.current = markY.current == null || reducedMotion ? targetY : markY.current + (targetY - markY.current) * Math.min(1, 1 - Math.pow(0.9, dtMs / 16.7));
    const my = markY.current;
    const band = flowBandRows();
    const { lineBuckets, linePool, barPool, barBright, barDim } = scratch;
    setPicture(createPicture((canvas) => {
      // 1. The stream: hairlines flowing toward the ruler, grouped by look; a line near a lit row brightens and is drawn on its own.
      for (const bucket of lineBuckets) bucket.length = 0;
      for (let n = 0; n < lines.length; n += 1) {
        const line = lines[n]!, seg = flowSegment(line, tSec);
        let a = seg.alpha * grow, w = Math.max(0.4, line.width * u), boosted = false;
        for (const [row, l] of lit) { const dy = Math.abs((row + 0.5) / FLOW_ROWS - line.y); if (dy < 0.05) { a += l.glow * (1 - dy / 0.05) * 0.5; w *= 1 + l.glow * 0.8; boosted = true; } }
        if (boosted) { set(paints.line, ink, a); paints.line.setStrokeWidth(w); canvas.drawLine(seg.x0 * S, seg.y0 * S, seg.x1 * S, seg.y1 * S, paints.line); continue; }
        const pair = linePool[n]!; pair[0].x = seg.x0 * S; pair[0].y = seg.y0 * S; pair[1].x = seg.x1 * S; pair[1].y = seg.y1 * S;
        lineBuckets[flowLineBucket(a, line.width)]!.push(pair[0], pair[1]);
      }
      for (let b = 0; b < lineBuckets.length; b += 1) {
        if (lineBuckets[b]!.length === 0) continue;
        set(paints.line, ink, flowBucketAlpha(b)); paints.line.setStrokeWidth(Math.max(0.4, (flowBucketThick(b) ? 0.78 : 0.45) * u));
        canvas.drawPoints(PointMode.Lines, lineBuckets[b]!, paints.line);
      }
      // 2. The ruler: two thin arcs with a faint band between them, and ticks (built once per size).
      set(paints.line, ink, grow * 0.5); paints.line.setStrokeWidth(Math.max(0.5, 0.9 * u));
      canvas.drawPoints(PointMode.Polygon, fixed.arcOuter, paints.line); canvas.drawPoints(PointMode.Polygon, fixed.arcInner, paints.line);
      set(paints.line, ink, grow * 0.07); paints.line.setStrokeWidth(10 * u); canvas.drawPoints(PointMode.Polygon, fixed.arcBand, paints.line);
      if (fixed.longTicks.length > 0) {
        paints.line.setStrokeWidth(Math.max(0.5, 0.9 * u));
        set(paints.line, ink, grow * 0.9); canvas.drawPoints(PointMode.Lines, fixed.longTicks, paints.line);
        set(paints.line, ink, grow * 0.5); canvas.drawPoints(PointMode.Lines, fixed.shortTicks, paints.line);
      }
      // 3. The wall: thin bars from the ruler toward the right edge, the unlit ones in two batches by brightness; a lit row grows to full length and flares on its own.
      const rowH = (S / FLOW_ROWS) * (detail === 1 ? 0.95 : 2.6);
      barBright.length = 0; barDim.length = 0;
      for (let n = 0; n < rows.length; n += 1) {
        const { row, index } = rows[n]!, bar = wallBar(row, tSec, grow), l = lit.get(index);
        if (l == null) {
          const pair = barPool[n]!; pair[0].x = bar.x0 * S; pair[0].y = bar.y * S; pair[1].x = bar.x1 * S; pair[1].y = bar.y * S;
          (row.bright ? barBright : barDim).push(pair[0], pair[1]);
          continue;
        }
        const x1 = bar.x1 + (FLOW_WALL_END - bar.x1) * l.reach * l.glow;
        set(paints.line, ink, Math.min(1, bar.alpha + l.glow * 0.5)); paints.line.setStrokeWidth(rowH * (1 + l.glow));
        canvas.drawLine(bar.x0 * S, bar.y * S, x1 * S, bar.y * S, paints.line);
        if (l.glow > 0.05) { set(paints.glowLine, ink, l.glow * 0.6); paints.glowLine.setStrokeWidth(rowH * 2.4); canvas.drawLine(bar.x0 * S, bar.y * S, x1 * S, bar.y * S, paints.glowLine); }
      }
      paints.line.setStrokeWidth(rowH);
      if (barDim.length > 0) { set(paints.line, ink, 0.5); canvas.drawPoints(PointMode.Lines, barDim, paints.line); }
      if (barBright.length > 0) { set(paints.line, ink, 0.86); canvas.drawPoints(PointMode.Lines, barBright, paints.line); }
      // 4. The ruler marker: a short white bar riding the ruler at the lit row.
      set(paints.line, ink, grow * 0.95); paints.line.setStrokeWidth(Math.max(1.2, 2.4 * u));
      canvas.drawLine(flowArcX(my) * S, (my - 0.035) * S, flowArcX(my) * S, (my + 0.035) * S, paints.line);
      // 5. A PAPER order: a lime band across the whole field, and a marker at its right end that flares.
      if (s.burst > 0.02) {
        const bandX1 = (flowArcX(FLOW_BAND_Y) + (FLOW_WALL_END - flowArcX(FLOW_BAND_Y)) * s.burst) * S;
        for (let index = band.first; index <= band.last; index += 1) {
          const y = ((index + 0.5) / FLOW_ROWS) * S, centre = index - (band.first + band.last) / 2, fade = 1 - Math.abs(centre) * 0.22;
          set(paints.line, accent, grow * 0.9 * s.burst * fade); paints.line.setStrokeWidth((S / FLOW_ROWS) * 0.95);
          canvas.drawLine(0, y, bandX1, y, paints.line);
          if (centre === 0) { set(paints.glowLine, accent, grow * 0.55 * s.burst); paints.glowLine.setStrokeWidth((S / FLOW_ROWS) * 3); canvas.drawLine(0, y, bandX1, y, paints.glowLine); }
        }
        const end = holoFillMarker(S);
        set(paints.bloomSmall, accent, grow * 0.45 * s.burst); canvas.drawCircle(end.x, end.y, 9 * u, paints.bloomSmall);
        set(paints.fill, accent, grow * 0.95 * s.burst); canvas.drawRect(Skia.XYWHRect(end.x - 4 * u, end.y - 5 * u, 8 * u, 10 * u), paints.fill);
      }
    }, { width: size, height: size }));
  };

  useEffect(() => {
    const now = Date.now();
    state.current = observeHolo(state.current, decisionCount, fillCount, now);
    if (reducedMotion || decisionCount == null) {
      // Still figure: no pulses or band in flight, tone colour applied.
      state.current = Object.freeze({ ...state.current, waves: Object.freeze([]), burst: 0, burstTarget: 0, flash: 0, birth: 1, tintMix: 1 });
      stillDrawn.current = true;
      render(now, 0);
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
        render(nowMs, dt);
      }
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => { alive = false; cancelAnimationFrame(frame); };
  }, [decisionCount, fillCount, tone, reducedMotion, size]); // eslint-disable-line react-hooks/exhaustive-deps

  return <View style={[styles.stage, { width: size, height: size }]} pointerEvents="none" testID={testID} importantForAccessibility="no-hide-descendants">
    <Canvas style={{ width: size, height: size }}>{picture ? <Picture picture={picture} /> : null}</Canvas>
  </View>;
}

const styles = StyleSheet.create({ stage: { alignItems: "center", justifyContent: "center" } });
