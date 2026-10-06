import React from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import type { HomeDestination } from "./homeView";
import type { PersonalPaperOperationsLoadResult } from "./personalPaperOperationsClient";
import type { WatchlistMarket } from "./watchlist";
import type { PublicCandle } from "./chartViewModel";
import { buildHomeFieldInput } from "./homeFieldInput";
import { buildIntelligenceField } from "./intelligenceFieldModel";
import { haltCauseFromSnapshot } from "./haltReasonModel";
import { describePaperOrderReason } from "./paperOrderReason";
import { explainDecision } from "./whyNoTradeModel";
import { useDailyCounts } from "./useDailyCounts";
import { chooseDailyCounts } from "./dailyResetModel";
import { staleLabel } from "./cachedSnapshotModel";
import { DecisionRings } from "./decisionRings";
import { buildNowScreen } from "./nowScreenModel";
import { CalmBigNumber, CalmHeadline, CalmStats } from "./uiKit";
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
  const ringsStatus = field.phase === "HALTED" ? { title: field.headline, detail: field.detail, tone: "halt" as const } : null;
  const heroMarket = Array.isArray(heartbeat?.tradedMarkets) && typeof heartbeat?.tradedMarkets[0] === "string" ? heartbeat.tradedMarkets[0] as string : null;
  const needsSetup = notConfigured != null || readOnlyError != null;
  return <View style={styles.shell} testID="now-screen">
    <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl tintColor={calmColors.text} refreshing={refreshing} onRefresh={onRefresh} />} showsVerticalScrollIndicator={false}>
      <Text style={styles.brand}>NUSA</Text>
      <CalmHeadline tone={model.tone} text={model.headline} sub={model.sub} />
      <View style={model.dim ? styles.dim : undefined} testID="now-hero">
        <DecisionRings status={ringsStatus} decisionCount={blocked ? null : dailyCounts.decisionCount} paperOrderCount={blocked ? null : dailyCounts.paperOrderCount} marketLabel={heroMarket} />
      </View>
      <View style={styles.block}>
        <CalmBigNumber value={model.equity} caption={model.delta ?? undefined} captionTone={model.deltaTone} dim={model.dim} />
      </View>
      {model.why == null ? null : <Pressable accessibilityRole="button" onPress={() => onNavigate("Paper")} style={styles.why} testID="now-why">
        <Text style={styles.whyText}>{model.why} <Text style={styles.link}>왜요?</Text></Text>
      </Pressable>}
      <View style={[styles.block, model.dim ? styles.dim : undefined]}><CalmStats items={model.stats} /></View>
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
  block: { paddingHorizontal: 20, marginTop: 6 },
  why: { marginHorizontal: 20, marginTop: 14, paddingTop: 14, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: calmColors.line },
  whyText: { color: calmColors.text, fontSize: readableFont(15), lineHeight: 23 },
  link: { color: calmColors.muted, textDecorationLine: "underline" },
  footnote: { color: calmColors.muted, fontSize: readableFont(12), paddingHorizontal: 20, marginTop: 4 },
  setup: { marginHorizontal: 20, marginTop: 18, paddingVertical: 14, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: calmColors.line, minHeight: 48 },
  setupText: { color: calmColors.attention, fontSize: readableFont(15) },
});
