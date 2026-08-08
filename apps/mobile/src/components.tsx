import React from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { buttonTokens, cardTokens, fieldTokens, type ButtonTone } from "./designSystem";
import { useTheme } from "./ThemeProvider";

export interface NusaButtonProps {
  readonly label: string;
  readonly onPress: () => void;
  readonly disabled?: boolean;
  readonly tone?: ButtonTone;
  readonly accessibilityLabel?: string;
  readonly testID?: string;
}

export function NusaButton({ label, onPress, disabled = false, tone = "primary", accessibilityLabel, testID }: NusaButtonProps) {
  const { theme } = useTheme();
  const tokens = buttonTokens(theme, tone);
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [styles.button, { backgroundColor: tokens.background, borderColor: tokens.border, borderRadius: tokens.radius, minHeight: tokens.minHeight, paddingHorizontal: tokens.horizontalPadding, opacity: disabled ? tokens.disabledOpacity : pressed ? 0.82 : 1 }]}
    >
      <Text style={[styles.buttonLabel, { color: tokens.foreground, fontWeight: theme.typography.weights.bold }]}>{label}</Text>
    </Pressable>
  );
}

export interface NusaTextFieldProps {
  readonly label: string;
  readonly value: string;
  readonly onChangeText: (value: string) => void;
  readonly placeholder?: string;
  readonly secureTextEntry?: boolean;
  readonly accessibilityLabel?: string;
  readonly testID?: string;
}

export function NusaTextField({ label, value, onChangeText, placeholder, secureTextEntry = false, accessibilityLabel, testID }: NusaTextFieldProps) {
  const { theme } = useTheme();
  const tokens = fieldTokens(theme);
  return (
    <View style={styles.fieldGroup}>
      <Text style={[styles.fieldLabel, { color: theme.colors.textMuted, fontSize: theme.typography.caption }]}>{label}</Text>
      <TextInput
        accessibilityLabel={accessibilityLabel ?? label}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={tokens.placeholder}
        secureTextEntry={secureTextEntry}
        style={[styles.field, { backgroundColor: tokens.background, borderColor: tokens.border, borderRadius: tokens.radius, color: tokens.foreground, minHeight: tokens.minHeight }]}
        testID={testID}
        value={value}
      />
    </View>
  );
}

export function NusaCard({ children, testID, raised = false }: Readonly<{ children: React.ReactNode; testID?: string; raised?: boolean }>) {
  const { theme } = useTheme();
  const tokens = cardTokens(theme);
  return <View style={[styles.card, { backgroundColor: raised ? theme.colors.surfaceRaised : tokens.background, borderColor: raised ? theme.colors.borderStrong : tokens.border, borderRadius: tokens.radius, padding: tokens.padding, shadowColor: tokens.shadow.color, shadowOffset: tokens.shadow.offset, shadowOpacity: tokens.shadow.opacity, shadowRadius: tokens.shadow.radius, elevation: tokens.shadow.elevation }]} testID={testID}>{children}</View>;
}

export type StatusTone = "primary" | "success" | "warning" | "danger" | "info" | "neutral";

export function StatusChip({ label, tone = "neutral", testID }: Readonly<{ label: string; tone?: StatusTone; testID?: string }>) {
  const { theme } = useTheme();
  const foreground = tone === "primary" ? theme.colors.primary : tone === "success" ? theme.colors.success : tone === "warning" ? theme.colors.warning : tone === "danger" ? theme.colors.danger : tone === "info" ? theme.colors.info : theme.colors.textMuted;
  return <View testID={testID} style={[styles.chip, { backgroundColor: theme.colors.surfaceSunken, borderColor: tone === "neutral" ? theme.colors.border : foreground }]}><Text style={[styles.chipLabel, { color: foreground }]}>{label}</Text></View>;
}

