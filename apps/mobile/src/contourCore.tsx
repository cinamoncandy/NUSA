import React, { useEffect, useMemo, useRef } from "react";
import { Animated, Easing, StyleSheet, View } from "react-native";

const SIZE = 260;
const RINGS = 12;

export interface ContourCoreProps {
  /** Real heartbeat decision count; each increase plays one alignment pulse. Null draws a still core. */
  readonly decisionCount: number | null;
  readonly reducedMotion: boolean;
  readonly innerColor: string;
  readonly outerColor: string;
  readonly pulseColor: string;
  readonly coreColor: string;
}

/**
 * Home hero "contour core": concentric rings that drift out of round (ambient motion only, not a
 * market measurement) and snap back into alignment once for every new decision the runtime
 * reports. All transforms run on the native driver; nothing moves under reduce-motion.
 */
export function ContourCore({ decisionCount, reducedMotion, innerColor, outerColor, pulseColor, coreColor }: ContourCoreProps) {
  const wobbles = useMemo(() => Array.from({ length: RINGS }, () => new Animated.Value(0)), []);
  const align = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(1)).current;
  const lastCount = useRef<number | null>(null);
  const animate = !reducedMotion && decisionCount != null;

  useEffect(() => {
    if (!animate) return undefined;
    const loops = wobbles.map((value, i) => Animated.loop(Animated.sequence([
      Animated.timing(value, { toValue: 1, duration: 2600 + i * 310, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(value, { toValue: -1, duration: 3100 + i * 270, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(value, { toValue: 0, duration: 1800 + i * 190, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ])));
    loops.forEach((loop) => loop.start());
    return () => loops.forEach((loop) => loop.stop());
  }, [animate, wobbles]);

  useEffect(() => {
    const previous = lastCount.current;
    lastCount.current = decisionCount;
    if (!animate || previous == null || decisionCount == null || decisionCount <= previous) return;
    align.setValue(1);
    pulse.setValue(0);
    Animated.parallel([
      Animated.timing(align, { toValue: 0, duration: 1600, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 1, duration: 1400, easing: Easing.out(Easing.quad), useNativeDriver: true }),
    ]).start();
  }, [animate, decisionCount, align, pulse]);

  const loose = Animated.subtract(1, align);
  return <View style={styles.stage} pointerEvents="none" testID="home-contour-core">
    {wobbles.map((value, i) => {
      const t = (i + 1) / RINGS;
      const size = SIZE * 0.92 * t;
      const amp = 0.035 + 0.05 * t;
      const sway = Animated.multiply(Animated.multiply(value, amp), loose);
      return <Animated.View key={i} style={[styles.ring, {
        width: size, height: size, borderRadius: size / 2,
        borderColor: t < 0.4 ? innerColor : outerColor,
        opacity: 0.22 + 0.6 * (1 - t),
        transform: [
          { rotate: `${(i * 37) % 180}deg` },
          { scaleX: Animated.add(1, sway) },
          { scaleY: Animated.subtract(1, sway) },
        ],
      }]} />;
    })}
    <Animated.View style={[styles.ring, styles.pulse, {
      borderColor: pulseColor,
      opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.9, 0] }),
      transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.15, 1] }) }],
    }]} />
    <View style={[styles.core, { backgroundColor: coreColor }]} />
  </View>;
}

const styles = StyleSheet.create({
  stage: { width: SIZE, height: SIZE, alignItems: "center", justifyContent: "center", marginTop: 6 },
  ring: { position: "absolute", borderWidth: 1 },
  pulse: { width: SIZE * 0.92, height: SIZE * 0.92, borderRadius: SIZE * 0.46, borderWidth: 1.5 },
  core: { width: 6, height: 6, borderRadius: 3 },
});
