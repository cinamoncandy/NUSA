import React from "react";
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import type { AiReadOnlyProjection } from "../../../packages/contracts/src/aiInference";
import type { ResearchStatusProjection } from "../../../packages/contracts/src/researchAutomation";
import { DataRow, NusaButton, NusaCard, StatusChip } from "./components";
import { InlineNotice, MetricTile, ScreenHeader } from "./uxPrimitives";
import { useTheme } from "./ThemeProvider";
import { uxLayout } from "./uxLayout";

interface AiViewProps { readonly ai: AiReadOnlyProjection | null; readonly research: ResearchStatusProjection | null; readonly health: string | null; readonly liveAuthority: "NONE" | null; readonly productionMutationAllowed: false | null; readonly killSwitchActive: boolean | null; readonly error: string | null; readonly refreshing: boolean; readonly onRefresh: () => void; }
function statusTone(status: AiReadOnlyProjection["status"] | undefined): "success" | "warning" | "neutral" { return status === "AVAILABLE" ? "success" : status === "INCOMPLETE" ? "warning" : "neutral"; }
function severityTone(severity: AiReadOnlyProjection["criticSeverity"]): "danger" | "warning" | "default" { if (severity === "critical" || severity === "high") return "danger"; if (severity === "medium") return "warning"; return "default"; }
function percent(value: number | null | undefined): string { return value == null || !Number.isFinite(value) ? "-" : `${Math.round(value * 100)}%`; }
function metric(value: number | null | undefined): string { return value == null || !Number.isFinite(value) ? "-" : value.toFixed(3); }

// Plain-language labels for verdict/status enums so the fields meant to build trust in the AI
// aren't the only ones left as raw English tokens in an otherwise fully Korean screen.
const calibrationStatusLabel: Record<string, string> = { UNKNOWN: "알 수 없음", UNVERIFIED: "미검증", INSUFFICIENT_DATA: "표본 부족", CALIBRATED: "보정 완료", DEGRADED: "성능 저하" };
const explanationVerdictLabel: Record<string, string> = { PASS: "검증 통과", ABSTAIN: "판단 보류", NOT_EVALUATED: "평가 안 됨" };
const scenarioRobustnessLabel: Record<string, string> = { ROBUST: "강건함", SENSITIVE: "민감함", CONTRADICTORY: "모순 발견", INCOMPLETE: "불완전", UNVERIFIED: "미검증", NOT_EVALUATED: "평가 안 됨" };
const learningProvenanceLabel: Record<string, string> = { AUTO_BACKGROUND: "백그라운드 자동 실행", USER_TRIGGERED: "사용자 요청", UNKNOWN: "알 수 없음" };
function labelOf(map: Record<string, string>, value: string | null | undefined): string { return value == null ? "-" : (map[value] ?? value); }
function AiState({ title, detail, testID, retry, loading = false }: Readonly<{ title: string; detail: string; testID: string; retry?: () => void; loading?: boolean }>) { const { theme } = useTheme(); return <View style={styles.state} testID={testID}><View style={styles.stateInner}>{loading ? <ActivityIndicator color={theme.colors.primary} /> : null}<InlineNotice title={title} detail={detail} tone={retry ? "danger" : "info"} />{retry ? <NusaButton label="다시 불러오기" onPress={retry} /> : null}</View></View>; }

