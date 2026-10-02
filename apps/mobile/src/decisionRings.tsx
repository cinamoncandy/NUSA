import React, { useEffect, useState } from "react";
import { AccessibilityInfo, StyleSheet, Text, View } from "react-native";
import { HoloSphere } from "./holoSphere";
import { useTheme } from "./ThemeProvider";
import { fieldFonts } from "./fieldFonts";
import { buildDecisionRings, type DecisionRingsInput } from "./decisionRingsModel";

// Home hero: the reported PAPER decision count over the NUSA holo sphere: a wave per new decision,
// a ring burst on each new PAPER order. Motion stops entirely when the OS reduce-motion setting is on.
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

  return <View style={styles.wrap} testID="home-decision-rings" accessibilityLabel={status && model.state === "UNKNOWN" ? `${status.title}. ${status.detail}` : `${model.headline}. ${model.detail}`}>
    {status ? <View style={[styles.status, { borderColor: status.tone === "halt" ? theme.colors.danger : theme.colors.warning }]} testID="home-decision-rings-status" accessibilityRole="alert">
      <Text style={[styles.statusTitle, { color: status.tone === "halt" ? theme.colors.danger : theme.colors.warning }]}>{status.title}</Text>
      <Text style={[styles.detail, { color: theme.colors.textMuted }]}>{status.detail}</Text>
    </View> : null}
    {model.state === "UNKNOWN" ? (status ? null : <Text style={[styles.pending, { color: theme.colors.textMuted }]} testID="home-decision-rings-count">{model.headline}</Text>) : <>
      <Text style={[fieldFonts.monoMedium, styles.count, { color: theme.colors.text }]} testID="home-decision-rings-count">{model.headline}</Text>
      <Text style={[styles.detail, { color: theme.colors.textMuted }]}>{model.detail}</Text>
    </>}
    <HoloSphere decisionCount={model.decisionCount} fillCount={model.paperOrderCount} tone={status?.tone === "halt" ? "halt" : status ? "hold" : "normal"} reducedMotion={reducedMotion} size={300} testID="home-holo" />
    <View style={styles.legend}>
      <Text style={[fieldFonts.mono, styles.legendText, { color: theme.colors.textMuted }]}>판단할 때마다 물결이 지나가고, 주문이 나가면 고리로 펼쳐집니다</Text>
      <Text style={[fieldFonts.mono, styles.legendText, { color: theme.colors.primary }]} testID="home-decision-rings-orders">PAPER 주문 {model.paperOrderCount == null ? "—" : model.paperOrderCount.toLocaleString("ko-KR")}건</Text>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", paddingVertical: 8, gap: 6 },
  status: { alignSelf: "stretch", borderWidth: 1, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 14, gap: 4, marginBottom: 6 },
  statusTitle: { fontSize: 15, fontWeight: "600" },
  pending: { fontSize: 14, textAlign: "center" },
  count: { fontSize: 34, fontWeight: "600", letterSpacing: -0.8 },
  detail: { fontSize: 13, textAlign: "center", maxWidth: 300, lineHeight: 19 },
  legend: { alignItems: "center", gap: 4 },
  legendText: { fontSize: 10.5 },
});
