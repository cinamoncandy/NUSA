import React, { useEffect, useState } from "react";
import { AccessibilityInfo, StyleSheet, Text, View } from "react-native";
import { ContourCore } from "./contourCore";
import { useTheme } from "./ThemeProvider";
import { fieldFonts } from "./fieldFonts";
import { buildDecisionRings, type DecisionRingsInput } from "./decisionRingsModel";

// Home hero: the reported PAPER decision count over the contour core, which aligns once per
// new decision. Motion stops entirely when the OS reduce-motion setting is on.
export interface DecisionRingsStatus {
  readonly title: string;
  readonly detail: string;
  readonly tone: "warning" | "halt";
}

export function DecisionRings({ status = null, ...props }: DecisionRingsInput & { readonly status?: DecisionRingsStatus | null }) {
  const { theme } = useTheme();
  const model = buildDecisionRings(props);
  const [reducedMotion, setReducedMotion] = useState(true);
  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then((v) => { if (mounted) setReducedMotion(v); }).catch(() => { if (mounted) setReducedMotion(false); });
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", setReducedMotion);
    return () => { mounted = false; sub.remove(); };
  }, []);

  return <View style={styles.wrap} testID="home-decision-rings" accessibilityLabel={`${model.headline}. ${model.detail}`}>
    {status ? <View style={[styles.status, { borderColor: status.tone === "halt" ? theme.colors.danger : theme.colors.warning }]} testID="home-decision-rings-status" accessibilityRole="alert">
      <Text style={[styles.statusTitle, { color: status.tone === "halt" ? theme.colors.danger : theme.colors.warning }]}>{status.title}</Text>
      <Text style={[styles.detail, { color: theme.colors.textMuted }]}>{status.detail}</Text>
    </View> : null}
    <Text style={[fieldFonts.monoMedium, styles.count, { color: theme.colors.text }]} testID="home-decision-rings-count">{model.headline}</Text>
    <Text style={[styles.detail, { color: theme.colors.textMuted }]}>{model.detail}</Text>
    <ContourCore decisionCount={model.decisionCount} reducedMotion={reducedMotion} innerColor={theme.colors.primary} outerColor={theme.colors.info} pulseColor={theme.colors.warning} coreColor={theme.colors.text} />
    <View style={styles.legend}>
      <Text style={[fieldFonts.mono, styles.legendText, { color: theme.colors.textMuted }]}>판단할 때마다 고리가 한 번 정렬됩니다</Text>
      <Text style={[fieldFonts.mono, styles.legendText, { color: theme.colors.primary }]} testID="home-decision-rings-orders">PAPER 주문 {model.paperOrderCount == null ? "—" : model.paperOrderCount.toLocaleString("ko-KR")}건</Text>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", paddingVertical: 8, gap: 6 },
  status: { alignSelf: "stretch", borderWidth: 1, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 14, gap: 4, marginBottom: 6 },
  statusTitle: { fontSize: 15, fontWeight: "600" },
  count: { fontSize: 34, fontWeight: "600", letterSpacing: -0.8 },
  detail: { fontSize: 13, textAlign: "center", maxWidth: 300, lineHeight: 19 },
  legend: { alignItems: "center", gap: 4 },
  legendText: { fontSize: 10.5 },
});
