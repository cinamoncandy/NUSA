import React, { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Pressable, StyleSheet, Text, TextInput, View, type TextInputProps } from "react-native";
import { buttonTokens, cardTokens, fieldTokens, intelligenceFieldColors, type ButtonTone } from "./designSystem";
import { useTheme } from "./ThemeProvider";

export interface NusaButtonProps {
  readonly label: string;
  readonly onPress: () => void;
  readonly disabled?: boolean;
  readonly selected?: boolean;
  readonly tone?: ButtonTone;
  readonly accessibilityLabel?: string;
  readonly testID?: string;
}

export function NusaButton({ label, onPress, disabled = false, selected = false, tone = "primary", accessibilityLabel, testID }: NusaButtonProps) {
  const { theme } = useTheme();
  const tokens = buttonTokens(theme, tone);
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityRole="button"
      accessibilityState={{ disabled, selected }}
      disabled={disabled}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: tokens.background,
          borderColor: tokens.border,
          borderWidth: tokens.borderWidth,
          borderRadius: tokens.radius,
          minHeight: tokens.minHeight,
          paddingHorizontal: tokens.horizontalPadding,
          opacity: disabled ? tokens.disabledOpacity : pressed ? tokens.pressedOpacity : 1,
          transform: [{ scale: pressed && !disabled ? 0.985 : 1 }],
        },
      ]}
    >
      <Text style={[styles.buttonLabel, { color: tokens.foreground, fontWeight: theme.typography.weights.bold }]}>{label}</Text>
    </Pressable>
  );
}

export interface NusaTextFieldProps extends Pick<TextInputProps, "autoCapitalize" | "autoCorrect" | "editable" | "keyboardType" | "returnKeyType"> {
  readonly label: string;
  readonly value: string;
  readonly onChangeText: (value: string) => void;
  readonly placeholder?: string;
  readonly secureTextEntry?: boolean;
  readonly accessibilityLabel?: string;
  readonly testID?: string;
}

export function NusaTextField({ label, value, onChangeText, placeholder, secureTextEntry = false, accessibilityLabel, testID, autoCapitalize = "sentences", autoCorrect = true, editable = true, keyboardType = "default", returnKeyType = "default" }: NusaTextFieldProps) {
  const { theme } = useTheme();
  const tokens = fieldTokens(theme);
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.fieldGroup}>
      <Text style={[styles.fieldLabel, { color: focused && editable ? theme.colors.focus : theme.colors.textMuted, fontSize: theme.typography.caption }]}>{label}</Text>
      <TextInput
        accessibilityLabel={accessibilityLabel ?? label}
        accessibilityState={{ disabled: !editable }}
        autoCapitalize={autoCapitalize}
        autoCorrect={autoCorrect}
        editable={editable}
        keyboardType={keyboardType}
        onBlur={() => setFocused(false)}
        onChangeText={onChangeText}
        onFocus={() => setFocused(true)}
        placeholder={placeholder}
        placeholderTextColor={tokens.placeholder}
        secureTextEntry={secureTextEntry}
        selectionColor={theme.colors.primary}
        returnKeyType={returnKeyType}
        style={[
          styles.field,
          {
            backgroundColor: tokens.background,
            borderColor: focused && editable ? tokens.focus : tokens.border,
            borderRadius: tokens.radius,
            borderWidth: focused && editable ? tokens.focusBorderWidth : tokens.borderWidth,
            color: tokens.foreground,
            minHeight: tokens.minHeight,
          },
        ]}
        testID={testID}
        value={value}
      />
    </View>
  );
}

