import React, { useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { BlendMode, Canvas, PaintStyle, Picture, Skia, StrokeCap, createPicture, type SkPicture } from "@shopify/react-native-skia";
import { fieldMotion } from "./designSystem";
import { BURST_FILL_ANGLE, BURST_FILL_REACH, BURST_ROTATION, BURST_TILT, HOLO_RADIUS_FRACTION, burstStreaks, dustField, dustPosition, easeOutBack, easeOutCubic, holoColor, holoFrameBudgetMs, initialHoloState, isHoloQuiet, observeHolo, pulseFor, streakLength, tickHolo, type HoloTone } from "./holoModel";

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
  const paint = useMemo(() => { const p = Skia.Paint(); p.setBlendMode(BlendMode.Plus); p.setAntiAlias(true); return p; }, []);
  const line = useMemo(() => { const p = Skia.Paint(); p.setBlendMode(BlendMode.Plus); p.setAntiAlias(true); p.setStyle(PaintStyle.Stroke); p.setStrokeCap(StrokeCap.Round); return p; }, []);
  const rgba = useMemo(() => new Float32Array(4), []);
  const [picture, setPicture] = useState<SkPicture | null>(null);
  const streaks = useMemo(() => burstStreaks(), []);
  const dust = useMemo(() => (points >= 600 ? dustField() : []), [points]);

  const render = (nowMs: number) => {
    const s = state.current, cx = size / 2, cy = size / 2, u = size / 300;
    const bloom = easeOutCubic(s.birth);
    const R = size * HOLO_RADIUS_FRACTION * (0.12 + 0.88 * easeOutBack(s.birth));
    const tSec = reducedMotion ? 0 : nowMs / 1000, flowSec = fieldMotion.holoFlowMs / 1000;
    // Lime and mint come from the ramp so hold / halt tint them amber / red and a fill flares them pale.
    const lime = holoColor(-1, 0, 0, tone, s.flash, s.flashColor, s.tintMix), mint = holoColor(1, 0, 0, tone, s.flash, s.flashColor, s.tintMix);
    const pulse = reducedMotion ? 0.5 : 0.5 + 0.5 * Math.sin(nowMs / 640);
    const set = (p: typeof paint, c: readonly [number, number, number], a: number) => { rgba[0] = c[0] / 255; rgba[1] = c[1] / 255; rgba[2] = c[2] / 255; rgba[3] = Math.max(0, Math.min(1, a)); p.setColor(rgba); };
    const boost = 1 + 0.6 * s.flash;
    setPicture(createPicture((canvas) => {
      // Atmosphere: stacked soft discs under the core.
      for (let i = 0; i < FOG_STEPS; i += 1) { const t = i / (FOG_STEPS - 1); set(paint, lime, bloom * 0.011 * boost); canvas.drawCircle(cx, cy, R * (1.02 - 0.92 * t), paint); }
      // Two thin ellipse rings on the tilted disc.
      canvas.save(); canvas.translate(cx, cy); canvas.rotate((BURST_ROTATION * 180) / Math.PI, 0, 0);
      for (const [rr, al] of [[0.95, 0.28], [0.76, 0.14]] as const) { set(line, lime, bloom * al); line.setStrokeWidth(Math.max(0.6, u)); canvas.drawOval(Skia.XYWHRect(-R * rr, -R * rr * BURST_TILT, R * rr * 2, R * rr * 2 * BURST_TILT), line); }
      canvas.restore();
      // Dust disc.
      for (const d of dust) { const q = dustPosition(d, tSec, flowSec); set(paint, d.lime ? lime : mint, bloom * d.alpha * boost); canvas.drawCircle(cx + q.x * R, cy + q.y * R, Math.max(0.4, d.size * u * 1.1), paint); }
      // Fine streaks.
      for (const k of streaks) {
        const len = R * streakLength(k, tSec), c = Math.cos(k.angle), sn = Math.sin(k.angle);
        set(line, lime, bloom * k.alpha * boost); line.setStrokeWidth(Math.max(0.4, k.width * u));
        canvas.drawLine(cx + c * R * k.inner, cy + sn * R * k.inner, cx + c * len, cy + sn * len, line);
      }
      // Decisions: a pulse ring and a bright streak from the core.
      for (const wave of s.waves) {
        const pl = pulseFor(wave, nowMs); if (pl == null) continue;
        set(line, lime, bloom * pl.ringAlpha); line.setStrokeWidth(Math.max(0.8, 1.4 * u)); canvas.drawCircle(cx, cy, R * pl.ringRadius, line);
        set(line, mint, bloom * pl.streakAlpha); line.setStrokeWidth(Math.max(0.9, 2 * u));
        canvas.drawLine(cx, cy, cx + Math.cos(pl.angle) * R * pl.streakLength, cy + Math.sin(pl.angle) * R * pl.streakLength, line);
      }
      // PAPER fill: a line from the core to a marker that flares.
      if (s.burst > 0.02) {
        const ex = cx + Math.cos(BURST_FILL_ANGLE) * R * BURST_FILL_REACH * s.burst, ey = cy + Math.sin(BURST_FILL_ANGLE) * R * BURST_FILL_REACH * s.burst;
        set(line, lime, bloom * 0.95); line.setStrokeWidth(Math.max(1, 1.8 * u)); canvas.drawLine(cx, cy, ex, ey, line);
        set(paint, lime, bloom * 0.35 * s.burst); canvas.drawCircle(ex, ey, 9 * u, paint);
        set(paint, lime, bloom * 0.95 * s.burst); canvas.drawRect(Skia.XYWHRect(ex - 4 * u, ey - 3 * u, 8 * u, 6 * u), paint);
      }
      // Core.
      for (const [rad, al] of [[0.3, 0.08], [0.16, 0.16 + 0.08 * pulse], [0.075, 0.55]] as const) { set(paint, lime, bloom * al * boost); canvas.drawCircle(cx, cy, R * rad, paint); }
      set(paint, [255, 255, 255], bloom * 0.95); canvas.drawCircle(cx, cy, Math.max(1, 3.2 * u), paint);
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
