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
  const primaryWidth = `${Math.round(42 + boundedStrength * 34)}%` as `${number}%`;
  const secondaryWidth = `${Math.round(30 + boundedStrength * 26)}%` as `${number}%`;
  const convergenceLeft = `${Math.round(44 + boundedStrength * 18)}%` as `${number}%`;
  return <View accessible accessibilityRole="image" accessibilityLabel={accessibilityLabel ?? (variant === "market" ? "실제 시장 데이터에 연결된 시그널" : "NUSA 상태 시그널")} style={styles.terrainSignal} testID={testID}>
    <View style={[styles.terrainHorizon, { backgroundColor: theme.colors.terrain, opacity: 0.22 }]} />
    <View style={[styles.terrainLine, { width: primaryWidth, backgroundColor: theme.colors.terrain, opacity: 0.78 }]} />
    <View style={[styles.terrainLine, styles.terrainLineHigh, { width: secondaryWidth, backgroundColor: theme.colors.aiSignalMid, opacity: 0.7 }]} />
    <View style={[styles.terrainLine, styles.terrainLineLow, { width: "42%", backgroundColor: theme.colors.aiSignalEnd, opacity: 0.58 }]} />
    <View style={[styles.terrainConvergence, { left: convergenceLeft, backgroundColor: theme.colors.aiSignalEnd, shadowColor: theme.colors.aiSignalEnd }]} />
    <View style={[styles.terrainConvergenceHalo, { left: convergenceLeft, borderColor: theme.colors.aiSignalEnd }]} />
  </View>;
}

export function WaveMark({ compact = false }: Readonly<{ compact?: boolean }>) {
  const { theme } = useTheme();
  const size = compact ? 30 : 42;
  const peakWidth = compact ? 13 : 18;
  const reflectionWidth = compact ? 22 : 31;
  return (
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[styles.nusaSymbol, { width: size, height: size }]}>
      <View style={[styles.symbolPeak, { borderLeftWidth: peakWidth / 2, borderRightWidth: peakWidth / 2, borderBottomWidth: compact ? 12 : 16, borderBottomColor: theme.colors.text }]} />
      <View style={[styles.symbolReflection, { width: reflectionWidth, backgroundColor: theme.colors.text }]} />
      <View style={[styles.symbolReflectionLine, { width: compact ? 14 : 20, backgroundColor: theme.colors.text }]} />
    </View>
  );
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

export interface BottomNavigationItem {
  readonly key: string;
  readonly label: string;
  readonly testID?: string;
}

export function BottomNavigation({ items, activeKey, onSelect, testID }: Readonly<{ items: readonly BottomNavigationItem[]; activeKey: string; onSelect: (key: string) => void; testID?: string }>) {
  const { theme } = useTheme();
  return <View accessibilityRole="tablist" style={[styles.bottomNavigation, { backgroundColor: theme.colors.navSurface, borderTopColor: theme.colors.border }]} testID={testID}>
    <View style={styles.bottomNavigationInner}>
      {items.map((item) => {
        const active = item.key === activeKey;
        return <Pressable key={item.key} accessibilityLabel={item.label} accessibilityRole="tab" accessibilityState={{ selected: active }} onPress={() => onSelect(item.key)} style={({ pressed }) => [styles.bottomNavigationItem, { borderColor: active ? theme.colors.neonBlue : "transparent", backgroundColor: active ? theme.colors.neonGlow : "transparent", borderRadius: theme.radii.lg, minHeight: theme.interaction.touchTarget + theme.spacing.xs, opacity: pressed ? theme.interaction.pressedOpacity : 1 }]} testID={item.testID ?? `tab-${item.key}`}>
          <View style={[styles.bottomNavigationIndicator, { backgroundColor: active ? theme.colors.aiSignalEnd : "transparent", width: active ? theme.spacing.xxl : theme.spacing.md }]} />
          <Text style={[styles.bottomNavigationLabel, { color: active ? theme.colors.neonTeal : theme.colors.textMuted, fontWeight: active ? theme.typography.weights.bold : theme.typography.weights.semibold }]}>{item.label}</Text>
        </Pressable>;
      })}
    </View>
  </View>;
}

