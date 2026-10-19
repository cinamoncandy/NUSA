import React, { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing, StyleSheet, Text, View } from "react-native";
import { calmColors } from "./uiKitModel";
import { readableFont } from "./designSystem";
import type { LearningFunnelModel } from "./learningFunnelModel";

// 학습 hero (redesign 2026-10-19): candidates fall through a funnel that narrows at each check; the last bar is what passed the
// independent holdout. Presentation only. Motion stops entirely when the OS reduce-motion setting is on.
const DROPS = 5;
const STEP = 76;
const CYCLE_MS = 2800;
const LANES = [0.18, 0.5, 0.82, 0.34, 0.66];

export function LearningFunnel({ model }: { readonly model: LearningFunnelModel }) {
  const [reducedMotion, setReducedMotion] = useState(true);
  const [width, setWidth] = useState(0);
  const drops = useRef(Array.from({ length: DROPS }, () => new Animated.Value(0))).current;

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then((v) => { if (mounted) setReducedMotion(v); }).catch(() => { if (mounted) setReducedMotion(false); });
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", setReducedMotion);
    return () => { mounted = false; sub.remove(); };
  }, []);

  useEffect(() => {
    if (reducedMotion || width === 0) return undefined;
    const loops = drops.map((value, i) => Animated.loop(Animated.sequence([
      Animated.delay((CYCLE_MS / DROPS) * i),
      Animated.timing(value, { toValue: 1, duration: CYCLE_MS, easing: Easing.bezier(0.4, 0, 0.8, 0.6), useNativeDriver: true }),
      Animated.timing(value, { toValue: 0, duration: 0, useNativeDriver: true }),
    ])));
    loops.forEach((loop) => loop.start());
    return () => loops.forEach((loop) => loop.stop());
  }, [reducedMotion, width, drops]);

  const height = STEP * model.stages.length;
  return <View style={styles.wrap} testID="learning-funnel" accessible accessibilityRole="summary"
    accessibilityLabel={model.stages.map((s) => `${s.label} ${s.value}`).join(", ")}
    onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
    <View style={{ height }}>
      {model.stages.map((stage, i) => {
        const attention = stage.tone === "ATTENTION";
        return <View key={stage.label} style={[styles.bar, { top: i * STEP, left: `${Math.round((1 - stage.width) * 50)}%`, width: `${Math.round(stage.width * 100)}%`, borderColor: attention ? calmColors.attention : calmColors.line, backgroundColor: calmColors.ground }]}>
          <Text style={[styles.label, attention ? { color: calmColors.attention } : null]} numberOfLines={1}>{stage.label}</Text>
          <Text style={[styles.value, attention ? { color: calmColors.attention } : null]}>{stage.value.toLocaleString("en-US")}</Text>
        </View>;
      })}
      {width === 0 || reducedMotion ? null : drops.map((value, i) => {
        // Each drop starts across the top bar and is pulled toward the centre as the funnel narrows, fading before the last bar.
        const startX = width * LANES[i % LANES.length] - 3;
        const centre = width / 2 - 3;
        return <Animated.View key={i} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[styles.drop, {
          left: 0, top: 44,
          opacity: value.interpolate({ inputRange: [0, 0.1, 0.7, 1], outputRange: [0, 1, 0.8, 0] }),
          transform: [
            { translateX: value.interpolate({ inputRange: [0, 1], outputRange: [startX, centre + (startX - centre) * 0.15] }) },
            { translateY: value.interpolate({ inputRange: [0, 1], outputRange: [0, height - 70] }) },
          ],
        }]} />;
      })}
    </View>
  </View>;
}

const styles = StyleSheet.create({
  wrap: { marginHorizontal: 20, marginTop: 14, marginBottom: 8 },
  bar: { position: "absolute", height: 48, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 14 },
  label: { color: calmColors.muted, fontSize: readableFont(12), flexShrink: 1, marginRight: 8 },
  value: { color: calmColors.text, fontSize: readableFont(20), fontWeight: "700" },
  drop: { position: "absolute", width: 6, height: 6, borderRadius: 3, backgroundColor: calmColors.text },
});
