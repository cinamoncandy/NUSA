import React from "react";
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import type { AiReadOnlyProjection } from "../../../packages/contracts/src/aiInference";
import type { ResearchStatusProjection } from "../../../packages/contracts/src/researchAutomation";
import { DataRow, NusaButton, NusaCard, StatusChip } from "./components";
import { InlineNotice, MetricTile, ScreenHeader } from "./uxPrimitives";
import { useTheme } from "./ThemeProvider";

interface AiViewProps { readonly ai: AiReadOnlyProjection | null; readonly research: ResearchStatusProjection | null; readonly health: string | null; readonly liveAuthority: "NONE" | null; readonly productionMutationAllowed: false | null; readonly killSwitchActive: boolean | null; readonly error: string | null; readonly refreshing: boolean; readonly onRefresh: () => void; }
function statusTone(status: AiReadOnlyProjection["status"] | undefined): "success" | "warning" | "neutral" { return status === "AVAILABLE" ? "success" : status === "INCOMPLETE" ? "warning" : "neutral"; }
function severityTone(severity: AiReadOnlyProjection["criticSeverity"]): "danger" | "warning" | "default" { if (severity === "critical" || severity === "high") return "danger"; if (severity === "medium") return "warning"; return "default"; }
function percent(value: number | null | undefined): string { return value == null || !Number.isFinite(value) ? "-" : `${Math.round(value * 100)}%`; }
function metric(value: number | null | undefined): string { return value == null || !Number.isFinite(value) ? "-" : value.toFixed(3); }

function AiState({ title, detail, testID, retry, loading = false }: Readonly<{ title: string; detail: string; testID: string; retry?: () => void; loading?: boolean }>) {
  const { theme } = useTheme();
  return <View style={styles.state} testID={testID}><View style={styles.stateInner}>{loading ? <ActivityIndicator color={theme.colors.primary} /> : null}<InlineNotice title={title} detail={detail} tone={retry ? "danger" : "info"} />{retry ? <NusaButton label="다시 불러오기" onPress={retry} /> : null}</View></View>;
}