export function NusaCard({ children, testID, raised = false, neon = false }: Readonly<{ children: React.ReactNode; testID?: string; raised?: boolean; neon?: boolean }>) {
  const { theme } = useTheme();
  const tokens = cardTokens(theme);
  return <View style={[styles.card, { backgroundColor: raised ? theme.colors.surfaceRaised : tokens.background, borderColor: neon ? theme.colors.neonBlue : (raised ? theme.colors.borderStrong : tokens.border), borderRadius: tokens.radius, padding: tokens.padding, shadowColor: neon ? theme.colors.neonBlue : tokens.shadow.color, shadowOffset: tokens.shadow.offset, shadowOpacity: neon ? 0.4 : (raised ? Math.min(tokens.shadow.opacity + 0.05, 1) : tokens.shadow.opacity), shadowRadius: neon ? 16 : (raised ? tokens.shadow.radius + 4 : tokens.shadow.radius), elevation: neon ? 3 : (raised ? tokens.shadow.elevation + 1 : tokens.shadow.elevation), borderWidth: neon ? 1.5 : 1 }]} testID={testID}>{children}</View>;
}

export type StatusTone = "primary" | "success" | "warning" | "danger" | "info" | "neutral";

export function StatusChip({ label, tone = "neutral", testID }: Readonly<{ label: string; tone?: StatusTone; testID?: string }>) {
  const { theme } = useTheme();
  const foreground = tone === "primary" ? theme.colors.primary : tone === "success" ? theme.colors.success : tone === "warning" ? theme.colors.warning : tone === "danger" ? theme.colors.danger : tone === "info" ? theme.colors.info : theme.colors.textMuted;
  const background = tone === "primary" ? theme.colors.primarySoft : theme.colors.surfaceSunken;
  return <View testID={testID} style={[styles.chip, { backgroundColor: background, borderColor: tone === "neutral" ? theme.colors.border : foreground }]}><Text style={[styles.chipLabel, { color: foreground }]}>{label}</Text></View>;
}

export function MotionReveal({ children, testID }: Readonly<{ children: React.ReactNode; testID?: string }>) {
  const [reducedMotion, setReducedMotion] = useState<boolean | null>(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(8)).current;

  useEffect(() => {
    let active = true;
    AccessibilityInfo.isReduceMotionEnabled().then((enabled) => { if (active) setReducedMotion(enabled); }).catch(() => { if (active) setReducedMotion(false); });
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setReducedMotion);
    return () => { active = false; subscription.remove(); };
  }, []);

  useEffect(() => {
    if (reducedMotion === null) return;
    if (reducedMotion) { opacity.setValue(1); translateY.setValue(0); return; }
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }),
      Animated.timing(translateY, { toValue: 0, duration: 180, useNativeDriver: true }),
    ]).start();
  }, [opacity, reducedMotion, translateY]);

  return <Animated.View testID={testID} style={{ opacity: reducedMotion === null ? 1 : opacity, transform: [{ translateY: reducedMotion === null ? 0 : translateY }] }}>{children}</Animated.View>;
}


export type IntelligenceFieldState = "IDLE" | "OBSERVING" | "RECOVERING" | "READY" | "ACTIVE" | "DEGRADED" | "BLOCKED";

export type IntelligenceFieldVariant = "intelligence" | "flow" | "authority";