export function WaveMark({ compact = false }: Readonly<{ compact?: boolean }>) {
  const { theme } = useTheme();
  const widths = compact ? [22, 28, 20] : [30, 38, 26];
  return <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.waveMark}>{widths.map((width, index) => <View key={width + index} style={[styles.waveLine, { width, backgroundColor: index === 1 ? theme.colors.primary : theme.colors.info, opacity: 1 - index * 0.18 }]} />)}</View>;
}

export function SectionHeading({ eyebrow, title, description }: Readonly<{ eyebrow?: string; title: string; description?: string }>) {
  const { theme } = useTheme();
  return <View style={styles.sectionHeading}>{eyebrow ? <Text style={[styles.eyebrow, { color: theme.colors.primary }]}>{eyebrow}</Text> : null}<Text style={[styles.sectionTitle, { color: theme.colors.text }]}>{title}</Text>{description ? <Text style={[styles.sectionDescription, { color: theme.colors.textMuted }]}>{description}</Text> : null}</View>;
}

export function AuthorityBanner({ detail = "AI와 모바일 화면은 분석·조회만 수행합니다. 실제 주문 권한은 없습니다." }: Readonly<{ detail?: string }>) {
  const { theme } = useTheme();
  return <View style={[styles.authority, { backgroundColor: theme.colors.primarySoft, borderColor: theme.colors.primary }]} testID="zero-authority-banner"><View style={styles.authorityTop}><Text style={[styles.authorityTitle, { color: theme.colors.text }]}>ZERO AUTHORITY</Text><StatusChip label="UI 주문 경로 없음" tone="info" /></View><Text style={[styles.authorityDetail, { color: theme.colors.textMuted }]}>{detail}</Text></View>;
}

export function DataRow({ label, value, emphasis = false, tone = "default" }: Readonly<{ label: string; value: string; emphasis?: boolean; tone?: "default" | "success" | "warning" | "danger" }>) {
  const { theme } = useTheme();
  const color = tone === "success" ? theme.colors.success : tone === "warning" ? theme.colors.warning : tone === "danger" ? theme.colors.danger : theme.colors.text;
  return <View style={styles.dataRow}><Text style={[styles.dataLabel, { color: theme.colors.textMuted }]}>{label}</Text><Text style={[styles.dataValue, { color, fontWeight: emphasis ? theme.typography.weights.bold : theme.typography.weights.semibold }]}>{value}</Text></View>;
}

const styles = StyleSheet.create({
  button: { alignItems: "center", justifyContent: "center", borderWidth: 1 },
  buttonLabel: { fontSize: 15, letterSpacing: -0.1 },
  card: { borderWidth: 1 },
  field: { borderWidth: 1, paddingHorizontal: 16, paddingVertical: 12, fontSize: 16 },
  fieldGroup: { gap: 7 },
  fieldLabel: { fontWeight: "600" },
  chip: { borderWidth: 1, borderRadius: 9999, paddingHorizontal: 10, paddingVertical: 5, alignSelf: "flex-start" },
  chipLabel: { fontSize: 11, fontWeight: "700", letterSpacing: 0.15 },
  waveMark: { gap: 4, alignItems: "flex-start", justifyContent: "center" },
  waveLine: { height: 3, borderRadius: 9999 },
  sectionHeading: { gap: 5 },
  eyebrow: { fontSize: 10, fontWeight: "700", letterSpacing: 1.5 },
  sectionTitle: { fontSize: 24, fontWeight: "700", letterSpacing: -0.7 },
  sectionDescription: { fontSize: 14, lineHeight: 21 },
  authority: { borderWidth: 1, borderRadius: 14, padding: 14, gap: 9 },
  authorityTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  authorityTitle: { fontSize: 13, fontWeight: "800", letterSpacing: 1.1 },
  authorityDetail: { fontSize: 13, lineHeight: 19 },
  dataRow: { minHeight: 30, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  dataLabel: { flex: 1, fontSize: 13 },
  dataValue: { flexShrink: 1, textAlign: "right", fontSize: 13 },
});
