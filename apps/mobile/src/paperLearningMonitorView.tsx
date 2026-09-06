import React, { useMemo, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { NusaButton } from "./components";
import { useTheme } from "./ThemeProvider";
import type { PaperLearningScreenState, PaperLearningUiEvent } from "./paperLearningScreen";
import { AuthorityRail, FactRow, IntelligenceSection, MetricStrip, ScreenLead, StateNotice, type IntelligenceTone } from "./intelligenceOs";

export interface PaperLearningMonitorViewProps {
  readonly state: PaperLearningScreenState;
  readonly refreshing: boolean;
  readonly onRefresh: () => void | Promise<void>;
  readonly onClose?: () => void;
}

const formatNumber = (value: number | null | undefined, digits = 2): string => value == null || !Number.isFinite(value)
  ? "—"
  : value.toLocaleString("ko-KR", { maximumFractionDigits: digits });

const money = (value: number | null | undefined): string => value == null || !Number.isFinite(value)
  ? "—"
  : `₩${Math.round(value).toLocaleString("ko-KR")}`;

const signedMoney = (value: number | null | undefined): string => value == null || !Number.isFinite(value)
  ? "—"
  : `${value > 0 ? "+" : value < 0 ? "-" : ""}${money(Math.abs(value))}`;

// RESULT (실제 PAPER 손익)와 LEARNING (검증된 평가 결론)을 섞지 않는다.
const learningOutcomeLabel: Record<string, string> = { PROMOTE: "전략 승격", REJECT: "전략 거부", PAUSE: "일시 중단", UNCHANGED: "변경 없음" };
function learningOutcomeSummary(evidence: PaperLearningUiEvent["evidence"] | null | undefined): string {
  if (evidence?.outcome == null) return "아직 검증된 학습 평가 결론이 없습니다.";
  const label = learningOutcomeLabel[evidence.outcome] ?? evidence.outcome;
  return `최근 평가 결론: ${label}${evidence.score == null ? "" : ` · 점수 ${formatNumber(evidence.score, 4)}`}`;
}

const formatTimestamp = (value: number): string => {
  try { return new Date(value).toLocaleString("ko-KR"); }
  catch { return "—"; }
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

const dataSourceMessage = (state: PaperLearningScreenState): Readonly<{ title: string; body: string }> | null => {
  switch (state.dataSource) {
    case "NOT_CONFIGURED":
      return Object.freeze({
        title: "PAPER 서버가 연결되지 않았습니다",
        body: "PAPER endpoint 또는 세션이 설정되지 않아 학습 데이터를 요청하지 못했습니다. 이 화면이 비어 있는 것은 학습 결과가 없다는 뜻이 아닙니다. Settings에서 PAPER 서버 연결을 완료해 주세요."
      });
    case "UNAVAILABLE":
      return Object.freeze({
        title: "PAPER 운영 데이터를 가져오지 못했습니다",
        body: "/api/paper-operations 응답이 실패했거나 유효하지 않거나 오래되었습니다. 네트워크와 서버 상태를 확인한 뒤 새로고침해 주세요. 표시된 빈 값은 서버가 보고한 학습 결과가 아닙니다."
      });
    case "PROJECTION_ABSENT":
      return Object.freeze({
        title: "서버 응답에 PAPER 학습 projection이 없습니다",
        body: "PAPER 운영 snapshot은 정상 수신됐지만 paperLearning projection 자체가 포함되지 않았습니다. 서버의 paperLearning projection 구성을 점검해야 합니다 (mobile 문제가 아닙니다)."
      });
    case "LOCAL_FALLBACK":
      return null;
    default:
      break;
  }
  if (state.timeline.length > 0) return null;
  if (state.status === "RUNNING") return Object.freeze({
    title: "PAPER 런타임은 실행 중이지만 학습 이벤트가 없습니다",
    body: "서버가 RUNNING 상태를 보고했지만 아직 MARKET_DATA/DECISION/LEARNING 이벤트가 수신되지 않았습니다. 잠시 후 새로고침해도 계속 비어 있으면 서버의 paperLearning projection을 점검해야 합니다."
  });
  if (state.status === "HALTED") return Object.freeze({
    title: "PAPER 학습이 중단되어 있습니다",
    body: "HALTED 상태에서는 새 학습 사이클이 생성되지 않습니다. PAPER 서버의 안전 게이트, kill switch, P0 상태와 최근 오류를 확인해 주세요."
  });
  if (state.status === "ERROR") return Object.freeze({
    title: "PAPER 학습 데이터 오류",
    body: "서버가 ERROR 상태를 보고했습니다. 현재 화면의 빈 값은 정상 학습 결과가 아니라 데이터 소스/런타임 오류 상태입니다."
  });
  return Object.freeze({
    title: "PAPER 데이터 소스가 아직 준비되지 않았습니다",
    body: "연결 또는 세션이 설정되지 않았거나 PAPER 런타임이 PAUSED 상태일 수 있습니다. Settings에서 PAPER 서버 연결을 검증한 뒤 다시 새로고침해 주세요."
  });
};

function statusTone(status: PaperLearningScreenState["status"]): IntelligenceTone {
  if (status === "RUNNING") return "success";
  if (status === "PAUSED") return "warning";
  return "danger";
}

function sourceTone(source: PaperLearningScreenState["dataSource"]): IntelligenceTone {
  if (source === "SERVER_STREAM") return "success";
  if (source === "LOCAL_FALLBACK" || source === "PROJECTION_EMPTY") return "warning";
  return "danger";
}

function riskTone(status: string | null | undefined): IntelligenceTone {
  if (status == null) return "neutral";
  const normalized = status.toUpperCase();
  if (normalized.includes("PASS") || normalized.includes("OK") || normalized.includes("ALLOW")) return "success";
  if (normalized.includes("BLOCK") || normalized.includes("HALT") || normalized.includes("FAIL") || normalized.includes("REJECT")) return "danger";
  return "warning";
}

export function PaperLearningMonitorView({ state, refreshing, onRefresh, onClose }: PaperLearningMonitorViewProps) {
  const { theme } = useTheme();
  const { width } = useWindowDimensions();
  const tablet = width >= 768;
  const [detailsOpen, setDetailsOpen] = useState(false);
  const latestMarketEvent = useMemo(() => state.timeline.find((event) => event.stage === "MARKET_DATA") ?? null, [state.timeline]);
  const latestOrderEvent = useMemo(() => state.timeline.find((event) => event.stage === "ORDER_INTENT") ?? null, [state.timeline]);
  const latestTerminalEvent = useMemo(() => state.timeline.find((event) => event.stage === "HALT" || event.stage === "ERROR" || event.stage === "IDEMPOTENCY") ?? null, [state.timeline]);
  const sourceMessage = useMemo(() => dataSourceMessage(state), [state]);
  const runtimeTone = statusTone(state.status);
  const runtimeLabel = state.status === "RUNNING" ? "PAPER ACTIVE" : state.status === "PAUSED" ? "OBSERVING" : state.status;
  const totalPnl = state.latestAccount == null ? state.performance.realizedPnL + state.performance.unrealizedPnL : state.latestAccount.realizedPnL + state.latestAccount.unrealizedPnL;
  const pnlTone: IntelligenceTone = totalPnl > 0 ? "success" : totalPnl < 0 ? "danger" : "neutral";
  const learningLabel = state.latestEvidence?.outcome == null ? "WAITING" : learningOutcomeLabel[state.latestEvidence.outcome] ?? state.latestEvidence.outcome;
  const learningTone: IntelligenceTone = state.latestEvidence?.outcome === "PROMOTE" ? "success" : state.latestEvidence?.outcome === "REJECT" ? "danger" : "neutral";
  const sourceColor = sourceTone(state.dataSource) === "success" ? theme.colors.success : sourceTone(state.dataSource) === "warning" ? theme.colors.warning : theme.colors.danger;

  return <ScrollView
    contentContainerStyle={styles.content}
    refreshControl={<RefreshControl tintColor={theme.colors.primary} refreshing={refreshing} onRefresh={() => { void onRefresh(); }} />}
    style={[styles.screen, { backgroundColor: theme.colors.background }]}
    showsVerticalScrollIndicator={false}
    testID="paper-learning-monitor"
  >
    <AuthorityRail
      detail="AUTONOMOUS PAPER · LIVE NONE · AI ZERO AUTHORITY"
      status={runtimeLabel}
      tone={runtimeTone}
      testID="paper-learning-authority-rail"
    />
    <ScreenLead
      eyebrow="PAPER LEARNING · READ ONLY"
      title="운용 상태를 한눈에 감독합니다"
      detail="판단·위험·가상 실행·손익·학습을 같은 사이클에서 보되, 실행 권한과 평가 근거는 분리해서 표시합니다."
      badge="READ ONLY"
      badgeTone="info"
    />
    <MetricStrip
      items={[
        { label: "EQUITY", value: money(state.latestAccount?.equity), tone: "neutral" },
        { label: "TOTAL PNL", value: signedMoney(totalPnl), tone: pnlTone },
        { label: "RISK", value: state.latestRisk?.status ?? "UNKNOWN", tone: riskTone(state.latestRisk?.status) },
        { label: "LEARNING", value: learningLabel, tone: learningTone },
      ]}
      testID="paper-learning-glance-strip"
    />

    <View style={styles.sourceRow} testID="paper-learning-data-source">
      <View style={styles.sourceCopy}>
        <Text style={[styles.eyebrow, { color: theme.colors.textMuted }]}>DATA SOURCE</Text>
        <Text style={[styles.sourceValue, { color: theme.colors.text }]}>{state.dataSource}</Text>
      </View>
      <View style={[styles.sourcePill, { borderColor: sourceColor }]}><Text style={[styles.sourcePillText, { color: sourceColor }]}>{state.dataSource === "SERVER_STREAM" ? "SERVER" : state.dataSource === "LOCAL_FALLBACK" ? "LOCAL" : "CHECK"}</Text></View>
    </View>
    {state.dataSource === "LOCAL_FALLBACK" ? <StateNotice
      title="LOCAL FALLBACK"
      detail="서버 PAPER 학습 이벤트가 비어 있어 기기 내 공개 시세 기반 관측을 대신 표시합니다. 서버 런타임의 학습 결과가 아닙니다."
      tone="warning"
      testID="paper-learning-local-fallback-note"
    /> : null}
    {sourceMessage ? <View testID="paper-learning-empty-source">
      <Text style={styles.hiddenAcceptanceText} testID="paper-learning-empty-source-title">{sourceMessage.title}</Text>
      <Text style={styles.hiddenAcceptanceText} testID="paper-learning-empty-source-reason">{sourceMessage.body}</Text>
      <StateNotice title={sourceMessage.title} detail={sourceMessage.body} tone="warning" />
    </View> : null}

    <View style={tablet ? styles.columns : undefined}>
      <IntelligenceSection title="현재 사이클" kicker="NOW" tone="primary" style={tablet ? styles.column : undefined} testID="paper-learning-current-cycle">
        <FactRow label="MARKET" value={state.latestMarket ?? "—"} />
        <FactRow label="CYCLE" value={state.currentCycle ?? "—"} />
        <FactRow label="DATA" value={latestMarketEvent == null ? "NO DATA" : `${latestMarketEvent.status} · ${formatTimestamp(latestMarketEvent.occurredAt)}`} />
        <FactRow label="SIGNAL" value={state.latestSignal == null ? "—" : `${state.latestSignal.action}${state.latestSignal.confidence == null ? "" : ` · ${Math.round(state.latestSignal.confidence * 100)}%`}`} />
        <FactRow label="DECISION" value={state.latestDecision == null ? "—" : `${state.latestDecision.action} · ${formatNumber(state.latestDecision.allocation * 100, 1)}%`} />
        {latestMarketEvent?.reason ? <Text style={[styles.note, { color: theme.colors.textMuted }]} testID="paper-learning-freshness-reason">{latestMarketEvent.reason}</Text> : null}
      </IntelligenceSection>
      <IntelligenceSection title="권한 / 위험" kicker="AUTHORITY" tone={state.latestRisk == null ? "neutral" : riskTone(state.latestRisk.status)} style={tablet ? styles.column : undefined} testID="paper-learning-authority">
        <FactRow label="MODE" value="PAPER ONLY" tone="success" />
        <FactRow label="LIVE" value="NONE" tone="success" />
        <FactRow label="AI" value="ZERO AUTHORITY" tone="info" />
        {state.latestGates.length === 0 ? <StateNotice title="PERMISSION GATES" detail="최근 permission gate 관측값이 없습니다." tone="info" /> : state.latestGates.map((gate) => <FactRow key={gate.name} label={gate.name} value={`${gate.status} · ${gate.reason}`} tone={riskTone(gate.status)} testID={`paper-learning-gate-${gate.name}`} />)}
        <FactRow label="RISK" value={state.latestRisk == null ? "—" : `${state.latestRisk.status} · ${state.latestRisk.reason}`} tone={riskTone(state.latestRisk?.status)} />
        {state.latestRisk?.limits ? <Text style={[styles.note, { color: theme.colors.textMuted }]}>{Object.entries(state.latestRisk.limits).map(([key, value]) => `${key}=${formatNumber(value, 6)}`).join(" · ")}</Text> : null}
      </IntelligenceSection>
    </View>

    <View style={tablet ? styles.columns : undefined}>
      <IntelligenceSection title="가상 실행 / 계정" kicker="PAPER ACCOUNTING" tone="success" style={tablet ? styles.column : undefined} testID="paper-learning-execution">
        <FactRow label="ORDER" value={latestOrderEvent == null ? "—" : `${latestOrderEvent.status}${latestOrderEvent.reason ? ` · ${latestOrderEvent.reason}` : ""}`} />
        <FactRow label="FILL" value={state.latestFill == null ? "—" : `${state.latestFill.side} ${formatNumber(state.latestFill.quantity, 8)} @ ${formatNumber(state.latestFill.price)}`} />
        <FactRow label="CASH" value={money(state.latestAccount?.cash)} />
        <FactRow label="EQUITY" value={money(state.latestAccount?.equity)} />
        <FactRow label="REALIZED PNL" value={signedMoney(state.latestAccount?.realizedPnL)} tone={state.latestAccount?.realizedPnL == null ? "neutral" : state.latestAccount.realizedPnL >= 0 ? "success" : "danger"} />
        <FactRow label="UNREALIZED PNL" value={signedMoney(state.latestAccount?.unrealizedPnL)} tone={state.latestAccount?.unrealizedPnL == null ? "neutral" : state.latestAccount.unrealizedPnL >= 0 ? "success" : "danger"} />
        <FactRow label="FEE / SLIPPAGE" value={state.latestFill == null ? "—" : `${formatNumber(state.latestFill.fee)} / ${formatNumber(state.latestFill.slippage, 6)}`} />
      </IntelligenceSection>
      <IntelligenceSection title="학습 / 평가" kicker="LEARNING" tone={learningTone} style={tablet ? styles.column : undefined} testID="paper-learning-evaluation-card">
        <Text style={[styles.learningSummary, { color: theme.colors.textMuted }]} testID="paper-learning-outcome-summary">{learningOutcomeSummary(state.latestEvidence)}</Text>
        <FactRow label="OUTCOME" value={state.latestEvidence?.outcome ?? "—"} tone={learningTone} />
        <FactRow label="SCORE" value={formatNumber(state.latestEvidence?.score, 4)} />
        <FactRow label="EVIDENCE" value={state.latestEvidence?.evidenceId ?? "—"} />
        <FactRow label="INPUT HASH" value={state.latestEvidence?.inputHash ?? "—"} />
        {latestTerminalEvent ? <Text style={[styles.note, { color: theme.colors.textMuted }]} testID="paper-learning-terminal-event">{latestTerminalEvent.stage} · {latestTerminalEvent.status} · {latestTerminalEvent.reason ?? "—"}</Text> : null}
      </IntelligenceSection>
    </View>

    <IntelligenceSection title="누적 PAPER 성과" kicker="RESULT" tone={pnlTone} testID="paper-learning-performance">
      <View style={styles.performanceGrid}>
        <View style={styles.performanceCell}><Text style={[styles.performanceLabel, { color: theme.colors.textMuted }]}>REALIZED</Text><Text style={[styles.performanceValue, { color: state.performance.realizedPnL >= 0 ? theme.colors.success : theme.colors.danger }]}>{signedMoney(state.performance.realizedPnL)}</Text></View>
        <View style={styles.performanceCell}><Text style={[styles.performanceLabel, { color: theme.colors.textMuted }]}>UNREALIZED</Text><Text style={[styles.performanceValue, { color: state.performance.unrealizedPnL >= 0 ? theme.colors.success : theme.colors.danger }]}>{signedMoney(state.performance.unrealizedPnL)}</Text></View>
        <View style={styles.performanceCell}><Text style={[styles.performanceLabel, { color: theme.colors.textMuted }]}>WIN RATE</Text><Text style={[styles.performanceValue, { color: theme.colors.text }]}>{state.performance.winRate == null ? "—" : `${formatNumber(state.performance.winRate * 100, 1)}%`}</Text></View>
        <View style={styles.performanceCell}><Text style={[styles.performanceLabel, { color: theme.colors.textMuted }]}>MAX DD</Text><Text style={[styles.performanceValue, { color: theme.colors.text }]}>{`${formatNumber(state.performance.maxDrawdown * 100, 2)}%`}</Text></View>
      </View>
      <FactRow label="CYCLES / FILLED" value={`${state.performance.completedCycles} / ${state.performance.filledCycles}`} />
      <FactRow label="FEES" value={money(state.performance.fees)} />
      <FactRow label="TURNOVER" value={formatNumber(state.performance.turnover)} />
      <FactRow label="EXPECTANCY" value={formatNumber(state.performance.expectancy)} />
      <Text style={[styles.disclaimer, { color: theme.colors.textMuted }]}>PAPER 성과는 실제 LIVE 성과를 보장하지 않습니다.</Text>
    </IntelligenceSection>

    <Pressable
      accessibilityRole="button"
      accessibilityState={{ expanded: detailsOpen }}
      onPress={() => setDetailsOpen((open) => !open)}
      style={({ pressed }) => [styles.disclosure, { borderTopColor: theme.colors.border, borderBottomColor: theme.colors.border, opacity: pressed ? 0.72 : 1 }]}
      testID="paper-learning-detail-toggle"
    >
      <View style={styles.disclosureCopy}>
        <Text style={[styles.eyebrow, { color: theme.colors.primary }]}>EVIDENCE DETAIL</Text>
        <Text style={[styles.disclosureTitle, { color: theme.colors.text }]}>최근 사이클과 이벤트 타임라인</Text>
      </View>
      <Text style={[styles.disclosureIcon, { color: theme.colors.textMuted }]}>{detailsOpen ? "−" : "+"}</Text>
    </Pressable>

    {detailsOpen ? <View style={styles.detailStack}>
      <IntelligenceSection title="최근 사이클" kicker="COMPLETED CYCLES" tone="neutral" testID="paper-learning-recent-cycles">
        {state.recentCycles.length === 0 ? <StateNotice title="NO COMPLETED CYCLE" detail="아직 완료된 학습 사이클이 없습니다." tone="info" /> : state.recentCycles.map((cycle) => <View key={cycle.cycleId} style={[styles.cycleRow, { borderTopColor: theme.colors.border }]}>
          <View style={styles.cycleCopy}><Text style={[styles.cycleTitle, { color: theme.colors.text }]}>{cycle.market} · {cycle.status}</Text><Text style={[styles.cycleDetail, { color: theme.colors.textMuted }]}>{cycle.reason ?? "관측 사유 없음"}</Text></View>
          <Text style={[styles.cycleDecision, { color: theme.colors.textMuted }]}>{cycle.decision?.action ?? "NO DECISION"}</Text>
        </View>)}
      </IntelligenceSection>

      <IntelligenceSection title="Cycle Timeline" kicker="AUDIT TRAIL" tone="info" testID="paper-learning-timeline">
        {state.timeline.length === 0 ? <StateNotice title="NO EVENTS" detail="관측 이벤트가 없습니다." tone="info" /> : state.timeline.map((event) => <View key={event.id} style={[styles.timelineItem, { borderLeftColor: theme.colors.border }]} testID={`paper-learning-event-${event.stage}`}>
          <View style={styles.timelineHeader}><Text style={[styles.timelineStage, { color: theme.colors.text }]}>{event.stage}</Text><Text style={[styles.timelineStatus, { color: theme.colors.textMuted }]}>{event.status} · {formatTimestamp(event.occurredAt)}</Text></View>
          <Text style={[styles.timelineBody, { color: theme.colors.textMuted }]}>{eventSummary(event)}</Text>
        </View>)}
      </IntelligenceSection>
    </View> : null}

    <View style={styles.actions}>
      <NusaButton label="현재 상태 새로고침" onPress={() => { void onRefresh(); }} testID="paper-learning-refresh" />
      {onClose ? <NusaButton label="닫기" tone="neutral" onPress={onClose} testID="paper-learning-close" /> : null}
    </View>
    <Text style={[styles.footer, { color: theme.colors.textMuted }]}>PAPER ONLY · LIVE NONE · AI ZERO AUTHORITY</Text>
  </ScrollView>;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { width: "100%", maxWidth: 1080, alignSelf: "center", paddingHorizontal: 20, paddingTop: 14, paddingBottom: 120, gap: 18 },
  eyebrow: { fontSize: 9, lineHeight: 13, fontWeight: "900", letterSpacing: 1.15 },
  sourceRow: { minHeight: 58, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, paddingHorizontal: 2 },
  sourceCopy: { flex: 1, minWidth: 0, gap: 3 },
  sourceValue: { fontSize: 13, lineHeight: 18, fontWeight: "800" },
  sourcePill: { minHeight: 28, minWidth: 62, borderWidth: 1, borderRadius: 999, alignItems: "center", justifyContent: "center", paddingHorizontal: 10 },
  sourcePillText: { fontSize: 9, lineHeight: 13, fontWeight: "900", letterSpacing: 0.7 },
  columns: { flexDirection: "row", alignItems: "stretch", gap: 18 },
  column: { flex: 1, minWidth: 0 },
  note: { fontSize: 10, lineHeight: 16 },
  learningSummary: { fontSize: 12, lineHeight: 18 },
  performanceGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  performanceCell: { minWidth: 132, flex: 1, flexBasis: "44%", gap: 3, paddingVertical: 4 },
  performanceLabel: { fontSize: 9, lineHeight: 13, fontWeight: "900", letterSpacing: 0.75 },
  performanceValue: { fontSize: 18, lineHeight: 23, fontWeight: "900", fontVariant: ["tabular-nums"] },
  disclaimer: { fontSize: 10, lineHeight: 15 },
  disclosure: { minHeight: 68, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, paddingVertical: 14 },
  disclosureCopy: { flex: 1, minWidth: 0, gap: 3 },
  disclosureTitle: { fontSize: 15, lineHeight: 20, fontWeight: "800" },
  disclosureIcon: { fontSize: 22, lineHeight: 24, fontWeight: "500" },
  detailStack: { gap: 14 },
  cycleRow: { minHeight: 56, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 10, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  cycleCopy: { flex: 1, minWidth: 0, gap: 3 },
  cycleTitle: { fontSize: 12, lineHeight: 17, fontWeight: "800" },
  cycleDetail: { fontSize: 10, lineHeight: 15 },
  cycleDecision: { maxWidth: "36%", textAlign: "right", fontSize: 10, lineHeight: 15, fontWeight: "800" },
  timelineItem: { borderLeftWidth: 2, paddingLeft: 11, paddingVertical: 8, gap: 4 },
  timelineHeader: { flexDirection: "row", justifyContent: "space-between", gap: 8 },
  timelineStage: { fontSize: 11, lineHeight: 16, fontWeight: "900" },
  timelineStatus: { flexShrink: 1, textAlign: "right", fontSize: 9, lineHeight: 14 },
  timelineBody: { fontSize: 10, lineHeight: 16 },
  actions: { gap: 8 },
  footer: { textAlign: "center", fontSize: 9, lineHeight: 14, fontWeight: "900", letterSpacing: 1.05, paddingTop: 4 },
  hiddenAcceptanceText: { position: "absolute", width: 1, height: 1, opacity: 0 },
});
