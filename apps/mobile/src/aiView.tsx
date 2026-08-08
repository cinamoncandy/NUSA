import React from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import type { AiReadOnlyProjection } from "../../../packages/contracts/src/aiInference";
import type { ResearchStatusProjection } from "../../../packages/contracts/src/researchAutomation";
import { AuthorityBanner, DataRow, NusaCard, SectionHeading, StatusChip } from "./components";
import { useTheme } from "./ThemeProvider";

interface AiViewProps {
  readonly ai: AiReadOnlyProjection | null;
  readonly research: ResearchStatusProjection | null;
  readonly health: string | null;
  readonly liveAuthority: "NONE";
  readonly productionMutationAllowed: false;
  readonly killSwitchActive: boolean;
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

export function AiView({ ai, research, health, liveAuthority, productionMutationAllowed, killSwitchActive, error, refreshing, onRefresh }: AiViewProps) {
  const { theme } = useTheme();
  const confidence = ai != null && ai.status !== "UNAVAILABLE" ? `${Math.round(ai.confidence * 100)}%` : "-";
  const lastRun = ai?.lastModelRun == null ? "-" : new Date(ai.lastModelRun).toLocaleString("ko-KR");

  return <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl tintColor={theme.colors.primary} refreshing={refreshing} onRefresh={onRefresh} />} testID="ai-screen">
    <SectionHeading eyebrow="AI RESEARCH" title="AI 인텔리전스" description="검증된 근거를 읽고 분석합니다. 주문·이체·LIVE 실행 권한은 없습니다." />
    <View style={styles.statusRow}>
      <StatusChip label="ZERO AUTHORITY" tone="info" />
      <StatusChip label="READ ONLY" tone="primary" />
      <StatusChip label={ai?.status ?? "UNAVAILABLE"} tone={statusTone(ai?.status)} />
    </View>
    <AuthorityBanner detail="AI는 분석·비판·불확실성 설명만 제공합니다. Risk Governor, P0, kill switch, HALT를 우회하거나 주문을 승인할 수 없습니다." />

    {error ? <NusaCard testID="ai-error"><Text style={[styles.cardTitle, { color: theme.colors.danger }]}>AI 상태를 불러올 수 없습니다</Text><Text style={[styles.body, { color: theme.colors.textMuted }]}>{error}</Text></NusaCard> : null}

    <NusaCard raised testID="ai-thesis-card">
      <View style={styles.cardHeader}><View><Text style={[styles.eyebrow, { color: theme.colors.info }]}>CURRENT ANALYSIS</Text><Text style={[styles.cardTitle, { color: theme.colors.text }]}>현재 분석</Text></View><StatusChip label={ai?.status ?? "UNAVAILABLE"} tone={statusTone(ai?.status)} /></View>
      <Text style={[styles.thesis, { color: ai?.thesis ? theme.colors.text : theme.colors.textMuted }]}>{ai?.thesis ?? "현재 표시할 검증된 AI 분석이 없습니다."}</Text>
      <DataRow label="신뢰도" value={confidence} />
      <DataRow label="불확실성" value={ai?.uncertainty ?? "-"} />
      <DataRow label="비판 심각도" value={ai?.criticSeverity ?? "-"} tone={severityTone(ai?.criticSeverity ?? null)} />
      <DataRow label="모델" value={ai?.modelVersion ?? "-"} />
      <DataRow label="프롬프트" value={ai?.promptVersion ?? "-"} />
      <DataRow label="최근 분석" value={lastRun} />
      <DataRow label="보정 상태" value={ai?.calibrationStatus ?? "UNKNOWN"} />
    </NusaCard>

