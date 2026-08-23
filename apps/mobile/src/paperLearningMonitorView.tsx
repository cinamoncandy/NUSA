import React, { useMemo } from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { NusaButton, NusaCard, StatusChip } from "./components";
import { useTheme } from "./ThemeProvider";
import type { PaperLearningScreenState, PaperLearningUiEvent } from "./paperLearningScreen";

export interface PaperLearningMonitorViewProps {
  readonly state: PaperLearningScreenState;
  readonly refreshing: boolean;
  readonly onRefresh: () => void | Promise<void>;
  readonly onClose?: () => void;
}

const formatNumber = (value: number | null | undefined, digits = 2): string => value == null || !Number.isFinite(value)
  ? "-"
  : value.toLocaleString("ko-KR", { maximumFractionDigits: digits });

const formatTimestamp = (value: number): string => {
  try { return new Date(value).toLocaleString("ko-KR"); }
  catch { return "-"; }
};

const eventSummary = (event: PaperLearningUiEvent): string => {
  const parts: string[] = [];
  if (event.signal) parts.push(`signal=${event.signal.action}${event.signal.confidence == null ? "" : ` ${Math.round(event.signal.confidence * 100)}%`}`);
  if (event.decision) parts.push(`decision=${event.decision.action} allocation=${formatNumber(event.decision.allocation * 100, 1)}% confidence=${formatNumber(event.decision.confidence * 100, 1)}%`);
  if (event.gates?.length) parts.push(`gates=${event.gates.map((gate) => `${gate.name}:${gate.status}(${gate.reason})`).join(" | ")}`);
  if (event.risk) parts.push(`risk=${event.risk.status} ${event.risk.reason}`);
  if (event.fill) parts.push(`fill=${event.fill.side} ${formatNumber(event.fill.quantity, 8)} @ ${formatNumber(event.fill.price)} fee=${formatNumber(event.fill.fee)} slippage=${formatNumber(event.fill.slippage, 6)}`);
  if (event.account) parts.push(`cash=${formatNumber(event.account.cash)} equity=${formatNumber(event.account.equity)} realized=${formatNumber(event.account.realizedPnL)} unrealized=${formatNumber(event.account.unrealizedPnL)}`);
  if (event.evidence) parts.push(`learning=${event.evidence.outcome ?? "UNCHANGED"} score=${formatNumber(event.evidence.score, 4)} evidence=${event.evidence.evidenceId ?? "-"}`);
  if (event.reason) parts.push(`reason=${event.reason}`);
  return parts.join(" · ") || "관측 세부 정보 없음";
};

