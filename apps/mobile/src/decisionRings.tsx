import React, { useEffect, useState } from "react";
import { AccessibilityInfo, StyleSheet, Text, View } from "react-native";
import { HoloSphere } from "./holoSphere";
import { useTheme } from "./ThemeProvider";
import { fieldFonts } from "./fieldFonts";
import { buildDecisionRings, type DecisionRingsInput } from "./decisionRingsModel";
import { fieldHero, fieldRadii } from "./designSystem";
import { holoChipPlacement } from "./holoModel";

// Home hero: the reported PAPER decision count over the NUSA holo sphere: a wave per new decision,
// a ring burst on each new PAPER order. Motion stops entirely when the OS reduce-motion setting is on.
export interface DecisionRingsStatus {
  readonly title: string;
  readonly detail: string;
  readonly tone: "warning" | "halt";
}

const HERO_SIZE = 300;
const MARKET_CHIP = /^KRW-[A-Z0-9-]{1,16}$/;

export function DecisionRings({ status = null, marketLabel = null, ...props }: DecisionRingsInput & { readonly status?: DecisionRingsStatus | null; /** The market the PAPER runtime trades; shown as a chip where the fill line lands. */ readonly marketLabel?: string | null }) {
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
    <View style={{ width: HERO_SIZE, height: HERO_SIZE }}>
      <HoloSphere decisionCount={model.decisionCount} fillCount={model.paperOrderCount} tone={status?.tone === "halt" ? "halt" : status ? "hold" : "normal"} reducedMotion={reducedMotion} size={HERO_SIZE} testID="home-holo" />
      {marketLabel != null && MARKET_CHIP.test(marketLabel) && status == null ? <View style={[styles.chip, holoChipPlacement(HERO_SIZE, marketLabel)]} testID="home-hero-market" pointerEvents="none">
        <Text style={[fieldFonts.monoMedium, styles.chipText]}>{marketLabel}</Text>
      </View> : null}
    </View>
    <View style={styles.legend}>
      <Text style={[fieldFonts.mono, styles.legendText, { color: theme.colors.textMuted }]}>판단마다 핵에서 빛이 퍼지고, 주문이 나가면 종목까지 선이 이어집니다</Text>
      <Text style={[fieldFonts.mono, styles.legendText, { color: fieldHero.lime }]} testID="home-decision-rings-orders">PAPER 주문 {model.paperOrderCount == null ? "—" : model.paperOrderCount.toLocaleString("ko-KR")}건</Text>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", paddingVertical: 8, gap: 6 },
  status: { alignSelf: "stretch", borderWidth: 1, borderRadius: fieldRadii.md, paddingVertical: 10, paddingHorizontal: 14, gap: 4, marginBottom: 6 },
  statusTitle: { fontSize: 15, fontWeight: "600" },
  pending: { fontSize: 14, textAlign: "center" },
  count: { fontSize: 34, fontWeight: "600", letterSpacing: -0.8 },
  detail: { fontSize: 13, textAlign: "center", maxWidth: 300, lineHeight: 19 },
  legend: { alignItems: "center", gap: 4 },
  chip: { position: "absolute", paddingVertical: 3, paddingHorizontal: 7, borderRadius: 3, borderWidth: 1, borderColor: fieldHero.limeChipBorder, backgroundColor: fieldHero.chipGround },
  chipText: { fontSize: 11, color: fieldHero.lime },
  legendText: { fontSize: 10.5 },
});
