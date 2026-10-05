import React, { useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { BlendMode, Canvas, PaintStyle, Picture, Skia, createPicture, type SkPicture } from "@shopify/react-native-skia";
import { fieldMotion } from "./designSystem";
import { HOLO_RING_COUNT, holoFrameBudgetMs, HOLO_RING_POINTS, easeOutBack, easeOutCubic, holoColor, ringPoint, scanBoost, initialHoloState, isHoloQuiet, observeHolo, spherePoints, tickHolo, waveDisplacement, type HoloTone } from "./holoModel";

export interface HoloSphereProps {
  /** Real runtime decision count; each increase sends one wave across the sphere. Null draws it still. */
  readonly decisionCount: number | null;
  /** Real PAPER order count; each increase flattens the sphere into a ring and reforms it green. */
  readonly fillCount: number | null;
  readonly tone: HoloTone;
  /** Still figure: reduce-motion, or a secondary-tab mark. */
  readonly reducedMotion: boolean;
  readonly size: number;
  readonly points?: number;
  readonly testID?: string;
}

// The spin is ambient, so the loop never runs faster than it must (budgets live in holoModel; state advances by elapsed time).
const VIEW_TILT = 0.35;

/**
 * NUSA holo sphere: an iridescent particle sphere drawn with Skia (Behance trend: AI orb + 3D
 * particles + holographic glass). See holoModel.ts for how runtime facts drive it.
 */
export function HoloSphere({ decisionCount, fillCount, tone, reducedMotion, size, points = 1600, testID = "holo-sphere" }: HoloSphereProps) {
  const state = useRef(initialHoloState());
  const stillDrawn = useRef(false);
  const sphere = useMemo(() => spherePoints(points), [points]);
  const paint = useMemo(() => { const p = Skia.Paint(); p.setBlendMode(BlendMode.Plus); p.setAntiAlias(true); return p; }, []);
  const glass = useMemo(() => { const p = Skia.Paint(); p.setAntiAlias(true); p.setStyle(PaintStyle.Stroke); p.setStrokeWidth(1); p.setColor(Skia.Color("rgba(232,241,250,0.14)")); return p; }, []);
  const rgba = useMemo(() => new Float32Array(4), []);
  const [picture, setPicture] = useState<SkPicture | null>(null);

  const render = (nowMs: number) => {
    const s = state.current, cx = size / 2, cy = size / 2;
    // Ink bloom on first appearance, then a slow breath while the runtime is normal. Both are still under reduce-motion.
    const bloom = easeOutCubic(s.birth);
    const breath = tone === "normal" && !reducedMotion ? 1 + 0.03 * Math.sin(nowMs / 700) : 1;
    const R = size * 0.34 * (0.08 + 0.92 * easeOutBack(s.birth)) * breath;
    const live = !reducedMotion && s.birth >= 1;
    const ca = Math.cos(s.spin), sa = Math.sin(s.spin), ct = Math.cos(VIEW_TILT), st = Math.sin(VIEW_TILT);
    const order: { x: number; y: number; z: number; r: number; c: readonly [number, number, number]; a: number }[] = [];
    for (let i = 0; i < points; i += 1) {
      const px = sphere[i * 3], py = sphere[i * 3 + 1], pz = sphere[i * 3 + 2];
      const disp = waveDisplacement(s.waves, px, py, pz, nowMs) + 0.045 * Math.sin(px * 6 + nowMs * 0.0021) * Math.cos(py * 5 - nowMs * 0.0017);
      const rr = 1 + disp, flat = Math.hypot(px, pz) || 1e-6;
      let X = px * rr * (1 - s.burst) + (px / flat) * 1.25 * s.burst;
      const Y0 = py * rr * (1 - s.burst) + py * 0.05 * s.burst;
      let Z = pz * rr * (1 - s.burst) + (pz / flat) * 1.25 * s.burst;
      [X, Z] = [X * ca + Z * sa, -X * sa + Z * ca];
      const Y = Y0 * ct - Z * st, Z2 = Y0 * st + Z * ct;
      const depth = (Z2 + 1.3) / 2.6, persp = 1 / (1 + Z2 * 0.25);
      const scan = live ? scanBoost(py, nowMs, fieldMotion.holoScanMs) : 0;
      order.push({ x: cx + X * R * persp, y: cy - Y * R * persp, z: Z2, r: (0.5 + 1.1 * depth + disp * 6 + scan * 1.4) * persp * (size / 300),
        c: holoColor(px, py, pz, tone, s.flash, s.flashColor, s.tintMix), a: bloom * Math.min(1, 0.12 + 0.8 * depth + disp * 4 + 0.3 * s.flash + scan * 0.7) });
    }
    // Two tilted orbit rings circling the sphere in opposite directions.
    for (let ring = 0; ring < HOLO_RING_COUNT; ring += 1) {
      for (let k = 0; k < HOLO_RING_POINTS; k += 1) {
        const q = ringPoint(ring, k, s.spin * 3);
        const Zr = q.z, persp = 1 / (1 + Zr * 0.25), depth = (Zr + 1.4) / 2.8;
        order.push({ x: cx + q.x * R * persp, y: cy - q.y * R * persp, z: Zr, r: (0.6 + 0.9 * depth) * persp * (size / 300),
          c: holoColor(q.x, q.y, q.z, tone, 0, s.flashColor, s.tintMix), a: bloom * (0.2 + 0.7 * depth) * (k % 9 === 0 ? 1 : 0.55) });
      }
    }
    order.sort((p, q) => p.z - q.z);
    setPicture(createPicture((canvas) => {
      canvas.drawOval(Skia.XYWHRect(cx - R * 1.32, cy - R * 0.37, R * 2.64, R * 0.74), glass);
      for (const p of order) {
        // SkColor is a Float32Array; filling one in place avoids parsing a CSS string per point.
        rgba[0] = p.c[0] / 255; rgba[1] = p.c[1] / 255; rgba[2] = p.c[2] / 255; rgba[3] = p.a;
        paint.setColor(rgba);
        canvas.drawCircle(p.x, p.y, Math.max(0.4, p.r), paint);
      }
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
