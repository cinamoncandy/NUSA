import React, { useEffect, useRef, useState } from "react";
import { fieldFonts } from "./fieldFonts";
import { AccessibilityInfo, Animated, Easing, StyleSheet, Text, View } from "react-native";
import { fieldMotion, fieldPalette } from "./designSystem";
import type { FieldSubsystem, FieldTone } from "./intelligenceFieldModel";
import { fieldHeaderPose, type FieldHeaderModel } from "./fieldScreensModel";

const HUE: Record<FieldSubsystem, string> = {
  market: fieldPalette.market,
  axiom: fieldPalette.axiom,
  paper: fieldPalette.paper,
  governance: fieldPalette.governance,
  risk: fieldPalette.risk,
};
const TONE: Record<FieldTone, string> = {
  dim: fieldPalette.dim,
  amber: fieldPalette.focus,
  blue: fieldPalette.market,
  green: fieldPalette.paper,
  red: fieldPalette.halt,
};

export function FieldHeader({ model, testID }: Readonly<{ model: FieldHeaderModel; testID: string }>) {
  const [reducedMotion, setReducedMotion] = useState<boolean | null>(null);
  const pose = fieldHeaderPose(model);
  const shift = useRef(new Animated.Value(0.35)).current;
  const presence = useRef(new Animated.Value(pose.presence)).current;
  const previousKey = useRef<string | null>(null);

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((value) => { if (mounted) setReducedMotion(value); })
      .catch(() => { if (mounted) setReducedMotion(false); });
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setReducedMotion);
    return () => { mounted = false; subscription.remove(); };
  }, []);

  useEffect(() => {
    const key = `${model.tone}:${model.subsystem}:${model.statusWord}`;
    const changed = previousKey.current != null && previousKey.current !== key;
    previousKey.current = key;
    shift.stopAnimation();
    presence.stopAnimation();

    if (reducedMotion !== false || !changed) {
      shift.setValue(0.35);
      presence.setValue(pose.presence);
      return undefined;
    }

    shift.setValue(0);
    presence.setValue(Math.max(0.25, pose.presence * 0.65));
    const animation = Animated.parallel([
      Animated.timing(shift, { toValue: 1, duration: fieldMotion.headerSignalMs, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(presence, { toValue: pose.presence, duration: fieldMotion.headerGlowMs, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]);
    animation.start();
    return () => animation.stop();
  }, [model.statusWord, model.subsystem, model.tone, pose.presence, presence, reducedMotion, shift]);

  const tone = TONE[model.tone];
  const subsystem = HUE[model.subsystem];
  const sealed = model.eyebrow === "LIVE" && model.statusWord === "SEALED";
  const travelA = shift.interpolate({ inputRange: [0, 1], outputRange: [-24, 14] });
  const travelB = shift.interpolate({ inputRange: [0, 1], outputRange: [18, -10] });

  return <View
    style={styles.shell}
    testID={testID}
    accessibilityRole="summary"
    accessibilityLabel={`${model.eyebrow} ${model.statusWord}. ${model.headline.replace("\n", " ")}. ${model.detail}`}
  >
    <View style={styles.statusRow}>
      <Text style={styles.eyebrow}>{model.eyebrow}</Text>
      <View style={[styles.dot, { backgroundColor: tone }]} />
      <Text style={[styles.status, { color: tone }]} testID={`${testID}-status`}>{model.statusWord}</Text>
    </View>

    <View style={styles.ribbonField} pointerEvents="none">
      <Animated.View style={[styles.band, styles.bandA, { backgroundColor: subsystem, opacity: presence, transform: [{ translateX: travelA }, { rotate: "-6deg" }] }]} />
      <Animated.View style={[styles.band, styles.bandB, { backgroundColor: tone, opacity: presence, transform: [{ translateX: travelB }, { rotate: "3deg" }] }]} />
      <View style={[styles.horizon, { backgroundColor: fieldPalette.dim }]} />
      <View style={[styles.focusLine, { backgroundColor: tone }]} />
      {sealed ? <View style={[styles.sealLine, { borderColor: fieldPalette.dim }]} /> : null}
    </View>

    <Text style={styles.headline} testID={`${testID}-headline`}>{model.headline}</Text>
    <Text style={styles.detail}>{model.detail}</Text>
    <View style={styles.facts}>
      {model.facts.map((fact) => <View key={fact.label} style={styles.fact}>
        <Text style={styles.factLabel}>{fact.label}</Text>
        <Text style={styles.factValue} numberOfLines={1}>{fact.value}</Text>
      </View>)}
    </View>
  </View>;
}

const styles = StyleSheet.create({
  shell: { backgroundColor: fieldPalette.void, paddingHorizontal: 20, paddingTop: 14, paddingBottom: 18, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: fieldPalette.dim, overflow: "hidden" },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  eyebrow: { color: fieldPalette.text, fontSize: 11, letterSpacing: 2.4, marginRight: "auto", ...fieldFonts.monoMedium },
  dot: { width: 6, height: 6, borderRadius: 3 },
  status: { fontSize: 11, letterSpacing: 2, ...fieldFonts.monoMedium },
  ribbonField: { height: 96, marginTop: 8, overflow: "hidden", justifyContent: "center" },
  band: { position: "absolute", left: "-16%", width: "132%", borderRadius: 28 },
  bandA: { height: 24, top: 18 },
  bandB: { height: 14, top: 50 },
  horizon: { position: "absolute", left: "8%", right: "8%", top: 53, height: StyleSheet.hairlineWidth, opacity: 0.42 },
  focusLine: { position: "absolute", left: "26%", right: "12%", top: 58, height: 2, borderRadius: 1, opacity: 0.9, transform: [{ rotate: "-4deg" }] },
  sealLine: { position: "absolute", left: "12%", right: "12%", top: 72, height: 18, borderTopWidth: 1, borderBottomWidth: 1, borderStyle: "dashed", opacity: 0.7 },
  headline: { color: fieldPalette.text, fontSize: 24, lineHeight: 31, letterSpacing: -0.3, ...fieldFonts.displayLight },
  detail: { color: fieldPalette.muted, fontSize: 13, lineHeight: 19, marginTop: 6 },
  facts: { flexDirection: "row", marginTop: 14, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: fieldPalette.dim, paddingTop: 10 },
  fact: { flex: 1, gap: 2 },
  factLabel: { color: fieldPalette.dim, fontSize: 9, letterSpacing: 1.6, ...fieldFonts.mono },
  factValue: { color: fieldPalette.label, fontSize: 13, fontVariant: ["tabular-nums"], ...fieldFonts.mono },
});