export function AiView({ ai, research, health, liveAuthority, productionMutationAllowed, killSwitchActive, error, refreshing, onRefresh }: AiViewProps) {
  const { theme } = useTheme();
  if (error) return <AiState title="AI 상태를 표시할 수 없습니다" detail={error} testID="ai-error" retry={onRefresh} />;
  if (ai === null && research === null) return <AiState title="AI 상태를 불러오는 중" detail="검증된 읽기 전용 AI·리서치 스냅샷을 기다리고 있습니다." testID="ai-loading" loading />;

  const trustedConfidence = ai?.calibrationStatus === "CALIBRATED" ? percent(ai.confidence) : "-";
  const rawProbability = percent(ai?.rawProbability);
  const calibratedProbability = ai?.calibrationStatus === "CALIBRATED" ? percent(ai.calibratedProbability) : "-";
  const lastRun = ai?.lastModelRun == null ? "-" : new Date(ai.lastModelRun).toLocaleString("ko-KR");
  const analysisTone = statusTone(ai?.status);

  return <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl tintColor={theme.colors.primary} refreshing={refreshing} onRefresh={onRefresh} />} testID="ai-screen">
    <ScreenHeader eyebrow="AI INTELLIGENCE" title="AI" description="검증된 분석과 신뢰도, 근거와 반대 근거를 읽기 전용으로 확인합니다." statusLabel={ai?.status ?? "UNAVAILABLE"} statusTone={analysisTone} />
    <View style={styles.authorityRow}><StatusChip label="AI ZERO AUTHORITY" tone="info" /><StatusChip label="READ ONLY" tone="primary" /></View>

    <NusaCard raised testID="ai-thesis-card"><View style={styles.cardHeader}><View><Text style={[styles.cardEyebrow, { color: theme.colors.primary }]}>CURRENT ANALYSIS</Text><Text style={[styles.cardTitle, { color: theme.colors.text }]}>현재 분석</Text></View><StatusChip label={ai?.status ?? "UNAVAILABLE"} tone={analysisTone} /></View><Text style={[styles.thesis, { color: ai?.thesis ? theme.colors.text : theme.colors.textMuted }]}>{ai?.thesis ?? "현재 표시할 검증된 AI 분석이 없습니다."}</Text><Text style={[styles.body, { color: theme.colors.textMuted }]}>이 분석은 주문 권한이 없는 읽기 전용 참고 정보입니다.</Text></NusaCard>

    <View style={styles.metricGrid}>
      <MetricTile label="원시 모델 확률" value={rawProbability} detail="미보정 모델 출력" tone="neutral" testID="ai-raw-probability" />
      <MetricTile label="검증 신뢰도" value={trustedConfidence} detail={ai?.calibrationStatus === "CALIBRATED" ? "보정 완료" : "보정되지 않음"} tone={ai?.calibrationStatus === "CALIBRATED" ? "success" : "warning"} testID="ai-trusted-confidence" />
      <MetricTile label="보정 확률" value={calibratedProbability} detail={`표본 ${ai?.calibrationSampleCount ?? 0}`} tone="info" testID="ai-calibrated-probability" />
    </View>

    <InlineNotice title="확률은 성과 보장이 아닙니다" detail="원시 모델 확률은 미보정 출력입니다. CALIBRATED 상태일 때만 검증 신뢰도를 별도로 표시합니다." tone="info" />

    <View style={styles.detailGrid}><View style={styles.detailCell}><NusaCard testID="ai-evidence-card"><View style={styles.cardHeader}><View><Text style={[styles.cardEyebrow, { color: theme.colors.textMuted }]}>EVIDENCE</Text><Text style={[styles.cardTitle, { color: theme.colors.text }]}>근거와 반대 근거</Text></View><StatusChip label={`${ai?.evidenceReferences.length ?? 0} 근거`} tone="neutral" /></View>
      <Text style={[styles.label, { color: theme.colors.textMuted }]}>근거</Text>{ai && ai.evidenceReferences.length > 0 ? ai.evidenceReferences.slice(0, 5).map((item) => <Text key={item} style={[styles.evidence, { color: theme.colors.text }]} numberOfLines={3}>• {item}</Text>) : <Text style={[styles.body, { color: theme.colors.textMuted }]}>검증된 근거 참조가 없습니다.</Text>}
      <Text style={[styles.label, styles.sectionGap, { color: theme.colors.textMuted }]}>반대 근거</Text>{ai && ai.counterEvidence.length > 0 ? ai.counterEvidence.slice(0, 5).map((item, index) => <Text key={`${index}-${item}`} style={[styles.evidence, { color: theme.colors.text }]} numberOfLines={3}>• {item}</Text>) : <Text style={[styles.body, { color: theme.colors.textMuted }]}>등록된 반대 근거가 없습니다.</Text>}
      {ai && ai.disagreements.length > 0 ? <><Text style={[styles.label, styles.sectionGap, { color: theme.colors.textMuted }]}>분석 간 불일치</Text>{ai.disagreements.slice(0, 4).map((item, index) => <Text key={`${index}-${item}`} style={[styles.evidence, { color: theme.colors.warning }]} numberOfLines={3}>• {item}</Text>)}</> : null}
    </NusaCard></View>

    <View style={styles.detailCell}><NusaCard testID="ai-diagnostics-card"><View style={styles.cardHeader}><View><Text style={[styles.cardEyebrow, { color: theme.colors.textMuted }]}>DIAGNOSTICS</Text><Text style={[styles.cardTitle, { color: theme.colors.text }]}>신뢰도 진단</Text></View></View><DataRow label="보정 상태" value={ai?.calibrationStatus ?? "UNKNOWN"} /><DataRow label="ECE" value={metric(ai?.calibrationExpectedError)} /><DataRow label="Brier" value={metric(ai?.calibrationBrierScore)} /><DataRow label="불확실성" value={ai?.uncertainty ?? "-"} /><DataRow label="비판 위험도" value={ai?.criticSeverity ?? "-"} tone={severityTone(ai?.criticSeverity ?? null)} /><DataRow label="최근 분석" value={lastRun} /></NusaCard>

    <NusaCard testID="ai-research-card"><View style={styles.cardHeader}><View><Text style={[styles.cardEyebrow, { color: theme.colors.textMuted }]}>RESEARCH</Text><Text style={[styles.cardTitle, { color: theme.colors.text }]}>리서치 상태</Text></View><StatusChip label={research?.health ?? "UNAVAILABLE"} tone={research?.health === "HEALTHY" ? "success" : research?.health === "FAIL_CLOSED" ? "danger" : "warning"} /></View><DataRow label="현재 PAPER 전략" value={research?.champion.strategyId ?? "-"} /><DataRow label="현재 전략 권한" value={research?.champion.authority ?? "-"} emphasis /><DataRow label="검증 후보 전략" value={research?.challenger.strategyId ?? "-"} /><DataRow label="연구 후보" value={research == null ? "-" : String(research.candidateCount)} /><DataRow label="실험" value={research == null ? "-" : String(research.experimentCount)} /></NusaCard>

    <NusaCard testID="ai-authority-card"><View style={styles.cardHeader}><View><Text style={[styles.cardEyebrow, { color: theme.colors.info }]}>AUTHORITY</Text><Text style={[styles.cardTitle, { color: theme.colors.text }]}>운영 경계</Text></View><StatusChip label={health ?? "UNKNOWN"} tone={health === "HEALTHY" ? "success" : "warning"} /></View><DataRow label="AI LIVE 권한" value={liveAuthority ?? "-"} emphasis /><DataRow label="Production mutation" value={productionMutationAllowed == null ? "-" : "금지"} tone={productionMutationAllowed === false ? "success" : "default"} /><DataRow label="킬 스위치" value={killSwitchActive == null ? "-" : killSwitchActive ? "활성" : "비활성"} tone={killSwitchActive === true ? "danger" : killSwitchActive === false ? "success" : "default"} /><Text style={[styles.body, { color: theme.colors.textMuted }]}>AI에는 PAPER·LIVE 주문, 이체, 출금 또는 운영 변경 권한이 없습니다.</Text></NusaCard></View></View>
  </ScrollView>;
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingTop: 20, gap: 16, paddingBottom: 36, width: "100%", maxWidth: 1080, alignSelf: "center" }, state: { flex: 1, justifyContent: "center", padding: 20, alignItems: "center" }, stateInner: { width: "100%", maxWidth: 720, gap: 12 }, authorityRow: { flexDirection: "row", flexWrap: "wrap", gap: 7 }, metricGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 }, detailGrid: { flexDirection: "row", flexWrap: "wrap", gap: 14, alignItems: "flex-start" }, detailCell: { flexGrow: 1, flexBasis: 440, gap: 14 }, cardHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 10 }, cardEyebrow: { fontSize: 10, fontWeight: "800", letterSpacing: 1.1, marginBottom: 4 }, cardTitle: { fontSize: 18, fontWeight: "700", letterSpacing: -0.4 }, thesis: { fontSize: 18, lineHeight: 27, fontWeight: "600", marginBottom: 8 }, label: { fontSize: 11, fontWeight: "800", letterSpacing: 0.7, marginBottom: 6 }, evidence: { fontSize: 13, lineHeight: 20, marginBottom: 5 }, body: { fontSize: 13, lineHeight: 20, marginTop: 8 }, sectionGap: { marginTop: 14 },
});