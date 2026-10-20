import React, { useEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { Canvas, Path, Skia } from "@shopify/react-native-skia";
import { calmColors } from "./uiKitModel";
import { fieldFonts } from "./fieldFonts";
import { readableFont } from "./designSystem";

/**
 * Instrument kit (redesign 2026-10-20, owner-chosen "계기판" direction): hairline panels with corner ticks, mono section labels,
 * a rolling odometer and a scrolling heartbeat trace. Presentation only. Every loop runs on the native driver and stops entirely
 * when the OS reduce-motion setting is on.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(true);
  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then((v) => { if (mounted) setReduced(v); }).catch(() => { if (mounted) setReduced(false); });
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduced);
    return () => { mounted = false; sub.remove(); };
  }, []);
  return reduced;
}

export function SectionLabel({ left, right = null }: { readonly left: string; readonly right?: string | null }) {
  return <View style={styles.label}>
    <Text style={[fieldFonts.mono, styles.labelLeft]}>{left}</Text>
    {right == null ? null : <Text style={[fieldFonts.mono, styles.labelRight]}>{right}</Text>}
  </View>;
}

export function Panel({ children, style }: { readonly children: React.ReactNode; readonly style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.panel, style]}>
    {children}
    <View pointerEvents="none" style={[styles.tick, styles.tickTopLeft]} />
    <View pointerEvents="none" style={[styles.tick, styles.tickBottomRight]} />
  </View>;
}

/** Each digit is a 0-9 column that rolls to its value, ones place first. A changed value rolls again. */
export function Odometer({ value, size, color = calmColors.text, reducedMotion }: { readonly value: number; readonly size: number; readonly color?: string; readonly reducedMotion: boolean }) {
  const chars = value.toLocaleString("en-US").split("");
  return <View style={styles.odo} accessible accessibilityLabel={value.toLocaleString("en-US")}>
    {chars.map((ch, i) => /\d/.test(ch)
      ? <OdometerDigit key={`${value}-${i}`} digit={Number(ch)} size={size} color={color} delay={(chars.length - 1 - i) * 70} reducedMotion={reducedMotion} />
      : <Text key={`${value}-${i}`} style={[fieldFonts.displayStrong, { fontSize: size, lineHeight: size * 1.08, height: size * 1.08, color }]}>{ch}</Text>)}
  </View>;
}

function OdometerDigit({ digit, size, color, delay, reducedMotion }: { readonly digit: number; readonly size: number; readonly color: string; readonly delay: number; readonly reducedMotion: boolean }) {
  const h = size * 1.08;
  const y = useRef(new Animated.Value(reducedMotion ? -digit * h : 0)).current;
  useEffect(() => {
    if (reducedMotion) { y.setValue(-digit * h); return undefined; }
    const anim = Animated.timing(y, { toValue: -digit * h, duration: 800, delay, easing: Easing.out(Easing.exp), useNativeDriver: true });
    anim.start();
    return () => anim.stop();
  }, [digit, h, delay, reducedMotion, y]);
  return <View style={{ height: h, overflow: "hidden" }} importantForAccessibility="no-hide-descendants">
    <Animated.View style={{ transform: [{ translateY: y }] }}>
      {Array.from({ length: 10 }, (_, k) => <Text key={k} style={[fieldFonts.displayStrong, { fontSize: size, lineHeight: h, height: h, color, fontVariant: ["tabular-nums"] }]}>{k}</Text>)}
    </Animated.View>
  </View>;
}

// One heartbeat period in a 200-wide box, 44 tall: flat, a small bump, the spike, a recovery bump, flat.
const BEAT: readonly (readonly [number, number])[] = [[0, 24], [30, 24], [34, 21], [38, 24], [62, 24], [66, 28], [71, 8], [77, 38], [82, 24], [110, 24], [115, 20], [121, 24], [200, 24]];
export const HEARTBEAT_HEIGHT = 44;

/** Builds two heartbeat periods across 2 * width so a translateX of -width loops seamlessly. */
export function heartbeatPath(width: number): string {
  const sx = width / 200;
  const pts = [0, 1].flatMap((k) => BEAT.map(([x, y]) => [(x + k * 200) * sx, y] as const));
  return pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y}`).join(" ");
}

/** A heartbeat trace that scrolls while the runtime is deciding: it says "alive", not a measured signal. */
export function Heartbeat({ width, reducedMotion }: { readonly width: number; readonly reducedMotion: boolean }) {
  const x = useRef(new Animated.Value(0)).current;
  const path = useMemo(() => (width > 0 ? Skia.Path.MakeFromSVGString(heartbeatPath(width)) : null), [width]);
  useEffect(() => {
    if (reducedMotion || width <= 0) { x.setValue(0); return undefined; }
    const loop = Animated.loop(Animated.timing(x, { toValue: -width, duration: 1400, easing: Easing.linear, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [reducedMotion, width, x]);
  if (width <= 0 || path == null) return <View style={styles.beat} />;
  return <View style={styles.beat} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
    <Animated.View style={{ width: width * 2, height: HEARTBEAT_HEIGHT, transform: [{ translateX: x }] }}>
      <Canvas style={{ width: width * 2, height: HEARTBEAT_HEIGHT }}><Path path={path} style="stroke" strokeWidth={1.4} color={calmColors.text} /></Canvas>
    </Animated.View>
  </View>;
}

export const instrumentType = StyleSheet.create({
  index: { color: calmColors.muted, fontSize: readableFont(11), letterSpacing: 2 },
  heroLine: { color: calmColors.text, fontSize: 54, lineHeight: 58, fontWeight: "700", letterSpacing: -2 },
  sub: { color: calmColors.muted, fontSize: readableFont(14), lineHeight: 21, marginTop: 10, maxWidth: 320 },
});

const styles = StyleSheet.create({
  label: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 },
  labelLeft: { color: calmColors.muted, fontSize: readableFont(11), letterSpacing: 1.2 },
  labelRight: { color: calmColors.text, fontSize: readableFont(11), letterSpacing: 1.2 },
  panel: { borderWidth: StyleSheet.hairlineWidth, borderColor: calmColors.line, padding: 14 },
  tick: { position: "absolute", width: 8, height: 8, borderColor: calmColors.text, opacity: 0.7 },
  tickTopLeft: { left: -1, top: -1, borderLeftWidth: 1, borderTopWidth: 1 },
  tickBottomRight: { right: -1, bottom: -1, borderRightWidth: 1, borderBottomWidth: 1 },
  odo: { flexDirection: "row", alignItems: "flex-start" },
  beat: { height: HEARTBEAT_HEIGHT, overflow: "hidden", marginTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: calmColors.line },
});