export function IntelligenceMotionField({
  active = true,
  evidenceCount = 0,
  state = active ? "ACTIVE" : "IDLE",
  label = "NUSA intelligence field",
  variant = "intelligence",
}: Readonly<{
  active?: boolean;
  evidenceCount?: number;
  state?: IntelligenceFieldState;
  label?: string;
  variant?: IntelligenceFieldVariant;
}>) {
  const { theme } = useTheme();
  const [reducedMotion, setReducedMotion] = useState<boolean | null>(null);
  const shift = useRef(new Animated.Value(0.35)).current;
  const energy = useRef(new Animated.Value(active ? 0.62 : 0.22)).current;
  const previousFieldState = useRef<Readonly<{ active: boolean; evidenceCount: number; state: IntelligenceFieldState }> | null>(null);

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then((enabled) => { if (mounted) setReducedMotion(enabled); }).catch(() => { if (mounted) setReducedMotion(false); });
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setReducedMotion);
    return () => { mounted = false; subscription.remove(); };
  }, []);

  useEffect(() => {
    const boundedEvidence = Math.max(0, Math.min(99, Math.round(evidenceCount)));
    const previous = previousFieldState.current;
    previousFieldState.current = { active, evidenceCount: boundedEvidence, state };
    shift.stopAnimation();
    energy.stopAnimation();

    if (reducedMotion == null) return undefined;
    if (reducedMotion || !active) {
      shift.setValue(0.35);
      energy.setValue(active ? 0.62 : 0.22);
      return undefined;
    }

    if (previous == null || (previous.active === active && previous.evidenceCount === boundedEvidence && previous.state === state)) {
      shift.setValue(0.35);
      energy.setValue(0.62);
      return undefined;
    }

    shift.setValue(0);
    energy.setValue(0.42);
    const animation = Animated.parallel([
      Animated.timing(shift, { toValue: 1, duration: 520, useNativeDriver: true }),
      Animated.sequence([
        Animated.timing(energy, { toValue: 1, duration: 280, useNativeDriver: true }),
        Animated.timing(energy, { toValue: 0.62, duration: 260, useNativeDriver: true }),
      ]),
    ]);
    animation.start();
    return () => animation.stop();
  }, [active, energy, evidenceCount, reducedMotion, shift, state]);

  const boundedEvidence = Math.max(0, Math.min(99, Math.round(evidenceCount)));
  const travelA = shift.interpolate({ inputRange: [0, 1], outputRange: [-22, 16] });
  const travelB = shift.interpolate({ inputRange: [0, 1], outputRange: [18, -12] });
  const travelC = shift.interpolate({ inputRange: [0, 1], outputRange: [-12, 10] });
  const glowOpacity = energy.interpolate({ inputRange: [0, 1], outputRange: [0.28, 0.78] });
  const lineOpacity = energy.interpolate({ inputRange: [0, 1], outputRange: [0.42, 1] });
  const footer = state === "RECOVERING"
    ? "RESTORE · VERIFY · CONNECT"
    : state === "BLOCKED" || state === "DEGRADED"
      ? "DETECT · ISOLATE · RECOVER"
      : "OBSERVE · VERIFY · LEARN";

  return <View accessible accessibilityRole="image" accessibilityLabel={label} style={styles.intelligenceField} testID="nusa-intelligence-motion">
    <View style={styles.intelligenceAmbientPlaneA} />
    <View style={styles.intelligenceAmbientPlaneB} />
    <Text style={styles.intelligenceFieldKicker}>NUSA · {state}</Text>

    {variant === "authority" ? <View style={styles.authorityField}>
      <Animated.View style={[styles.authorityInputBand, styles.authorityInputBandA, { backgroundColor: theme.colors.aiSignalMid, opacity: lineOpacity, transform: [{ translateX: travelA }] }]} />
      <Animated.View style={[styles.authorityInputBand, styles.authorityInputBandB, { backgroundColor: theme.colors.aiSignalStart, opacity: glowOpacity, transform: [{ translateX: travelB }] }]} />
      <Animated.View style={[styles.authorityInputBand, styles.authorityInputBandC, { backgroundColor: theme.colors.aiSignalEnd, opacity: lineOpacity, transform: [{ translateX: travelC }] }]} />
      <View style={[styles.authorityBoundaryPlane, { borderColor: state === "BLOCKED" ? theme.colors.warning : theme.colors.aiSignalEnd }]}>
        <Text style={[styles.authorityBoundaryLabel, { color: state === "BLOCKED" ? theme.colors.warning : theme.colors.aiSignalEnd }]}>AUTHORITY BOUNDARY</Text>
        <Text style={styles.authorityBoundaryValue}>LIVE NONE</Text>
      </View>
      <View style={styles.authoritySilentZone} />
    </View> : <View style={styles.ribbonField}>
      <Animated.View style={[styles.ribbonBand, styles.ribbonBandA, { backgroundColor: theme.colors.aiSignalStart, opacity: glowOpacity, transform: [{ translateX: travelA }, { rotate: "-7deg" }] }]} />
      <Animated.View style={[styles.ribbonBand, styles.ribbonBandB, { backgroundColor: theme.colors.aiSignalMid, opacity: glowOpacity, transform: [{ translateX: travelB }, { rotate: "4deg" }] }]} />
      <Animated.View style={[styles.ribbonBand, styles.ribbonBandC, { backgroundColor: theme.colors.aiSignalEnd, opacity: glowOpacity, transform: [{ translateX: travelC }, { rotate: "-2deg" }] }]} />
      <View style={[styles.ribbonHorizon, { backgroundColor: theme.colors.terrain }]} />
      <View style={[styles.ribbonFocusLine, { backgroundColor: theme.colors.aiSignalEnd, opacity: active ? 0.9 : 0.38 }]} />
      {variant === "flow" ? <View style={styles.flowLabels}>
        <Text style={styles.flowLabel}>STRATEGY</Text>
        <Text style={styles.flowLabel}>EXECUTION</Text>
        <Text style={styles.flowLabel}>LEDGER</Text>
        <Text style={styles.flowLabel}>LEARNING</Text>
      </View> : null}
    </View>}

    <View style={styles.intelligenceLegend}><Text style={styles.intelligenceLegendLabel}>EVIDENCE</Text><Text style={styles.intelligenceLegendValue}>{boundedEvidence}</Text></View>
    <Text style={styles.intelligenceFieldFooter}>{footer}</Text>
  </View>;
}

