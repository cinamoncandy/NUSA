import React from "react";
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import type { AiReadOnlyProjection, ResearchStatusProjection } from "./aiViewModel";
import { AuthorityBanner, DataRow, NusaButton, NusaCard, SectionHeading, StatusChip } from "./components";
import { useTheme } from "./ThemeProvider";

interface AiViewProps {
  readonly ai: AiReadOnlyProjection | null;
  readonly research: ResearchStatusProjection | null;
  readonly health: string | null;
  readonly liveAuthority: "NONE" | null;
  readonly productionMutationAllowed: false | null;
  readonly killSwitchActive: boolean | null;
  readonly error: string | null;
  readonly refreshing: boolean;
  readonly onRefresh: () => void;
}

function statusTone(status: AiReadOnlyProjection["status"] | undefined): "success" | "warning" | "neutral" {
  return status === "AVAILABLE" ? "success" : status === "INCOMPLETE" ? "warning" : "neutral";
}

function severityTone(severity: AiReadOnlyProjection["criticSeverity"]): "danger" | "warning" | "default" {
  if (severity === "critical" || severity === "high") return "danger";
  if (severity === "medium") return "warning";
  return "default";
}

function percent(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) ? "-" : `${Math.round(value * 100)}%`;
}

function metric(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) ? "-" : value.toFixed(3);
}

function AiState({ title, detail, testID, retry, loading = false }: Readonly<{ title: string; detail: string; testID: string; retry?: () => void; loading?: boolean }>) {
  const { theme } = useTheme();
  return <View style={styles.state} testID={testID}>
    <NusaCard>
      {loading ? <ActivityIndicator color={theme.colors.primary} /> : null}
      <Text style={[styles.stateTitle, { color: theme.colors.text }]}>{title}</Text>
      <Text style={[styles.body, { color: theme.colors.textMuted }]}>{detail}</Text>
      {retry ? <NusaButton label="다시 불러오기" onPress={retry} /> : null}
    </NusaCard>
  </View>;
}