    <NusaCard testID="ai-evidence-card">
      <View style={styles.cardHeader}><Text style={[styles.cardTitle, { color: theme.colors.text }]}>근거와 반대 근거</Text><StatusChip label={`${ai?.evidenceReferences.length ?? 0} 근거`} tone="neutral" /></View>
      <Text style={[styles.label, { color: theme.colors.textMuted }]}>근거 참조</Text>
      {ai && ai.evidenceReferences.length > 0 ? ai.evidenceReferences.slice(0, 5).map((item) => <Text key={item} style={[styles.evidence, { color: theme.colors.text }]} numberOfLines={2}>• {item}</Text>) : <Text style={[styles.body, { color: theme.colors.textMuted }]}>검증된 근거 참조가 없습니다.</Text>}
      <Text style={[styles.label, styles.sectionGap, { color: theme.colors.textMuted }]}>반대 근거</Text>
      {ai && ai.counterEvidence.length > 0 ? ai.counterEvidence.slice(0, 5).map((item, index) => <Text key={`${index}-${item}`} style={[styles.evidence, { color: theme.colors.text }]} numberOfLines={3}>• {item}</Text>) : <Text style={[styles.body, { color: theme.colors.textMuted }]}>등록된 반대 근거가 없습니다.</Text>}
      {ai && ai.disagreements.length > 0 ? <><Text style={[styles.label, styles.sectionGap, { color: theme.colors.textMuted }]}>에이전트 불일치</Text>{ai.disagreements.slice(0, 5).map((item, index) => <Text key={`${index}-${item}`} style={[styles.evidence, { color: theme.colors.text }]} numberOfLines={3}>• {item}</Text>)}</> : null}
    </NusaCard>

    <NusaCard testID="ai-research-card">
      <View style={styles.cardHeader}><Text style={[styles.cardTitle, { color: theme.colors.text }]}>리서치 거버넌스</Text><StatusChip label={research?.health ?? "UNAVAILABLE"} tone={research?.health === "HEALTHY" ? "success" : research?.health === "FAIL_CLOSED" ? "danger" : "warning"} /></View>
      <DataRow label="Champion" value={research?.champion.strategyId ?? "-"} />
      <DataRow label="Champion 권한" value={research?.champion.authority ?? "-"} emphasis />
      <DataRow label="Challenger" value={research?.challenger.strategyId ?? "-"} />
      <DataRow label="Challenger 권한" value={research?.challenger.authority ?? "-"} emphasis />
      <DataRow label="후보 수" value={String(research?.candidateCount ?? "-")} />
      <DataRow label="실험 수" value={String(research?.experimentCount ?? "-")} />
    </NusaCard>

    <NusaCard testID="ai-authority-card">
      <View style={styles.cardHeader}><Text style={[styles.cardTitle, { color: theme.colors.text }]}>권한 경계</Text><StatusChip label={health ?? "UNKNOWN"} tone={health === "HEALTHY" ? "success" : "warning"} /></View>
      <DataRow label="AI LIVE 권한" value={liveAuthority} emphasis />
      <DataRow label="Production mutation" value={productionMutationAllowed ? "허용" : "금지"} tone={productionMutationAllowed ? "danger" : "success"} />
      <DataRow label="킬 스위치" value={killSwitchActive ? "활성" : "비활성"} tone={killSwitchActive ? "danger" : "success"} />
      <Text style={[styles.body, { color: theme.colors.textMuted }]}>ZERO AUTHORITY는 UI 문구가 아니라 서버 snapshot의 권한 불변식과 함께 표시됩니다.</Text>
    </NusaCard>
  </ScrollView>;
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingTop: 18, gap: 14, paddingBottom: 32 },
  statusRow: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  cardHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 10 },
  eyebrow: { fontSize: 10, fontWeight: "800", letterSpacing: 1.2, marginBottom: 4 },
  cardTitle: { fontSize: 18, fontWeight: "700", letterSpacing: -0.4 },
  thesis: { fontSize: 17, lineHeight: 25, fontWeight: "600", marginBottom: 12 },
  label: { fontSize: 11, fontWeight: "800", letterSpacing: 0.7, marginBottom: 6 },
  evidence: { fontSize: 13, lineHeight: 20, marginBottom: 5 },
  body: { fontSize: 13, lineHeight: 20, marginTop: 8 },
  sectionGap: { marginTop: 14 },
});