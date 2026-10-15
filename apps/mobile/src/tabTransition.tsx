import React, { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing, StyleSheet } from "react-native";
import { fieldMotion } from "./designSystem";

/**
 * Field-language tab transition: the new destination settles in with a short fade and lift.
 * Runs only when the destination key changes; mount and reduced motion render statically.
 */
export function TabTransition({ transitionKey, children }: Readonly<{ transitionKey: string; children: React.ReactNode }>) {
  const [reducedMotion, setReducedMotion] = useState<boolean | null>(null);
  const progress = useRef(new Animated.Value(1)).current;
  const previousKey = useRef<string | null>(null);

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then((v) => { if (mounted) setReducedMotion(v); }).catch(() => { if (mounted) setReducedMotion(false); });
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", setReducedMotion);
    return () => { mounted = false; sub.remove(); };
  }, []);

  useEffect(() => {
    const changed = previousKey.current != null && previousKey.current !== transitionKey;
    previousKey.current = transitionKey;
    if (reducedMotion !== false || !changed) { progress.setValue(1); return undefined; }
    progress.setValue(0);
    const animation = Animated.timing(progress, { toValue: 1, duration: fieldMotion.tabTransitionMs, easing: Easing.out(Easing.cubic), useNativeDriver: true });
    animation.start();
    return () => animation.stop();
  }, [transitionKey, reducedMotion, progress]);

  const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [10, 0] });
  return <Animated.View style={[styles.fill, { opacity: progress, transform: [{ translateY }] }]} testID="tab-transition">{children}</Animated.View>;
}

const styles = StyleSheet.create({ fill: { flex: 1 } });
