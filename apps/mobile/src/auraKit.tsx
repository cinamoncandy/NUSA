import React, { useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from "react-native";
import { BlurMask, Canvas, Fill, FractalNoise, Group, LinearGradient, Points, RadialGradient, RoundedRect, Rect, rect, rrect, vec } from "@shopify/react-native-skia";
import { auraPalette } from "./designSystem";
import { dotFieldLayout, isDotSupported, layoutDotMatrix, litIndices } from "./dotMatrix";
import { entranceProgress, revealedCount } from "./auraMotion";
import { useReducedMotion } from "./instrumentKit";

/**
 * Aura kit (Learning tab): near-black ground, one green that glows, grain, dot-matrix numerals. Everything here is drawn with
 * Skia, so it looks the same on every device and needs no font or image asset. Motion is one-shot only (see useEntrance: numeral
 * scan-in, lit dots switching on, marker slide); nothing loops, and under reduce-motion everything starts at its final state.
 * Presentation only; it never decides or invents a value.
 */
const RADIUS = 28;

/** Skia throws on an empty point list ("Points array must not be empty"), which a not-yet-started entrance or a zero count produces. */
const nonEmpty = (points: readonly { x: number; y: number }[]): boolean => points.length > 0;


type Tone = "GREEN" | "DARK";

/**
 * One-shot entrance progress 0..1. Nothing plays until the OS has answered the reduce-motion question; under reduce-motion it
 * jumps straight to 1. It stops requesting frames at 1, so there is no loop and no idle cost.
 */
export function useEntrance(durationMs: number, delayMs = 0): number {
  const reduced = useReducedMotion();
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    if (reduced === null) return undefined;
    if (reduced) { setProgress(1); return undefined; }
    let frame = 0;
    const started = Date.now();
    const step = () => {
      const p = entranceProgress(Date.now() - started, delayMs, durationMs);
      setProgress(p);
      if (p < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [reduced, durationMs, delayMs]);
  return progress;
}


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
      <Group clip={rrect(rect(0, 0, size.w, size.h), RADIUS, RADIUS)}>
        <RoundedRect x={0} y={0} width={size.w} height={size.h} r={RADIUS}>
          {tone === "GREEN"
            ? <LinearGradient start={vec(0, 0)} end={vec(size.w, size.h)} colors={[auraPalette.deep, auraPalette.mid, auraPalette.bright]} positions={[0, 0.58, 1]} />
            : <LinearGradient start={vec(0, 0)} end={vec(size.w, size.h)} colors={[auraPalette.card, auraPalette.ground]} />}
        </RoundedRect>
        {tone === "DARK"
          ? <Rect x={0} y={0} width={size.w} height={size.h}>
            <RadialGradient c={vec(size.w, 0)} r={Math.max(size.w, size.h) * 0.4} colors={[auraPalette.mid, auraPalette.deep, "transparent"]} positions={[0, 0.5, 1]} />
          </Rect>
          : <Rect x={0} y={0} width={size.w} height={size.h}>
            <RadialGradient c={vec(size.w * 0.9, size.h * 0.1)} r={Math.max(size.w, size.h) * 0.6} colors={[auraPalette.neon, "transparent"]} positions={[0, 1]} />
          </Rect>}
        <Fill opacity={tone === "GREEN" ? 0.22 : 0.12} blendMode="softLight">
          <FractalNoise freqX={0.85} freqY={0.85} octaves={3} seed={7} />
        </Fill>
      </Group>
    </Canvas> : null}
    {children}
  </View>;
}

