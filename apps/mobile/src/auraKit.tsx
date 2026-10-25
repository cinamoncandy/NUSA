import React, { useMemo, useState } from "react";
import { StyleSheet, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from "react-native";
import { BlurMask, Canvas, Fill, FractalNoise, LinearGradient, Points, RadialGradient, RoundedRect, Rect, vec } from "@shopify/react-native-skia";
import { auraPalette } from "./designSystem";
import { dotFieldLayout, layoutDotMatrix, litIndices } from "./dotMatrix";

/**
 * Aura kit (Learning tab): near-black ground, one green that glows, grain, dot-matrix numerals. Everything here is drawn with
 * Skia, so it looks the same on every device and needs no font or image asset. Static (no animation) by design: nothing
 * moves, so there is nothing to disable for reduce-motion. Presentation only; it never decides or invents a value.
 */
const RADIUS = 28;

type Tone = "GREEN" | "DARK";

/** A rounded card with a grain-textured gradient. GREEN is the highlighted card; DARK is the quiet one with a green glow in one corner. */
export function GrainCard({ height, tone = "GREEN", children, style, testID, accessibilityLabel }: {
  readonly height?: number;
  readonly tone?: Tone;
  readonly children?: React.ReactNode;
  readonly style?: StyleProp<ViewStyle>;
  readonly testID?: string;
  readonly accessibilityLabel?: string;
}) {
  const [size, setSize] = useState({ w: 0, h: height ?? 0 });
  const onLayout = (event: LayoutChangeEvent) => {
    const { width, height: h } = event.nativeEvent.layout;
    const next = { w: Math.round(width), h: Math.round(h) };
    setSize((prev) => (prev.w === next.w && prev.h === next.h ? prev : next));
  };
  const accessible = accessibilityLabel != null;
  return <View
    style={[styles.card, height == null ? null : { height }, style]}
    onLayout={onLayout}
    testID={testID}
    accessible={accessible}
    accessibilityLabel={accessibilityLabel}
  >
    {size.w > 0 && size.h > 0 ? <Canvas style={StyleSheet.absoluteFill} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <RoundedRect x={0} y={0} width={size.w} height={size.h} r={RADIUS}>
        {tone === "GREEN"
          ? <LinearGradient start={vec(0, 0)} end={vec(size.w, size.h)} colors={[auraPalette.deep, auraPalette.mid, auraPalette.bright]} positions={[0, 0.58, 1]} />
          : <LinearGradient start={vec(0, 0)} end={vec(size.w, size.h)} colors={[auraPalette.card, auraPalette.ground]} />}
      </RoundedRect>
      {tone === "DARK"
        ? <Rect x={0} y={0} width={size.w} height={size.h}>
          <RadialGradient c={vec(size.w * 0.92, size.h * 0.08)} r={Math.max(size.w, size.h) * 0.7} colors={[auraPalette.mid, auraPalette.deep, "transparent"]} positions={[0, 0.5, 1]} />
        </Rect>
        : <Rect x={0} y={0} width={size.w} height={size.h}>
          <RadialGradient c={vec(size.w * 0.18, size.h * 0.12)} r={Math.max(size.w, size.h) * 0.75} colors={[auraPalette.neon, "transparent"]} positions={[0, 1]} />
        </Rect>}
      <Fill opacity={tone === "GREEN" ? 0.22 : 0.12} blendMode="softLight">
        <FractalNoise freqX={0.85} freqY={0.85} octaves={3} seed={7} />
      </Fill>
    </Canvas> : null}
    {children}
  </View>;
}

/** Big dot-matrix text (digits, sign, dot, percent, slash, D). `glow` adds a soft blur under the dots. */
export function DotNumeral({ text, pitch, color = auraPalette.text, glow = false, accessibilityLabel }: {
  readonly text: string;
  readonly pitch: number;
  readonly color?: string;
  readonly glow?: boolean;
  readonly accessibilityLabel?: string;
}) {
  const layout = useMemo(() => layoutDotMatrix(text, pitch), [text, pitch]);
  if (layout.width <= 0) return null;
  const radius = Math.max(1, pitch * 0.34);
  return <Canvas style={{ width: layout.width, height: layout.height }} accessibilityLabel={accessibilityLabel ?? text} accessible>
    {glow ? <Points points={layout.dots as { x: number; y: number }[]} mode="points" color={color} style="stroke" strokeWidth={radius * 3} strokeCap="round"><BlurMask blur={radius * 1.6} style="normal" /></Points> : null}
    <Points points={layout.dots as { x: number; y: number }[]} mode="points" color={color} style="stroke" strokeWidth={radius * 2} strokeCap="round" />
  </Canvas>;
}

/** `total` dots, `lit` of them bright. The count of lit dots is the value; their positions are a fixed even spread. */
export function DotField({ total, lit, columns, pitch, accessibilityLabel }: {
  readonly total: number;
  readonly lit: number;
  readonly columns: number;
  readonly pitch: number;
  readonly accessibilityLabel: string;
}) {
  const geometry = useMemo(() => {
    const layout = dotFieldLayout(total, columns, pitch);
    const on = new Set(litIndices(total, lit));
    const dim: { x: number; y: number }[] = [];
    const bright: { x: number; y: number }[] = [];
    for (let i = 0; i < total; i += 1) {
      const point = { x: (i % layout.columns + 0.5) * pitch, y: (Math.floor(i / layout.columns) + 0.5) * pitch };
      (on.has(i) ? bright : dim).push(point);
    }
    return { layout, dim, bright };
  }, [total, lit, columns, pitch]);
  if (geometry.layout.rows === 0) return null;
  const r = Math.max(1, pitch * 0.2);
  return <Canvas style={{ width: geometry.layout.width, height: geometry.layout.height }} accessible accessibilityLabel={accessibilityLabel}>
    <Points points={geometry.dim} mode="points" color={auraPalette.unlit} style="stroke" strokeWidth={r * 2} strokeCap="round" />
    <Points points={geometry.bright} mode="points" color={auraPalette.neon} style="stroke" strokeWidth={r * 4.4} strokeCap="round"><BlurMask blur={r * 2.2} style="normal" /></Points>
    <Points points={geometry.bright} mode="points" color={auraPalette.text} style="stroke" strokeWidth={r * 2.6} strokeCap="round" />
  </Canvas>;
}

/** A row of tick marks with one marker at `ratio` (0..1) of the width. Decorative: the value is always printed next to it as text. */
export function TickSlider({ ratio, color = auraPalette.neon, width, height = 22 }: {
  readonly ratio: number;
  readonly color?: string;
  readonly width: number;
  readonly height?: number;
}) {
  const ticks = useMemo(() => {
    const points: { x: number; y: number }[] = [];
    for (let x = 2; x < width; x += 7) points.push({ x, y: height / 2 });
    return points;
  }, [width, height]);
  if (width <= 0) return null;
  const clamped = Number.isFinite(ratio) ? Math.max(0, Math.min(1, ratio)) : 0;
  const x = Math.round(clamped * (width - 3));
  return <Canvas style={{ width, height }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" pointerEvents="none">
    <Points points={ticks} mode="points" color={auraPalette.muted} style="stroke" strokeWidth={1.4} strokeCap="round" />
    <RoundedRect x={x} y={1} width={3} height={height - 2} r={1.5} color={color}><BlurMask blur={3} style="solid" /></RoundedRect>
    <RoundedRect x={x} y={1} width={3} height={height - 2} r={1.5} color={color} />
  </Canvas>;
}

const styles = StyleSheet.create({
  card: { borderRadius: RADIUS, overflow: "hidden", padding: 18 },
});
