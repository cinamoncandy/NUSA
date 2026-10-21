import React from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import type { HomeDestination } from "./homeView";
import type { PersonalPaperOperationsLoadResult } from "./personalPaperOperationsClient";
import type { WatchlistMarket } from "./watchlist";
import type { PublicCandle } from "./chartViewModel";
import { buildHomeFieldInput } from "./homeFieldInput";
import { buildIntelligenceField } from "./intelligenceFieldModel";
import { haltCauseFromSnapshot } from "./haltReasonModel";
import { buildLossLimitLine, buildTodayRealizedLine } from "./lossLimitModel";
import { describePaperOrderReason } from "./paperOrderReason";
import { explainDecision } from "./whyNoTradeModel";
import { useDailyCounts } from "./useDailyCounts";
import { chooseDailyCounts, partialWindowNote } from "./dailyResetModel";
import { staleLabel } from "./cachedSnapshotModel";
import { InstrumentEquity, InstrumentNow } from "./instrumentNow";
import { buildNowScreen } from "./nowScreenModel";
import { buildRiskGate } from "./riskGateModel";
import { RiskGateFlow } from "./riskGateFlow";
import { buildDecisionTerrain } from "./decisionTerrainModel";
import { calmColors } from "./uiKitModel";
import { readableFont } from "./designSystem";

type Snapshot = Extract<PersonalPaperOperationsLoadResult, { status: "READY" }>["snapshot"];

interface NowViewProps {
  readonly snapshot: Snapshot | null;
  readonly cachedSnapshot?: { readonly snapshot: Snapshot; readonly savedAt: number } | null;
  readonly investmentPercent: number;
  readonly readOnlyError: string | null;
  readonly notConfigured: string | null;
  readonly sessionRecovering?: boolean;
  readonly refreshing: boolean;
  readonly publicMarket: string;
  readonly publicMarkets: readonly WatchlistMarket[] | null;
  readonly publicCandles: readonly PublicCandle[] | null;
  readonly publicCurrentPrice: number | null;
  readonly publicMarketConnectionState: string;
  readonly publicMarketStale: boolean;
  readonly onRefresh: () => void;
  readonly onGoSettings: () => void;
  readonly onNavigate: (destination: HomeDestination) => void;
  readonly onOpenPaperLearning: () => void;
}

