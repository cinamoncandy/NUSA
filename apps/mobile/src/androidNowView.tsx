import React from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { useTheme } from "./ThemeProvider";
import { HomeView as LegacyHomeView } from "./homeViewLegacy";
import { createCashInvestmentEnvelope } from "./capitalAllocationGuard";
import { buildHomeDecisionSurface } from "./homeDecisionSurface";
import { buildLocalPortfolio, isLocalPaperActive } from "./localPaperLedger";
import { useLocalPaperMarkPrice, useLocalPaperSnapshot } from "./localPaperLedgerHooks";

type Props = React.ComponentProps<typeof LegacyHomeView>;

type PriorityTone = "normal" | "attention" | "blocked";

type PriorityState = Readonly<{
  eyebrow: string;
  title: string;
  detail: string;
  tone: PriorityTone;
  actionLabel: string;
  action: () => void;
}>;

function krw(value: number): string {
  return `₩${Math.round(value).toLocaleString("ko-KR")}`;
}

function signedKrw(value: number): string {
  return `${value >= 0 ? "+" : "-"}${krw(Math.abs(value))}`;
}

function percent(value: number | null): string {
  return value == null || !Number.isFinite(value) ? "—" : `${(value * 100).toFixed(1)}%`;
}

function Meta({ children, accent = false }: Readonly<{ children: React.ReactNode; accent?: boolean }>) {
  const { theme } = useTheme();
  return <Text style={[styles.meta, { color: accent ? theme.colors.primary : theme.colors.textMuted }]}>{children}</Text>;
}

function Divider() {
  const { theme } = useTheme();
  return <View style={[styles.divider, { backgroundColor: theme.colors.border }]} />;
}

function TruthCell({ label, value, tone = "default" }: Readonly<{ label: string; value: string; tone?: "default" | "accent" | "warning" }>) {
  const { theme } = useTheme();
  const color = tone === "accent" ? theme.colors.primary : tone === "warning" ? theme.colors.warning : theme.colors.text;
  return <View style={styles.truthCell}><Meta>{label}</Meta><Text style={[styles.truthValue, { color }]}>{value}</Text></View>;
}

function EvidenceLine({ children, counter = false }: Readonly<{ children: React.ReactNode; counter?: boolean }>) {
  const { theme } = useTheme();
  return <View style={styles.evidenceLine}><View style={[styles.evidenceDot, { backgroundColor: counter ? theme.colors.danger : theme.colors.primary }]} /><Text style={[styles.evidenceText, { color: theme.colors.text }]}>{children}</Text></View>;
}

function ConstraintRow({ label, value, tone = "default" }: Readonly<{ label: string; value: string; tone?: "default" | "positive" | "warning" }>) {
  const { theme } = useTheme();
  const color = tone === "positive" ? theme.colors.success : tone === "warning" ? theme.colors.warning : theme.colors.text;
  return <View style={[styles.constraintRow, { borderTopColor: theme.colors.border }]}><Text style={[styles.constraintLabel, { color: theme.colors.textMuted }]}>{label}</Text><Text style={[styles.constraintValue, { color }]}>{value}</Text></View>;
}