export function AIInsight({ thesis, evidenceCount, confidence, onPress, testID }: Readonly<{ thesis: string | null; evidenceCount: number; confidence?: string; onPress: () => void; testID?: string }>) {
  const { theme } = useTheme();
  const available = Boolean(thesis?.trim()) && evidenceCount > 0;
  return <NusaCard testID={testID}>
    <View style={styles.insightHeader}><View><Text style={[styles.eyebrow, { color: theme.colors.textMuted }]}>AI INSIGHT</Text><Text style={[styles.sectionTitle, { color: theme.colors.text }]}>오늘의 분석</Text></View><View style={styles.insightBadges}><StatusChip label="READ ONLY" tone="info" />{confidence ? <StatusChip label={confidence} tone="info" /> : null}</View></View>
    <Text style={[styles.insightThesis, { color: available ? theme.colors.text : theme.colors.textMuted }]}>{thesis ?? "현재 표시할 검증된 AI 분석이 없습니다."}</Text>
    <View style={styles.insightFooter}><Text style={[styles.meta, { color: theme.colors.textMuted }]}>{available ? `근거 ${evidenceCount}개` : "검증된 근거 없음"}</Text><NusaButton label="AI 보기" onPress={onPress} tone="neutral" /></View>
  </NusaCard>;
}

export function SafetyNotice({ health, runtimeState, killSwitchActive, liveAuthority, productionMutationAllowed, testID }: Readonly<{ health: string; runtimeState: string; killSwitchActive: boolean; liveAuthority: string; productionMutationAllowed: boolean; testID?: string }>) {
  const { theme } = useTheme();
  const healthToneValue: StatusTone = health === "HEALTHY" || health === "READY" ? "success" : health === "FAIL_CLOSED" || health === "DOWN" ? "danger" : "warning";
  return <NusaCard testID={testID}>
    <View style={styles.safetyHeader}><View><Text style={[styles.eyebrow, { color: theme.colors.textMuted }]}>RISK / SAFETY</Text><Text style={[styles.sectionTitle, { color: theme.colors.text }]}>운영 상태</Text></View><StatusChip label={health} tone={healthToneValue} /></View>
    <DataRow label="PAPER 런타임" value={runtimeState} tone={healthToneValue} /><DataRow label="킬 스위치" value={killSwitchActive ? "활성" : "비활성"} tone={killSwitchActive ? "danger" : "success"} /><DataRow label="LIVE 권한" value={liveAuthority} /><DataRow label="Production mutation" value={productionMutationAllowed ? "허용" : "금지"} tone={productionMutationAllowed ? "danger" : "success"} />
  </NusaCard>;
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
  nusaSymbol: { alignItems: "center", justifyContent: "center", position: "relative" },
  symbolPeak: { position: "absolute", bottom: "43%", width: 0, height: 0, borderLeftColor: "transparent", borderRightColor: "transparent", borderStyle: "solid" },
  symbolReflection: { position: "absolute", height: 4, borderRadius: 9999, bottom: "29%", opacity: 0.9, transform: [{ skewX: "-12deg" }] },
  symbolReflectionLine: { position: "absolute", height: 2, borderRadius: 9999, bottom: "19%", opacity: 0.72, transform: [{ skewX: "-12deg" }] },
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
  bottomNavigation: { borderTopWidth: 1, alignItems: "center" },
  bottomNavigationInner: { width: "100%", maxWidth: 1080, flexDirection: "row", paddingTop: 8, paddingBottom: 9, paddingHorizontal: 6 },
  bottomNavigationItem: { flex: 1, alignItems: "center", justifyContent: "center", gap: 6, borderWidth: 1, marginHorizontal: 2 },
  bottomNavigationIndicator: { height: 2, borderRadius: 2 },
  bottomNavigationLabel: { fontSize: 10, letterSpacing: 0.1 },
  insightHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 12 },
  insightBadges: { flexDirection: "row", gap: 7, flexWrap: "wrap", justifyContent: "flex-end" },
  insightThesis: { fontSize: 17, lineHeight: 25, fontWeight: "700" },
  insightFooter: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" },
  safetyHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 4 },
  meta: { fontSize: 12, lineHeight: 18 },
  terrainSignal: { height: 92, width: "100%", overflow: "hidden", justifyContent: "center", position: "relative" },
  terrainHorizon: { position: "absolute", left: 0, right: 0, top: "59%", height: StyleSheet.hairlineWidth },
  terrainLine: { position: "absolute", left: "4%", top: "50%", height: 1, transform: [{ rotate: "-7deg" }] },
  terrainLineHigh: { left: "18%", top: "32%", transform: [{ rotate: "8deg" }] },
  terrainLineLow: { left: "28%", top: "68%", transform: [{ rotate: "-2deg" }] },
  terrainConvergence: { position: "absolute", top: "47%", width: 7, height: 7, borderRadius: 4, marginLeft: -3, shadowOpacity: 0.6, shadowRadius: 10, elevation: 2 },
  terrainConvergenceHalo: { position: "absolute", top: "39%", width: 23, height: 23, borderRadius: 12, borderWidth: 1, marginLeft: -11, opacity: 0.45 },
});
