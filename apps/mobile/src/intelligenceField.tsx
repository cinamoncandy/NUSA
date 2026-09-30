import React, { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, StyleSheet, Text, View } from "react-native";
import { buildHomeFieldFacts, buildIntelligenceField, type FieldSubsystem, type FieldTone, type IntelligenceFieldInput } from "./intelligenceFieldModel";
import { fieldPalette } from "./designSystem";

const TONE_COLOR: Readonly<Record<FieldTone, string>> = Object.freeze({
  dim: fieldPalette.dim,
  amber: fieldPalette.focus,
  blue: fieldPalette.market,
  green: fieldPalette.paper,
  red: fieldPalette.halt,
});

const SUBSYSTEM_LABEL: Readonly<Record<FieldSubsystem, string>> = Object.freeze({
  market: "시세",
  axiom: "판단",
  paper: "모의투자",
  governance: "승인",
  risk: "위험",
});

export function IntelligenceField({ input }: Readonly<{ input: IntelligenceFieldInput }>) {
  const model = buildIntelligenceField(input);
  const facts = buildHomeFieldFacts(input);
  const [reducedMotion, setReducedMotion] = useState<boolean | null>(null);
  const shift = useRef(new Animated.Value(0.35)).current;
  const energy = useRef(new Animated.Value(model.coreLevel)).current;
  const previous = useRef<string | null>(null);

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => { if (mounted) setReducedMotion(enabled); })
      .catch(() => { if (mounted) setReducedMotion(false); });
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setReducedMotion);
    return () => { mounted = false; subscription.remove(); };
  }, []);

  useEffect(() => {
    const key = `${model.phase}:${model.tone}:${model.focus ?? ""}:${model.lit.join(",")}`;
    const changed = previous.current != null && previous.current !== key;
    previous.current = key;
    shift.stopAnimation();
    energy.stopAnimation();

    if (reducedMotion !== false || !changed) {
      shift.setValue(0.35);
      energy.setValue(model.coreLevel);
      return undefined;
    }

    shift.setValue(0);
    energy.setValue(Math.max(0.2, model.coreLevel * 0.72));
    const animation = Animated.parallel([
      Animated.timing(shift, { toValue: 1, duration: 520, useNativeDriver: true }),
      Animated.sequence([
        Animated.timing(energy, { toValue: 1, duration: 240, useNativeDriver: true }),
        Animated.timing(energy, { toValue: model.coreLevel, duration: 320, useNativeDriver: true }),
      ]),
    ]);
    animation.start();
    return () => animation.stop();
  }, [energy, model.coreLevel, model.focus, model.lit, model.phase, model.tone, reducedMotion, shift]);

  const color = TONE_COLOR[model.tone];
  const bandOpacity = energy.interpolate({ inputRange: [0, 1], outputRange: [0.16, 0.72] });
  const travelA = shift.interpolate({ inputRange: [0, 1], outputRange: [-26, 18] });
  const travelB = shift.interpolate({ inputRange: [0, 1], outputRange: [20, -14] });
  const travelC = shift.interpolate({ inputRange: [0, 1], outputRange: [-14, 12] });

  return <View
    accessibilityRole="summary"
    accessibilityLabel={`${model.statusWord}. ${model.headline.replace("\n", " ")}. ${model.detail}`}
    style={styles.shell}
    testID="home-intelligence-field"
  >
    <View style={styles.topline}>
      <View style={[styles.statusDot, { backgroundColor: color }]} />
      <Text style={[styles.statusWord, { color }]} testID="intelligence-field-status">{model.statusWord}</Text>
      <Text style={styles.phase}>{model.phase}</Text>
    </View>

    <Text style={styles.headline}>{model.headline}</Text>
    <Text style={styles.detail}>{model.detail}</Text>

    <View style={styles.ribbonField} pointerEvents="none">
      <Animated.View style={[styles.ribbonBand, styles.ribbonBandA, { backgroundColor: fieldPalette.market, opacity: bandOpacity, transform: [{ translateX: travelA }, { rotate: "-7deg" }] }]} />
      <Animated.View style={[styles.ribbonBand, styles.ribbonBandB, { backgroundColor: color, opacity: bandOpacity, transform: [{ translateX: travelB }, { rotate: "4deg" }] }]} />
      <Animated.View style={[styles.ribbonBand, styles.ribbonBandC, { backgroundColor: fieldPalette.paper, opacity: bandOpacity, transform: [{ translateX: travelC }, { rotate: "-2deg" }] }]} />
      <View style={[styles.ribbonHorizon, { backgroundColor: fieldPalette.dim }]} />
      <View style={[styles.focusLine, { backgroundColor: color }]} />
    </View>

    <View style={styles.subsystems}>
      {(["governance", "market", "risk", "axiom", "paper"] as const).map((id) => {
        const lit = model.lit.includes(id);
        const focused = model.focus === id;
        return <View key={id} style={styles.subsystem}>
          <View style={[styles.subsystemDot, { backgroundColor: focused ? color : lit ? fieldPalette.text : fieldPalette.dim, opacity: focused ? 1 : lit ? 0.72 : 0.28 }]} />
          <Text style={[styles.subsystemLabel, { color: focused ? color : lit ? fieldPalette.text : fieldPalette.muted }]}>{SUBSYSTEM_LABEL[id]}</Text>
          <Text style={styles.subsystemState}>{model.states[id] ?? "—"}</Text>
        </View>;
      })}
    </View>

    <View style={styles.facts}>
      {facts.map((fact) => <View key={fact.label} style={styles.fact}>
        <Text style={styles.factLabel}>{fact.label === "DECISIONS" ? "판단" : fact.label === "PAPER ORDERS" ? "모의 주문" : "단계"}</Text>
        <Text style={styles.factValue} numberOfLines={1}>{fact.value}</Text>
      </View>)}
    </View>
  </View>;
}