export function AndroidNowView(props: Props) {
  const { theme } = useTheme();
  const localPaperActive = props.snapshot == null && isLocalPaperActive();
  const localTradingSnapshot = useLocalPaperSnapshot();
  const localMarkPrice = useLocalPaperMarkPrice(localPaperActive);
  const localPortfolio = localPaperActive ? buildLocalPortfolio(localTradingSnapshot, localMarkPrice) : null;
  const account = props.snapshot?.portfolio?.account ?? localPortfolio?.account ?? null;
  const ai = props.snapshot?.ai ?? null;
  const disconnected = props.notConfigured != null || props.readOnlyError != null;
  const paperReady = props.snapshot?.readyForPaperOperations ?? false;
  const marketFresh = props.publicMarketConnectionState === "CONNECTED" && !props.publicMarketStale;
  const assetValue = account == null ? null : account.assetValue ?? Math.max(0, account.equity - account.cash);
  const realized = account == null ? null : (account.realizedPnl ?? account.position.realizedPnl);
  const unrealized = account?.unrealizedPnl ?? null;
  const totalPnl = realized == null || unrealized == null ? null : realized + unrealized;
  const exposure = account == null || assetValue == null || account.equity <= 0 ? null : Math.max(0, Math.min(1, assetValue / account.equity));
  const allocation = account == null ? null : createCashInvestmentEnvelope(account.cash, props.investmentPercent);
  const positionOpen = account != null && account.position.quantity > 0 && Boolean(account.position.market);
  const trustedConfidence = ai?.calibrationStatus === "CALIBRATED" && ai.confidence != null && Number.isFinite(ai.confidence)
    ? `${Math.round(ai.confidence * 100)}%`
    : "—";

  const decision = buildHomeDecisionSurface({
    runtimeState: props.snapshot?.operations.runtimeState,
    health: props.snapshot?.health,
    readyForPaperOperations: paperReady,
    disconnected,
    readOnlyError: props.readOnlyError != null,
    accountSource: props.snapshot != null ? "CLOUD" : localPortfolio != null ? "LOCAL" : null,
    paperEquity: account?.equity,
    paperTotalPnl: totalPnl,
    aiThesis: ai?.status === "AVAILABLE" ? ai.thesis : null,
    aiEvidenceCount: ai?.status === "AVAILABLE" ? ai.evidenceReferences.length : 0,
    aiCalibrationStatus: ai?.calibrationStatus,
    aiConfidence: ai?.confidence,
  });

  const runDecisionAction = () => {
    switch (decision.primaryAction) {
      case "SETTINGS": props.onGoSettings(); break;
      case "PORTFOLIO": props.onNavigate("Portfolio"); break;
      case "AI_SIGNAL": props.onNavigate("AiSignal"); break;
      case "MARKETS": props.onNavigate("Markets"); break;
    }
  };

  const priority: PriorityState = disconnected
    ? {
      eyebrow: "HIGH PRIORITY · CONNECTION",
      title: "연결 상태 확인이 필요합니다",
      detail: props.readOnlyError ?? props.notConfigured ?? "PAPER 연결 상태를 확인하세요.",
      tone: "blocked",
      actionLabel: "CONTROL에서 확인",
      action: props.onGoSettings,
    }
    : props.snapshot != null && !paperReady
      ? {
        eyebrow: "HIGH PRIORITY · SAFETY GATE",
        title: "PAPER 운용 게이트가 차단되었습니다",
        detail: "현재 검증 상태에서는 운용 행동보다 차단 원인 확인이 우선입니다.",
        tone: "attention",
        actionLabel: "상태 확인",
        action: props.onGoSettings,
      }
      : ai?.status === "AVAILABLE"
        ? {
          eyebrow: "OWNER REVIEW",
          title: ai.thesis || "새 NUSA 판단이 준비되었습니다",
          detail: "핵심 근거와 가장 강한 반대 근거를 확인한 뒤 사용자가 결정합니다.",
          tone: "normal",
          actionLabel: "판단 검토",
          action: () => props.onNavigate("AiSignal"),
        }
        : positionOpen
          ? {
            eyebrow: "POSITION SUPERVISION",
            title: "열린 포지션을 감독하고 있습니다",
            detail: "현재 포지션과 자산 노출의 변화를 확인하세요.",
            tone: "normal",
            actionLabel: "자산 감독",
            action: () => props.onNavigate("Portfolio"),
          }
          : {
            eyebrow: "MONITORING",
            title: "현재 긴급한 사용자 결정은 없습니다",
            detail: "NUSA는 시장과 PAPER 상태를 계속 관찰하고 있습니다.",
            tone: "normal",
            actionLabel: "시장 보기",
            action: () => props.onNavigate("Markets"),
          };

  const priorityColor = priority.tone === "blocked" ? theme.colors.danger : priority.tone === "attention" ? theme.colors.warning : theme.colors.primary;
  const pnlColor = totalPnl == null ? theme.colors.text : totalPnl >= 0 ? theme.colors.success : theme.colors.danger;
  const evidence = ai?.evidenceReferences ?? [];
  const counterEvidence = ai?.counterEvidence ?? [];

  const alerts: readonly Readonly<{ label: string; value: string; tone: "warning" | "neutral" }>[] = [
    ...(disconnected ? [{ label: "연결", value: "확인 필요", tone: "warning" as const }] : []),
    ...(!marketFresh ? [{ label: "시장 데이터", value: props.publicMarketConnectionState === "CONNECTED" ? "STALE" : "UNKNOWN", tone: "warning" as const }] : []),
    ...(props.snapshot != null && !paperReady ? [{ label: "PAPER GATE", value: "BLOCKED", tone: "warning" as const }] : []),
  ];

  return <ScrollView
    style={{ backgroundColor: theme.colors.background }}
    contentContainerStyle={styles.content}
    refreshControl={<RefreshControl tintColor={theme.colors.primary} refreshing={props.refreshing} onRefresh={props.onRefresh} />}
    testID="home-screen"
  >
    <View style={styles.brandRow} testID="android-now-brand">
      <View><Text style={[styles.wordmark, { color: theme.colors.text }]}>NUSA</Text><Text style={[styles.productLine, { color: theme.colors.primary }]}>AI INVESTMENT OS</Text></View>
      <Text style={[styles.androidOnly, { color: theme.colors.textMuted }]}>ANDROID · TEMP C</Text>
    </View>

    <View style={[styles.truthRail, { borderColor: theme.colors.borderStrong, backgroundColor: theme.colors.surface }]} testID="android-system-truth-rail">
      <TruthCell label="SYSTEM TRUTH" value="PAPER ONLY" tone="accent" />
      <TruthCell label="AI AUTHORITY" value="ZERO" />
      <TruthCell label="MARKET DATA" value={marketFresh ? "FRESH" : "CHECK"} tone={marketFresh ? "accent" : "warning"} />
    </View>

    <View style={styles.sectionLead}><Text style={[styles.sectionLeadAccent, { color: theme.colors.text }]}>NOW</Text><Text style={[styles.sectionLeadSub, { color: theme.colors.textMuted }]}>지금 가장 중요한 것</Text></View>

    <View style={[styles.nowStage, { borderColor: theme.colors.borderStrong, backgroundColor: theme.colors.surface }]} testID="android-now-priority">
      <View style={[styles.priorityBar, { backgroundColor: priorityColor }]} />
      <View style={styles.nowCopy}>
        <Meta accent>{priority.eyebrow}</Meta>
        <Text style={[styles.nowTitle, { color: theme.colors.text }]}>{priority.title}</Text>
        <Text style={[styles.nowDetail, { color: theme.colors.textMuted }]}>{priority.detail}</Text>
        <Pressable accessibilityRole="button" onPress={priority.action} style={({ pressed }) => [styles.inlineAction, { borderColor: theme.colors.borderStrong, backgroundColor: theme.colors.surfaceSunken, opacity: pressed ? theme.interaction.pressedOpacity : 1 }]}>
          <Text style={[styles.inlineActionLabel, { color: theme.colors.text }]}>{priority.actionLabel}</Text><Text style={[styles.inlineActionArrow, { color: priorityColor }]}>→</Text>
        </Pressable>
      </View>
    </View>

    {ai?.status === "AVAILABLE" ? <View style={[styles.decisionCard, { borderColor: theme.colors.borderStrong, backgroundColor: theme.colors.surface }]} testID="android-now-decision">
      <View style={styles.decisionHeader}>
        <View><Meta accent>NUSA · 최근 판단</Meta><Text style={[styles.decisionTitle, { color: theme.colors.text }]}>{ai.thesis || "검증된 판단"}</Text></View>
        <View style={[styles.reliabilityBadge, { borderColor: theme.colors.border }]}><Meta>CALIBRATED</Meta><Text style={[styles.reliabilityValue, { color: trustedConfidence === "—" ? theme.colors.textMuted : theme.colors.text }]}>{trustedConfidence}</Text></View>
      </View>
      <Divider />
      <View style={styles.evidenceColumns}>
        <View style={styles.evidenceColumn}><Meta accent>핵심 근거</Meta>{evidence.length > 0 ? evidence.slice(0, 3).map((item, index) => <EvidenceLine key={`support-${index}`}>{item}</EvidenceLine>) : <Text style={[styles.emptyText, { color: theme.colors.textMuted }]}>검증된 근거 참조 없음</Text>}</View>
        <View style={styles.evidenceColumn}><Meta>가장 강한 반대 근거</Meta>{counterEvidence.length > 0 ? counterEvidence.slice(0, 2).map((item, index) => <EvidenceLine counter key={`counter-${index}`}>{item}</EvidenceLine>) : <Text style={[styles.emptyText, { color: theme.colors.textMuted }]}>등록된 반대 근거 없음</Text>}</View>
      </View>
      <Pressable accessibilityRole="button" onPress={() => props.onNavigate("AiSignal")} style={({ pressed }) => [styles.fullWidthAction, { borderTopColor: theme.colors.border, opacity: pressed ? theme.interaction.pressedOpacity : 1 }]}>
        <Text style={[styles.fullWidthActionText, { color: theme.colors.primary }]}>상세 분석 보기</Text><Text style={[styles.inlineActionArrow, { color: theme.colors.primary }]}>→</Text>
      </Pressable>
    </View> : null}

    <View style={styles.summaryGrid} testID="android-now-assets">
      <View style={[styles.summaryCard, styles.summaryCardWide, { borderColor: theme.colors.border, backgroundColor: theme.colors.surface }]}>
        <Meta>자산 현황 · ASSET STATE</Meta>
        <Text style={[styles.assetValue, { color: theme.colors.text }]}>{account == null ? "—" : krw(account.equity)}</Text>
        <Text style={[styles.assetDelta, { color: pnlColor }]}>{totalPnl == null ? "검증된 PnL 대기" : signedKrw(totalPnl)}</Text>
      </View>
      <View style={[styles.summaryCard, { borderColor: theme.colors.border, backgroundColor: theme.colors.surface }]}>
        <Meta>노출 현황</Meta>
        <Text style={[styles.exposureValue, { color: theme.colors.text }]}>{percent(exposure)}</Text>
        <Text style={[styles.summarySub, { color: theme.colors.textMuted }]}>{positionOpen && account ? account.position.market : "NO POSITION"}</Text>
      </View>
    </View>

    <View style={[styles.controlCard, { borderColor: theme.colors.border, backgroundColor: theme.colors.surface }]} testID="android-now-control">
      <View style={styles.sectionHeader}><View><Text style={[styles.sectionTitle, { color: theme.colors.text }]}>위험 제약</Text><Meta>REAL CONSTRAINTS ONLY</Meta></View><Text style={[styles.controlState, { color: paperReady ? theme.colors.success : theme.colors.warning }]}>{paperReady ? "READY" : "FAIL CLOSED"}</Text></View>
      <ConstraintRow label="PAPER GATE" value={paperReady ? "READY" : "BLOCKED"} tone={paperReady ? "positive" : "warning"} />
      <ConstraintRow label="LIVE AUTHORITY" value="NONE" />
      <ConstraintRow label="AI AUTHORITY" value="ZERO" />
      {allocation ? <ConstraintRow label="PROTECTED CASH" value={krw(allocation.reservedCash)} /> : null}
    </View>

    <View style={[styles.nextCard, { borderColor: theme.colors.border, backgroundColor: theme.colors.surface }]} testID="android-now-next-actions">
      <View style={styles.sectionHeader}><View><Text style={[styles.sectionTitle, { color: theme.colors.text }]}>다음 행동 제안</Text><Meta>NUSA SUGGESTION</Meta></View></View>
      <Pressable accessibilityRole="button" onPress={runDecisionAction} style={({ pressed }) => [styles.nextPrimary, { borderColor: theme.colors.borderStrong, backgroundColor: theme.colors.surfaceSunken, opacity: pressed ? theme.interaction.pressedOpacity : 1 }]} testID="home-supervisor-primary-action">
        <View style={styles.nextPrimaryCopy}><Text style={[styles.nextPrimaryTitle, { color: theme.colors.text }]}>{decision.primaryLabel}</Text><Text style={[styles.nextPrimaryDetail, { color: theme.colors.textMuted }]}>{decision.result}</Text></View><Text style={[styles.nextChevron, { color: theme.colors.primary }]}>→</Text>
      </Pressable>
      <View style={styles.quickActions}>
        <Pressable onPress={() => props.onNavigate("Markets")} style={styles.quickAction}><Meta>MARKETS</Meta><Text style={[styles.quickLabel, { color: theme.colors.text }]}>시장 확인</Text></Pressable>
        <Pressable onPress={() => props.onNavigate("Portfolio")} style={styles.quickAction}><Meta>ASSETS</Meta><Text style={[styles.quickLabel, { color: theme.colors.text }]}>자산 감독</Text></Pressable>
        <Pressable onPress={props.onOpenPaperLearning} style={styles.quickAction}><Meta>LEARNING</Meta><Text style={[styles.quickLabel, { color: theme.colors.text }]}>학습 근거</Text></Pressable>
      </View>
    </View>

    <View style={[styles.alertCard, { borderColor: theme.colors.border, backgroundColor: theme.colors.surface }]} testID="android-now-alerts">
      <View style={styles.sectionHeader}><View><Text style={[styles.sectionTitle, { color: theme.colors.text }]}>중요 알림</Text><Meta>PRIORITIZED</Meta></View><Text style={[styles.alertCount, { color: alerts.length > 0 ? theme.colors.warning : theme.colors.textMuted }]}>{alerts.length}</Text></View>
      {alerts.length === 0 ? <Text style={[styles.emptyText, { color: theme.colors.textMuted }]}>현재 우선 처리가 필요한 시스템 알림이 없습니다.</Text> : alerts.map((alert) => <View key={`${alert.label}-${alert.value}`} style={[styles.alertRow, { borderTopColor: theme.colors.border }]}><View style={[styles.alertDot, { backgroundColor: alert.tone === "warning" ? theme.colors.warning : theme.colors.primary }]} /><Text style={[styles.alertLabel, { color: theme.colors.text }]}>{alert.label}</Text><Text style={[styles.alertValue, { color: theme.colors.textMuted }]}>{alert.value}</Text></View>)}
    </View>

    <Text style={[styles.footer, { color: theme.colors.textMuted }]}>판단을 설득하지 않습니다. 검증 가능하게 만들고, 결정은 사용자에게 남깁니다.</Text>
  </ScrollView>;
}