export function PaperLearningMonitorView({ state, refreshing, onRefresh, onClose }: PaperLearningMonitorViewProps) {
  const { theme } = useTheme();
  const latestMarketEvent = useMemo(() => state.timeline.find((event) => event.stage === "MARKET_DATA") ?? null, [state.timeline]);
  const latestOrderEvent = useMemo(() => state.timeline.find((event) => event.stage === "ORDER_INTENT") ?? null, [state.timeline]);
  const latestTerminalEvent = useMemo(() => state.timeline.find((event) => event.stage === "HALT" || event.stage === "ERROR" || event.stage === "IDEMPOTENCY") ?? null, [state.timeline]);
  const statusTone = state.status === "RUNNING" ? "primary" : state.status === "PAUSED" ? "warning" : "danger";

  return <ScrollView
    contentContainerStyle={styles.content}
    refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { void onRefresh(); }} />}
    style={[styles.screen, { backgroundColor: theme.colors.background }]}
    testID="paper-learning-monitor"
  >
    <View style={styles.titleRow}>
      <View style={styles.titleText}>
        <Text style={[styles.eyebrow, { color: theme.colors.primary }]}>PAPER LEARNING · READ ONLY</Text>
        <Text style={[styles.title, { color: theme.colors.text }]}>자동학습 관제</Text>
        <Text style={[styles.description, { color: theme.colors.textMuted }]}>시장 입력부터 판단, 권한, 위험, 가상체결, PnL, 학습까지 한 사이클의 현재 진실을 표시합니다.</Text>
      </View>
      <StatusChip label={state.status} tone={statusTone} />
    </View>

    <NusaCard raised>
      <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>현재 사이클</Text>
      <View style={styles.grid}>
        <Metric label="MARKET" value={state.latestMarket ?? "-"} />
        <Metric label="CYCLE" value={state.currentCycle ?? "-"} compact />
        <Metric label="DATA" value={latestMarketEvent == null ? "NO DATA" : `${latestMarketEvent.status} · ${formatTimestamp(latestMarketEvent.occurredAt)}`} />
        <Metric label="STRATEGY" value={state.latestStrategy.strategyId ?? "-"} />
        <Metric label="CANDIDATE" value={state.latestStrategy.candidateId ?? "-"} />
        <Metric label="CHAMPION" value={state.latestStrategy.championId ?? "-"} />
        <Metric label="SIGNAL" value={state.latestSignal == null ? "-" : `${state.latestSignal.action}${state.latestSignal.confidence == null ? "" : ` · ${Math.round(state.latestSignal.confidence * 100)}%`}`} />
        <Metric label="DECISION" value={state.latestDecision == null ? "-" : `${state.latestDecision.action} · ${formatNumber(state.latestDecision.allocation * 100, 1)}%`} />
      </View>
      {latestMarketEvent?.reason ? <Text style={[styles.reason, { color: theme.colors.textMuted }]} testID="paper-learning-freshness-reason">{latestMarketEvent.reason}</Text> : null}
    </NusaCard>

    <NusaCard>
      <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>TradePermission / RiskAuthority</Text>
      {state.latestGates.length === 0 ? <Text style={[styles.empty, { color: theme.colors.textMuted }]}>최근 permission gate 없음</Text> : state.latestGates.map((gate) => <View key={gate.name} style={[styles.row, { borderBottomColor: theme.colors.border }]} testID={`paper-learning-gate-${gate.name}`}>
        <Text style={[styles.rowLabel, { color: theme.colors.text }]}>{gate.name}</Text>
        <Text style={[styles.rowValue, { color: theme.colors.textMuted }]}>{gate.status} · {gate.reason}</Text>
      </View>)}
      <View style={[styles.row, { borderBottomColor: theme.colors.border }]}>
        <Text style={[styles.rowLabel, { color: theme.colors.text }]}>RISK</Text>
        <Text style={[styles.rowValue, { color: theme.colors.textMuted }]}>{state.latestRisk == null ? "-" : `${state.latestRisk.status} · ${state.latestRisk.reason}`}</Text>
      </View>
      {state.latestRisk?.limits ? <Text style={[styles.reason, { color: theme.colors.textMuted }]}>{Object.entries(state.latestRisk.limits).map(([key, value]) => `${key}=${formatNumber(value, 6)}`).join(" · ")}</Text> : null}
    </NusaCard>

    <NusaCard>
      <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>가상 실행 / 계정 변화</Text>
      <View style={styles.grid}>
        <Metric label="ORDER" value={latestOrderEvent == null ? "-" : `${latestOrderEvent.status}${latestOrderEvent.reason ? ` · ${latestOrderEvent.reason}` : ""}`} />
        <Metric label="FILL" value={state.latestFill == null ? "-" : `${state.latestFill.side} ${formatNumber(state.latestFill.quantity, 8)} @ ${formatNumber(state.latestFill.price)}`} />
        <Metric label="FEE" value={state.latestFill == null ? "-" : formatNumber(state.latestFill.fee)} />
        <Metric label="SLIPPAGE" value={state.latestFill == null ? "-" : formatNumber(state.latestFill.slippage, 6)} />
        <Metric label="CASH" value={formatNumber(state.latestAccount?.cash)} />
        <Metric label="EQUITY" value={formatNumber(state.latestAccount?.equity)} />
        <Metric label="REALIZED PnL" value={formatNumber(state.latestAccount?.realizedPnL)} />
        <Metric label="UNREALIZED PnL" value={formatNumber(state.latestAccount?.unrealizedPnL)} />
      </View>
    </NusaCard>

    <NusaCard>
      <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>Learning / Evaluation</Text>
      <View style={styles.grid}>
        <Metric label="OUTCOME" value={state.latestEvidence?.outcome ?? "-"} />
        <Metric label="SCORE" value={formatNumber(state.latestEvidence?.score, 4)} />
        <Metric label="EVIDENCE" value={state.latestEvidence?.evidenceId ?? "-"} compact />
        <Metric label="INPUT HASH" value={state.latestEvidence?.inputHash ?? "-"} compact />
      </View>
      {latestTerminalEvent ? <Text style={[styles.reason, { color: theme.colors.textMuted }]} testID="paper-learning-terminal-event">{latestTerminalEvent.stage} · {latestTerminalEvent.status} · {latestTerminalEvent.reason ?? "-"}</Text> : null}
    </NusaCard>

    <NusaCard>
      <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>누적 PAPER 성과</Text>
      <View style={styles.grid}>
        <Metric label="REALIZED" value={formatNumber(state.performance.realizedPnL)} />
        <Metric label="UNREALIZED" value={formatNumber(state.performance.unrealizedPnL)} />
        <Metric label="FEES" value={formatNumber(state.performance.fees)} />
        <Metric label="TURNOVER" value={formatNumber(state.performance.turnover)} />
        <Metric label="CYCLES" value={String(state.performance.completedCycles)} />
        <Metric label="FILLED" value={String(state.performance.filledCycles)} />
        <Metric label="WIN RATE" value={state.performance.winRate == null ? "-" : `${formatNumber(state.performance.winRate * 100, 1)}%`} />
        <Metric label="EXPECTANCY" value={formatNumber(state.performance.expectancy)} />
        <Metric label="MAX DRAWDOWN" value={`${formatNumber(state.performance.maxDrawdown * 100, 2)}%`} />
      </View>
      <Text style={[styles.disclaimer, { color: theme.colors.textMuted }]}>PAPER 성과는 실제 LIVE 성과를 보장하지 않습니다.</Text>
    </NusaCard>

    <NusaCard>
      <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>최근 사이클</Text>
      {state.recentCycles.length === 0 ? <Text style={[styles.empty, { color: theme.colors.textMuted }]}>아직 완료된 학습 사이클이 없습니다.</Text> : state.recentCycles.map((cycle) => <View key={cycle.cycleId} style={[styles.row, { borderBottomColor: theme.colors.border }]}>
        <Text style={[styles.rowLabel, { color: theme.colors.text }]}>{cycle.market} · {cycle.status}</Text>
        <Text style={[styles.rowValue, { color: theme.colors.textMuted }]}>{cycle.decision?.action ?? "NO DECISION"} · {cycle.reason ?? "-"}</Text>
      </View>)}
    </NusaCard>

    <NusaCard>
      <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>Cycle Timeline</Text>
      {state.timeline.length === 0 ? <Text style={[styles.empty, { color: theme.colors.textMuted }]}>관측 이벤트 없음</Text> : state.timeline.map((event) => <View key={event.id} style={[styles.timelineItem, { borderLeftColor: theme.colors.border }]} testID={`paper-learning-event-${event.stage}`}>
        <View style={styles.timelineHeader}>
          <Text style={[styles.timelineStage, { color: theme.colors.text }]}>{event.stage}</Text>
          <Text style={[styles.timelineStatus, { color: theme.colors.textMuted }]}>{event.status} · {formatTimestamp(event.occurredAt)}</Text>
        </View>
        <Text style={[styles.timelineBody, { color: theme.colors.textMuted }]}>{eventSummary(event)}</Text>
      </View>)}
    </NusaCard>

    <View style={styles.actions}>
      <NusaButton label="현재 상태 새로고침" onPress={() => { void onRefresh(); }} testID="paper-learning-refresh" />
      {onClose ? <NusaButton label="닫기" onPress={onClose} testID="paper-learning-close" /> : null}
    </View>
  </ScrollView>;
}

