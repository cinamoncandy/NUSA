import React, { useEffect, useRef, useState } from "react";
import { Animated, Easing, StyleSheet, View } from "react-native";
import { calmColors } from "./uiKitModel";
import { restingGlow, shouldPulse } from "./heartbeatPulseModel";

const SWEEP_MS = 650;
const BEAM = 90;

/**
 * A thin line under the decision core. Each time the server's heartbeat timestamp advances (a real heartbeat arrived) a short beam
 * sweeps across it once; between heartbeats the line rests at a brightness that fades with the real age of that timestamp.
 * Reduce-motion (or before the OS answers): no sweep, only the resting brightness. Display only.
 */
export function HeartbeatPulse({ lastHeartbeatAt, width, reducedMotion }: { readonly lastHeartbeatAt: number | null; readonly width: number; readonly reducedMotion: boolean | null }) {
  const x = useRef(new Animated.Value(-BEAM)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const previous = useRef<number | null>(lastHeartbeatAt);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    const pulse = shouldPulse(previous.current, lastHeartbeatAt);
    previous.current = lastHeartbeatAt;
    if (!pulse || reducedMotion !== false || width <= 0) return undefined;
    x.setValue(-BEAM); opacity.setValue(1);
    const anim = Animated.parallel([
      Animated.timing(x, { toValue: width, duration: SWEEP_MS, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 0, duration: SWEEP_MS, easing: Easing.in(Easing.quad), useNativeDriver: true }),
    ]);
    anim.start();
    return () => { anim.stop(); opacity.setValue(0); };
  }, [lastHeartbeatAt, reducedMotion, width, x, opacity]);
  if (width <= 0) return null;
  return <View style={[styles.track, { width }]} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
    <View style={[styles.rest, { opacity: restingGlow(lastHeartbeatAt, now) * 0.55 }]} />
    <Animated.View style={[styles.beam, { opacity, transform: [{ translateX: x }] }]} />
  </View>;
}

const styles = StyleSheet.create({
  track: { height: 3, overflow: "hidden", alignSelf: "center", borderRadius: 2, backgroundColor: calmColors.line },
  rest: { ...StyleSheet.absoluteFillObject, backgroundColor: calmColors.order },
  beam: { position: "absolute", top: 0, bottom: 0, width: BEAM, borderRadius: 2, backgroundColor: calmColors.text },
});
