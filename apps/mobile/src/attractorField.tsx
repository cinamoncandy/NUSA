import React, { useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { BlendMode, Canvas, Picture, PointMode, Skia, createPicture, type SkPicture, type SkPoint } from "@shopify/react-native-skia";
import { initialAttractorState, isAttractorSettled, iterateAttractor, observeAttractor, settleAttractor, tickAttractor, type AttractorTone } from "./attractorModel";

export interface AttractorFieldProps {
  /** Real runtime decision count; each increase morphs the figure one step. Null draws a still figure. */
  readonly decisionCount: number | null;
  /** Real PAPER fill count; each increase locks the figure into its symmetric form and blooms green. */
  readonly fillCount: number | null;
  readonly tone: AttractorTone;
  readonly reducedMotion: boolean;
  readonly size: number;
  /** Fewer points for small marks; HOME uses the default. */
  readonly points?: number;
  readonly testID?: string;
}

const FRAME_MS = 33;

/**
 * NUSA attractor: a glowing Clifford attractor drawn with Skia. It never moves on a clock; the
 * form changes only when the runtime reports a new decision or fill (see attractorModel.ts).
 * Rendering pauses entirely under reduce-motion and when the count is unknown.
 */
export function AttractorField({ decisionCount, fillCount, tone, reducedMotion, size, points = 5000, testID = "attractor-field" }: AttractorFieldProps) {
  const state = useRef(initialAttractorState());
  const cloud = useMemo(() => {
    const xs = new Float32Array(points), ys = new Float32Array(points);
    for (let i = 0; i < points; i += 1) { xs[i] = Math.sin(i * 12.9898) ; ys[i] = Math.cos(i * 78.233); }
    for (let i = 0; i < 12; i += 1) iterateAttractor(xs, ys, state.current.params);
    return { xs, ys, pts: Array.from({ length: points }, () => ({ x: 0, y: 0 })) as { x: number; y: number }[] };
  }, [points]);
  const paint = useMemo(() => { const p = Skia.Paint(); p.setBlendMode(BlendMode.Plus); p.setStrokeWidth(size > 120 ? 1.2 : 1); p.setAntiAlias(true); return p; }, [size]);
  const [picture, setPicture] = useState<SkPicture | null>(null);
  const drawn = useRef(false);

  const render = () => {
    const s = state.current, { xs, ys, pts } = cloud;
    iterateAttractor(xs, ys, s.params);
    const scale = size * 0.22 * (1 + 0.05 * s.bloom), c = size / 2;
    for (let i = 0; i < pts.length; i += 1) { pts[i].x = c + xs[i] * scale; pts[i].y = c + ys[i] * scale; }
    const [r, g, b] = s.color;
    const alpha = Math.min(1, (size > 120 ? 0.12 : 0.3) + 0.3 * s.bloom);
    paint.setColor(Skia.Color(`rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${alpha})`));
    drawn.current = true;
    setPicture(createPicture((canvas) => canvas.drawPoints(PointMode.Points, pts as SkPoint[], paint), { width: size, height: size }));
  };

  // One effect owns both the observation and the frame loop. The loop runs only while the figure
  // is still moving and stops once settled; a new count, tone or size re-runs this effect.
  useEffect(() => {
    state.current = observeAttractor(state.current, decisionCount, fillCount);
    if (reducedMotion || decisionCount == null) {
      // Still figure (reduce-motion, unknown count, or a secondary-tab mark): jump to the end state.
      state.current = settleAttractor(state.current, tone);
      render();
      return undefined;
    }
    let alive = true, last = 0, frame = 0;
    const loop = (now: number) => {
      if (!alive) return;
      if (now - last >= FRAME_MS) {
        last = now;
        const before = state.current;
        state.current = tickAttractor(before, tone);
        if (drawn.current && isAttractorSettled(before, state.current)) return;
        render();
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