function Metric({ label, value, compact = false }: Readonly<{ label: string; value: string; compact?: boolean }>) {
  const { theme } = useTheme();
  return <View style={styles.metric}><Text style={[styles.metricLabel, { color: theme.colors.textMuted }]}>{label}</Text><Text numberOfLines={compact ? 1 : 2} style={[styles.metricValue, { color: theme.colors.text }]}>{value}</Text></View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { width: "100%", maxWidth: 960, alignSelf: "center", padding: 18, gap: 12, paddingBottom: 32 },
  titleRow: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 },
  titleText: { flex: 1, gap: 4 },
  eyebrow: { fontSize: 10, fontWeight: "800", letterSpacing: 1.2 },
  title: { fontSize: 25, fontWeight: "800", letterSpacing: -0.6 },
  description: { fontSize: 12, lineHeight: 18 },
  sectionTitle: { fontSize: 15, fontWeight: "800", marginBottom: 10 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  metric: { minWidth: 132, flexGrow: 1, flexBasis: "30%", gap: 3, paddingVertical: 5 },
  metricLabel: { fontSize: 9, fontWeight: "800", letterSpacing: 0.9 },
  metricValue: { fontSize: 12, fontWeight: "700", lineHeight: 17 },
  reason: { fontSize: 11, lineHeight: 17, marginTop: 8 },
  row: { paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, gap: 3 },
  rowLabel: { fontSize: 11, fontWeight: "800" },
  rowValue: { fontSize: 11, lineHeight: 16 },
  empty: { fontSize: 11, lineHeight: 17 },
  disclaimer: { fontSize: 10, lineHeight: 15, marginTop: 10 },
  timelineItem: { borderLeftWidth: 2, paddingLeft: 10, paddingVertical: 7, gap: 4 },
  timelineHeader: { flexDirection: "row", justifyContent: "space-between", gap: 8 },
  timelineStage: { fontSize: 11, fontWeight: "800" },
  timelineStatus: { fontSize: 10 },
  timelineBody: { fontSize: 10, lineHeight: 15 },
  actions: { gap: 8 },
});