export function AiView({ ai, research, health, liveAuthority, productionMutationAllowed, killSwitchActive, error, refreshing, onRefresh }: AiViewProps) {
  const { theme } = useTheme();
  if (error) return <AiState title="AI 상태를 표시할 수 없습니다" detail={error} testID="ai-error" retry={onRefresh} />;
  if (ai === null && research === null) return <AiState title="AI 상태를 불러오는 중" detail="검증된 읽기 전용 AI·리서치 스냅샷을 기다리고 있습니다." testID="ai-loading" loading />;

  const trustedConfidence = ai?.calibrationStatus === "CALIBRATED" ? percent(ai.confidence) : "-";
  const rawProbability = percent(ai?.rawProbability);
  const calibratedProbability = ai?.calibrationStatus === "CALIBRATED" ? percent(ai.calibratedProbability) : "-";
  const lastRun = ai?.lastModelRun == null ? "-" : new Date(ai.lastModelRun).toLocaleString("ko-KR");
  const analysisTone = statusTone(ai?.status);
  const evidenceCount = ai?.evidenceReferences.length ?? 0;
  const counterCount = ai?.counterEvidence.length ?? 0;
  const learningProvenance = ai?.learningProvenance ?? "UNKNOWN";
  const learningProvenanceDetail = learningProvenance === "AUTO_BACKGROUND"
    ? "검증된 실행 근거에 따라 백그라운드 자동 실행으로 분류되었습니다."
    : learningProvenance === "USER_TRIGGERED"
      ? "검증된 실행 근거에 따라 사용자 요청으로 분류되었습니다."
      : "실행 근거가 확인되지 않아 출처를 분류하지 않습니다.";

  return <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl tintColor={theme.colors.primary} refreshing={refreshing} onRefresh={onRefresh} />} testID="ai-screen">
    <ScreenHeader eyebrow="NUSA INTELLIGENCE" title="AI" description="현재 관찰과 근거를 읽기 전용으로 제공합니다. AI는 주문 권한이 없습니다." statusLabel="READ ONLY" statusTone="primary" />

    <View testID="ai-now">
      <View style={styles.hero} testID="ai-thesis-card">
        <View style={styles.heroTop}><View><Text accessibilityRole="header" style={[styles.eyebrow, { color: theme.colors.primary }]}>NOW</Text><Text style={[styles.heroTitle, { color: theme.colors.text }]}>현재 관찰</Text></View><StatusChip label={ai?.status ?? "UNAVAILABLE"} tone={analysisTone} /></View>
        <Text style={[styles.thesis, { color: ai?.thesis ? theme.colors.text : theme.colors.textMuted }]}>{ai?.thesis ?? "현재 표시할 검증된 AI 분석이 없습니다."}</Text>
        <View style={styles.heroMeta}><Text style={[styles.meta, { color: theme.colors.textMuted }]}>신뢰 수준 {trustedConfidence}</Text><Text style={[styles.meta, { color: theme.colors.textMuted }]}>근거 {evidenceCount} · 반대 {counterCount}</Text><Text style={[styles.meta, { color: theme.colors.textMuted }]}>최근 분석 {lastRun}</Text></View>
      </View>
    </View>

    <View testID="ai-why"><View style={styles.evidenceSection} testID="ai-evidence-card"><View style={styles.sectionHeader}><View><Text accessibilityRole="header" style={[styles.eyebrow, { color: theme.colors.textMuted }]}>WHY</Text><Text style={[styles.sectionTitle, { color: theme.colors.text }]}>근거와 반대 신호</Text></View></View><View style={styles.evidenceGrid}><View style={styles.evidenceColumn}><Text style={[styles.columnLabel, { color: theme.colors.success }]}>핵심 근거</Text>{ai && ai.evidenceReferences.length > 0 ? ai.evidenceReferences.slice(0, 4).map((item) => <Text key={item} style={[styles.evidence, { color: theme.colors.text }]} numberOfLines={3}>• {item}</Text>) : <Text style={[styles.body, { color: theme.colors.textMuted }]}>검증된 근거 참조가 없습니다.</Text>}</View><View style={styles.evidenceColumn}><Text style={[styles.columnLabel, { color: theme.colors.warning }]}>반대 신호</Text>{ai && ai.counterEvidence.length > 0 ? ai.counterEvidence.slice(0, 4).map((item, index) => <Text key={`${index}-${item}`} style={[styles.evidence, { color: theme.colors.text }]} numberOfLines={3}>• {item}</Text>) : <Text style={[styles.body, { color: theme.colors.textMuted }]}>등록된 반대 근거가 없습니다.</Text>}</View></View>{ai && ai.disagreements.length > 0 ? <View style={styles.disagreement}><Text style={[styles.columnLabel, { color: theme.colors.warning }]}>분석 간 불일치</Text>{ai.disagreements.slice(0, 3).map((item, index) => <Text key={`${index}-${item}`} style={[styles.evidence, { color: theme.colors.warning }]} numberOfLines={3}>• {item}</Text>)}</View> : null}{ai && ai.evidenceReferences.length > 4 ? <Text style={[styles.body, { color: theme.colors.textMuted }]}>외 {ai.evidenceReferences.length - 4}개 근거</Text> : null}</View></View>

    <View style={styles.decisionSection} testID="ai-result">
      <View style={styles.sectionHeader}><View><Text accessibilityRole="header" style={[styles.eyebrow, { color: theme.colors.textMuted }]}>RESULT</Text><Text style={[styles.sectionTitle, { color: theme.colors.text }]}>검증된 출력과 연구 상태</Text></View></View>
      <View style={styles.metricGrid}>
        <MetricTile label="검증 신뢰도" value={trustedConfidence} detail={ai?.calibrationStatus === "CALIBRATED" ? "보정 완료" : "보정 필요"} tone={ai?.calibrationStatus === "CALIBRATED" ? "success" : "warning"} testID="ai-trusted-confidence" />
        <MetricTile label="근거" value={String(evidenceCount)} detail="검증된 참조" tone="info" />
        <MetricTile label="반대 신호" value={String(counterCount)} detail="반대 근거" tone={counterCount > 0 ? "warning" : "default"} />
      </View>
      <NusaCard testID="ai-research-card"><View style={styles.cardHeader}><View><Text style={[styles.cardTitle, { color: theme.colors.text }]}>리서치 상태</Text></View><StatusChip label={research?.health ?? "UNAVAILABLE"} tone={research?.health === "HEALTHY" ? "success" : research?.health === "FAIL_CLOSED" ? "danger" : "warning"} /></View><DataRow label="현재 PAPER 전략" value={research?.champion.strategyId ?? "-"} /><DataRow label="현재 전략 권한" value={research?.champion.authority ?? "-"} emphasis /><DataRow label="검증 후보 전략" value={research?.challenger.strategyId ?? "-"} /><DataRow label="연구 후보" value={research == null ? "-" : String(research.candidateCount)} /><DataRow label="실험" value={research == null ? "-" : String(research.experimentCount)} /></NusaCard>
      <Text style={[styles.body, { color: theme.colors.textMuted }]}>이 화면은 읽기 전용 결과만 표시합니다. AI 결과에서 LIVE 주문이나 Production mutation으로 이어지는 실행 경로는 없습니다.</Text>
    </View>

    <View style={styles.decisionSection} testID="ai-risk">
      <View style={styles.sectionHeader}><View><Text accessibilityRole="header" style={[styles.eyebrow, { color: theme.colors.textMuted }]}>RISK</Text><Text style={[styles.sectionTitle, { color: theme.colors.text }]}>불확실성과 권한 경계</Text></View></View>
      <View style={styles.detailGrid}><View style={styles.detailCell}><NusaCard testID="ai-diagnostics-card"><View style={styles.cardHeader}><View><Text style={[styles.cardTitle, { color: theme.colors.text }]}>신뢰도 진단</Text></View></View><Text style={[styles.body, { color: theme.colors.textMuted }]}>원시 모델 확률은 미보정 모델 출력이며, 검증된 성공 확률이나 성과 보장이 아닙니다. CALIBRATED일 때만 별도의 검증 신뢰도와 보정 확률을 표시합니다.</Text><DataRow label="보정 상태" value={labelOf(calibrationStatusLabel, ai?.calibrationStatus ?? "UNKNOWN")} /><DataRow label="보정 표본" value={ai?.calibrationSampleCount == null ? "-" : String(ai.calibrationSampleCount)} /><DataRow label="보정 확률" value={calibratedProbability} /><DataRow label="원시 모델 확률 (미보정)" value={rawProbability} /><DataRow label="ECE" value={metric(ai?.calibrationExpectedError)} /><DataRow label="Brier" value={metric(ai?.calibrationBrierScore)} /><DataRow label="불확실성" value={ai?.uncertainty ?? "-"} /><DataRow label="비판 위험도" value={ai?.criticSeverity ?? "-"} tone={severityTone(ai?.criticSeverity ?? null)} /><DataRow label="설명 신뢰성 검증" value={labelOf(explanationVerdictLabel, ai?.explanationVerdict ?? "NOT_EVALUATED")} tone={ai?.explanationVerdict === "PASS" ? "default" : ai?.explanationVerdict === "ABSTAIN" ? "warning" : "default"} /></NusaCard></View></View>
      <InlineNotice title="AI 분석은 판단 보조입니다" detail="AI에는 PAPER·LIVE 주문, 이체, 출금 또는 운영 변경 권한이 없습니다. 성과를 보장하지 않습니다." tone="info" />
      <View testID="ai-zero-authority-status"><StatusChip label="AI ZERO AUTHORITY" tone="info" /></View>
      <View style={styles.detailGrid}><View style={styles.detailCell}><NusaCard testID="ai-authority-card"><View style={styles.cardHeader}><View><Text style={[styles.cardTitle, { color: theme.colors.text }]}>AI 권한</Text></View><StatusChip label={health ?? "UNKNOWN"} tone={health === "HEALTHY" ? "success" : "warning"} /></View><DataRow label="AI 권한" value="ZERO_AUTHORITY" emphasis /><DataRow label="AI LIVE 권한" value={liveAuthority ?? "-"} emphasis /><DataRow label="Production mutation" value={productionMutationAllowed == null ? "-" : "금지"} tone={productionMutationAllowed === false ? "success" : "default"} /><DataRow label="킬 스위치" value={killSwitchActive == null ? "-" : killSwitchActive ? "활성" : "비활성"} tone={killSwitchActive === true ? "danger" : killSwitchActive === false ? "success" : "default"} /></NusaCard></View></View>
    </View>

    <View style={styles.decisionSection} testID="ai-learning">
      <View style={styles.sectionHeader}><View><Text accessibilityRole="header" style={[styles.eyebrow, { color: theme.colors.textMuted }]}>LEARNING</Text><Text style={[styles.sectionTitle, { color: theme.colors.text }]}>실제 판단에 사용된 학습 근거</Text></View></View>
      <NusaCard testID="ai-learning-card"><DataRow label="참고한 과거 사례" value={ai?.recentLessonCount == null ? "-" : String(ai.recentLessonCount)} /><DataRow label="시나리오 강건성" value={labelOf(scenarioRobustnessLabel, ai?.scenarioRobustnessState ?? "NOT_EVALUATED")} tone={ai?.scenarioRobustnessState === "ROBUST" ? "default" : ai?.scenarioRobustnessState === "SENSITIVE" || ai?.scenarioRobustnessState === "CONTRADICTORY" ? "warning" : "default"} /><View testID="ai-learning-provenance" accessible accessibilityRole="text" accessibilityLabel={`학습 근거 출처 ${labelOf(learningProvenanceLabel, learningProvenance)}`}><DataRow label="학습 근거 출처" value={labelOf(learningProvenanceLabel, learningProvenance)} /></View></NusaCard>
      <InlineNotice title="학습 근거 출처" detail={learningProvenanceDetail} tone="info" />
    </View>
  </ScrollView>;
}

