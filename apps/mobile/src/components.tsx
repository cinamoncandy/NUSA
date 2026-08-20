import React, { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Pressable, StyleSheet, Text, TextInput, View, type TextInputProps } from "react-native";
import { buttonTokens, cardTokens, fieldTokens, type ButtonTone } from "./designSystem";
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

export function TerrainSignal({ variant = "symbolic", signalStrength = 0.6, accessibilityLabel, testID }: Readonly<{ variant?: "symbolic" | "market"; signalStrength?: number; accessibilityLabel?: string; testID?: string }>) {
  const { theme } = useTheme();
  const boundedStrength = Math.max(0.25, Math.min(1, signalStrength));
  const convergenceLeft = `${Math.round(50 + boundedStrength * 8)}%` as `${number}%`;
  const signalOpacity = 0.55 + boundedStrength * 0.4;
  const fieldLabel = accessibilityLabel ?? (variant === "market" ? "실제 시장 데이터에 연결된 시그널" : "NUSA 상태 시그널");

  return <View accessible accessibilityRole="image" accessibilityLabel={fieldLabel} style={styles.terrainSignal} testID={testID}>
    <View style={[styles.terrainGridLine, styles.terrainGridLineA, { backgroundColor: theme.colors.borderStrong }]} />
    <View style={[styles.terrainGridLine, styles.terrainGridLineB, { backgroundColor: theme.colors.borderStrong }]} />
    <View style={[styles.terrainGridLine, styles.terrainGridLineC, { backgroundColor: theme.colors.borderStrong }]} />
    <View style={[styles.terrainGridLine, styles.terrainGridLineD, { backgroundColor: theme.colors.borderStrong }]} />
    <View style={[styles.terrainGridColumn, styles.terrainGridColumnA, { backgroundColor: theme.colors.borderStrong }]} />
    <View style={[styles.terrainGridColumn, styles.terrainGridColumnB, { backgroundColor: theme.colors.borderStrong }]} />
    <View style={[styles.terrainGridColumn, styles.terrainGridColumnC, { backgroundColor: theme.colors.borderStrong }]} />

    <View style={[styles.terrainContour, styles.terrainContourFarA, { backgroundColor: theme.colors.terrain, opacity: signalOpacity * 0.30 }]} />
    <View style={[styles.terrainContour, styles.terrainContourFarB, { backgroundColor: theme.colors.terrain, opacity: signalOpacity * 0.38 }]} />
    <View style={[styles.terrainContour, styles.terrainContourMidA, { backgroundColor: theme.colors.aiSignalStart, opacity: signalOpacity * 0.48 }]} />
    <View style={[styles.terrainContour, styles.terrainContourMidB, { backgroundColor: theme.colors.aiSignalStart, opacity: signalOpacity * 0.58 }]} />
    <View style={[styles.terrainContour, styles.terrainContourNearA, { backgroundColor: theme.colors.aiSignalMid, opacity: signalOpacity * 0.66 }]} />
    <View style={[styles.terrainContour, styles.terrainContourNearB, { backgroundColor: theme.colors.aiSignalMid, opacity: signalOpacity * 0.76 }]} />
    <View style={[styles.terrainContour, styles.terrainContourGroundA, { backgroundColor: theme.colors.terrain, opacity: signalOpacity * 0.82 }]} />
    <View style={[styles.terrainContour, styles.terrainContourGroundB, { backgroundColor: theme.colors.terrain, opacity: signalOpacity }]} />

    <View style={[styles.terrainRail, styles.terrainRailLeft, { backgroundColor: theme.colors.aiSignalStart, opacity: 0.28 + boundedStrength * 0.30 }]} />
    <View style={[styles.terrainRail, styles.terrainRailRight, { backgroundColor: theme.colors.aiSignalMid, opacity: 0.30 + boundedStrength * 0.34 }]} />
    <View style={[styles.terrainAxis, { left: convergenceLeft, backgroundColor: theme.colors.aiSignalEnd, opacity: 0.24 + boundedStrength * 0.28 }]} />

    <View style={[styles.terrainNodeTick, styles.terrainNodeTickLeft, { left: convergenceLeft, backgroundColor: theme.colors.aiSignalEnd, opacity: 0.72 }]} />
    <View style={[styles.terrainNodeTick, styles.terrainNodeTickRight, { left: convergenceLeft, backgroundColor: theme.colors.aiSignalEnd, opacity: 0.72 }]} />
    <View style={[styles.terrainHaloOuter, { left: convergenceLeft, borderColor: theme.colors.aiSignalStart, opacity: 0.30 + boundedStrength * 0.20 }]} />
    <View style={[styles.terrainHaloMid, { left: convergenceLeft, borderColor: theme.colors.aiSignalMid, opacity: 0.38 + boundedStrength * 0.22 }]} />
    <View style={[styles.terrainHaloInner, { left: convergenceLeft, borderColor: theme.colors.aiSignalEnd, opacity: 0.52 + boundedStrength * 0.24 }]} />
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
  dataValue: { flexShrink: 1, textAlign: "right", fontSize: 13, lineHeight: 19, fontVariant: ["tabular-nums"] },
  dataValueEmphasis: { fontSize: 14 },

  terrainSignal: { height: 292, width: "100%", overflow: "hidden", position: "relative" },
  terrainGridLine: { position: "absolute", left: "1%", right: "1%", height: 1, opacity: 0.46 },
  terrainGridLineA: { top: "18%" },
  terrainGridLineB: { top: "39%" },
  terrainGridLineC: { top: "61%" },
  terrainGridLineD: { top: "82%" },
  terrainGridColumn: { position: "absolute", top: "8%", bottom: "8%", width: 1, opacity: 0.28 },
  terrainGridColumnA: { left: "24%" },
  terrainGridColumnB: { left: "50%" },
  terrainGridColumnC: { left: "76%" },

  terrainContour: { position: "absolute", height: 2, borderRadius: 1 },
  terrainContourFarA: { left: "5%", top: "24%", width: "58%", transform: [{ rotate: "4deg" }] },
  terrainContourFarB: { right: "3%", top: "28%", width: "48%", transform: [{ rotate: "-5deg" }] },
  terrainContourMidA: { left: "3%", top: "39%", width: "74%", transform: [{ rotate: "-7deg" }] },
  terrainContourMidB: { right: "1%", top: "44%", width: "63%", transform: [{ rotate: "6deg" }] },
  terrainContourNearA: { left: "7%", top: "56%", width: "82%", transform: [{ rotate: "8deg" }] },
  terrainContourNearB: { right: "5%", top: "61%", width: "68%", transform: [{ rotate: "-8deg" }] },
  terrainContourGroundA: { left: "2%", top: "73%", width: "88%", transform: [{ rotate: "-3deg" }] },
  terrainContourGroundB: { right: "0%", top: "79%", width: "92%", transform: [{ rotate: "3deg" }] },

  terrainRail: { position: "absolute", height: 2, width: "58%", top: "51%", borderRadius: 1 },
  terrainRailLeft: { left: "-6%", transform: [{ rotate: "12deg" }] },
  terrainRailRight: { right: "-8%", transform: [{ rotate: "-11deg" }] },
  terrainAxis: { position: "absolute", top: "10%", bottom: "9%", width: 1.5 },
  terrainNodeTick: { position: "absolute", top: "51%", width: 18, height: 2, marginTop: -0.5 },
  terrainNodeTickLeft: { marginLeft: -30 },
  terrainNodeTickRight: { marginLeft: 12 },
  terrainHaloOuter: { position: "absolute", top: "39%", width: 78, height: 78, borderRadius: 39, borderWidth: 1, marginLeft: -39 },
  terrainHaloMid: { position: "absolute", top: "42.5%", width: 58, height: 58, borderRadius: 29, borderWidth: 1, marginLeft: -29 },
  terrainHaloInner: { position: "absolute", top: "46%", width: 38, height: 38, borderRadius: 19, borderWidth: 1.5, marginLeft: -19 },
  terrainConvergence: { position: "absolute", top: "49.3%", width: 16, height: 16, borderRadius: 8, marginLeft: -8, shadowOpacity: 0.82, shadowRadius: 18, elevation: 4 },
});
