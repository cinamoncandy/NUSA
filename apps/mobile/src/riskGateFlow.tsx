import React, { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing, StyleSheet, Text, View } from "react-native";
import { calmColors } from "./uiKitModel";
import { readableFont } from "./designSystem";
import type { RiskGateModel } from "./riskGateModel";

// Now-screen hero while the consecutive-loss limit holds new buys (redesign 2026-10-19): buy signals run toward the risk gate and
// pile up in front of it; the path after the gate stays dotted and empty because no order went out. Presentation only. Motion stops
// entirely when the OS reduce-motion setting is on.
const TRACK = 168;
const DOTS = 4;
const CYCLE_MS = 2600;

export function RiskGateFlow({ gate, windowNote = null }: { readonly gate: RiskGateModel; /** Shown when the buy counters started after a mid-day server restart (partialWindowNote). */ readonly windowNote?: string | null }) {
  const [reducedMotion, setReducedMotion] = useState(true);
  const runs = useRef(Array.from({ length: DOTS }, () => new Animated.Value(0))).current;
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then((v) => { if (mounted) setReducedMotion(v); }).catch(() => { if (mounted) setReducedMotion(false); });
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", setReducedMotion);
    return () => { mounted = false; sub.remove(); };
  }, []);

  useEffect(() => {
    if (reducedMotion) return undefined;
    const loops = runs.map((value, i) => Animated.loop(Animated.sequence([
      Animated.delay((CYCLE_MS / DOTS) * i),
      Animated.timing(value, { toValue: 1, duration: CYCLE_MS, easing: Easing.bezier(0.5, 0, 0.9, 0.6), useNativeDriver: true }),
      Animated.timing(value, { toValue: 0, duration: 0, useNativeDriver: true }),
    ])));
    const gateLoop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
    ]));
    loops.forEach((loop) => loop.start());
    gateLoop.start();
    return () => { loops.forEach((loop) => loop.stop()); gateLoop.stop(); };
  }, [reducedMotion, runs, pulse]);

  const waiting = gate.waiting == null || gate.waiting === 0 ? null : gate.waiting.toLocaleString("en-US");
  return <View style={styles.card} testID="now-risk-gate" accessibilityRole="summary" accessibilityLabel={`${gate.headline.replace("\n", ". ")}. ${gate.detail}`}>
    <Text style={styles.caption}>신호 → 위험 → 주문</Text>
    <View style={styles.stage} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={styles.source} />
      <View style={styles.track} />
      {runs.map((value, i) => <Animated.View key={i} style={[styles.dot, reducedMotion ? { transform: [{ translateX: 40 * i }] } : {
        opacity: value.interpolate({ inputRange: [0, 0.08, 0.85, 1], outputRange: [0, 1, 1, 0] }),
        transform: [{ translateX: value.interpolate({ inputRange: [0, 0.6, 1], outputRange: [0, TRACK - 18, TRACK - 10] }) }, { scale: value.interpolate({ inputRange: [0, 0.8, 1], outputRange: [1, 1, 0.6] }) }],
      }]} />)}
      <Animated.View style={[styles.gateHalo, { opacity: reducedMotion ? 0.4 : pulse.interpolate({ inputRange: [0, 1], outputRange: [0.25, 0.7] }) }]} />
      <View style={styles.gate} />
      <View style={styles.after}>{Array.from({ length: 6 }, (_, i) => <View key={i} style={styles.dash} />)}</View>
      <View style={styles.sink} />
    </View>
    <View style={styles.labels}>
      <Text style={styles.label}>{gate.signals == null ? "매수 신호" : `매수 신호 ${gate.signals.toLocaleString("en-US")}`}</Text>
      <Text style={[styles.label, styles.gateLabel]}>{waiting == null ? "위험 — 멈춤" : `${waiting} 대기`}</Text>
      <Text style={[styles.label, styles.muted]}>주문 0</Text>
    </View>
    <Text style={styles.detail}>{gate.detail}</Text>
    {windowNote ? <Text style={styles.detail} testID="now-risk-gate-window">{windowNote}</Text> : null}
  </View>;
}

const styles = StyleSheet.create({
  card: { marginHorizontal: 20, marginTop: 16, padding: 16, borderRadius: 22, backgroundColor: "#0A1017", borderWidth: StyleSheet.hairlineWidth, borderColor: "#2A3440" },
  caption: { color: calmColors.muted, fontSize: readableFont(11), letterSpacing: 1, marginBottom: 14 },
  stage: { height: 40, justifyContent: "center" },
  source: { position: "absolute", left: 0, width: 12, height: 12, borderRadius: 6, backgroundColor: calmColors.text },
  track: { position: "absolute", left: 12, width: TRACK, height: 2, backgroundColor: calmColors.line },
  dot: { position: "absolute", left: 12, width: 8, height: 8, borderRadius: 4, backgroundColor: calmColors.text },
  gateHalo: { position: "absolute", left: TRACK + 6, width: 26, height: 44, borderRadius: 13, backgroundColor: calmColors.attention },
  gate: { position: "absolute", left: TRACK + 12, width: 14, height: 36, borderRadius: 7, backgroundColor: calmColors.attention },
  // Dashes are separate segments: a one-sided dashed border renders solid on Android.
  after: { position: "absolute", left: TRACK + 32, right: 20, height: 2, flexDirection: "row", justifyContent: "space-between", overflow: "hidden" },
  dash: { width: 4, height: 2, backgroundColor: "#2A3440" },
  sink: { position: "absolute", right: 0, width: 14, height: 14, borderRadius: 7, borderWidth: 2, borderColor: "#343C45" },
  labels: { flexDirection: "row", justifyContent: "space-between", marginTop: 12 },
  label: { color: calmColors.text, fontSize: readableFont(12) },
  gateLabel: { color: calmColors.attention, fontWeight: "600" },
  muted: { color: calmColors.muted },
  detail: { color: calmColors.muted, fontSize: readableFont(12), marginTop: 6 },
});