const styles = StyleSheet.create({
  content: { width: "100%", maxWidth: 620, alignSelf: "center", paddingHorizontal: 16, paddingTop: 16, paddingBottom: 30, gap: 14 },
  brandRow: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", gap: 12, paddingHorizontal: 2, paddingBottom: 2 },
  wordmark: { fontFamily: "serif", fontSize: 33, lineHeight: 39, fontWeight: "400", letterSpacing: 3.9 },
  productLine: { fontSize: 8, lineHeight: 12, fontWeight: "700", letterSpacing: 2.05 },
  androidOnly: { fontSize: 7, lineHeight: 10, fontWeight: "700", letterSpacing: 0.95 },
  truthRail: { minHeight: 68, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, flexDirection: "row", alignItems: "center" },
  truthCell: { flex: 1, gap: 4 },
  truthValue: { fontSize: 11, lineHeight: 15, fontWeight: "700", fontVariant: ["tabular-nums"] },
  meta: { fontSize: 7, lineHeight: 10, fontWeight: "700", letterSpacing: 1.0 },
  sectionLead: { flexDirection: "row", alignItems: "baseline", gap: 10, paddingHorizontal: 2 },
  sectionLeadAccent: { fontSize: 22, lineHeight: 27, fontWeight: "700", letterSpacing: 0.1 },
  sectionLeadSub: { fontSize: 10, lineHeight: 15 },
  nowStage: { minHeight: 190, borderWidth: 1, borderRadius: 12, overflow: "hidden", flexDirection: "row" },
  priorityBar: { width: 5 },
  nowCopy: { flex: 1, padding: 18, gap: 10, justifyContent: "center" },
  nowTitle: { fontSize: 24, lineHeight: 32, fontWeight: "600", letterSpacing: -0.65 },
  nowDetail: { fontSize: 11, lineHeight: 18, maxWidth: 440 },
  inlineAction: { alignSelf: "flex-start", minHeight: 48, borderWidth: 1, borderRadius: 24, paddingHorizontal: 16, flexDirection: "row", alignItems: "center", gap: 12, marginTop: 4 },
  inlineActionLabel: { fontSize: 11, lineHeight: 15, fontWeight: "700" },
  inlineActionArrow: { fontSize: 18, lineHeight: 20, fontWeight: "300" },
  decisionCard: { borderWidth: 1, borderRadius: 12, padding: 16, gap: 13 },
  decisionHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 16 },
  decisionTitle: { marginTop: 5, fontSize: 20, lineHeight: 28, fontWeight: "600", maxWidth: 360 },
  reliabilityBadge: { minWidth: 82, borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, alignItems: "flex-end", gap: 2 },
  reliabilityValue: { fontSize: 17, lineHeight: 22, fontWeight: "500", fontVariant: ["tabular-nums"] },
  divider: { height: StyleSheet.hairlineWidth, width: "100%" },
  evidenceColumns: { flexDirection: "row", gap: 16 },
  evidenceColumn: { flex: 1, gap: 8 },
  evidenceLine: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  evidenceDot: { width: 5, height: 5, borderRadius: 3, marginTop: 6 },
  evidenceText: { flex: 1, fontSize: 10, lineHeight: 17 },
  emptyText: { fontSize: 10, lineHeight: 17 },
  fullWidthAction: { minHeight: 48, borderTopWidth: StyleSheet.hairlineWidth, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingTop: 10 },
  fullWidthActionText: { fontSize: 11, lineHeight: 16, fontWeight: "700" },
  summaryGrid: { flexDirection: "row", gap: 10 },
  summaryCard: { flex: 1, minHeight: 126, borderWidth: 1, borderRadius: 12, padding: 14, justifyContent: "space-between", gap: 7 },
  summaryCardWide: { flex: 1.35 },
  assetValue: { fontSize: 25, lineHeight: 31, fontWeight: "400", fontVariant: ["tabular-nums"] },
  assetDelta: { fontSize: 11, lineHeight: 16, fontWeight: "600", fontVariant: ["tabular-nums"] },
  exposureValue: { fontSize: 27, lineHeight: 33, fontWeight: "400", fontVariant: ["tabular-nums"] },
  summarySub: { fontSize: 9, lineHeight: 13, fontWeight: "600" },
  controlCard: { borderWidth: 1, borderRadius: 12, padding: 14, gap: 6 },
  sectionHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 },
  sectionTitle: { fontSize: 14, lineHeight: 19, fontWeight: "700" },
  controlState: { fontSize: 9, lineHeight: 13, fontWeight: "700", letterSpacing: 0.7 },
  constraintRow: { minHeight: 44, borderTopWidth: StyleSheet.hairlineWidth, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 16 },
  constraintLabel: { flex: 1, fontSize: 9, lineHeight: 13 },
  constraintValue: { fontSize: 10, lineHeight: 14, fontWeight: "700", fontVariant: ["tabular-nums"] },
  nextCard: { borderWidth: 1, borderRadius: 12, padding: 14, gap: 11 },
  nextPrimary: { minHeight: 86, borderWidth: 1, borderRadius: 10, padding: 14, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 14 },
  nextPrimaryCopy: { flex: 1, gap: 4 },
  nextPrimaryTitle: { fontSize: 14, lineHeight: 20, fontWeight: "700" },
  nextPrimaryDetail: { fontSize: 10, lineHeight: 16 },
  nextChevron: { fontSize: 24, lineHeight: 28, fontWeight: "300" },
  quickActions: { flexDirection: "row", gap: 8 },
  quickAction: { flex: 1, minHeight: 52, justifyContent: "center", gap: 4 },
  quickLabel: { fontSize: 10, lineHeight: 15, fontWeight: "600" },
  alertCard: { borderWidth: 1, borderRadius: 12, padding: 14, gap: 6 },
  alertCount: { fontSize: 12, lineHeight: 16, fontWeight: "700", fontVariant: ["tabular-nums"] },
  alertRow: { minHeight: 46, borderTopWidth: StyleSheet.hairlineWidth, flexDirection: "row", alignItems: "center", gap: 9 },
  alertDot: { width: 6, height: 6, borderRadius: 3 },
  alertLabel: { flex: 1, fontSize: 10, lineHeight: 15, fontWeight: "600" },
  alertValue: { fontSize: 9, lineHeight: 13, fontVariant: ["tabular-nums"] },
  footer: { paddingTop: 2, fontFamily: "serif", fontSize: 9, lineHeight: 17, textAlign: "center" },
});