export function TerrainSignal({ variant = "symbolic", signalStrength = 0.6, accessibilityLabel, testID }: Readonly<{ variant?: "symbolic" | "market"; signalStrength?: number; accessibilityLabel?: string; testID?: string }>) {
  const { theme } = useTheme();
  const boundedStrength = Math.max(0.25, Math.min(1, signalStrength));
  const primaryWidth = `${Math.round(58 + boundedStrength * 27)}%` as `${number}%`;
  const secondaryWidth = `${Math.round(45 + boundedStrength * 25)}%` as `${number}%`;
  const convergenceLeft = `${Math.round(48 + boundedStrength * 22)}%` as `${number}%`;
  // Raised floors so the hero reads as a hero even at the lowest signal strength: the reference
  // calls for restrained glow and low-noise surfaces, not for the centerpiece to be optional.
  const signalOpacity = 0.55 + boundedStrength * 0.4;
  return <View accessible accessibilityRole="image" accessibilityLabel={accessibilityLabel ?? (variant === "market" ? "실제 시장 데이터에 연결된 시그널" : "NUSA 상태 시그널")} style={styles.terrainSignal} testID={testID}>
    <View style={[styles.terrainGridLine, styles.terrainGridLineTop, { backgroundColor: theme.colors.borderStrong, opacity: 0.5 }]} />
    <View style={[styles.terrainGridLine, styles.terrainGridLineMid, { backgroundColor: theme.colors.borderStrong, opacity: 0.62 }]} />
    <View style={[styles.terrainGridLine, styles.terrainGridLineLow, { backgroundColor: theme.colors.borderStrong, opacity: 0.4 }]} />
    <View style={[styles.terrainPlane, styles.terrainPlaneFar, { width: secondaryWidth, backgroundColor: theme.colors.terrain, opacity: signalOpacity * 0.6 }]} />
    <View style={[styles.terrainPlane, styles.terrainPlaneMid, { width: primaryWidth, backgroundColor: theme.colors.aiSignalStart, opacity: signalOpacity * 0.78 }]} />
    <View style={[styles.terrainPlane, styles.terrainPlaneNear, { width: "72%", backgroundColor: theme.colors.aiSignalMid, opacity: signalOpacity * 0.9 }]} />
    <View style={[styles.terrainPlane, styles.terrainPlaneGround, { width: "88%", backgroundColor: theme.colors.terrain, opacity: signalOpacity }]} />
    <View style={[styles.terrainConvergenceBeam, { left: convergenceLeft, backgroundColor: theme.colors.aiSignalEnd, opacity: 0.35 + boundedStrength * 0.25 }]} />
    <View style={[styles.terrainConvergenceHaloOuter, { left: convergenceLeft, borderColor: theme.colors.aiSignalMid, opacity: 0.3 + boundedStrength * 0.2 }]} />
    <View style={[styles.terrainConvergenceHalo, { left: convergenceLeft, borderColor: theme.colors.aiSignalEnd, opacity: 0.5 + boundedStrength * 0.25 }]} />
    <View style={[styles.terrainConvergence, { left: convergenceLeft, backgroundColor: theme.colors.aiSignalEnd, shadowColor: theme.colors.aiSignalEnd, opacity: 0.9 + boundedStrength * 0.1 }]} />
  </View>;
}

