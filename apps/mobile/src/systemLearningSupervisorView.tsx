import React from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { useTheme } from "./ThemeProvider";
import { loadEvolutionLearningSupervisor, type EvolutionLearningSupervisorLoadResult } from "./evolutionLearningSupervisorClient";
import type { DashboardCredentialProvider } from "./personalPaperOperationsClient";
import type { EvolutionLearningSupervisorOutcome } from "../../../packages/contracts/src/evolutionLearningSupervisor";

type LearningAttention = Readonly<{ label: "CLEAR" | "WATCH" | "REVIEW" | "INSUFFICIENT"; detail: string }>;

function learningAttention(outcome: EvolutionLearningSupervisorOutcome): LearningAttention {
  if (outcome === "FAILED" || outcome === "REGRESSION") {
    return Object.freeze({ label: "REVIEW", detail: "실패 또는 회귀가 기록되었습니다. 실패·롤백 근거를 확인하세요." });
  }
  if (outcome === "PARTIAL_SUCCESS" || outcome === "UNDERPERFORMED") {
    return Object.freeze({ label: "WATCH", detail: "부분 성공 또는 기대 미달 기록입니다. 다음 검증 근거를 계속 관찰하세요." });
  }
  if (outcome === "SUCCESS") {
    return Object.freeze({ label: "CLEAR", detail: "최신 검증 결과가 성공으로 기록되었습니다." });
  }
  return Object.freeze({ label: "INSUFFICIENT", detail: "최신 결과가 UNKNOWN이므로 감독 결론을 확대하지 않습니다." });
}

