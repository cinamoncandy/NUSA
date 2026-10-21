import React, { useEffect, useRef, useState } from "react";
import { Animated, Easing, Pressable, StyleSheet, Text, View } from "react-native";
import type { LiveGateSummary } from "./liveGateModel";
import { gateDotKind, type GateDotKind } from "./gateDotsModel";
import { fieldFonts } from "./fieldFonts";
import { calmColors } from "./uiKitModel";
import { readableFont } from "./designSystem";

const WORD = { PASS: "통과", FAIL: "실패", BLOCKED: "막힘", STALE: "오래됨", CHECKING: "확인 중" } as const;

/** Each dot fills in left to right on entry; a blocked dot breathes. reducedMotion null/true: one settled frame, nothing moves. */
function Dot({ kind, index, reducedMotion, selected, label, onPress }: { readonly kind: GateDotKind; readonly index: number; readonly reducedMotion: boolean | null; readonly selected: boolean; readonly label: string; readonly onPress: () => void }) {
  const fill = useRef(new Animated.Value(reducedMotion === false ? 0 : 1)).current;
  const breath = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (reducedMotion !== false) { fill.setValue(1); return undefined; }
    fill.setValue(0);
    const a = Animated.timing(fill, { toValue: 1, duration: 420, delay: 120 + index * 90, easing: Easing.out(Easing.cubic), useNativeDriver: true });
    a.start();
    return () => a.stop();
  }, [reducedMotion, index, fill]);
  useEffect(() => {
    if (kind !== "BLOCKED" || reducedMotion !== false) { breath.setValue(1); return undefined; }
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(breath, { toValue: 0.35, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(breath, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [kind, reducedMotion, breath]);
  const color = kind === "PASSED" ? calmColors.text : kind === "BLOCKED" ? calmColors.attention : calmColors.muted;
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected }} onPress={onPress} style={styles.hit}>
    <Animated.View style={[styles.dot, { borderColor: color, opacity: Animated.multiply(fill, breath), transform: [{ scale: fill.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }) }] }, kind === "PASSED" || kind === "BLOCKED" ? { backgroundColor: kind === "BLOCKED" ? "transparent" : color } : null]}>
      {kind === "BLOCKED" ? <View style={[styles.inner, { backgroundColor: color }]} /> : null}
    </Animated.View>
    {selected ? <View style={[styles.tick, { backgroundColor: color }]} /> : null}
  </Pressable>;
}

/** The readiness gates as one row of dots. Tap a dot for that gate's reason. Read-only: nothing here enables anything. */
export function GateDots({ gates, reducedMotion }: { readonly gates: LiveGateSummary; readonly reducedMotion: boolean | null }) {
  const firstOpen = gates.gates.findIndex((g) => g.state !== "PASS");
  const [pickedId, setPickedId] = useState<string | null>(null);
  const found = pickedId == null ? -1 : gates.gates.findIndex((g) => g.id === pickedId);
  const index = found >= 0 ? found : Math.max(0, firstOpen);
  const gate = gates.gates[index];
  return <View testID="safety-gate-dots">
    <View style={styles.head}>
      <Text style={[fieldFonts.mono, styles.count]} accessibilityLabel={`관문 ${gates.total}개 중 ${gates.passed}개 통과`}>{gates.passed} / {gates.total}</Text>
      <Text style={styles.note}>통과해도 실거래는 켜지지 않아요</Text>
    </View>
    <View style={styles.row}>
      {gates.gates.map((g, i) => <Dot key={g.id} kind={gateDotKind(g.state)} index={i} reducedMotion={reducedMotion} selected={i === index} label={`${g.title}, ${WORD[g.state]}`} onPress={() => setPickedId(g.id)} />)}
    </View>
    {gate == null ? null : <View style={styles.reason} testID="safety-gate-reason" accessibilityLiveRegion="polite">
      <View style={styles.reasonHead}><Text style={styles.title}>{gate.title}</Text><Text style={[fieldFonts.mono, styles.state, gate.state === "PASS" ? null : styles.stateOpen]}>{WORD[gate.state]}</Text></View>
      <Text style={styles.detail}>{gate.detail}</Text>
    </View>}
  </View>;
}

const styles = StyleSheet.create({
  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", marginTop: 6 },
  count: { color: calmColors.text, fontSize: readableFont(28) },
  note: { color: calmColors.muted, fontSize: readableFont(12), flexShrink: 1, textAlign: "right" },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 },
  hit: { width: 34, height: 44, alignItems: "center", justifyContent: "center" },
  dot: { width: 18, height: 18, borderRadius: 9, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  inner: { width: 6, height: 6, borderRadius: 3 },
  tick: { width: 12, height: 2, marginTop: 4 },
  reason: { marginTop: 12, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: calmColors.line },
  reasonHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
  title: { color: calmColors.text, fontSize: readableFont(15), flexShrink: 1 },
  state: { color: calmColors.muted, fontSize: readableFont(12) },
  stateOpen: { color: calmColors.attention },
  detail: { color: calmColors.muted, fontSize: readableFont(13), lineHeight: 19, marginTop: 4 },
});