export function WaveMark(_props: Readonly<{ compact?: boolean }>) {
  return null;
}

export function SectionHeading({ eyebrow, title, description }: Readonly<{ eyebrow?: string; title: string; description?: string }>) {
  const { theme } = useTheme();
  return <View style={styles.sectionHeading}>{eyebrow ? <Text style={[styles.eyebrow, { color: theme.colors.primary }]}>{eyebrow}</Text> : null}<Text style={[styles.sectionTitle, { color: theme.colors.text }]}>{title}</Text>{description ? <Text style={[styles.sectionDescription, { color: theme.colors.textMuted }]}>{description}</Text> : null}</View>;
}

export function AuthorityBanner({ detail = "AI는 주문, 이체, 출금 또는 운영 상태를 변경할 권한이 없습니다. AI는 읽기 전용이며 PAPER 주문은 별도의 사용자 승인·PAPER 실행 경로에서만 처리됩니다." }: Readonly<{ detail?: string }>) {
  const { theme } = useTheme();
  return <View style={[styles.authority, { backgroundColor: theme.colors.primarySoft, borderColor: theme.colors.primary }]} testID="zero-authority-banner"><View style={styles.authorityTop}><Text style={[styles.authorityTitle, { color: theme.colors.text }]}>ZERO AUTHORITY</Text><StatusChip label="AI 읽기 전용" tone="info" /></View><Text style={[styles.authorityDetail, { color: theme.colors.textMuted }]}>{detail}</Text></View>;
}

export function DataRow({ label, value, emphasis = false, tone = "default", testID }: Readonly<{ label: string; value: string; emphasis?: boolean; tone?: "default" | "success" | "warning" | "danger"; testID?: string }>) {
  const { theme } = useTheme();
  const color = tone === "success" ? theme.colors.success : tone === "warning" ? theme.colors.warning : tone === "danger" ? theme.colors.danger : theme.colors.text;
  return <View accessible accessibilityLabel={`${label}: ${value}`} style={styles.dataRow} testID={testID}><Text style={[styles.dataLabel, { color: theme.colors.textMuted }]}>{label}</Text><Text style={[styles.dataValue, emphasis && styles.dataValueEmphasis, { color, fontWeight: emphasis ? theme.typography.weights.bold : theme.typography.weights.semibold }]}>{value}</Text></View>;
}

/**
 * Static loading skeleton block. Deliberately animation-free so loading
 * states stay deterministic under tests and cheap on low-end devices;
 * perceived motion remains the job of refresh controls and progress UI.
 * Decorative only — never a substitute for real content or state text.
 */
export function Skeleton({ width = "100%", height = 14, borderRadius = 7, testID }: Readonly<{ width?: number | `${number}%`; height?: number; borderRadius?: number; testID?: string }>) {
  const { theme } = useTheme();
  return <View accessible={false} testID={testID} style={[styles.skeleton, { width, height, borderRadius, backgroundColor: theme.colors.surfaceRaised }]} />;
}