const styles = StyleSheet.create({
  shell: { minHeight: 292, overflow: "hidden", position: "relative", paddingHorizontal: 18, paddingTop: 16, paddingBottom: 14, backgroundColor: fieldPalette.void, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: fieldPalette.dim },
  topline: { flexDirection: "row", alignItems: "center", gap: 7, zIndex: 3 },
  statusDot: { width: 6, height: 6, borderRadius: 999 },
  statusWord: { fontSize: 9, fontWeight: "800", letterSpacing: 1.15 },
  phase: { marginLeft: "auto", color: fieldPalette.dim, fontSize: 8, letterSpacing: 1.1 },
  headline: { marginTop: 24, maxWidth: "74%", color: fieldPalette.text, fontSize: 27, lineHeight: 32, fontWeight: "300", letterSpacing: -0.5, zIndex: 3 },
  detail: { marginTop: 8, maxWidth: "82%", color: fieldPalette.muted, fontSize: 11, lineHeight: 17, zIndex: 3 },
  ribbonField: { position: "absolute", left: 0, right: 0, top: 76, height: 116, overflow: "hidden", justifyContent: "center" },
  ribbonBand: { position: "absolute", left: "-18%", width: "136%", borderRadius: 30 },
  ribbonBandA: { height: 28, top: 14 },
  ribbonBandB: { height: 20, top: 47 },
  ribbonBandC: { height: 12, top: 76 },
  ribbonHorizon: { position: "absolute", left: "8%", right: "8%", top: 63, height: StyleSheet.hairlineWidth, opacity: 0.38 },
  focusLine: { position: "absolute", left: "21%", right: "13%", top: 68, height: 2, borderRadius: 1, opacity: 0.9, transform: [{ rotate: "-4deg" }] },
  subsystems: { marginTop: 72, flexDirection: "row", justifyContent: "space-between", gap: 6, zIndex: 3 },
  subsystem: { flex: 1, minWidth: 0, alignItems: "center", gap: 3 },
  subsystemDot: { width: 5, height: 5, borderRadius: 999 },
  subsystemLabel: { fontSize: 8, lineHeight: 11, fontWeight: "700" },
  subsystemState: { color: fieldPalette.dim, fontSize: 6.5, lineHeight: 9, textAlign: "center" },
  facts: { marginTop: 13, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: fieldPalette.dim, flexDirection: "row", zIndex: 3 },
  fact: { flex: 1, minWidth: 0, gap: 2 },
  factLabel: { color: fieldPalette.muted, fontSize: 7.5, lineHeight: 10, letterSpacing: 0.45 },
  factValue: { color: fieldPalette.text, fontSize: 11, lineHeight: 15, fontWeight: "700" },
});
