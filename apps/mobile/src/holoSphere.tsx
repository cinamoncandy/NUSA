import React, { useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { BlendMode, BlurStyle, Canvas, PaintStyle, Picture, PointMode, Skia, StrokeCap, createPicture, type SkPicture } from "@shopify/react-native-skia";
import { fieldMotion } from "./designSystem";
import { HOLO_COLORS, BURST_FILL_ANGLE, BURST_FILL_REACH, BURST_ROTATION, BURST_TILT, HOLO_RADIUS_FRACTION, burstStreaks, dustField, dustPosition, easeOutBack, easeOutCubic, holoColor, holoFrameBudgetMs, initialHoloState, isHoloQuiet, observeHolo, pulseFor, streakLength, tickHolo, type HoloTone } from "./holoModel";

export interface HoloSphereProps {
  /** Real runtime decision count; each increase sends a pulse ring and a bright streak out from the core. Null draws it still. */
  readonly decisionCount: number | null;
  /** Real PAPER order count; each increase draws a line from the core to a marker and flares it, then it settles. */
  readonly fillCount: number | null;
  readonly tone: HoloTone;
  /** Still figure: reduce-motion, or a secondary-tab mark. */
  readonly reducedMotion: boolean;
  readonly size: number;
  readonly points?: number;
  readonly testID?: string;
}


/**
 * NUSA holo mark, after the owner's reference: a lime core with fine light streaks, a tilted disc of dust and
 * thin ellipse rings. A runtime decision sends a pulse ring and a bright streak out from the core; a PAPER fill
 * draws a line from the core to a marker that flares. See holoModel.ts for how runtime facts drive it. The
 * component name is kept for its callers.
 */
/** Soft atmosphere: this many stacked, very faint discs from the figure radius down to the core read as a smooth glow, not rings. */
const FOG_STEPS = 16;

export function HoloSphere({ decisionCount, fillCount, tone, reducedMotion, size, points = 1600, testID = "holo-sphere" }: HoloSphereProps) {
  const state = useRef(initialHoloState());
  const stillDrawn = useRef(false);
  const paints = useMemo(() => {
    const make = (stroke: boolean, blur = 0) => {
      const p = Skia.Paint(); p.setBlendMode(BlendMode.Plus); p.setAntiAlias(true);
      if (stroke) { p.setStyle(PaintStyle.Stroke); p.setStrokeCap(StrokeCap.Round); }
      // A soft glow when the renderer supports a blur mask; without it the crisp passes still draw the figure.
      if (blur > 0) { try { p.setMaskFilter(Skia.MaskFilter.MakeBlur(BlurStyle.Normal, blur, true)); } catch { /* no blur */ } }
      return p;
    };
    return { fill: make(false), line: make(true), glowLine: make(true, 1.6), bloom: make(false, 9), bloomSmall: make(false, 3) };
  }, []);
  const rgba = useMemo(() => new Float32Array(4), []);
  const [picture, setPicture] = useState<SkPicture | null>(null);
  const streaks = useMemo(() => burstStreaks(), []);
  // Dust is drawn in a handful of batched point calls (by brightness and by how faint), with preallocated points so a frame allocates nothing.
  const dustBatches = useMemo(() => {
    if (points < 600) return [];
    const field = dustField(), batches: { idx: number[]; pts: { x: number; y: number }[]; bright: boolean; alpha: number; width: number }[] = [];
    for (const bright of [true, false]) for (const [lo, hi] of [[0, 0.25], [0.25, 0.45], [0.45, 1.01]] as const) {
      const idx = field.map((d, i) => (d.bright === bright && d.alpha >= lo && d.alpha < hi ? i : -1)).filter((i) => i >= 0);
      if (idx.length === 0) continue;
      batches.push({ idx, pts: idx.map(() => ({ x: 0, y: 0 })), bright, alpha: idx.reduce((sum, i) => sum + field[i]!.alpha, 0) / idx.length, width: idx.reduce((sum, i) => sum + field[i]!.size, 0) / idx.length });
    }
    return batches;
  }, [points]);

  const render = (nowMs: number) => {
    const s = state.current, cx = size / 2, cy = size / 2, u = size / 300;
    const bloom = easeOutCubic(s.birth);
    const R = size * HOLO_RADIUS_FRACTION * (0.12 + 0.88 * easeOutBack(s.birth));
    const tSec = reducedMotion ? 0 : nowMs / 1000, flowSec = fieldMotion.holoFlowMs / 1000;
    // Emerald comes from the ramp so hold / halt tint it amber / red and a fill flares it; lime is only the active line and marker.
    const emerald = holoColor(-1, 0, 0, tone, s.flash * 0.3, s.flashColor, s.tintMix);
    const accent = tone === "normal" ? HOLO_COLORS.lime : emerald;
    const tintW = tone === "normal" ? 0 : 0.85 * s.tintMix, toneRgb = tone === "halt" ? HOLO_COLORS.halt : HOLO_COLORS.hold;
    const white: readonly [number, number, number] = [236 + (toneRgb[0] - 236) * tintW, 255 + (toneRgb[1] - 255) * tintW, 244 + (toneRgb[2] - 244) * tintW];
    const pulse = reducedMotion ? 0.5 : 0.5 + 0.5 * Math.sin(nowMs / 640);
    const set = (p: typeof paints.fill, c: readonly [number, number, number], a: number) => { rgba[0] = c[0] / 255; rgba[1] = c[1] / 255; rgba[2] = c[2] / 255; rgba[3] = Math.max(0, Math.min(1, a)); p.setColor(rgba); };
    const boost = 1 + 0.4 * s.flash;
    setPicture(createPicture((canvas) => {
      // Atmosphere: stacked, very faint discs read as a smooth glow.
      for (let i = 0; i < FOG_STEPS; i += 1) { const t = i / (FOG_STEPS - 1); set(paints.fill, emerald, bloom * 0.012 * boost); canvas.drawCircle(cx, cy, R * (1.02 - 0.92 * t), paints.fill); }
      // Two thin ellipse rings on the tilted disc.
      canvas.save(); canvas.translate(cx, cy); canvas.rotate((BURST_ROTATION * 180) / Math.PI, 0, 0);
      for (const [rr, al] of [[0.95, 0.2], [0.74, 0.1]] as const) { set(paints.line, emerald, bloom * al); paints.line.setStrokeWidth(Math.max(0.5, 0.8 * u)); canvas.drawOval(Skia.XYWHRect(-R * rr, -R * rr * BURST_TILT, R * rr * 2, R * rr * 2 * BURST_TILT), paints.line); }
      canvas.restore();
      // Dense, fine dust (batched).
      if (dustBatches.length > 0) {
        const field = dustField();
        for (const batch of dustBatches) {
          for (let k = 0; k < batch.idx.length; k += 1) { const q = dustPosition(field[batch.idx[k]!]!, tSec, flowSec), pt = batch.pts[k]!; pt.x = cx + q.x * R; pt.y = cy + q.y * R; }
          set(paints.line, batch.bright ? white : emerald, bloom * batch.alpha * boost); paints.line.setStrokeWidth(Math.max(0.5, batch.width * 2 * u));
          canvas.drawPoints(PointMode.Points, batch.pts, paints.line);
        }
      }
      // Thin streaks: a soft glow pass, then the crisp pass.
      for (let pass = 0; pass < 2; pass += 1) {
        const p = pass === 0 ? paints.glowLine : paints.line;
        for (let n = 0; n < streaks.length; n += 1) {
          const k = streaks[n]!, len = R * streakLength(k, tSec), c = Math.cos(k.angle), sn = Math.sin(k.angle);
          set(p, n % 9 === 0 ? white : emerald, bloom * k.alpha * boost * (pass === 0 ? 0.7 : 1)); p.setStrokeWidth(Math.max(0.4, k.width * u));
          canvas.drawLine(cx + c * R * k.inner, cy + sn * R * k.inner, cx + c * len, cy + sn * len, p);
        }
      }
      // Decisions: a pulse ring and a bright streak from the core.
      for (const wave of s.waves) {
        const pl = pulseFor(wave, nowMs); if (pl == null) continue;
        set(paints.line, emerald, bloom * pl.ringAlpha); paints.line.setStrokeWidth(Math.max(0.8, 1.4 * u)); canvas.drawCircle(cx, cy, R * pl.ringRadius, paints.line);
        set(paints.line, white, bloom * pl.streakAlpha); paints.line.setStrokeWidth(Math.max(0.9, 1.8 * u));
        canvas.drawLine(cx, cy, cx + Math.cos(pl.angle) * R * pl.streakLength, cy + Math.sin(pl.angle) * R * pl.streakLength, paints.line);
      }
      // PAPER fill: an accent line from the core to a marker that flares.
      if (s.burst > 0.02) {
        const ex = cx + Math.cos(BURST_FILL_ANGLE) * R * BURST_FILL_REACH * s.burst, ey = cy + Math.sin(BURST_FILL_ANGLE) * R * BURST_FILL_REACH * s.burst;
        set(paints.line, accent, bloom * 0.95); paints.line.setStrokeWidth(Math.max(1, 1.5 * u)); canvas.drawLine(cx, cy, ex, ey, paints.line);
        set(paints.bloomSmall, accent, bloom * 0.45 * s.burst); canvas.drawCircle(ex, ey, 9 * u, paints.bloomSmall);
        set(paints.fill, accent, bloom * 0.95 * s.burst); canvas.drawRect(Skia.XYWHRect(ex - 5 * u, ey - 3.5 * u, 10 * u, 7 * u), paints.fill);
      }
      // Core: soft emerald bloom, a white glow and a white point.
      set(paints.bloom, emerald, bloom * (0.2 + 0.06 * pulse) * boost); canvas.drawCircle(cx, cy, R * 0.26, paints.bloom);
      set(paints.bloomSmall, white, bloom * 0.45 * boost); canvas.drawCircle(cx, cy, R * 0.06, paints.bloomSmall);
      set(paints.fill, white, bloom * 0.95); canvas.drawCircle(cx, cy, Math.max(1, 2.6 * u), paints.fill);
    }, { width: size, height: size }));
  };

  useEffect(() => {
    const now = Date.now();
    state.current = observeHolo(state.current, decisionCount, fillCount, now);
    if (reducedMotion || decisionCount == null) {
      // Still figure: no waves or burst in flight, tone colour applied.
      state.current = Object.freeze({ ...state.current, waves: Object.freeze([]), burst: 0, burstTarget: 0, flash: 0, birth: 1, tintMix: 1 });
      stillDrawn.current = true;
      render(now);
      return undefined;
    }
    // HOME starts with reduced motion assumed until the OS preference resolves; replay the bloom once when live motion begins.
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
  }, [decisionCount, fillCount, tone, reducedMotion, size]); // eslint-disable-line react-hooks/exhaustive-deps

  return <View style={[styles.stage, { width: size, height: size }]} pointerEvents="none" testID={testID} importantForAccessibility="no-hide-descendants">
    <Canvas style={{ width: size, height: size }}>{picture ? <Picture picture={picture} /> : null}</Canvas>
  </View>;
}

const styles = StyleSheet.create({ stage: { alignItems: "center", justifyContent: "center" } });
