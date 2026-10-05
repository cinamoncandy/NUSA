import React, { useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { BlendMode, Canvas, PaintStyle, Picture, Skia, StrokeCap, createPicture, type SkPicture } from "@shopify/react-native-skia";
import { fieldMotion } from "./designSystem";
import { HOLO_FILL_EXPANSION, LIQUID_LAYERS, LIQUID_SEGMENTS, easeOutBack, easeOutCubic, holoColor, holoFrameBudgetMs, initialHoloState, isHoloQuiet, liquidRadius, observeHolo, tickHolo, type HoloTone } from "./holoModel";

export interface HoloSphereProps {
  /** Real runtime decision count; each increase sends one wave across the sphere. Null draws it still. */
  readonly decisionCount: number | null;
  /** Real PAPER order count; each increase pushes the rings outward in green, then they settle. */
  readonly fillCount: number | null;
  readonly tone: HoloTone;
  /** Still figure: reduce-motion, or a secondary-tab mark. */
  readonly reducedMotion: boolean;
  readonly size: number;
  readonly points?: number;
  readonly testID?: string;
}


/**
 * NUSA holo mark: four layers of liquid light drawn with Skia. Each layer is a closed ring whose radius
 * flows like water; a runtime decision sends a bump round the rings and a PAPER fill pushes them outward
 * in green. See holoModel.ts for how runtime facts drive it. The component name is kept for its callers.
 */
export function HoloSphere({ decisionCount, fillCount, tone, reducedMotion, size, points = 1600, testID = "holo-sphere" }: HoloSphereProps) {
  const state = useRef(initialHoloState());
  const stillDrawn = useRef(false);
  const paint = useMemo(() => { const p = Skia.Paint(); p.setBlendMode(BlendMode.Plus); p.setAntiAlias(true); return p; }, []);
  const line = useMemo(() => { const p = Skia.Paint(); p.setBlendMode(BlendMode.Plus); p.setAntiAlias(true); p.setStyle(PaintStyle.Stroke); p.setStrokeCap(StrokeCap.Butt); return p; }, []);
  const rgba = useMemo(() => new Float32Array(4), []);
  const [picture, setPicture] = useState<SkPicture | null>(null);
  const layers = points >= 600 ? LIQUID_LAYERS : 2, segments = points >= 600 ? LIQUID_SEGMENTS : 48;

  const render = (nowMs: number) => {
    const s = state.current, cx = size / 2, cy = size / 2;
    const bloom = easeOutCubic(s.birth);
    const breath = tone === "normal" && !reducedMotion ? 1 + 0.025 * Math.sin(nowMs / 800) : 1;
    const R = size * 0.33 * (0.1 + 0.9 * easeOutBack(s.birth)) * breath * (1 + HOLO_FILL_EXPANSION * s.burst);
    const tSec = reducedMotion ? 0 : nowMs / 1000, flowSec = fieldMotion.holoFlowMs / 1000;
    const coreRgb = holoColor(0, 0, 1, tone, 0, s.flashColor, s.tintMix);
    const pulse = reducedMotion ? 0.5 : 0.5 + 0.5 * Math.sin(nowMs / 640);
    const strokeW = Math.max(0.8, 1.7 * (size / 300));
    setPicture(createPicture((canvas) => {
      // Soft core glow in the status tone, two layers.
      for (const [rad, al] of [[0.62, 0.06], [0.34, 0.1 + 0.08 * pulse]] as const) { rgba[0] = coreRgb[0] / 255; rgba[1] = coreRgb[1] / 255; rgba[2] = coreRgb[2] / 255; rgba[3] = bloom * al; paint.setColor(rgba); canvas.drawCircle(cx, cy, R * rad, paint); }
      for (let layer = 0; layer < layers; layer += 1) {
        const scale = 0.62 + 0.14 * layer, depth = (layer + 1) / layers;
        let px = 0, py = 0;
        for (let i = 0; i <= segments; i += 1) {
          const theta = (i / segments) * Math.PI * 2;
          const r = R * scale * liquidRadius(theta, layer, tSec, flowSec, s.waves, nowMs);
          const x = cx + Math.cos(theta) * r, y = cy + Math.sin(theta) * r;
          if (i > 0) {
            const c = holoColor(Math.cos(theta), 0.3 * layer - 0.4, Math.sin(theta), tone, s.flash, s.flashColor, s.tintMix);
            rgba[0] = c[0] / 255; rgba[1] = c[1] / 255; rgba[2] = c[2] / 255; rgba[3] = bloom * (0.3 + 0.5 * depth);
            // Soft glow first (wide, faint), then the crisp line. Butt caps: round caps would double up at every joint under additive blending.
            const a = rgba[3];
            rgba[3] = a * 0.22; line.setColor(rgba); line.setStrokeWidth(strokeW * 4.2 * (0.7 + 0.5 * depth)); canvas.drawLine(px, py, x, y, line);
            rgba[3] = a; line.setColor(rgba); line.setStrokeWidth(strokeW * (0.7 + 0.5 * depth)); canvas.drawLine(px, py, x, y, line);
          }
          px = x; py = y;
        }
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