const styles = StyleSheet.create({ content: { paddingHorizontal: 20, paddingTop: 20, gap: 20, paddingBottom: 44, width: "100%", maxWidth: uxLayout.maxWorkspaceWidth, alignSelf: "center" }, state: { flex: 1, justifyContent: "center", padding: 20, alignItems: "center" }, stateInner: { width: "100%", maxWidth: 720, gap: 12 }, hero: { paddingVertical: 10, gap: 13 }, heroTop: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }, eyebrow: { fontSize: 10, lineHeight: 15, fontWeight: "800", letterSpacing: 1.1 }, heroTitle: { marginTop: 4, fontSize: 20, lineHeight: 26, fontWeight: "800", letterSpacing: -0.4 }, thesis: { fontSize: 25, lineHeight: 35, fontWeight: "700", letterSpacing: -0.75 }, heroMeta: { flexDirection: "row", flexWrap: "wrap", gap: 12 }, meta: { fontSize: 11, lineHeight: 17, fontWeight: "600" }, metricGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 }, evidenceSection: { gap: 14, paddingVertical: 4 }, decisionSection: { gap: 14, paddingVertical: 4 }, sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }, sectionTitle: { marginTop: 4, fontSize: 19, lineHeight: 25, fontWeight: "800", letterSpacing: -0.4 }, evidenceGrid: { flexDirection: "row", flexWrap: "wrap", gap: 20 }, evidenceColumn: { flexGrow: 1, flexBasis: 300 }, columnLabel: { fontSize: 11, lineHeight: 16, fontWeight: "800", letterSpacing: 0.7, marginBottom: 7 }, evidence: { fontSize: 13, lineHeight: 20, marginBottom: 6 }, disagreement: { paddingTop: 4 }, detailGrid: { flexDirection: "row", flexWrap: "wrap", gap: 14, alignItems: "flex-start" }, detailCell: { flexGrow: 1, flexBasis: 440, gap: 14 }, cardHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 10 }, cardTitle: { marginTop: 4, fontSize: 18, fontWeight: "700", letterSpacing: -0.4 }, body: { fontSize: 13, lineHeight: 20, marginTop: 8 } });
