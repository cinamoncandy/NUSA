import React, { useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { BlendMode, BlurStyle, Canvas, PaintStyle, Picture, PointMode, Skia, StrokeCap, createPicture, type SkPicture } from "@shopify/react-native-skia";
import { HOLO_COLORS, FLOW_BAND_Y, FLOW_ROWS, FLOW_TICKS, FLOW_WALL_END, easeOutCubic, flowArcX, flowBandRows, flowClockSec, flowLines, flowSegment, flowTick, holoFillMarker, holoFrameBudgetMs, holoInk, initialHoloState, isHoloQuiet, observeHolo, pulseFor, tickHolo, wallBar, wallRows, type HoloTone } from "./holoModel";

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

/**
 * NUSA flow-field mark, after the owner's reference: fine hairlines stream in from the left toward a curved ruler, a white marker
 * rides the ruler, and a wall of thin bars stands on its right. A runtime decision lights one wall row and the hairlines beside
 * it; a PAPER order sends a lime band across the whole field. See holoModel.ts for the geometry and how runtime facts drive it.
 * The component name is kept for its callers.
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
    setPicture(createPicture((canvas) => {
      // 1. The stream: fine hairlines flowing toward the ruler; lines near a lit row brighten.
      for (let n = 0; n < lines.length; n += 1) {
        const seg = flowSegment(lines[n]!, tSec);
        let a = seg.alpha * grow, w = Math.max(0.4, lines[n]!.width * u);
        for (const [row, l] of lit) { const dy = Math.abs((row + 0.5) / FLOW_ROWS - lines[n]!.y); if (dy < 0.05) { a += l.glow * (1 - dy / 0.05) * 0.5; w *= 1 + l.glow * 0.8; } }
        set(paints.line, ink, a); paints.line.setStrokeWidth(w);
        canvas.drawLine(seg.x0 * S, seg.y0 * S, seg.x1 * S, seg.y1 * S, paints.line);
      }
      // 2. The ruler: two thin arcs with a faint band between them, and ticks.
      const arc = (offset: number): { x: number; y: number }[] => { const pts: { x: number; y: number }[] = []; for (let i = 0; i <= 40; i += 1) { const y = i / 40; pts.push({ x: flowArcX(y) * S + offset * u, y: y * S }); } return pts; };
      set(paints.line, ink, grow * 0.5); paints.line.setStrokeWidth(Math.max(0.5, 0.9 * u));
      canvas.drawPoints(PointMode.Polygon, arc(-5), paints.line); canvas.drawPoints(PointMode.Polygon, arc(5), paints.line);
      set(paints.line, ink, grow * 0.07); paints.line.setStrokeWidth(10 * u); canvas.drawPoints(PointMode.Polygon, arc(0), paints.line);
      if (detail === 1) {
        for (let i = 0; i < FLOW_TICKS; i += 1) {
          const t = flowTick(i), x = flowArcX(t.y) * S;
          set(paints.line, ink, grow * (t.long ? 0.9 : 0.5)); paints.line.setStrokeWidth(Math.max(0.5, 0.9 * u));
          canvas.drawLine(x - (t.long ? 9 : 5) * u, t.y * S, x + (t.long ? 9 : 5) * u, t.y * S, paints.line);
        }
      }
      // 3. The wall: thin bars from the ruler toward the right edge; a lit row grows to full length and flares.
      const rowH = (S / FLOW_ROWS) * (detail === 1 ? 0.95 : 2.6);
      for (const { row, index } of rows) {
        const bar = wallBar(row, tSec, grow), l = lit.get(index);
        const x1 = l == null ? bar.x1 : bar.x1 + (FLOW_WALL_END - bar.x1) * l.reach * l.glow;
        set(paints.line, ink, Math.min(1, bar.alpha + (l == null ? 0 : l.glow * 0.5))); paints.line.setStrokeWidth(rowH * (l == null ? 1 : 1 + l.glow));
        canvas.drawLine(bar.x0 * S, bar.y * S, x1 * S, bar.y * S, paints.line);
        if (l != null && l.glow > 0.05) { set(paints.glowLine, ink, l.glow * 0.6); paints.glowLine.setStrokeWidth(rowH * 2.4); canvas.drawLine(bar.x0 * S, bar.y * S, x1 * S, bar.y * S, paints.glowLine); }
      }
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
