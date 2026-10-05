import React, { useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { BlendMode, Canvas, PaintStyle, Picture, Skia, createPicture, type SkPicture } from "@shopify/react-native-skia";
import { fieldMotion } from "./designSystem";
import { HOLO_RING_COUNT, HOLO_RING_POINTS, crystalGeometry, easeOutBack, easeOutCubic, holoColor, holoFrameBudgetMs, initialHoloState, isHoloQuiet, observeHolo, ringPoint, scanBoost, tickHolo, waveDisplacement, type HoloTone } from "./holoModel";

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
  const paint = useMemo(() => { const p = Skia.Paint(); p.setBlendMode(BlendMode.Plus); p.setAntiAlias(true); return p; }, []);
  const glass = useMemo(() => { const p = Skia.Paint(); p.setAntiAlias(true); p.setStyle(PaintStyle.Stroke); p.setStrokeWidth(1); p.setColor(Skia.Color("rgba(232,241,250,0.14)")); return p; }, []);
  const edge = useMemo(() => { const p = Skia.Paint(); p.setBlendMode(BlendMode.Plus); p.setAntiAlias(true); p.setStyle(PaintStyle.Stroke); return p; }, []);
  const rgba = useMemo(() => new Float32Array(4), []);
  const [picture, setPicture] = useState<SkPicture | null>(null);

  const render = (nowMs: number) => {
    const s = state.current, cx = size / 2, cy = size / 2;
    // Spring bloom on first appearance, then a slow breath while the runtime is normal. Both are still under reduce-motion.
    const bloom = easeOutCubic(s.birth);
    const breath = tone === "normal" && !reducedMotion ? 1 + 0.03 * Math.sin(nowMs / 700) : 1;
    const R = size * 0.34 * (0.08 + 0.92 * easeOutBack(s.birth)) * breath;
    // Glass crystal: a faceted lattice whose vertices carry the runtime waves; fills push it outward.
    const geo = crystalGeometry(), live = !reducedMotion && s.birth >= 1;
    const ca = Math.cos(s.spin), sa = Math.sin(s.spin), ct = Math.cos(VIEW_TILT), st = Math.sin(VIEW_TILT);
    const proj = geo.vertices.map(([px, py, pz]) => {
      const disp = waveDisplacement(s.waves, px, py, pz, nowMs) + 0.05 * Math.sin(px * 5 + nowMs * 0.0021) * Math.cos(py * 4 - nowMs * 0.0017);
      const rr = (1 + disp * 1.8) * (1 + 0.7 * s.burst);
      let X = px * rr, Z = pz * rr;
      [X, Z] = [X * ca + Z * sa, -X * sa + Z * ca];
      const Y0 = py * rr, Y = Y0 * ct - Z * st, Z2 = Y0 * st + Z * ct;
      const persp = 1 / (1 + Z2 * 0.25), depth = (Z2 + 1.3) / 2.6;
      const scan = live ? scanBoost(py, nowMs, fieldMotion.holoScanMs) : 0;
      return { x: cx + X * R * persp, y: cy - Y * R * persp, z: Z2, depth, persp, disp, scan, c: holoColor(px, py, pz, tone, s.flash, s.flashColor, s.tintMix) };
    });
    const edgeList = geo.edges.map(([i, j]) => {
      const p = proj[i], q = proj[j], depth = (p.depth + q.depth) / 2, hot = Math.max(p.scan, q.scan) + (p.disp + q.disp) * 3;
      return { p, q, z: (p.z + q.z) / 2, a: bloom * Math.min(1, 0.1 + 0.55 * depth + 0.5 * hot + 0.25 * s.flash), w: (0.7 + 0.9 * depth + hot) * (size / 300) };
    }).sort((m, n) => m.z - n.z);
    const order: { x: number; y: number; z: number; r: number; c: readonly [number, number, number]; a: number }[] = [];
    for (const p of proj) order.push({ x: p.x, y: p.y, z: p.z, r: (1.1 + 1.8 * p.depth + p.scan * 2.2 + p.disp * 8) * p.persp * (size / 300), c: p.c, a: bloom * Math.min(1, 0.3 + 0.7 * p.depth + p.scan) });
    // Two tilted orbit rings circling the crystal in opposite directions.
    if (points >= 600) for (let ring = 0; ring < HOLO_RING_COUNT; ring += 1) {
      for (let k = 0; k < HOLO_RING_POINTS; k += 1) {
        const q = ringPoint(ring, k, s.spin * 3);
        const Zr = q.z, persp = 1 / (1 + Zr * 0.25), depth = (Zr + 1.4) / 2.8;
        order.push({ x: cx + q.x * R * persp, y: cy - q.y * R * persp, z: Zr, r: (0.6 + 0.9 * depth) * persp * (size / 300),
          c: holoColor(q.x, q.y, q.z, tone, 0, s.flashColor, s.tintMix), a: bloom * (0.2 + 0.7 * depth) * (k % 9 === 0 ? 1 : 0.55) });
      }
    }
    order.sort((p, q) => p.z - q.z);
    const core = 0.5 + 0.5 * Math.sin(nowMs / 520);
    setPicture(createPicture((canvas) => {
      canvas.drawOval(Skia.XYWHRect(cx - R * 1.32, cy - R * 0.37, R * 2.64, R * 0.74), glass);
      // Soft inner core glow, two layers, pulsing slowly.
      for (const [rad, al] of [[0.55, 0.07], [0.3, 0.1 + 0.08 * core]] as const) { rgba[0] = 0.36; rgba[1] = 0.88; rgba[2] = 1; rgba[3] = bloom * al; paint.setColor(rgba); canvas.drawCircle(cx, cy, R * rad, paint); }
      for (const e of edgeList) {
        rgba[0] = (e.p.c[0] + e.q.c[0]) / 510; rgba[1] = (e.p.c[1] + e.q.c[1]) / 510; rgba[2] = (e.p.c[2] + e.q.c[2]) / 510; rgba[3] = e.a;
        edge.setColor(rgba); edge.setStrokeWidth(Math.max(0.5, e.w));
        canvas.drawLine(e.p.x, e.p.y, e.q.x, e.q.y, edge);
      }
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