export function SystemLearningSupervisorView({ baseUrl, credentialProvider, onClose }: Readonly<{ baseUrl: string; credentialProvider: DashboardCredentialProvider; onClose: () => void }>) {
  const { theme } = useTheme();
  const [result, setResult] = React.useState<EvolutionLearningSupervisorLoadResult>({ status: "UNAVAILABLE", reason: "System learning evidence has not been loaded yet." });
  const [refreshing, setRefreshing] = React.useState(false);
  const [historyOpen, setHistoryOpen] = React.useState(false);
  const [detailsOpen, setDetailsOpen] = React.useState(false);

  const refresh = React.useCallback(async () => {
    setRefreshing(true);
    try { setResult(await loadEvolutionLearningSupervisor({ baseUrl, credentialProvider })); }
    finally { setRefreshing(false); }
  }, [baseUrl, credentialProvider]);

  React.useEffect(() => { void refresh(); }, [refresh]);

  const ready = result.status === "READY" ? result.snapshot : null;
  const unavailableReason = result.status === "READY" ? null : result.reason;
  const latest = ready?.latest ?? null;
  const priorLearning = ready?.recent?.slice(1) ?? [];
  const attention = latest == null ? null : learningAttention(latest.outcome);
  const tone = latest?.outcome === "FAILED" || latest?.outcome === "REGRESSION" ? theme.colors.danger : theme.colors.aiSignalEnd;
  const attentionTone = attention?.label === "REVIEW"
    ? theme.colors.danger
    : attention?.label === "INSUFFICIENT"
      ? theme.colors.textMuted
      : theme.colors.aiSignalEnd;
  return <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={theme.colors.primary} />} testID="system-learning-screen">
    <View style={styles.header}>
      <View><Text style={[styles.kicker, { color: theme.colors.aiSignalEnd }]}>SYSTEM LEARNING / SUPERVISOR</Text><Text style={[styles.title, { color: theme.colors.text }]}>NUSA가 무엇을 배웠는지</Text></View>
      <Pressable accessibilityRole="button" onPress={onClose} testID="system-learning-close"><Text style={[styles.close, { color: theme.colors.textMuted }]}>닫기</Text></Pressable>
    </View>
    {attention ? <View style={[styles.attentionCard, { borderColor: attentionTone }]} testID="system-learning-attention">
      <View style={styles.row}><Text style={[styles.label, { color: theme.colors.textMuted }]}>ATTENTION</Text><Text style={[styles.attentionLabel, { color: attentionTone }]}>{attention.label}</Text></View>
      <Text style={[styles.value, { color: theme.colors.text }]}>{attention.detail}</Text>
    </View> : null}
    <View style={[styles.card, { borderColor: theme.colors.borderStrong }]}>
      <Text style={[styles.label, { color: theme.colors.textMuted }]}>AUTHORITY</Text>
      <Text style={[styles.value, { color: theme.colors.text }]}>READ ONLY · AI ZERO AUTHORITY · LIVE NONE</Text>
      <Text style={[styles.meta, { color: theme.colors.textMuted }]}>이 화면은 진화/시스템 학습의 증거만 보여주며 전략 승격, 주문, 자본 변경 권한을 갖지 않습니다.</Text>
    </View>
    {ready == null ? <View style={[styles.card, { borderColor: theme.colors.border }]} testID="system-learning-unavailable"><Text style={[styles.label, { color: theme.colors.textMuted }]}>EVIDENCE</Text><Text style={[styles.value, { color: theme.colors.text }]}>{unavailableReason ?? "System learning evidence is unavailable."}</Text></View>
      : latest == null ? <View style={[styles.card, { borderColor: theme.colors.border }]} testID="system-learning-empty"><Text style={[styles.label, { color: theme.colors.textMuted }]}>LATEST</Text><Text style={[styles.value, { color: theme.colors.text }]}>아직 검증된 시스템 학습 기록이 없습니다.</Text><Text style={[styles.meta, { color: theme.colors.textMuted }]}>EVENTS 0 · HEAD {ready.headHash.slice(0, 12)}</Text></View>
      : <>
        <View style={[styles.card, { borderColor: tone }]} testID="system-learning-latest">
          <View style={styles.row}><Text style={[styles.label, { color: theme.colors.textMuted }]}>RESULT</Text><Text style={[styles.outcome, { color: tone }]}>{latest.outcome}</Text></View>
          <Text style={[styles.problem, { color: theme.colors.text }]}>{latest.problem}</Text>
          <Text style={[styles.meta, { color: theme.colors.textMuted }]}>VALIDATION {latest.validationStatus} · REUSABLE {latest.reusable ? "YES" : "NO"}</Text>
        </View>
        <View style={[styles.card, { borderColor: theme.colors.border }]}>
          <Text style={[styles.label, { color: theme.colors.textMuted }]}>HYPOTHESIS</Text><Text style={[styles.value, { color: theme.colors.text }]}>{latest.hypothesis}</Text>
        </View>
        {latest.failureReason ? <View style={[styles.card, { borderColor: theme.colors.danger }]}><Text style={[styles.label, { color: theme.colors.danger }]}>FAILURE</Text><Text style={[styles.value, { color: theme.colors.text }]}>{latest.failureReason}</Text></View> : null}
        {priorLearning.length > 0 ? <Pressable accessibilityRole="button" accessibilityState={{ expanded: historyOpen }} onPress={() => setHistoryOpen((open) => !open)} style={[styles.card, { borderColor: theme.colors.border }]} testID="system-learning-history-toggle">
          <View style={styles.row}><Text style={[styles.label, { color: theme.colors.textMuted }]}>RECENT LEARNING</Text><Text style={[styles.label, { color: theme.colors.aiSignalEnd }]}>{historyOpen ? "CLOSE" : "OPEN"}</Text></View>
          <Text style={[styles.meta, { color: theme.colors.textMuted }]}>최신 기록 이전 {priorLearning.length}건의 검증된 시스템 학습 증거</Text>
          {historyOpen ? <View style={styles.details} testID="system-learning-history">
            {priorLearning.map((item, index) => {
              const itemAttention = learningAttention(item.outcome);
              const itemTone = itemAttention.label === "REVIEW"
                ? theme.colors.danger
                : itemAttention.label === "INSUFFICIENT"
                  ? theme.colors.textMuted
                  : theme.colors.aiSignalEnd;
              return <View key={`${item.opportunityId}:${item.changeReference}:${item.recordedAt}`} style={[styles.historyItem, { borderTopColor: theme.colors.border }]} testID={`system-learning-history-item-${index}`}>
                <View style={styles.row}><Text style={[styles.outcome, { color: itemTone }]}>{item.outcome}</Text><Text style={[styles.label, { color: itemTone }]}>{itemAttention.label}</Text></View>
                <Text style={[styles.value, { color: theme.colors.text }]}>{item.problem}</Text>
                <Text style={[styles.meta, { color: theme.colors.textMuted }]}>RECORDED {item.recordedAt} · REUSABLE {item.reusable ? "YES" : "NO"}</Text>
              </View>;
            })}
          </View> : null}
        </Pressable> : null}
        <Pressable accessibilityRole="button" accessibilityState={{ expanded: detailsOpen }} onPress={() => setDetailsOpen((open) => !open)} style={[styles.card, { borderColor: theme.colors.border }]} testID="system-learning-evidence-toggle">
          <View style={styles.row}><Text style={[styles.label, { color: theme.colors.textMuted }]}>EVIDENCE</Text><Text style={[styles.label, { color: theme.colors.aiSignalEnd }]}>{detailsOpen ? "CLOSE" : "OPEN"}</Text></View>
          <Text style={[styles.meta, { color: theme.colors.textMuted }]}>EVENTS {ready.eventCount} · HEAD {ready.headHash.slice(0, 12)}</Text>
          {detailsOpen ? <View style={styles.details} testID="system-learning-evidence-details">
            <Text style={[styles.meta, { color: theme.colors.textMuted }]}>OPPORTUNITY {latest.opportunityId}</Text>
            <Text style={[styles.meta, { color: theme.colors.textMuted }]}>CHANGE {latest.changeReference}</Text>
            {latest.evidenceReferences.map((reference) => <Text key={reference} style={[styles.meta, { color: theme.colors.textMuted }]}>• {reference}</Text>)}
            {latest.rollbackReference ? <Text style={[styles.meta, { color: theme.colors.textMuted }]}>ROLLBACK {latest.rollbackReference}</Text> : null}
            <Text style={[styles.meta, { color: theme.colors.textMuted }]}>RECORDED {latest.recordedAt}</Text>
          </View> : null}
        </Pressable>
      </>}
  </ScrollView>;
}

const styles = StyleSheet.create({ content: { paddingHorizontal: 20, paddingVertical: 18, gap: 14, paddingBottom: 120 }, header: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }, kicker: { fontSize: 11, fontWeight: "800", letterSpacing: 1.4 }, title: { marginTop: 5, fontSize: 24, lineHeight: 30, fontWeight: "800" }, close: { fontSize: 13, fontWeight: "700", paddingVertical: 6 }, attentionCard: { borderWidth: 2, borderRadius: 16, padding: 16, gap: 9 }, attentionLabel: { fontSize: 13, fontWeight: "900", letterSpacing: 1.1 }, card: { borderWidth: 1, borderRadius: 16, padding: 16, gap: 9 }, row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12 }, label: { fontSize: 11, fontWeight: "800", letterSpacing: 1.2 }, value: { fontSize: 15, lineHeight: 21, fontWeight: "600" }, problem: { fontSize: 20, lineHeight: 27, fontWeight: "800" }, outcome: { fontSize: 13, fontWeight: "900", letterSpacing: 1 }, meta: { fontSize: 12, lineHeight: 18 }, details: { gap: 6, paddingTop: 4 }, historyItem: { borderTopWidth: 1, paddingTop: 10, marginTop: 4, gap: 6 } });