export function AiView({ ai, research, health, liveAuthority, productionMutationAllowed, killSwitchActive, error, refreshing, onRefresh }: AiViewProps) {
  const { theme } = useTheme();

  if (error) return <AiState title="AI 상태를 표시할 수 없습니다" detail={error} testID="ai-error" retry={onRefresh} />;
  if (ai === null && research === null) return <AiState title="AI 상태를 불러오는 중" detail="검증된 읽기 전용 AI·리서치 스냅샷을 기다리고 있습니다." testID="ai-loading" loading />;

  const trustedConfidence = ai?.calibrationStatus === "CALIBRATED" ? percent(ai.confidence) : "-";
  const rawProbability = percent(ai?.rawProbability);
  const calibratedProbability = ai?.calibrationStatus === "CALIBRATED" ? percent(ai.calibratedProbability) : "-";
  const lastRun = ai?.lastModelRun == null ? "-" : new Date(ai.lastModelRun).toLocaleString("ko-KR");

  return <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl tintColor={theme.colors.primary} refreshing={refreshing} onRefresh={onRefresh} />} testID="ai-screen">
    <SectionHeading eyebrow="AI RESEARCH" title="AI 인텔리전스" description="검증된 근거와 불확실성을 읽습니다. 주문·이체·LIVE 실행 권한은 없습니다." />
    <View style={styles.statusRow}>
      <StatusChip label="ZERO AUTHORITY" tone="info" />
      <StatusChip label="READ ONLY" tone="primary" />
      <StatusChip label={ai?.status ?? "UNAVAILABLE"} tone={statusTone(ai?.status)} />
    </View>
    <AuthorityBanner detail="AI는 분석·비판·불확실성 설명만 제공합니다. Risk Governor, P0, kill switch, HALT를 우회하거나 주문을 승인할 수 없습니다." />

    <NusaCard raised testID="ai-thesis-card">
      <View style={styles.cardHeader}><View><Text style={[styles.eyebrow, { color: theme.colors.info }]}>CURRENT ANALYSIS</Text><Text style={[styles.cardTitle, { color: theme.colors.text }]}>현재 분석</Text></View><StatusChip label={ai?.status ?? "UNAVAILABLE"} tone={statusTone(ai?.status)} /></View>
      <Text style={[styles.thesis, { color: ai?.thesis ? theme.colors.text : theme.colors.textMuted }]}>{ai?.thesis ?? "현재 표시할 검증된 AI 분석이 없습니다."}</Text>
      <DataRow label="원시 모델 확률 (미보정)" value={rawProbability} />
      <DataRow label="검증 신뢰도" value={trustedConfidence} emphasis={ai?.calibrationStatus === "CALIBRATED"} />
      <DataRow label="보정 확률" value={calibratedProbability} />
      <DataRow label="보정 상태" value={ai?.calibrationStatus ?? "UNKNOWN"} />
      <DataRow label="보정 표본" value={ai?.calibrationSampleCount == null ? "-" : String(ai.calibrationSampleCount)} />
      <DataRow label="ECE" value={metric(ai?.calibrationExpectedError)} />
      <DataRow label="Brier" value={metric(ai?.calibrationBrierScore)} />
      <DataRow label="불확실성" value={ai?.uncertainty ?? "-"} />
      <DataRow label="비판 위험도" value={ai?.criticSeverity ?? "-"} tone={severityTone(ai?.criticSeverity ?? null)} />
      <DataRow label="최근 분석" value={lastRun} />
      <Text style={[styles.body, { color: theme.colors.textMuted }]}>원시 모델 확률은 미보정 모델 출력이며 검증된 성공 확률이나 성과 보장이 아닙니다. 보정 상태가 CALIBRATED일 때만 별도의 검증 신뢰도를 표시합니다.</Text>
    </NusaCard>

    <NusaCard testID="ai-evidence-card">
      <View style={styles.cardHeader}><Text style={[styles.cardTitle, { color: theme.colors.text }]}>근거와 반대 근거</Text><StatusChip label={`${ai?.evidenceReferences.length ?? 0} 근거`} tone="neutral" /></View>
      <Text style={[styles.label, { color: theme.colors.textMuted }]}>근거 참조</Text>
      {ai && ai.evidenceReferences.length > 0 ? ai.evidenceReferences.slice(0, 5).map((item) => <Text key={item} style={[styles.evidence, { color: theme.colors.text }]} numberOfLines={2}>• {item}</Text>) : <Text style={[styles.body, { color: theme.colors.textMuted }]}>검증된 근거 참조가 없습니다.</Text>}
      {ai && ai.evidenceReferences.length > 5 ? <Text style={[styles.more, { color: theme.colors.textMuted }]}>외 {ai.evidenceReferences.length - 5}개 근거가 있습니다.</Text> : null}
      <Text style={[styles.label, styles.sectionGap, { color: theme.colors.textMuted }]}>반대 근거</Text>
      {ai && ai.counterEvidence.length > 0 ? ai.counterEvidence.slice(0, 5).map((item, index) => <Text key={`${index}-${item}`} style={[styles.evidence, { color: theme.colors.text }]} numberOfLines={3}>• {item}</Text>) : <Text style={[styles.body, { color: theme.colors.textMuted }]}>등록된 반대 근거가 없습니다.</Text>}
      {ai && ai.counterEvidence.length > 5 ? <Text style={[styles.more, { color: theme.colors.textMuted }]}>외 {ai.counterEvidence.length - 5}개 반대 근거가 있습니다.</Text> : null}
      {ai && ai.disagreements.length > 0 ? <><Text style={[styles.label, styles.sectionGap, { color: theme.colors.textMuted }]}>분석 간 불일치</Text>{ai.disagreements.slice(0, 5).map((item, index) => <Text key={`${index}-${item}`} style={[styles.evidence, { color: theme.colors.text }]} numberOfLines={3}>• {item}</Text>)}{ai.disagreements.length > 5 ? <Text style={[styles.more, { color: theme.colors.textMuted }]}>외 {ai.disagreements.length - 5}개 불일치가 있습니다.</Text> : null}</> : null}
    </NusaCard>

    <NusaCard testID="ai-research-card">
      <View style={styles.cardHeader}><Text style={[styles.cardTitle, { color: theme.colors.text }]}>리서치 상태</Text><StatusChip label={research?.health ?? "UNAVAILABLE"} tone={research?.health === "HEALTHY" ? "success" : research?.health === "FAIL_CLOSED" ? "danger" : "warning"} /></View>
      <DataRow label="현재 PAPER 전략" value={research?.champion.strategyId ?? "-"} />
      <DataRow label="현재 전략 권한" value={research?.champion.authority ?? "-"} emphasis />
      <DataRow label="검증 후보 전략" value={research?.challenger.strategyId ?? "-"} />
      <DataRow label="후보 전략 권한" value={research?.challenger.authority ?? "-"} emphasis />
      <DataRow label="연구 후보" value={research == null ? "-" : String(research.candidateCount)} />
      <DataRow label="실험" value={research == null ? "-" : String(research.experimentCount)} />
    </NusaCard>

    <NusaCard testID="ai-authority-card">
      <View style={styles.cardHeader}><Text style={[styles.cardTitle, { color: theme.colors.text }]}>시스템 권한</Text><StatusChip label={health ?? "UNKNOWN"} tone={health === "HEALTHY" ? "success" : "warning"} /></View>
      <DataRow label="AI LIVE 권한" value={liveAuthority ?? "-"} emphasis />
      <DataRow label="Production mutation" value={productionMutationAllowed == null ? "-" : "금지"} tone={productionMutationAllowed === false ? "success" : "default"} />
      <DataRow label="킬 스위치" value={killSwitchActive == null ? "-" : killSwitchActive ? "활성" : "비활성"} tone={killSwitchActive === true ? "danger" : killSwitchActive === false ? "success" : "default"} />
      <Text style={[styles.body, { color: theme.colors.textMuted }]}>ZERO AUTHORITY는 제품 정책이며, 서버 snapshot이 연결되면 실제 권한 불변식도 함께 표시됩니다.</Text>
    </NusaCard>
  </ScrollView>;
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingTop: 18, gap: 14, paddingBottom: 32 },
  state: { flex: 1, justifyContent: "center", padding: 20 },
  stateTitle: { fontSize: 18, fontWeight: "700", marginTop: 10 },
  statusRow: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  cardHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 10 },
  eyebrow: { fontSize: 10, fontWeight: "800", letterSpacing: 1.2, marginBottom: 4 },
  cardTitle: { fontSize: 18, fontWeight: "700", letterSpacing: -0.4 },
  thesis: { fontSize: 17, lineHeight: 25, fontWeight: "600", marginBottom: 12 },
  label: { fontSize: 11, fontWeight: "800", letterSpacing: 0.7, marginBottom: 6 },
  evidence: { fontSize: 13, lineHeight: 20, marginBottom: 5 },
  more: { fontSize: 12, lineHeight: 18, marginTop: 3 },
  body: { fontSize: 13, lineHeight: 20, marginTop: 8 },
  sectionGap: { marginTop: 14 },
});