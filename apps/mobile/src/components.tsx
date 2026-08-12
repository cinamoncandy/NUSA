import React, { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View, type TextInputProps } from "react-native";
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

export function NusaCard({ children, testID, raised = false }: Readonly<{ children: React.ReactNode; testID?: string; raised?: boolean }>) {
  const { theme } = useTheme();
  const tokens = cardTokens(theme);
  return <View style={[styles.card, { backgroundColor: raised ? theme.colors.surfaceRaised : tokens.background, borderColor: raised ? theme.colors.borderStrong : tokens.border, borderRadius: tokens.radius, padding: tokens.padding, shadowColor: tokens.shadow.color, shadowOffset: tokens.shadow.offset, shadowOpacity: raised ? Math.min(tokens.shadow.opacity + 0.05, 1) : tokens.shadow.opacity, shadowRadius: raised ? tokens.shadow.radius + 4 : tokens.shadow.radius, elevation: raised ? tokens.shadow.elevation + 1 : tokens.shadow.elevation }]} testID={testID}>{children}</View>;
}

export type StatusTone = "primary" | "success" | "warning" | "danger" | "info" | "neutral";

export function StatusChip({ label, tone = "neutral", testID }: Readonly<{ label: string; tone?: StatusTone; testID?: string }>) {
  const { theme } = useTheme();
  const foreground = tone === "primary" ? theme.colors.primary : tone === "success" ? theme.colors.success : tone === "warning" ? theme.colors.warning : tone === "danger" ? theme.colors.danger : tone === "info" ? theme.colors.info : theme.colors.textMuted;
  const background = tone === "primary" ? theme.colors.primarySoft : theme.colors.surfaceSunken;
  return <View testID={testID} style={[styles.chip, { backgroundColor: background, borderColor: tone === "neutral" ? theme.colors.border : foreground }]}><Text style={[styles.chipLabel, { color: foreground }]}>{label}</Text></View>;
}

export function WaveMark({ compact = false }: Readonly<{ compact?: boolean }>) {
  const { theme } = useTheme();
  const size = compact ? 30 : 42;
  const islandWidth = compact ? 17 : 24;
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[styles.islandMark, { width: size, height: size }]}>
      <View style={[styles.islandHalo, { width: size, height: size, borderColor: theme.colors.borderStrong }]} />
      <View style={[styles.islandHorizon, { width: compact ? 22 : 31, backgroundColor: theme.colors.info }]} />
      <View style={[styles.islandLand, { width: islandWidth, backgroundColor: theme.colors.primary }]} />
      <View style={[styles.islandBeacon, { backgroundColor: theme.colors.text }]} />
    </View>
  );
}

export function SectionHeading({ eyebrow, title, description }: Readonly<{ eyebrow?: string; title: string; description?: string }>) {
  const { theme } = useTheme();
  return <View style={styles.sectionHeading}>{eyebrow ? <Text style={[styles.eyebrow, { color: theme.colors.primary }]}>{eyebrow}</Text> : null}<Text style={[styles.sectionTitle, { color: theme.colors.text }]}>{title}</Text>{description ? <Text style={[styles.sectionDescription, { color: theme.colors.textMuted }]}>{description}</Text> : null}</View>;
}

export function AuthorityBanner({ detail = "AI에는 PAPER·LIVE 주문, 이체, 출금 또는 운영 상태 변경 권한이 없습니다. 실제 주문 권한은 없습니다." }: Readonly<{ detail?: string }>) {
  const { theme } = useTheme();
  return <View style={[styles.authority, { backgroundColor: theme.colors.primarySoft, borderColor: theme.colors.primary }]} testID="zero-authority-banner"><View style={styles.authorityTop}><Text style={[styles.authorityTitle, { color: theme.colors.text }]}>ZERO AUTHORITY</Text><StatusChip label="AI 읽기 전용" tone="info" /></View><Text style={[styles.authorityDetail, { color: theme.colors.textMuted }]}>{detail}</Text></View>;
}

export function DataRow({ label, value, emphasis = false, tone = "default" }: Readonly<{ label: string; value: string; emphasis?: boolean; tone?: "default" | "success" | "warning" | "danger" }>) {
  const { theme } = useTheme();
  const color = tone === "success" ? theme.colors.success : tone === "warning" ? theme.colors.warning : tone === "danger" ? theme.colors.danger : theme.colors.text;
  return <View accessible accessibilityLabel={`${label}: ${value}`} style={styles.dataRow}><Text style={[styles.dataLabel, { color: theme.colors.textMuted }]}>{label}</Text><Text style={[styles.dataValue, emphasis && styles.dataValueEmphasis, { color, fontWeight: emphasis ? theme.typography.weights.bold : theme.typography.weights.semibold }]}>{value}</Text></View>;
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
  islandMark: { alignItems: "center", justifyContent: "center", position: "relative" },
  islandHalo: { position: "absolute", borderWidth: 1, borderRadius: 9999, opacity: 0.72 },
  islandHorizon: { position: "absolute", height: 2, borderRadius: 9999, bottom: "37%", opacity: 0.82 },
  islandLand: { position: "absolute", height: 8, borderTopLeftRadius: 9999, borderTopRightRadius: 9999, borderBottomLeftRadius: 5, borderBottomRightRadius: 5, bottom: "33%", transform: [{ skewX: "-9deg" }] },
  islandBeacon: { position: "absolute", width: 3, height: 3, borderRadius: 9999, top: "25%", right: "27%", opacity: 0.92 },
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
});