const styles = StyleSheet.create({
  button: { alignItems: "center", justifyContent: "center", borderWidth: 1 },
  buttonLabel: { fontSize: 15, letterSpacing: -0.15 },
  card: { borderWidth: 1 },
  field: { paddingHorizontal: 16, paddingVertical: 12, fontSize: 16 },
  fieldGroup: { gap: 7 },
  fieldLabel: { fontWeight: "600", letterSpacing: 0.15 },
  chip: { borderWidth: 1, borderRadius: 9999, paddingHorizontal: 10, paddingVertical: 5, alignSelf: "flex-start" },
  chipLabel: { fontSize: 10, fontWeight: "700", letterSpacing: 0.35 },
  sectionHeading: { gap: 6, marginBottom: 4 },
  eyebrow: { fontSize: 10, fontWeight: "700", letterSpacing: 1.8 },
  sectionTitle: { fontSize: 27, lineHeight: 33, fontWeight: "700", letterSpacing: -1 },
  sectionDescription: { fontSize: 14, lineHeight: 21, maxWidth: 560 },
  authority: { borderWidth: 1, borderRadius: 20, padding: 16, gap: 10 },
  authorityTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" },
  authorityTitle: { fontSize: 12, fontWeight: "800", letterSpacing: 1.2 },
  authorityDetail: { fontSize: 13, lineHeight: 20 },
  dataRow: { minHeight: 36, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 14 },
  dataLabel: { flex: 1, fontSize: 13, lineHeight: 19 },
  skeleton: { opacity: 0.85 },
  intelligenceField: { height: 224, minWidth: 220, flex: 1, overflow: "hidden", borderWidth: StyleSheet.hairlineWidth, borderColor: intelligenceFieldColors.border, borderRadius: 20, position: "relative", backgroundColor: intelligenceFieldColors.surface },
  intelligenceAmbientPlaneA: { position: "absolute", width: "78%", height: 118, right: "-12%", top: -30, borderRadius: 38, backgroundColor: intelligenceFieldColors.ambientPurple, opacity: 0.7, transform: [{ rotate: "-9deg" }] },
  intelligenceAmbientPlaneB: { position: "absolute", width: "86%", height: 104, left: "-22%", bottom: -32, borderRadius: 42, backgroundColor: intelligenceFieldColors.ambientTeal, opacity: 0.58, transform: [{ rotate: "7deg" }] },
  intelligenceFieldKicker: { position: "absolute", left: 16, top: 14, zIndex: 4, color: intelligenceFieldColors.textMuted, fontSize: 8, lineHeight: 11, fontWeight: "900", letterSpacing: 1.25 },
  intelligenceFieldFooter: { position: "absolute", right: 16, bottom: 14, zIndex: 4, color: intelligenceFieldColors.textSubtle, fontSize: 7, lineHeight: 10, fontWeight: "900", letterSpacing: 1.05 },
  ribbonField: { position: "absolute", left: 0, right: 0, top: 30, bottom: 30, overflow: "hidden", justifyContent: "center" },
  ribbonBand: { position: "absolute", left: "-16%", width: "132%", borderRadius: 32 },
  ribbonBandA: { height: 34, top: "29%" },
  ribbonBandB: { height: 24, top: "47%" },
  ribbonBandC: { height: 14, top: "63%" },
  ribbonHorizon: { position: "absolute", left: "5%", right: "5%", top: "55%", height: 1, opacity: 0.32 },
  ribbonFocusLine: { position: "absolute", left: "16%", right: "10%", top: "58%", height: 2, borderRadius: 1, transform: [{ rotate: "-4deg" }] },
  flowLabels: { position: "absolute", left: 18, right: 18, bottom: 23, flexDirection: "row", justifyContent: "space-between", gap: 8 },
  flowLabel: { color: intelligenceFieldColors.textSubtle, fontSize: 7, lineHeight: 10, fontWeight: "900", letterSpacing: 0.8 },
  authorityField: { position: "absolute", left: 0, right: 0, top: 32, bottom: 32, overflow: "hidden" },
  authorityInputBand: { position: "absolute", left: "-7%", width: "62%", height: 2, borderRadius: 1 },
  authorityInputBandA: { top: "30%", transform: [{ rotate: "3deg" }] },
  authorityInputBandB: { top: "50%", transform: [{ rotate: "-4deg" }] },
  authorityInputBandC: { top: "69%", transform: [{ rotate: "2deg" }] },
  authorityBoundaryPlane: { position: "absolute", left: "58%", top: "10%", bottom: "10%", width: "27%", borderLeftWidth: 1.5, justifyContent: "center", paddingLeft: 12, backgroundColor: "rgba(255,255,255,0.015)" },
  authorityBoundaryLabel: { fontSize: 7, lineHeight: 10, fontWeight: "900", letterSpacing: 0.9 },
  authorityBoundaryValue: { marginTop: 5, color: intelligenceFieldColors.text, fontSize: 13, lineHeight: 17, fontWeight: "900", letterSpacing: 0.6 },
  authoritySilentZone: { position: "absolute", left: "85%", right: 0, top: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.18)" },
  intelligenceLegend: { position: "absolute", left: 16, bottom: 13, zIndex: 4, flexDirection: "row", alignItems: "baseline", gap: 6 },
  intelligenceLegendLabel: { color: intelligenceFieldColors.textMuted, fontSize: 8, lineHeight: 11, fontWeight: "900", letterSpacing: 1.05 },
  intelligenceLegendValue: { color: intelligenceFieldColors.text, fontSize: 14, lineHeight: 17, fontWeight: "900", fontVariant: ["tabular-nums"] },
  dataValue: { flexShrink: 1, textAlign: "right", fontSize: 13, lineHeight: 19, fontVariant: ["tabular-nums"] },
  dataValueEmphasis: { fontSize: 14 },
  // Issue #536's MASTER VISUAL REFERENCE names this centerpiece the visual hero of HOME, not a
  // decorative footnote under it. The previous geometry -- 1px diagonal lines at low opacity, an
  // 8px center dot -- rendered as close to empty space at normal viewing distance regardless of
  // which design preset was active, which is how a real, merged redesign still read as "nothing
  // changed" on device. Strokes stay thin and precise per the reference language; what changes is
  // that they are now thick and contrasted enough to actually register as a hero graphic rather
  // than disappearing into the surface behind them.
  terrainSignal: { height: 240, width: "100%", overflow: "hidden", justifyContent: "center", position: "relative" },
  terrainGridLine: { position: "absolute", left: "2%", right: "2%", height: 1 },
  terrainGridLineTop: { top: "27%" },
  terrainGridLineMid: { top: "50%" },
  terrainGridLineLow: { top: "73%" },
  terrainPlane: { position: "absolute", height: 2, borderRadius: 1 },
  terrainPlaneFar: { left: "6%", top: "30%", transform: [{ rotate: "6deg" }] },
  terrainPlaneMid: { left: "10%", top: "45%", transform: [{ rotate: "-8deg" }] },
  terrainPlaneNear: { left: "18%", top: "61%", transform: [{ rotate: "9deg" }] },
  terrainPlaneGround: { left: "4%", top: "77%", transform: [{ rotate: "-3deg" }] },
  terrainConvergenceBeam: { position: "absolute", top: "24%", bottom: "16%", width: 1.5, marginLeft: -0.75 },
  terrainConvergence: { position: "absolute", top: "48%", width: 16, height: 16, borderRadius: 8, marginLeft: -8, shadowOpacity: 0.85, shadowRadius: 18, elevation: 4 },
  terrainConvergenceHalo: { position: "absolute", top: "40%", width: 48, height: 48, borderRadius: 24, borderWidth: 1.5, marginLeft: -24 },
  terrainConvergenceHaloOuter: { position: "absolute", top: "33%", width: 82, height: 82, borderRadius: 41, borderWidth: 1, marginLeft: -41 },
});
