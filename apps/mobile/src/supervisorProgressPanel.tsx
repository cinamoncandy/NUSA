import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { InMemoryDashboardCredentialSession } from "./dashboardCredentialSession";
import { loadOperationalProgress, type OperationalProgressLoadResult } from "./operationalProgressClient";
import { getConfiguredPaperEndpoint } from "./paperConnectionSession";
import { useTheme } from "./ThemeProvider";

const REFRESH_INTERVAL_MS = 30_000;

function initialState(): OperationalProgressLoadResult {
  return Object.freeze({ status: "NOT_CONFIGURED", reason: "Supervisor progress is not configured." });
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export function SupervisorProgressPanel({ refreshing }: Readonly<{ refreshing: boolean }>) {
  const { theme } = useTheme();
  const [state, setState] = React.useState<OperationalProgressLoadResult>(() => initialState());
  const [expanded, setExpanded] = React.useState(false);
  const requestGeneration = React.useRef(0);
  const credentialSession = React.useMemo(() => new InMemoryDashboardCredentialSession(), []);

  const refresh = React.useCallback(async () => {
    const generation = ++requestGeneration.current;
    const endpoint = getConfiguredPaperEndpoint();
    if (endpoint == null) {
      if (generation === requestGeneration.current) setState(Object.freeze({ status: "NOT_CONFIGURED", reason: "Verified Supervisor endpoint is not configured." }));
      return;
    }
    const result = await loadOperationalProgress({ baseUrl: endpoint, credentialProvider: credentialSession.credentialProvider });
    if (generation === requestGeneration.current) setState(result);
  }, [credentialSession]);

  React.useEffect(() => {
    let active = true;
    void refresh();
    const timer = setInterval(() => { if (active) void refresh(); }, REFRESH_INTERVAL_MS);
    return () => { active = false; requestGeneration.current += 1; clearInterval(timer); };
  }, [refresh]);

  React.useEffect(() => {
    if (refreshing) void refresh();
  }, [refresh, refreshing]);

  if (state.status !== "READY") {
    return <View style={[styles.panel, { borderColor: theme.colors.border }]} testID="home-supervisor-progress-unavailable">
      <View style={styles.header}>
        <Text style={[styles.kicker, { color: theme.colors.textMuted }]}>SUPERVISOR PROGRESS</Text>
        <Text style={[styles.authority, { color: theme.colors.textMuted }]}>READ ONLY</Text>
      </View>
      <Text style={[styles.attentionValue, { color: theme.colors.textMuted }]}>검증된 운영 진척도 없음</Text>
      <Text style={[styles.meta, { color: theme.colors.textMuted }]}>{state.reason}</Text>
    </View>;
  }

  const { snapshot } = state;
  const blockerCount = snapshot.blockers.length + snapshot.blockedCriteria.length;
  const primaryBlocker = snapshot.blockers[0] ?? snapshot.blockedCriteria[0] ?? null;
  const needsAttention = blockerCount > 0;
  const attentionColor = needsAttention ? theme.colors.aiSignalEnd : theme.colors.textMuted;

  return <View style={[styles.panel, { borderColor: needsAttention ? theme.colors.aiSignalEnd : theme.colors.borderStrong }]} testID="home-supervisor-progress">
    <View style={styles.header}>
      <Text style={[styles.kicker, { color: theme.colors.textMuted }]}>SUPERVISOR PROGRESS</Text>
      <Text style={[styles.authority, { color: theme.colors.textMuted }]}>OPERATIONAL EVIDENCE · READ ONLY</Text>
    </View>

    <View style={[styles.attention, { borderTopColor: theme.colors.border }]} testID="home-supervisor-progress-attention">
      <View style={styles.attentionHeader}>
        <Text style={[styles.attentionLabel, { color: attentionColor }]}>{needsAttention ? "ATTENTION" : "CLEAR"}</Text>
        <Text style={[styles.blockedCount, { color: attentionColor }]}>{needsAttention ? `${blockerCount} BLOCKED` : "0 BLOCKED"}</Text>
      </View>
      <Text style={[styles.attentionValue, { color: theme.colors.text }]}>{primaryBlocker ?? "현재 canonical blocker 없음"}</Text>
    </View>

    <View style={[styles.progressRail, { borderTopColor: theme.colors.border }]}>
      <View>
        <Text style={[styles.level, { color: theme.colors.textMuted }]} testID="home-supervisor-progress-level">LEVEL {snapshot.level}</Text>
        <Text style={[styles.progressValue, { color: theme.colors.text }]} testID="home-supervisor-progress-ratio">{percent(snapshot.overallProgressRatio)}</Text>
      </View>
      <View style={styles.counts}>
        <Text style={[styles.count, { color: theme.colors.textMuted }]}>CANONICAL PROGRESS</Text>
        <Text style={[styles.count, { color: theme.colors.textMuted }]}>ACHIEVED {snapshot.achievedCriteria.length}</Text>
      </View>
    </View>

    <Pressable accessibilityRole="button" accessibilityState={{ expanded }} onPress={() => setExpanded((value) => !value)} style={({ pressed }) => [styles.toggle, { borderTopColor: theme.colors.border, opacity: pressed ? theme.interaction.pressedOpacity : 1 }]} testID="home-supervisor-progress-toggle">
      <Text style={[styles.toggleLabel, { color: theme.colors.textMuted }]}>{expanded ? "EVIDENCE CLOSE" : "EVIDENCE OPEN"}</Text>
      <Text style={[styles.toggleLabel, { color: theme.colors.textMuted }]}>{snapshot.headSha.slice(0, 8)}</Text>
    </Pressable>

    {expanded ? <View style={[styles.evidence, { borderTopColor: theme.colors.border }]} testID="home-supervisor-progress-evidence">
      <Text style={[styles.meta, { color: theme.colors.textMuted }]}>HEAD {snapshot.headSha}</Text>
      <Text style={[styles.meta, { color: theme.colors.textMuted }]}>AS OF {new Date(snapshot.asOf).toISOString()}</Text>
      {snapshot.domains.map((domain) => <View key={domain.domain} style={styles.domainRow}><Text style={[styles.domain, { color: theme.colors.textMuted }]}>{domain.domain}</Text><Text style={[styles.domainValue, { color: theme.colors.text }]}>{percent(domain.completionRatio)}</Text></View>)}
      {snapshot.reasons.length > 0 ? <View style={styles.reasonList}>{snapshot.reasons.map((reason) => <Text key={reason} style={[styles.meta, { color: theme.colors.textMuted }]}>• {reason}</Text>)}</View> : null}
    </View> : null}
  </View>;
}

const styles = StyleSheet.create({
  panel: { borderWidth: 1, padding: 14, gap: 10 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  kicker: { fontSize: 9, lineHeight: 12, fontWeight: "900", letterSpacing: 1.5 },
  authority: { fontSize: 8, lineHeight: 11, fontWeight: "800", letterSpacing: 1 },
  attention: { borderTopWidth: 1, paddingTop: 10, gap: 5 },
  attentionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  attentionLabel: { fontSize: 10, lineHeight: 13, fontWeight: "900", letterSpacing: 1.3 },
  blockedCount: { fontSize: 9, lineHeight: 12, fontWeight: "900", letterSpacing: 1 },
  attentionValue: { fontSize: 14, lineHeight: 20, fontWeight: "800" },
  progressRail: { borderTopWidth: 1, paddingTop: 10, flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", gap: 16 },
  level: { fontSize: 9, lineHeight: 13, fontWeight: "900", letterSpacing: 1.1 },
  progressValue: { marginTop: 2, fontSize: 30, lineHeight: 34, fontWeight: "900", fontVariant: ["tabular-nums"] },
  counts: { alignItems: "flex-end", gap: 4 },
  count: { fontSize: 9, lineHeight: 12, fontWeight: "900", letterSpacing: 1 },
  toggle: { minHeight: 40, borderTopWidth: 1, paddingTop: 8, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  toggleLabel: { fontSize: 9, lineHeight: 12, fontWeight: "900", letterSpacing: 1 },
  evidence: { borderTopWidth: 1, paddingTop: 10, gap: 8 },
  domainRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  domain: { flex: 1, fontSize: 9, lineHeight: 13, fontWeight: "800" },
  domainValue: { fontSize: 10, lineHeight: 13, fontWeight: "900", fontVariant: ["tabular-nums"] },
  reasonList: { gap: 4 },
  meta: { fontSize: 9, lineHeight: 14, fontWeight: "700" },
});