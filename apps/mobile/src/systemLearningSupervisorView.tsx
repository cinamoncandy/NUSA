import React from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { useTheme } from "./ThemeProvider";
import { loadEvolutionLearningSupervisor, type EvolutionLearningSupervisorLoadResult } from "./evolutionLearningSupervisorClient";
import type { DashboardCredentialProvider } from "./personalPaperOperationsClient";

export function SystemLearningSupervisorView({ baseUrl, credentialProvider, onClose }: Readonly<{ baseUrl: string; credentialProvider: DashboardCredentialProvider; onClose: () => void }>) {
  const { theme } = useTheme();
  const [result, setResult] = React.useState<EvolutionLearningSupervisorLoadResult>({ status: "UNAVAILABLE", reason: "System learning evidence has not been loaded yet." });
  const [refreshing, setRefreshing] = React.useState(false);
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
  const tone = latest?.outcome === "FAILED" || latest?.outcome === "REGRESSION" ? theme.colors.danger : theme.colors.aiSignalEnd;
  return <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={theme.colors.primary} />} testID="system-learning-screen">
    <View style={styles.header}>
      <View><Text style={[styles.kicker, { color: theme.colors.aiSignalEnd }]}>SYSTEM LEARNING / SUPERVISOR</Text><Text style={[styles.title, { color: theme.colors.text }]}>NUSA가 무엇을 배웠는지</Text></View>
      <Pressable accessibilityRole="button" onPress={onClose} testID="system-learning-close"><Text style={[styles.close, { color: theme.colors.textMuted }]}>닫기</Text></Pressable>
    </View>
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

const styles = StyleSheet.create({ content: { paddingHorizontal: 20, paddingVertical: 18, gap: 14, paddingBottom: 120 }, header: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }, kicker: { fontSize: 11, fontWeight: "800", letterSpacing: 1.4 }, title: { marginTop: 5, fontSize: 24, lineHeight: 30, fontWeight: "800" }, close: { fontSize: 13, fontWeight: "700", paddingVertical: 6 }, card: { borderWidth: 1, borderRadius: 16, padding: 16, gap: 9 }, row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12 }, label: { fontSize: 11, fontWeight: "800", letterSpacing: 1.2 }, value: { fontSize: 15, lineHeight: 21, fontWeight: "600" }, problem: { fontSize: 20, lineHeight: 27, fontWeight: "800" }, outcome: { fontSize: 13, fontWeight: "900", letterSpacing: 1 }, meta: { fontSize: 12, lineHeight: 18 }, details: { gap: 6, paddingTop: 4 } });
