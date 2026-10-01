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
  /** Stage diameter; HOME uses the default, secondary tab headers a compact one. */
  readonly size?: number;
  readonly testID?: string;
}

/**
 * Home hero "contour core": concentric rings that drift out of round (ambient motion only, not a
 * market measurement) and snap back into alignment once for every new decision the runtime
 * reports. All transforms run on the native driver; nothing moves under reduce-motion.
 */
export function ContourCore({ decisionCount, reducedMotion, innerColor, outerColor, pulseColor, coreColor, size: stage = SIZE, testID = "home-contour-core" }: ContourCoreProps) {
  const wobbles = useMemo(() => Array.from({ length: RINGS }, () => new Animated.Value(0)), []);
  const align = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(1)).current;
  const lastCount = useRef<number | null>(null);
  const pulseAnimation = useRef<Animated.CompositeAnimation | null>(null);
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
    if (!animate) {
      // Reduce-motion (or an unknown count) stops a pulse that is still in flight and settles the rings.
      pulseAnimation.current?.stop();
      pulseAnimation.current = null;
      align.setValue(0);
      pulse.setValue(1);
      return;
    }
    if (previous == null || decisionCount == null || decisionCount <= previous) return;
    align.setValue(1);
    pulse.setValue(0);
    pulseAnimation.current?.stop();
    pulseAnimation.current = Animated.parallel([
      Animated.timing(align, { toValue: 0, duration: 1600, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 1, duration: 1400, easing: Easing.out(Easing.quad), useNativeDriver: true }),
    ]);
    pulseAnimation.current.start();
  }, [animate, decisionCount, align, pulse]);

  useEffect(() => () => { pulseAnimation.current?.stop(); }, []);

  const loose = Animated.subtract(1, align);
  return <View style={[styles.stage, { width: stage, height: stage, marginTop: stage === SIZE ? 6 : 0 }]} pointerEvents="none" testID={testID}>
    {wobbles.map((value, i) => {
      const t = (i + 1) / RINGS;
      const size = stage * 0.92 * t;
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
    <Animated.View style={[styles.ring, styles.pulse, { width: stage * 0.92, height: stage * 0.92, borderRadius: stage * 0.46,
      borderColor: pulseColor,
      opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.9, 0] }),
      transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.15, 1] }) }],
    }]} />
    <View style={[styles.core, { backgroundColor: coreColor }]} />
  </View>;
}

const styles = StyleSheet.create({
  stage: { width: SIZE, height: SIZE, alignItems: "center", justifyContent: "center" },
  ring: { position: "absolute", borderWidth: 1 },
  pulse: { width: SIZE * 0.92, height: SIZE * 0.92, borderRadius: SIZE * 0.46, borderWidth: 1.5 },
  core: { width: 6, height: 6, borderRadius: 3 },
});