/** "지금" — the calm redesign of HOME. Same props and data derivations as HomeView; presentation only. */
export function NowView({ snapshot: liveSnapshot, cachedSnapshot = null, readOnlyError, notConfigured, sessionRecovering = false, refreshing, publicMarketStale, onRefresh, onGoSettings, onNavigate }: NowViewProps) {
  const stale = liveSnapshot == null && cachedSnapshot != null && notConfigured == null;
  const snapshot = stale ? cachedSnapshot.snapshot : liveSnapshot;
  const blocked = stale || notConfigured != null || readOnlyError != null || sessionRecovering;
  const fieldInput = buildHomeFieldInput({ snapshot: stale ? null : snapshot, readOnlyError, notConfigured, sessionRecovering: Boolean(sessionRecovering), publicMarketStale });
  const haltCause = haltCauseFromSnapshot(stale ? null : snapshot);
  const heartbeat = snapshot?.operations.heartbeat ?? null;
  const baselineCounts = useDailyCounts(stale ? null : heartbeat?.startedAt ?? null, stale ? null : fieldInput.decisionCount, stale ? null : fieldInput.paperOrderCount);
  const dailyCounts = stale ? Object.freeze({ decisionCount: null, paperOrderCount: null }) : chooseDailyCounts(heartbeat?.windowDecisionCount, heartbeat?.windowOrderCount, baselineCounts);
  const field = buildIntelligenceField({ ...fieldInput, haltCause, decisionCount: dailyCounts.decisionCount, paperOrderCount: dailyCounts.paperOrderCount });
  const account = snapshot?.portfolio?.account ?? null;
  const totalPnl = account == null ? null : (account.realizedPnl ?? account.position.realizedPnl) + account.unrealizedPnl;
  const orderReason = blocked ? null : describePaperOrderReason(heartbeat?.lastPaperDecisionOutcome);
  const todayRealized = blocked ? null : buildTodayRealizedLine(heartbeat?.todayRealized, Date.now());
  const lossLimit = blocked ? null : buildLossLimitLine(heartbeat?.lossLimit, Date.now(), haltCause != null || field.phase === "HALTED");
  const model = buildNowScreen({
    phase: field.phase,
    phaseHeadline: field.headline,
    phaseDetail: field.detail,
    staleLabel: stale && cachedSnapshot != null ? staleLabel(cachedSnapshot.savedAt, Date.now()) : null,
    equity: account?.equity ?? null,
    totalPnl,
    startingEquity: account != null && totalPnl != null ? account.equity - totalPnl : null,
    orderReasonText: orderReason?.text ?? null,
    whyLines: blocked ? [] : explainDecision(heartbeat?.lastDecisionDetail),
    decisionCount: heartbeat?.decisionCount ?? null,
    paperOrderCount: heartbeat?.paperOrderCount ?? null,
    fillCount: heartbeat?.paperFillCount ?? null,
  });
  // The main motion graphic: today's decision terrain from the server's display-only trace (nothing drawn while stale or blocked).
  const traceSource: { readonly decisionCount?: unknown; readonly decisionTrace?: unknown } | null = heartbeat ?? null;
  const rawLossLimit: { readonly consecutiveLossCount?: unknown; readonly maxConsecutiveLosses?: unknown; readonly periodStartedAt?: unknown; readonly limitReachedAt?: unknown } | null = heartbeat?.lossLimit ?? null;
  // Redesign 2026-10-19: when the loss limit holds new buys, say where the flow stopped (the risk gate), not just "no execution".
  const gate = blocked || field.phase !== "ATTENTION" ? null : buildRiskGate({ lossLimitState: lossLimit?.state ?? null, decisionCount: dailyCounts.decisionCount, paperOrderCount: dailyCounts.paperOrderCount, buySignalCount: heartbeat?.buySignalCount, buyBlockedCount: heartbeat?.buyBlockedCount, consecutiveLossCount: rawLossLimit?.consecutiveLossCount, maxConsecutiveLosses: rawLossLimit?.maxConsecutiveLosses, periodStartedAt: rawLossLimit?.periodStartedAt, limitReachedAt: rawLossLimit?.limitReachedAt, now: Date.now() });
  const terrain = buildDecisionTerrain({ trace: blocked ? null : traceSource?.decisionTrace, now: Date.now(), limitReachedAt: blocked ? null : rawLossLimit?.limitReachedAt });
  const needsSetup = notConfigured != null || readOnlyError != null;
  return <View style={styles.shell} testID="now-screen">
    <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl tintColor={calmColors.text} refreshing={refreshing} onRefresh={onRefresh} />} showsVerticalScrollIndicator={false}>
      <Text style={styles.brand}>NUSA</Text>
      {gate ? <RiskGateFlow gate={gate} lossText={lossLimit?.text ?? null} windowNote={partialWindowNote(heartbeat?.buyCountsSince, Date.now())} terrain={terrain} decisionCount={dailyCounts.decisionCount} /> : <InstrumentNow tone={model.tone} headline={model.headline} sub={model.sub} dim={model.dim} decisionCount={blocked ? null : dailyCounts.decisionCount} orderCount={blocked ? null : dailyCounts.paperOrderCount} stats={model.stats} />}
      <InstrumentEquity value={model.equity} caption={model.delta} tone={model.deltaTone} dim={model.dim} />
      {todayRealized == null ? null : <Text style={[styles.footnote, { color: todayRealized.tone === "LOSS" ? calmColors.loss : calmColors.text }]} testID="now-today-realized">{todayRealized.text}</Text>}
      {lossLimit == null || gate ? null : <View style={styles.why} testID="now-loss-limit">
        <Text style={[styles.whyText, { color: calmColors.attention }]}>{lossLimit.text}</Text>
      </View>}
      {model.why == null ? null : <Pressable accessibilityRole="button" onPress={() => onNavigate("Paper")} style={styles.why} testID="now-why">
        <Text style={styles.whyText}>{model.why} <Text style={styles.link}>왜요?</Text></Text>
      </Pressable>}
      <Text style={styles.footnote}>숫자는 서버가 시작된 뒤부터 센 값이에요</Text>
      {needsSetup ? <Pressable accessibilityRole="button" onPress={onGoSettings} style={styles.setup} testID="now-setup">
        <Text style={styles.setupText}>연결 설정 열기 →</Text>
      </Pressable> : null}
    </ScrollView>
  </View>;
}

const styles = StyleSheet.create({
  shell: { flex: 1, backgroundColor: calmColors.ground },
  content: { paddingBottom: 32, width: "100%", maxWidth: 720, alignSelf: "center" },
  brand: { color: calmColors.muted, fontSize: readableFont(12), letterSpacing: 5, paddingHorizontal: 20, paddingTop: 18 },
  dim: { opacity: 0.55 },
  why: { marginHorizontal: 20, marginTop: 14, paddingTop: 14, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: calmColors.line },
  whyText: { color: calmColors.text, fontSize: readableFont(15), lineHeight: 23 },
  link: { color: calmColors.muted, textDecorationLine: "underline" },
  footnote: { color: calmColors.muted, fontSize: readableFont(12), paddingHorizontal: 20, marginTop: 4 },
  setup: { marginHorizontal: 20, marginTop: 18, paddingVertical: 14, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: calmColors.line, minHeight: 48 },
  setupText: { color: calmColors.attention, fontSize: readableFont(15) },
});
