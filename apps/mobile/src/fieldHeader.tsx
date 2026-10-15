import React, { useEffect, useRef, useState } from "react";
import { fieldFonts } from "./fieldFonts";
import { AccessibilityInfo, Animated, Easing, StyleSheet, Text, View, type LayoutChangeEvent } from "react-native";
import { fieldMotion, fieldPalette, labelFont } from "./designSystem";
import type { FieldSubsystem, FieldTone } from "./intelligenceFieldModel";
import { HoloSphere } from "./holoSphere";
import { fieldHeaderPose, type FieldHeaderModel } from "./fieldScreensModel";

/**
 * Compact header band for secondary tabs: the HOME holo sphere, drawn still and tinted by the tab's
 * state (same figure as HOME; this band has no decision heartbeat). Moves only when the tone or subsystem changes. A sealed LIVE tab
 * draws a dashed seal ring around the nebula.
 */
const HEIGHT = 150;
const SEAL_RADIUS = 70;
const SPHERE_SIZE = 128;
const HUE: Record<FieldSubsystem, string> = { market: fieldPalette.market, axiom: fieldPalette.axiom, paper: fieldPalette.paper, governance: fieldPalette.governance, risk: fieldPalette.risk };
const TONE: Record<FieldTone, string> = { dim: fieldPalette.dim, amber: fieldPalette.focus, blue: fieldPalette.market, green: fieldPalette.paper, red: fieldPalette.halt };


export function FieldHeader({ model, testID }: Readonly<{ model: FieldHeaderModel; testID: string }>) {
  const [width, setWidth] = useState(0);
  const [reducedMotion, setReducedMotion] = useState<boolean | null>(null);
  const glow = useRef(new Animated.Value(1)).current;
  const pose = fieldHeaderPose(model);
  const spread = useRef(new Animated.Value(pose.spread)).current;
  const presence = useRef(new Animated.Value(pose.presence)).current;

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then((v) => { if (mounted) setReducedMotion(v); }).catch(() => { if (mounted) setReducedMotion(false); });
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", setReducedMotion);
    return () => { mounted = false; sub.remove(); };
  }, []);

  const previousKey = useRef<string | null>(null);
  useEffect(() => {
    const key = `${model.tone}:${model.subsystem}`;
    const changed = previousKey.current != null && previousKey.current !== key;
    previousKey.current = key;
    // Mounting or revisiting a tab is not a state change: animate only on a later semantic change.
    if (reducedMotion !== false || !changed) { glow.setValue(1); spread.setValue(pose.spread); presence.setValue(pose.presence); return undefined; }
    glow.setValue(0.25);
    // A state change re-settles the rings: they tighten or loosen and the tone glows back in.
    const animation = Animated.parallel([
      Animated.timing(spread, { toValue: pose.spread, duration: fieldMotion.poseMs, easing: Easing.inOut(Easing.cubic), useNativeDriver: true }),
      Animated.timing(presence, { toValue: pose.presence, duration: fieldMotion.poseMs, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.timing(glow, { toValue: 1, duration: fieldMotion.headerGlowMs, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]);
    animation.start();
    return () => animation.stop();
  }, [model.tone, model.subsystem, reducedMotion, glow, spread, presence, pose.spread, pose.presence]);

  const tone = TONE[model.tone];
  const sealed = model.eyebrow === "LIVE" && model.statusWord === "SEALED";
  const onLayout = (event: LayoutChangeEvent) => setWidth(Math.round(event.nativeEvent.layout.width));
  return <View style={styles.shell} testID={testID} accessibilityRole="summary" accessibilityLabel={`${model.eyebrow} ${model.statusWord}. ${model.headline.replace("\n", " ")}. ${model.detail}`}>
    <View style={styles.statusRow}>
      <Text style={styles.eyebrow}>{model.eyebrow}</Text>
      <View style={[styles.dot, { backgroundColor: tone }]} />
      <Text style={[styles.status, { color: tone }]} testID={`${testID}-status`}>{model.statusWord}</Text>
    </View>
    <View style={styles.field} onLayout={onLayout}>
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity: presence, transform: [{ scale: spread }] }]}>
        <Animated.View style={[styles.figure, { opacity: glow }]}>
          <HoloSphere decisionCount={null} fillCount={null} tone={model.tone === "red" ? "halt" : model.tone === "amber" ? "hold" : "normal"} reducedMotion size={SPHERE_SIZE} points={900} testID={`${testID}-holo`} />
        </Animated.View>
      </Animated.View>
      {width > 0 && sealed ? <View pointerEvents="none" style={[styles.seal, { left: width / 2 - SEAL_RADIUS, top: HEIGHT / 2 - SEAL_RADIUS }]} /> : null}
    </View>
    <Text style={styles.headline} testID={`${testID}-headline`}>{model.headline}</Text>
    <Text style={styles.detail}>{model.detail}</Text>
    <View style={styles.facts}>
      {model.facts.map((fact) => <View key={fact.label} style={styles.fact}><Text style={styles.factLabel}>{fact.label}</Text><Text style={styles.factValue} numberOfLines={1}>{fact.value}</Text></View>)}
    </View>
  </View>;
}

const styles = StyleSheet.create({
  shell: { backgroundColor: fieldPalette.void, paddingHorizontal: 20, paddingTop: 14, paddingBottom: 18, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: fieldPalette.dim },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  eyebrow: { color: fieldPalette.text, fontSize: labelFont(11), letterSpacing: 2.4, marginRight: "auto", ...fieldFonts.monoMedium },
  dot: { width: 6, height: 6, borderRadius: 3 },
  status: { fontSize: labelFont(11), letterSpacing: 2, ...fieldFonts.monoMedium },
  field: { height: HEIGHT, overflow: "hidden" },
  seal: { position: "absolute", width: SEAL_RADIUS * 2, height: SEAL_RADIUS * 2, borderRadius: SEAL_RADIUS, borderWidth: 1, borderStyle: "dashed", borderColor: fieldPalette.dim },
  figure: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, alignItems: "center", justifyContent: "center" },
  headline: { color: fieldPalette.text, fontSize: 24, lineHeight: 31, letterSpacing: -0.3, ...fieldFonts.displayLight },
  detail: { color: fieldPalette.muted, fontSize: 13, lineHeight: 19, marginTop: 6 },
  facts: { flexDirection: "row", marginTop: 14, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: fieldPalette.dim, paddingTop: 10 },
  fact: { flex: 1, gap: 2 },
  factLabel: { color: fieldPalette.dim, fontSize: labelFont(9), letterSpacing: 1.6, ...fieldFonts.mono },
  factValue: { color: fieldPalette.label, fontSize: 13, fontVariant: ["tabular-nums"], ...fieldFonts.mono },
});
