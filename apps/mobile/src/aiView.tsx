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
function AiState({ title, detail, testID, retry, loading = false }: Readonly<{ title: string; detail: string; testID: string; retry?: () => void; loading?: boolean }>) { const { theme } = useTheme(); return <View style={styles.state} testID={testID}><View style={styles.stateInner}>{loading ? <ActivityIndicator color={theme.colors.primary} /> : null}<InlineNotice title={title} detail={detail} tone={retry ? "danger" : "info"} />{retry ? <NusaButton label="다시 불러오기" onPress={retry} /> : null}</View></View>; }

export function AiView({ ai, research, health, liveAuthority, productionMutationAllowed, killSwitchActive, error, refreshing, onRefresh }: AiViewProps) {
  const { theme } = useTheme();
  if (error) return <AiState title="AI 상태를 표시할 수 없습니다" detail={error} testID="ai-error" retry={onRefresh} />;
  if (ai === null && research === null) return <AiState title="AI 상태를 불러오는 중" detail="검증된 읽기 전용 AI·리서치 스냅샷을 기다리고 있습니다." testID="ai-loading" loading />;

  const isCalibrated = ai?.calibrationStatus === "CALIBRATED";
  const trustedConfidence = isCalibrated ? percent(ai?.confidence) : "-";
  const verifiedConfidence = ai?.calibrationStatus === "CALIBRATED" ? percent(ai.confidence) : "-";
  const rawProbability = percent(ai?.rawProbability);
  const calibratedProbability = ai?.calibrationStatus === "CALIBRATED" ? percent(ai.calibratedProbability) : "-";
  const lastRun = ai?.lastModelRun == null ? "-" : new Date(ai.lastModelRun).toLocaleString("ko-KR");
  const analysisTone = statusTone(ai?.status);
  const evidenceCount = ai?.evidenceReferences.length ?? 0;
  const counterCount = ai?.counterEvidence.length ?? 0;
  const disagreementCount = ai?.disagreements.length ?? 0;
  const signalReady = ai?.status === "AVAILABLE" && isCalibrated && Boolean(ai?.thesis);
  const signalLabel = signalReady ? "VERIFIED SIGNAL" : "NO VERIFIED SIGNAL";
  const signalDetail = ai?.thesis ?? "현재 표시할 검증된 AI 분석이 없습니다.";

  return <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl tintColor={theme.colors.primary} refreshing={refreshing} onRefresh={onRefresh} />} testID="ai-screen">
    <ScreenHeader eyebrow="NUSA INTELLIGENCE" title="AI SIGNAL" description="검증된 관찰·근거·불확실성을 한 흐름으로 읽습니다. AI는 읽기 전용이며 주문 권한이 없습니다." statusLabel="READ ONLY" statusTone="primary" />

    <View style={[styles.signalStage, { borderColor: theme.colors.border, backgroundColor: theme.colors.surface }]} testID="ai-signal-stage">
      <View style={styles.stageHeader}>
        <View style={styles.stageIdentity}>
          <Text style={[styles.eyebrow, { color: theme.colors.primary }]}>AI SIGNAL · READ ONLY</Text>
          <Text style={[styles.stageTitle, { color: theme.colors.text }]}>{signalLabel}</Text>
        </View>
        <StatusChip label={ai?.status ?? "UNAVAILABLE"} tone={analysisTone} />
      </View>

      <View style={styles.stageThesis} testID="ai-thesis-card">
        <Text style={[styles.stageThesisLabel, { color: theme.colors.textMuted }]}>CURRENT THESIS</Text>
        <Text style={[styles.thesis, { color: ai?.thesis ? theme.colors.text : theme.colors.textMuted }]}>{signalDetail}</Text>
        {!signalReady ? <Text style={[styles.bandDetail, { color: theme.colors.textMuted }]}>근거와 보정 상태가 확인되기 전에는 신호를 만들지 않습니다.</Text> : null}
      </View>

      <View style={styles.confidenceBand} testID="ai-signal-confidence">
        <MetricTile label="검증 신뢰도" value={trustedConfidence} detail={isCalibrated ? "CALIBRATED CONFIDENCE" : "CALIBRATED CONFIDENCE · 보정 완료 전 숨김"} tone={isCalibrated ? "primary" : "warning"} testID="ai-verified-confidence" />
        <View style={[styles.stageDivider, { backgroundColor: theme.colors.borderStrong }]} />
        <View style={styles.stageMetric}>
          <Text style={[styles.bandLabel, { color: theme.colors.textMuted }]}>EVIDENCE</Text>
          <Text style={[styles.stageMetricValue, { color: theme.colors.text }]}>{evidenceCount}</Text>
          <Text style={[styles.bandDetail, { color: theme.colors.textMuted }]}>검증된 참조</Text>
        </View>
        <View style={styles.stageMetric}>
          <Text style={[styles.bandLabel, { color: theme.colors.textMuted }]}>COUNTER</Text>
          <Text style={[styles.stageMetricValue, { color: counterCount > 0 ? theme.colors.warning : theme.colors.text }]}>{counterCount}</Text>
          <Text style={[styles.bandDetail, { color: theme.colors.textMuted }]}>반대 근거</Text>
        </View>
        <View style={styles.stageMetric}>
          <Text style={[styles.bandLabel, { color: theme.colors.textMuted }]}>DISAGREEMENT</Text>
          <Text style={[styles.stageMetricValue, { color: disagreementCount > 0 ? theme.colors.warning : theme.colors.text }]}>{disagreementCount}</Text>
          <Text style={[styles.bandDetail, { color: theme.colors.textMuted }]}>분석 불일치</Text>
        </View>
      </View>

      <View style={styles.stageFooter} testID="ai-signal-evidence-strip">
        <Text style={[styles.stageFooterText, { color: theme.colors.textMuted }]}>최근 분석 {lastRun}</Text>
        <Text style={[styles.stageFooterText, { color: theme.colors.textMuted }]}>설명 검증 {ai?.explanationVerdict ?? "NOT_EVALUATED"}</Text>
        <Text style={[styles.stageFooterText, { color: theme.colors.textMuted }]}>불확실성 {ai?.uncertainty ?? "-"}</Text>
      </View>
    </View>

    <View style={styles.section} testID="ai-evidence-card">
      <View style={styles.sectionHeader}>
        <View><Text style={[styles.eyebrow, { color: theme.colors.textMuted }]}>EVIDENCE MAP</Text><Text style={[styles.sectionTitle, { color: theme.colors.text }]}>근거와 반대 신호</Text></View>
        <StatusChip label={`${evidenceCount} : ${counterCount}`} tone={counterCount > 0 ? "warning" : "neutral"} />
      </View>
      <View style={styles.evidenceGrid}>
        <View style={[styles.evidenceColumn, { borderColor: theme.colors.border }]}>
          <Text style={[styles.columnLabel, { color: theme.colors.success }]}>SUPPORTING EVIDENCE</Text>
          {ai && ai.evidenceReferences.length > 0 ? ai.evidenceReferences.slice(0, 4).map((item) => <Text key={item} style={[styles.evidence, { color: theme.colors.text }]} numberOfLines={3}>• {item}</Text>) : <Text style={[styles.body, { color: theme.colors.textMuted }]}>검증된 근거 참조가 없습니다.</Text>}
          {ai && ai.evidenceReferences.length > 4 ? <Text style={[styles.more, { color: theme.colors.textMuted }]}>외 {ai.evidenceReferences.length - 4}개 근거</Text> : null}
        </View>
        <View style={[styles.evidenceColumn, { borderColor: theme.colors.border }]}>
          <Text style={[styles.columnLabel, { color: theme.colors.warning }]}>COUNTER EVIDENCE</Text>
          {ai && ai.counterEvidence.length > 0 ? ai.counterEvidence.slice(0, 4).map((item, index) => <Text key={`${index}-${item}`} style={[styles.evidence, { color: theme.colors.text }]} numberOfLines={3}>• {item}</Text>) : <Text style={[styles.body, { color: theme.colors.textMuted }]}>등록된 반대 근거가 없습니다.</Text>}
        </View>
      </View>
      {ai && ai.disagreements.length > 0 ? <View style={[styles.disagreement, { borderTopColor: theme.colors.border }]}><Text style={[styles.columnLabel, { color: theme.colors.warning }]}>MODEL DISAGREEMENT</Text>{ai.disagreements.slice(0, 3).map((item, index) => <Text key={`${index}-${item}`} style={[styles.evidence, { color: theme.colors.warning }]} numberOfLines={3}>• {item}</Text>)}</View> : null}
    </View>

    <View style={styles.detailGrid}>
      <View style={styles.detailCell}>
        <NusaCard testID="ai-research-card">
          <View style={styles.cardHeader}><View><Text style={[styles.eyebrow, { color: theme.colors.primary }]}>RESEARCH PIPELINE</Text><Text style={[styles.cardTitle, { color: theme.colors.text }]}>리서치 상태</Text></View><StatusChip label={research?.health ?? "UNAVAILABLE"} tone={research?.health === "HEALTHY" ? "success" : research?.health === "FAIL_CLOSED" ? "danger" : "warning"} /></View>
          <Text style={[styles.cardLead, { color: theme.colors.textMuted }]}>AI 신호와 분리된 연구 파이프라인입니다. 후보는 검증을 통과하기 전 PAPER 권한을 얻지 않습니다.</Text>
          <DataRow label="현재 PAPER 전략" value={research?.champion.strategyId ?? "-"} />
          <DataRow label="현재 전략 권한" value={research?.champion.authority ?? "-"} emphasis />
          <DataRow label="검증 후보 전략" value={research?.challenger.strategyId ?? "-"} />
          <DataRow label="연구 후보" value={research == null ? "-" : String(research.candidateCount)} />
          <DataRow label="실험" value={research == null ? "-" : String(research.experimentCount)} />
        </NusaCard>
      </View>

      <View style={styles.detailCell}>
        <NusaCard testID="ai-diagnostics-card">
          <View style={styles.cardHeader}><View><Text style={[styles.eyebrow, { color: theme.colors.textMuted }]}>CALIBRATION DETAILS</Text><Text style={[styles.cardTitle, { color: theme.colors.text }]}>신뢰도 진단</Text></View><StatusChip label={ai?.calibrationStatus ?? "UNKNOWN"} tone={isCalibrated ? "success" : "warning"} /></View>
          <Text style={[styles.cardLead, { color: theme.colors.textMuted }]}>원시 모델 확률은 미보정 모델 출력이며 검증된 성공 확률이나 성과 보장이 아닙니다. CALIBRATED일 때만 별도의 검증 신뢰도와 보정 확률을 표시합니다.</Text>
          <DataRow label="교정 상태" value={ai?.calibrationStatus ?? "-"} />
          <DataRow label="검증 신뢰도" value={verifiedConfidence} emphasis />
          <DataRow label="보정 표본" value={ai?.calibrationSampleCount == null ? "-" : String(ai.calibrationSampleCount)} />
          <DataRow label="보정 확률" value={calibratedProbability} />
          <DataRow label="원시 모델 확률 (미보정)" value={rawProbability} />
          <DataRow label="ECE" value={metric(ai?.calibrationExpectedError)} />
          <DataRow label="Brier" value={metric(ai?.calibrationBrierScore)} />
          <DataRow label="비판 위험도" value={ai?.criticSeverity ?? "-"} tone={severityTone(ai?.criticSeverity ?? null)} />
          <DataRow label="설명 신뢰성 검증" value={ai?.explanationVerdict ?? "NOT_EVALUATED"} tone={ai?.explanationVerdict === "PASS" ? "default" : ai?.explanationVerdict === "ABSTAIN" ? "warning" : "default"} />
          <DataRow label="참고한 과거 사례" value={ai?.recentLessonCount == null ? "-" : String(ai.recentLessonCount)} />
          <DataRow label="시나리오 강건성" value={ai?.scenarioRobustnessState ?? "NOT_EVALUATED"} tone={ai?.scenarioRobustnessState === "ROBUST" ? "default" : ai?.scenarioRobustnessState === "SENSITIVE" || ai?.scenarioRobustnessState === "CONTRADICTORY" ? "warning" : "default"} />
        </NusaCard>
      </View>
    </View>

    <View style={styles.safetyLead} testID="ai-zero-authority-status"><StatusChip label="AI ZERO AUTHORITY" tone="info" />
      <View><Text style={[styles.eyebrow, { color: theme.colors.info }]}>SAFETY BOUNDARY</Text><Text style={[styles.sectionTitle, { color: theme.colors.text }]}>판단 보조와 실행 권한을 분리합니다</Text></View>
    </View>
    <InlineNotice title="AI 분석은 판단 보조입니다" detail="AI에는 PAPER·LIVE 주문, 이체, 출금 또는 운영 변경 권한이 없습니다. 성과를 보장하지 않습니다." tone="info" />
    <NusaCard testID="ai-authority-card">
      <View style={styles.cardHeader}><View><Text style={[styles.eyebrow, { color: theme.colors.info }]}>ZERO AUTHORITY</Text><Text style={[styles.cardTitle, { color: theme.colors.text }]}>AI 권한</Text></View><StatusChip label={health ?? "UNKNOWN"} tone={health === "HEALTHY" ? "success" : "warning"} /></View>
      <DataRow label="AI LIVE 권한" value={liveAuthority ?? "-"} emphasis />
      <DataRow label="Production mutation" value={productionMutationAllowed == null ? "-" : "금지"} tone={productionMutationAllowed === false ? "success" : "default"} />
      <DataRow label="킬 스위치" value={killSwitchActive == null ? "-" : killSwitchActive ? "활성" : "비활성"} tone={killSwitchActive === true ? "danger" : killSwitchActive === false ? "success" : "default"} />
    </NusaCard>
  </ScrollView>;
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingTop: 20, gap: 20, paddingBottom: 44, width: "100%", maxWidth: uxLayout.maxWorkspaceWidth, alignSelf: "center" },
  state: { flex: 1, justifyContent: "center", padding: 20, alignItems: "center" },
  stateInner: { width: "100%", maxWidth: 720, gap: 12 },
  signalStage: { minHeight: 470, borderWidth: 1, borderRadius: 18, padding: 20, gap: 22, justifyContent: "space-between" },
  stageHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" },
  stageIdentity: { gap: 4 },
  eyebrow: { fontSize: 10, lineHeight: 15, fontWeight: "800", letterSpacing: 1.1 },
  stageTitle: { fontSize: 16, lineHeight: 22, fontWeight: "800", letterSpacing: 0.2 },
  stageThesis: { flexGrow: 1, justifyContent: "center", gap: 10, maxWidth: 920 },
  stageThesisLabel: { fontSize: 10, lineHeight: 15, fontWeight: "800", letterSpacing: 1.2 },
  thesis: { fontSize: 27, lineHeight: 38, fontWeight: "700", letterSpacing: -0.8 },
  confidenceBand: { flexDirection: "row", flexWrap: "wrap", alignItems: "stretch", gap: 16 },
  confidencePrimary: { minWidth: 180, flexGrow: 1, gap: 4 },
  bandLabel: { fontSize: 9, lineHeight: 14, fontWeight: "800", letterSpacing: 1 },
  confidenceValue: { fontSize: 36, lineHeight: 42, fontWeight: "800", letterSpacing: -1.1 },
  bandDetail: { fontSize: 10, lineHeight: 15, fontWeight: "600" },
  stageDivider: { width: 1, minHeight: 68, opacity: 0.22 },
  stageMetric: { minWidth: 96, flexGrow: 1, gap: 3, justifyContent: "center" },
  stageMetricValue: { fontSize: 24, lineHeight: 30, fontWeight: "800", letterSpacing: -0.6 },
  stageFooter: { flexDirection: "row", flexWrap: "wrap", gap: 14 },
  stageFooterText: { fontSize: 10, lineHeight: 16, fontWeight: "600" },
  section: { gap: 16, paddingVertical: 4 },
  sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" },
  sectionTitle: { marginTop: 4, fontSize: 19, lineHeight: 25, fontWeight: "800", letterSpacing: -0.4 },
  evidenceGrid: { flexDirection: "row", flexWrap: "wrap", gap: 14 },
  evidenceColumn: { flexGrow: 1, flexBasis: 300, borderWidth: 1, borderRadius: 14, padding: 16, minHeight: 160 },
  columnLabel: { fontSize: 10, lineHeight: 15, fontWeight: "800", letterSpacing: 0.8, marginBottom: 8 },
  evidence: { fontSize: 13, lineHeight: 20, marginBottom: 7 },
  more: { fontSize: 11, lineHeight: 16, fontWeight: "600", marginTop: 3 },
  disagreement: { paddingTop: 14, borderTopWidth: 1 },
  detailGrid: { flexDirection: "row", flexWrap: "wrap", gap: 14, alignItems: "flex-start" },
  detailCell: { flexGrow: 1, flexBasis: 440, gap: 14 },
  cardHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 10, flexWrap: "wrap" },
  cardTitle: { marginTop: 4, fontSize: 18, fontWeight: "700", letterSpacing: -0.4 },
  cardLead: { fontSize: 12, lineHeight: 19, marginBottom: 8 },
  body: { fontSize: 13, lineHeight: 20 },
  safetyLead: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", gap: 12, flexWrap: "wrap", paddingTop: 4 }
});