/** Big dot-matrix text (digits, sign, dot, percent, slash, D). `glow` adds a soft blur under the dots. */
export function DotNumeral({ text, pitch, color = auraPalette.text, glow = false, accessibilityLabel, delayMs = 250 }: {
  readonly text: string;
  readonly pitch: number;
  readonly color?: string;
  readonly glow?: boolean;
  readonly accessibilityLabel?: string;
  readonly delayMs?: number;
}) {
  const layout = useMemo(() => layoutDotMatrix(text, pitch), [text, pitch]);
  const scan = useEntrance(650, delayMs);
  const shown = useMemo(() => (scan >= 1 ? layout.dots : layout.dots.filter((dot) => dot.x <= scan * layout.width + pitch)), [layout, scan, pitch]);
  // Never draw a wrong number: a character without a dot glyph makes the whole numeral plain text instead.
  if (!isDotSupported(text)) return <Text style={{ color, fontSize: Math.max(12, pitch * 6) }} accessibilityLabel={accessibilityLabel ?? text}>{text}</Text>;
  if (layout.width <= 0) return null;
  const radius = Math.max(1, pitch * 0.34);
  return <Canvas style={{ width: layout.width, height: layout.height }} accessibilityLabel={accessibilityLabel ?? text} accessible>
    {glow && nonEmpty(shown) ? <Points points={shown as { x: number; y: number }[]} mode="points" color={color} style="stroke" strokeWidth={radius * 3} strokeCap="round"><BlurMask blur={radius * 1.6} style="normal" /></Points> : null}
    {nonEmpty(shown) ? <Points points={shown as { x: number; y: number }[]} mode="points" color={color} style="stroke" strokeWidth={radius * 2} strokeCap="round" /> : null}
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
  const sweep = useEntrance(900, 450);
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
  // The lit dots switch on one by one (the count found); unlit ones stay dim until their turn.
  const litNow = revealedCount(geometry.bright.length, sweep);
  const brightNow = sweep >= 1 ? geometry.bright : geometry.bright.slice(0, litNow);
  const waiting = sweep >= 1 ? geometry.dim : geometry.dim.concat(geometry.bright.slice(litNow));
  const r = Math.max(1, pitch * 0.2);
  return <Canvas style={{ width: geometry.layout.width, height: geometry.layout.height }} accessible accessibilityLabel={accessibilityLabel}>
    {nonEmpty(waiting) ? <Points points={waiting} mode="points" color={auraPalette.unlit} style="stroke" strokeWidth={r * 2} strokeCap="round" /> : null}
    {nonEmpty(brightNow) ? <Points points={brightNow} mode="points" color={auraPalette.neon} style="stroke" strokeWidth={r * 4.4} strokeCap="round"><BlurMask blur={r * 2.2} style="normal" /></Points> : null}
    {nonEmpty(brightNow) ? <Points points={brightNow} mode="points" color={auraPalette.text} style="stroke" strokeWidth={r * 2.6} strokeCap="round" /> : null}
  </Canvas>;
}

/** A row of tick marks with one marker at `ratio` (0..1) of the width. Decorative: the value is always printed next to it as text. */
export function TickSlider({ ratio, color = auraPalette.neon, width, height = 22 }: {
  readonly ratio: number;
  readonly color?: string;
  readonly width: number;
  readonly height?: number;
}) {
  const slide = useEntrance(700, 450);
  const ticks = useMemo(() => {
    const points: { x: number; y: number }[] = [];
    for (let x = 2; x < width; x += 7) points.push({ x, y: height / 2 });
    return points;
  }, [width, height]);
  if (width <= 0) return null;
  const clamped = Number.isFinite(ratio) ? Math.max(0, Math.min(1, ratio)) : 0;
  const x = Math.round(clamped * slide * (width - 3));
  return <Canvas style={{ width, height }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" pointerEvents="none">
    {nonEmpty(ticks) ? <Points points={ticks} mode="points" color={auraPalette.muted} style="stroke" strokeWidth={1.4} strokeCap="round" /> : null}
    <RoundedRect x={x} y={1} width={3} height={height - 2} r={1.5} color={color}><BlurMask blur={3} style="solid" /></RoundedRect>
    <RoundedRect x={x} y={1} width={3} height={height - 2} r={1.5} color={color} />
  </Canvas>;
}

const styles = StyleSheet.create({
  card: { borderRadius: RADIUS, overflow: "hidden", padding: 18 },
});
