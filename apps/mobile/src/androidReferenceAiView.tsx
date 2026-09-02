import React from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { useTheme } from "./ThemeProvider";
import { AiView as LegacyAiView } from "./aiViewLegacy";

type Props = React.ComponentProps<typeof LegacyAiView>;

function Caption({ children, accent = false }: Readonly<{ children: React.ReactNode; accent?: boolean }>) {
  const { theme } = useTheme();
  return <Text style={[styles.caption, { color: accent ? theme.colors.primary : theme.colors.textMuted }]}>{children}</Text>;
}

function AuthorityRow({ label, value, positive = false }: Readonly<{ label: string; value: string; positive?: boolean }>) {
  const { theme } = useTheme();
  return <View style={[styles.authorityRow, { borderTopColor: theme.colors.border }]}><Text style={[styles.authorityLabel, { color: theme.colors.textMuted }]}>{label}</Text><Text style={[styles.authorityValue, { color: positive ? theme.colors.primary : theme.colors.text }]}>{value}</Text></View>;
}

export function AndroidReferenceAiView(props: Props) {
  const { theme } = useTheme();
  const ai = props.ai;
  const trustedConfidence = ai?.calibrationStatus === "CALIBRATED" && ai.confidence != null && Number.isFinite(ai.confidence)
    ? `${Math.round(ai.confidence * 100)}%`
    : "—";
  const lastRun = ai?.lastModelRun == null ? "—" : new Date(ai.lastModelRun).toLocaleString("ko-KR");
  const available = ai?.status === "AVAILABLE";
  const evidence = ai?.evidenceReferences ?? [];
  const counter = ai?.counterEvidence ?? [];

  return <ScrollView
    style={{ backgroundColor: theme.colors.background }}
    contentContainerStyle={styles.content}
    refreshControl={<RefreshControl tintColor={theme.colors.primary} refreshing={props.refreshing} onRefresh={props.onRefresh} />}
    testID="ai-screen"
  >
    <View style={styles.brandBlock}>
      <Text style={[styles.wordmark, { color: theme.colors.text }]}>NUSA</Text>
      <Text style={[styles.productLine, { color: theme.colors.textMuted }]}>Autonomous Investment Intelligence OS</Text>
      <View style={styles.titleRow}><View><Text style={[styles.pageTitle, { color: theme.colors.text }]}>NUSA 판단 단계</Text><Caption>DECISION STAGE</Caption></View><Text style={[styles.readOnly, { color: theme.colors.primary }]}>READ ONLY</Text></View>
    </View>

    <View style={[styles.hero, { borderColor: theme.colors.borderStrong, backgroundColor: theme.colors.surface }]} testID="android-ai-decision-stage">
      <View style={styles.heroHeader}><View><Caption accent>NUSA AI DECISION</Caption><Text style={[styles.heroState, { color: available ? theme.colors.primary : theme.colors.textMuted }]}>{available ? "VERIFIED" : "WAITING"}</Text></View><Text style={[styles.updated, { color: theme.colors.textMuted }]}>{lastRun}</Text></View>
      <Text style={[styles.thesis, { color: theme.colors.text }]}>{available && ai?.thesis ? ai.thesis : "검증된 판단을 기다리고 있습니다."}</Text>
      <View style={styles.heroBody}>
        <View accessible accessibilityLabel={`검증 신뢰도 ${trustedConfidence}`} style={[styles.confidenceRing, { borderColor: ai?.calibrationStatus === "CALIBRATED" ? theme.colors.primary : theme.colors.borderStrong }]}>
          <Text style={[styles.confidenceLabel, { color: theme.colors.textMuted }]}>CONFIDENCE</Text>
          <Text style={[styles.confidenceValue, { color: theme.colors.text }]}>{trustedConfidence}</Text>
          <Text style={[styles.calibration, { color: theme.colors.textMuted }]}>{ai?.calibrationStatus ?? "UNVERIFIED"}</Text>
        </View>
        <View style={styles.heroFacts}>
          <View style={styles.fact}><Caption>KEY EVIDENCE</Caption><Text style={[styles.factValue, { color: theme.colors.text }]}>{evidence.length}</Text></View>
          <View style={styles.fact}><Caption>COUNTER</Caption><Text style={[styles.factValue, { color: theme.colors.text }]}>{counter.length}</Text></View>
          <View style={styles.fact}><Caption>UNCERTAINTY</Caption><Text style={[styles.factValueSmall, { color: theme.colors.text }]}>{ai?.uncertainty ?? "—"}</Text></View>
        </View>
      </View>
    </View>

    <View style={[styles.panel, { borderColor: theme.colors.border, backgroundColor: theme.colors.surface }]} testID="android-ai-evidence">
      <View style={styles.sectionHeader}><View><Text style={[styles.sectionTitle, { color: theme.colors.text }]}>핵심 근거</Text><Caption>KEY EVIDENCE</Caption></View><Text style={[styles.count, { color: theme.colors.primary }]}>{evidence.length}</Text></View>
      {evidence.length > 0 ? evidence.slice(0, 5).map((item, index) => <View key={`${index}-${item}`} style={[styles.evidenceRow, { borderTopColor: theme.colors.border }]}><Text style={[styles.bullet, { color: theme.colors.primary }]}>•</Text><Text style={[styles.evidenceText, { color: theme.colors.text }]}>{item}</Text></View>) : <Text style={[styles.empty, { color: theme.colors.textMuted }]}>검증된 근거 참조가 없습니다.</Text>}
    </View>

    <View style={[styles.panel, { borderColor: theme.colors.border, backgroundColor: theme.colors.surface }]} testID="android-ai-counter-evidence">
      <View style={styles.sectionHeader}><View><Text style={[styles.sectionTitle, { color: theme.colors.text }]}>반대 근거</Text><Caption>COUNTER EVIDENCE</Caption></View><Text style={[styles.count, { color: counter.length > 0 ? theme.colors.warning : theme.colors.textMuted }]}>{counter.length}</Text></View>
      {counter.length > 0 ? counter.slice(0, 4).map((item, index) => <View key={`${index}-${item}`} style={[styles.evidenceRow, { borderTopColor: theme.colors.border }]}><Text style={[styles.bullet, { color: theme.colors.warning }]}>•</Text><Text style={[styles.evidenceText, { color: theme.colors.text }]}>{item}</Text></View>) : <Text style={[styles.empty, { color: theme.colors.textMuted }]}>등록된 반대 근거가 없습니다.</Text>}
    </View>

    <View style={[styles.panel, { borderColor: theme.colors.border, backgroundColor: theme.colors.surface }]} testID="android-ai-invalidation">
      <View style={styles.sectionHeader}><View><Text style={[styles.sectionTitle, { color: theme.colors.text }]}>무효화 조건</Text><Caption>INVALIDATION</Caption></View></View>
      <Text style={[styles.empty, { color: theme.colors.textMuted }]}>현재 canonical AI projection에는 전용 invalidation 필드가 없습니다. 시안용 가격·조건을 임의 생성하지 않습니다.</Text>
    </View>

    <View style={[styles.nextActionPanel, { borderColor: theme.colors.borderStrong, backgroundColor: theme.colors.surface }]}>
      <Caption accent>NEXT ACTION</Caption>
      <Text style={[styles.nextAction, { color: theme.colors.text }]}>근거와 반대 근거를 검토한 뒤 사용자가 결정합니다.</Text>
      <Text style={[styles.nextMeta, { color: theme.colors.textMuted }]}>AI는 판단 보조이며 주문·이체·출금·운영 변경 권한이 없습니다.</Text>
    </View>

    <View style={[styles.panel, { borderColor: theme.colors.border, backgroundColor: theme.colors.surface }]} testID="android-ai-research">
      <View style={styles.sectionHeader}><View><Text style={[styles.sectionTitle, { color: theme.colors.text }]}>리서치 상태</Text><Caption>RESEARCH</Caption></View><Text style={[styles.count, { color: props.research?.health === "HEALTHY" ? theme.colors.primary : theme.colors.textMuted }]}>{props.research?.health ?? "—"}</Text></View>
      <AuthorityRow label="현재 PAPER 전략" value={props.research?.champion.strategyId ?? "—"} />
      <AuthorityRow label="전략 권한" value={props.research?.champion.authority ?? "—"} />
      <AuthorityRow label="연구 후보" value={props.research == null ? "—" : String(props.research.candidateCount)} />
      <AuthorityRow label="실험" value={props.research == null ? "—" : String(props.research.experimentCount)} />
    </View>

    <View style={[styles.panel, { borderColor: theme.colors.borderStrong, backgroundColor: theme.colors.surface }]} testID="android-ai-authority">
      <View style={styles.sectionHeader}><View><Text style={[styles.sectionTitle, { color: theme.colors.text }]}>권한 · 안전</Text><Caption>AUTHORITY & SAFETY</Caption></View><Text style={[styles.count, { color: theme.colors.warning }]}>FAIL CLOSED</Text></View>
      <AuthorityRow label="AI AUTHORITY" value="ZERO" positive />
      <AuthorityRow label="LIVE AUTHORITY" value={props.liveAuthority ?? "NONE"} />
      <AuthorityRow label="PRODUCTION MUTATION" value={props.productionMutationAllowed === false ? "DISABLED" : "—"} />
      <AuthorityRow label="KILL SWITCH" value={props.killSwitchActive == null ? "—" : props.killSwitchActive ? "ACTIVE" : "INACTIVE"} />
      <AuthorityRow label="SYSTEM HEALTH" value={props.health ?? "—"} />
    </View>

    {props.error ? <View style={[styles.errorPanel, { borderColor: theme.colors.danger }]}><Text style={[styles.errorTitle, { color: theme.colors.danger }]}>AI 상태를 표시할 수 없습니다</Text><Text style={[styles.empty, { color: theme.colors.textMuted }]}>{props.error}</Text></View> : null}

    <Text style={[styles.footer, { color: theme.colors.textMuted }]}>판단 · 근거 · 통제 · ZERO AUTHORITY</Text>
  </ScrollView>;
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 18, paddingTop: 20, paddingBottom: 36, gap: 16, width: "100%", maxWidth: 620, alignSelf: "center" },
  brandBlock: { gap: 4, paddingBottom: 4 },
  wordmark: { fontFamily: "serif", fontSize: 34, lineHeight: 40, fontWeight: "400", letterSpacing: 4.2 },
  productLine: { fontFamily: "serif", fontSize: 11, lineHeight: 17, letterSpacing: 0.5 },
  titleRow: { marginTop: 16, flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", gap: 12 },
  pageTitle: { fontSize: 18, lineHeight: 24, fontWeight: "500", letterSpacing: -0.2 },
  readOnly: { fontSize: 8, lineHeight: 12, fontWeight: "700", letterSpacing: 1.2 },
  caption: { fontSize: 8, lineHeight: 12, fontWeight: "600", letterSpacing: 1.1 },
  hero: { borderWidth: 1, borderRadius: 8, padding: 16, gap: 18 },
  heroHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 },
  heroState: { marginTop: 4, fontSize: 12, lineHeight: 17, fontWeight: "700", letterSpacing: 0.9 },
  updated: { fontSize: 8, lineHeight: 12, fontVariant: ["tabular-nums"] },
  thesis: { fontFamily: "serif", fontSize: 31, lineHeight: 41, fontWeight: "400", letterSpacing: -0.8 },
  heroBody: { flexDirection: "row", alignItems: "center", gap: 18 },
  confidenceRing: { width: 132, height: 132, borderRadius: 66, borderWidth: 8, alignItems: "center", justifyContent: "center" },
  confidenceLabel: { fontSize: 7, lineHeight: 10, letterSpacing: 1 },
  confidenceValue: { marginTop: 5, fontSize: 34, lineHeight: 38, fontWeight: "300", fontVariant: ["tabular-nums"] },
  calibration: { marginTop: 4, fontSize: 7, lineHeight: 10, letterSpacing: 0.6 },
  heroFacts: { flex: 1, gap: 10 },
  fact: { minHeight: 48, justifyContent: "space-between", paddingBottom: 7, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "rgba(255,255,255,0.08)" },
  factValue: { fontSize: 20, lineHeight: 25, fontWeight: "500", fontVariant: ["tabular-nums"] },
  factValueSmall: { fontSize: 12, lineHeight: 18, fontWeight: "500" },
  panel: { borderWidth: 1, borderRadius: 8, padding: 15, gap: 10 },
  sectionHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 10 },
  sectionTitle: { fontSize: 15, lineHeight: 20, fontWeight: "600" },
  count: { fontSize: 9, lineHeight: 13, fontWeight: "700", letterSpacing: 0.7 },
  evidenceRow: { minHeight: 44, borderTopWidth: StyleSheet.hairlineWidth, paddingVertical: 10, flexDirection: "row", gap: 8 },
  bullet: { width: 10, fontSize: 13, lineHeight: 18 },
  evidenceText: { flex: 1, fontSize: 11, lineHeight: 18 },
  empty: { fontSize: 11, lineHeight: 18 },
  nextActionPanel: { borderWidth: 1, borderRadius: 8, padding: 16, gap: 7 },
  nextAction: { fontFamily: "serif", fontSize: 20, lineHeight: 29, fontWeight: "400" },
  nextMeta: { fontSize: 10, lineHeight: 16 },
  authorityRow: { minHeight: 42, borderTopWidth: StyleSheet.hairlineWidth, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  authorityLabel: { flex: 1, fontSize: 10, lineHeight: 15 },
  authorityValue: { flexShrink: 1, textAlign: "right", fontSize: 11, lineHeight: 16, fontWeight: "600", fontVariant: ["tabular-nums"] },
  errorPanel: { borderWidth: 1, borderRadius: 8, padding: 14, gap: 6 },
  errorTitle: { fontSize: 12, lineHeight: 17, fontWeight: "700" },
  footer: { fontFamily: "serif", textAlign: "center", fontSize: 10, lineHeight: 18, letterSpacing: 0.5, paddingTop: 4 },
});
