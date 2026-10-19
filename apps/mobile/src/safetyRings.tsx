import React, { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing, StyleSheet, Text, View } from "react-native";
import { calmColors } from "./uiKitModel";
import { readableFont } from "./designSystem";

// 안전 hero (redesign 2026-10-19): three rings, one per fixed lock of this build (PAPER only, LIVE locked, AI no authority), turning
// slowly at different speeds and directions around a padlock. The locks are build facts, never server values, so nothing a response
// says can make this look unlocked. Motion stops entirely when the OS reduce-motion setting is on.
const SIZE = 200;
const RINGS = [
  { size: 196, width: 1.5, ms: 40000, dir: 1, opacity: 0.45, dashed: true },
  { size: 152, width: 2, ms: 28000, dir: -1, opacity: 0.65, dashed: true },
  { size: 108, width: 3, ms: 18000, dir: 1, opacity: 1, dashed: false },
] as const;

export function SafetyRings() {
  const [reducedMotion, setReducedMotion] = useState(true);
  const spins = useRef(RINGS.map(() => new Animated.Value(0))).current;

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then((v) => { if (mounted) setReducedMotion(v); }).catch(() => { if (mounted) setReducedMotion(false); });
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", setReducedMotion);
    return () => { mounted = false; sub.remove(); };
  }, []);

  useEffect(() => {
    if (reducedMotion) return undefined;
    const loops = spins.map((value, i) => Animated.loop(Animated.timing(value, { toValue: 1, duration: RINGS[i].ms, easing: Easing.linear, useNativeDriver: true })));
    loops.forEach((loop) => loop.start());
    return () => loops.forEach((loop) => loop.stop());
  }, [reducedMotion, spins]);

  return <View style={styles.wrap} testID="safety-rings" accessible accessibilityRole="summary" accessibilityLabel="실제 돈은 움직이지 않아요. 모의투자 전용, 실거래 잠김, AI 권한 없음">
    <View style={styles.stage} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {RINGS.map((ring, i) => <Animated.View key={ring.size} style={[styles.ring, {
        width: ring.size, height: ring.size, borderRadius: ring.size / 2, borderWidth: ring.width, opacity: ring.opacity,
        borderStyle: ring.dashed ? "dashed" : "solid",
        transform: reducedMotion ? [] : [{ rotate: spins[i].interpolate({ inputRange: [0, 1], outputRange: ring.dir > 0 ? ["0deg", "360deg"] : ["360deg", "0deg"] }) }],
      }]} />)}
      <View style={styles.lockBody}><View style={styles.lockShackle} /></View>
    </View>
    <Text style={styles.headline} accessibilityRole="header">실제 돈은 한 푼도{"\n"}움직이지 않아요</Text>
  </View>;
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", marginTop: 8, marginBottom: 6 },
  stage: { width: SIZE, height: SIZE, alignItems: "center", justifyContent: "center" },
  // Rings are closed circles: a full dashed border with a radius renders dashed on Android too.
  ring: { position: "absolute", borderColor: calmColors.order },
  lockBody: { width: 30, height: 22, borderRadius: 5, borderWidth: 2.5, borderColor: calmColors.order, marginTop: 14 },
  lockShackle: { position: "absolute", left: 4, top: -14, width: 17, height: 15, borderTopLeftRadius: 9, borderTopRightRadius: 9, borderWidth: 2.5, borderBottomWidth: 0, borderColor: calmColors.order },
  headline: { color: calmColors.text, fontSize: readableFont(20), lineHeight: 28, fontWeight: "700", textAlign: "center", marginTop: 10 },
});
