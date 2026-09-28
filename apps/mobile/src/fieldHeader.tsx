import React, { memo, useEffect, useMemo, useRef, useState } from "react";
import { fieldFonts } from "./fieldFonts";
import { AccessibilityInfo, Animated, Easing, StyleSheet, Text, View, type LayoutChangeEvent } from "react-native";
import { buildFieldGeometry } from "./intelligenceField";
import { fieldPalette } from "./designSystem";
import type { FieldSubsystem, FieldTone } from "./intelligenceFieldModel";
import type { FieldHeaderModel } from "./fieldScreensModel";

/**
 * Compact Intelligence Field band for secondary tabs: one lit strand toward the subsystem the
 * tab is about, the rest faint. Moves only when the tone or subsystem changes.
 */
const HEIGHT = 150;
const HUE: Record<FieldSubsystem, string> = { market: fieldPalette.market, axiom: fieldPalette.axiom, paper: fieldPalette.paper, governance: fieldPalette.governance, risk: fieldPalette.risk };
const TONE: Record<FieldTone, string> = { dim: fieldPalette.dim, amber: fieldPalette.focus, blue: fieldPalette.market, green: fieldPalette.paper, red: fieldPalette.halt };
const ORDER: readonly FieldSubsystem[] = ["market", "axiom", "paper", "governance", "risk"];

const Dots = memo(function Dots({ dots, color, faint }: Readonly<{ dots: readonly { x: number; y: number; size: number; opacity: number }[]; color: string; faint: boolean }>) {
  return <>{dots.map((d, i) => <View key={i} style={{ position: "absolute", left: d.x - d.size / 2, top: d.y - d.size / 2, width: d.size, height: d.size, borderRadius: d.size / 2, backgroundColor: color, opacity: faint ? d.opacity * 0.18 : d.opacity }} />)}</>;
});

export function FieldHeader({ model, testID }: Readonly<{ model: FieldHeaderModel; testID: string }>) {
  const [width, setWidth] = useState(0);
  const [reducedMotion, setReducedMotion] = useState<boolean | null>(null);
  const geometry = useMemo(() => (width > 0 ? buildFieldGeometry(width, HEIGHT) : null), [width]);
  const glow = useRef(new Animated.Value(1)).current;

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
    if (reducedMotion !== false || !changed) { glow.setValue(1); return undefined; }
    glow.setValue(0.25);
    const animation = Animated.timing(glow, { toValue: 1, duration: 800, easing: Easing.out(Easing.cubic), useNativeDriver: true });
    animation.start();
    return () => animation.stop();
  }, [model.tone, model.subsystem, reducedMotion, glow]);

  const tone = TONE[model.tone];
  const onLayout = (event: LayoutChangeEvent) => setWidth(Math.round(event.nativeEvent.layout.width));
  return <View style={styles.shell} testID={testID} accessibilityRole="summary" accessibilityLabel={`${model.eyebrow} ${model.statusWord}. ${model.headline.replace("\n", " ")}. ${model.detail}`}>
    <View style={styles.statusRow}>
      <Text style={styles.eyebrow}>{model.eyebrow}</Text>
      <View style={[styles.dot, { backgroundColor: tone }]} />
      <Text style={[styles.status, { color: tone }]} testID={`${testID}-status`}>{model.statusWord}</Text>
    </View>
    <View style={styles.field} onLayout={onLayout}>
      {geometry == null ? null : ORDER.map((id) => {
        const lit = id === model.subsystem;
        const dots = <Dots dots={geometry[id]} color={lit ? (model.tone === "dim" ? HUE[id] : tone) : HUE[id]} faint={!lit} />;
        return lit ? <Animated.View key={id} pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity: glow }]}>{dots}</Animated.View> : <View key={id} pointerEvents="none" style={StyleSheet.absoluteFill}>{dots}</View>;
      })}
      {width > 0 ? <View pointerEvents="none" style={[styles.core, { left: width / 2 - 9, top: HEIGHT / 2 - 9, borderColor: tone }]} /> : null}
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
  eyebrow: { color: fieldPalette.text, fontSize: 11, letterSpacing: 2.4, marginRight: "auto", ...fieldFonts.monoMedium },
  dot: { width: 6, height: 6, borderRadius: 3 },
  status: { fontSize: 11, letterSpacing: 2, ...fieldFonts.monoMedium },
  field: { height: HEIGHT, overflow: "hidden" },
  core: { position: "absolute", width: 18, height: 18, borderWidth: 1.2, transform: [{ rotate: "45deg" }] },
  headline: { color: fieldPalette.text, fontSize: 24, lineHeight: 31, letterSpacing: -0.3, ...fieldFonts.displayLight },
  detail: { color: fieldPalette.muted, fontSize: 13, lineHeight: 19, marginTop: 6 },
  facts: { flexDirection: "row", marginTop: 14, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: fieldPalette.dim, paddingTop: 10 },
  fact: { flex: 1, gap: 2 },
  factLabel: { color: fieldPalette.dim, fontSize: 9, letterSpacing: 1.6, ...fieldFonts.mono },
  factValue: { color: fieldPalette.label, fontSize: 13, fontVariant: ["tabular-nums"], ...fieldFonts.mono },
});
