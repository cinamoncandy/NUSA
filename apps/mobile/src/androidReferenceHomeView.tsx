import React from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { useTheme } from "./ThemeProvider";
import { HomeView as LegacyHomeView } from "./homeViewLegacy";
import { createCashInvestmentEnvelope } from "./capitalAllocationGuard";
import { buildHomeDecisionSurface } from "./homeDecisionSurface";
import { buildLocalPortfolio, isLocalPaperActive } from "./localPaperLedger";
import { useLocalPaperMarkPrice, useLocalPaperSnapshot } from "./localPaperLedgerHooks";

type Props = React.ComponentProps<typeof LegacyHomeView>;

function krw(value: number): string {
  return `₩${Math.round(value).toLocaleString("ko-KR")}`;
}

function signedKrw(value: number): string {
  return `${value >= 0 ? "+" : "-"}${krw(Math.abs(value))}`;
}

function percent(value: number | null): string {
  return value == null || !Number.isFinite(value) ? "—" : `${(value * 100).toFixed(1)}%`;
}

function Caption({ children, accent = false }: Readonly<{ children: React.ReactNode; accent?: boolean }>) {
  const { theme } = useTheme();
  return <Text style={[styles.caption, { color: accent ? theme.colors.primary : theme.colors.textMuted }]}>{children}</Text>;
}

function Row({ label, value, tone = "default" }: Readonly<{ label: string; value: string; tone?: "default" | "positive" | "warning" }>) {
  const { theme } = useTheme();
  const color = tone === "positive" ? theme.colors.success : tone === "warning" ? theme.colors.warning : theme.colors.text;
  return <View style={[styles.row, { borderTopColor: theme.colors.border }]}><Text style={[styles.rowLabel, { color: theme.colors.textMuted }]}>{label}</Text><Text style={[styles.rowValue, { color }]}>{value}</Text></View>;
}

export function AndroidReferenceHomeView(props: Props) {
  const { theme } = useTheme();
  const localPaperActive = props.snapshot == null && isLocalPaperActive();
  const localTradingSnapshot = useLocalPaperSnapshot();
  const localMarkPrice = useLocalPaperMarkPrice(localPaperActive);
  const localPortfolio = localPaperActive ? buildLocalPortfolio(localTradingSnapshot, localMarkPrice) : null;
  const account = props.snapshot?.portfolio?.account ?? localPortfolio?.account ?? null;
  const source = props.snapshot != null ? "CLOUD PAPER" : localPortfolio != null ? "LOCAL PAPER" : "NO SOURCE";
  const assetValue = account == null ? null : account.assetValue ?? Math.max(0, account.equity - account.cash);
  const realized = account == null ? null : (account.realizedPnl ?? account.position.realizedPnl);
  const unrealized = account?.unrealizedPnl ?? null;
  const totalPnl = realized == null || unrealized == null ? null : realized + unrealized;
  const exposure = account == null || assetValue == null || account.equity <= 0 ? null : Math.max(0, Math.min(1, assetValue / account.equity));
  const allocation = account == null ? null : createCashInvestmentEnvelope(account.cash, props.investmentPercent);
  const ai = props.snapshot?.ai ?? null;
  const disconnected = props.notConfigured != null;
  const decision = buildHomeDecisionSurface({
    runtimeState: props.snapshot?.operations.runtimeState,
    health: props.snapshot?.health,
    readyForPaperOperations: props.snapshot?.readyForPaperOperations ?? false,
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
  const trustedConfidence = ai?.calibrationStatus === "CALIBRATED" && ai.confidence != null
    ? `${Math.round(ai.confidence * 100)}%`
    : "—";
  const positionOpen = account != null && account.position.quantity > 0 && Boolean(account.position.market);
  const pnlTone = totalPnl != null && totalPnl >= 0 ? theme.colors.success : theme.colors.danger;

  const runPrimaryAction = () => {
    switch (decision.primaryAction) {
      case "SETTINGS": props.onGoSettings(); break;
      case "PORTFOLIO": props.onNavigate("Portfolio"); break;
      case "AI_SIGNAL": props.onNavigate("AiSignal"); break;
      case "MARKETS": props.onNavigate("Markets"); break;
    }
  };

  return <ScrollView
    style={{ backgroundColor: theme.colors.background }}
    contentContainerStyle={styles.content}
    refreshControl={<RefreshControl tintColor={theme.colors.primary} refreshing={props.refreshing} onRefresh={props.onRefresh} />}
    testID="home-screen"
  >
    <View style={styles.brandBlock} testID="android-reference-brand">
      <Text style={[styles.wordmark, { color: theme.colors.text }]}>NUSA</Text>
      <Text style={[styles.productLine, { color: theme.colors.textMuted }]}>Autonomous Investment Intelligence OS</Text>
      <View style={styles.titleRow}>
        <View><Text style={[styles.pageTitle, { color: theme.colors.text }]}>운영 개요</Text><Caption>OPERATING OVERVIEW</Caption></View>
        <Text style={[styles.androidOnly, { color: theme.colors.primary }]}>ANDROID ONLY</Text>
      </View>
    </View>

    <View style={[styles.modeRail, { borderColor: theme.colors.borderStrong, backgroundColor: theme.colors.surface }]}>
      <View style={styles.modeCell}><Caption>MODE</Caption><Text style={[styles.modeValue, { color: theme.colors.primary }]}>PAPER ONLY</Text></View>
      <View style={styles.modeCell}><Caption>LIVE</Caption><Text style={[styles.modeValue, { color: theme.colors.textMuted }]}>NONE</Text></View>
      <View style={styles.modeCell}><Caption>AI AUTHORITY</Caption><Text style={[styles.modeValue, { color: theme.colors.warning }]}>ZERO</Text></View>
    </View>

    <View style={[styles.heroCard, { borderColor: theme.colors.borderStrong, backgroundColor: theme.colors.surface }]} testID="android-asset-state">
      <View style={styles.sectionHeader}><View><Text style={[styles.sectionTitle, { color: theme.colors.text }]}>자산 상태</Text><Caption>ASSET STATE</Caption></View><Text style={[styles.source, { color: theme.colors.textMuted }]}>{source}</Text></View>
      {account ? <>
        <View style={styles.assetHeroRow}>
          <View style={styles.assetHeroCopy}>
            <Caption>총 자산 · TOTAL EQUITY</Caption>
            <Text style={[styles.equity, { color: theme.colors.text }]}>{krw(account.equity)}</Text>
            <Caption>오늘 변화</Caption>
            <Text style={[styles.pnl, { color: pnlTone }]}>{totalPnl == null ? "—" : signedKrw(totalPnl)}</Text>
          </View>
          <View accessible accessibilityLabel={`총 노출 ${percent(exposure)}`} style={[styles.exposureRing, { borderColor: theme.colors.primary }]}>
            <View style={[styles.exposureTick, { backgroundColor: theme.colors.warning }]} />
            <Text style={[styles.exposureValue, { color: theme.colors.text }]}>{percent(exposure)}</Text>
            <Text style={[styles.exposureLabel, { color: theme.colors.textMuted }]}>총 노출</Text>
          </View>
        </View>
        <View style={styles.metricPair}>
          <View style={styles.metricCell}><Caption>현금 · CASH</Caption><Text style={[styles.metricValue, { color: theme.colors.text }]}>{krw(account.cash)}</Text></View>
          <View style={styles.metricCell}><Caption>포지션 가치</Caption><Text style={[styles.metricValue, { color: theme.colors.text }]}>{assetValue == null ? "—" : krw(assetValue)}</Text></View>
        </View>
      </> : <View style={styles.emptyBlock}><Text style={[styles.emptyTitle, { color: theme.colors.text }]}>자산 소스 대기</Text><Text style={[styles.body, { color: theme.colors.textMuted }]}>검증된 PAPER 자산 소스가 연결되기 전 숫자를 만들지 않습니다.</Text></View>}
    </View>

    <View style={[styles.panel, { borderColor: theme.colors.border, backgroundColor: theme.colors.surface }]} testID="android-performance-snapshot">
      <View style={styles.sectionHeader}><View><Text style={[styles.sectionTitle, { color: theme.colors.text }]}>성과 스냅샷</Text><Caption>PERFORMANCE SNAPSHOT</Caption></View></View>
      <Row label="실현 손익" value={realized == null ? "—" : signedKrw(realized)} tone={realized != null && realized >= 0 ? "positive" : "default"} />
      <Row label="미실현 손익" value={unrealized == null ? "—" : signedKrw(unrealized)} tone={unrealized != null && unrealized >= 0 ? "positive" : "default"} />
      <Row label="현재 포지션" value={positionOpen && account ? `${account.position.market} · ${account.position.quantity}` : "NONE"} />
      <Text style={[styles.truthNote, { color: theme.colors.textMuted }]}>검증된 기간 수익률 시계열이 없으므로 그래프를 임의 생성하지 않습니다.</Text>
    </View>

    <Pressable accessibilityRole="button" onPress={() => props.onNavigate("AiSignal")} style={({ pressed }) => [styles.decisionCard, { borderColor: theme.colors.borderStrong, backgroundColor: theme.colors.surface, opacity: pressed ? theme.interaction.pressedOpacity : 1 }]} testID="android-decision-stage">
      <View style={styles.sectionHeader}><View><Text style={[styles.sectionTitle, { color: theme.colors.text }]}>NUSA 판단 단계</Text><Caption>DECISION STAGE</Caption></View><Text style={[styles.source, { color: ai?.status === "AVAILABLE" ? theme.colors.primary : theme.colors.textMuted }]}>{ai?.status ?? "WAITING"}</Text></View>
      <Text style={[styles.decisionHeadline, { color: theme.colors.text }]}>{ai?.status === "AVAILABLE" && ai.thesis ? ai.thesis : decision.now}</Text>
      <View style={styles.decisionBody}>
        <View style={[styles.confidenceRing, { borderColor: ai?.calibrationStatus === "CALIBRATED" ? theme.colors.primary : theme.colors.borderStrong }]}>
          <Text style={[styles.confidenceLabel, { color: theme.colors.textMuted }]}>CONFIDENCE</Text>
          <Text style={[styles.confidenceValue, { color: theme.colors.text }]}>{trustedConfidence}</Text>
        </View>
        <View style={styles.decisionMeta}>
          <Caption accent>KEY EVIDENCE</Caption>
          <Text style={[styles.body, { color: theme.colors.text }]}>{ai?.evidenceReferences?.[0] ?? decision.why}</Text>
          <Caption>COUNTER EVIDENCE</Caption>
          <Text style={[styles.body, { color: theme.colors.textMuted }]}>{ai?.counterEvidence?.[0] ?? "등록된 반대 근거 없음"}</Text>
        </View>
      </View>
      <View style={[styles.nextAction, { borderTopColor: theme.colors.border }]}><View><Caption>NEXT ACTION</Caption><Text style={[styles.nextActionText, { color: theme.colors.text }]}>{decision.result}</Text></View><Text style={[styles.arrow, { color: theme.colors.primary }]}>→</Text></View>
    </Pressable>

    <View style={[styles.panel, { borderColor: theme.colors.border, backgroundColor: theme.colors.surface }]} testID="android-risk-authority">
      <View style={styles.sectionHeader}><View><Text style={[styles.sectionTitle, { color: theme.colors.text }]}>리스크 · 권한</Text><Caption>RISK & AUTHORITY</Caption></View><Text style={[styles.source, { color: props.snapshot?.readyForPaperOperations ? theme.colors.success : theme.colors.warning }]}>{props.snapshot?.readyForPaperOperations ? "READY" : "FAIL CLOSED"}</Text></View>
      <View style={[styles.riskNotice, { borderColor: theme.colors.warning }]}><Text style={[styles.riskTitle, { color: theme.colors.warning }]}>RISK SCORE</Text><Text style={[styles.body, { color: theme.colors.textMuted }]}>canonical risk score가 현재 모바일 snapshot에 없으므로 수치를 표시하지 않습니다.</Text></View>
      <Row label="PAPER GATE" value={props.snapshot?.readyForPaperOperations ? "READY" : "BLOCKED"} tone={props.snapshot?.readyForPaperOperations ? "positive" : "warning"} />
      <Row label="LIVE AUTHORITY" value="NONE" />
      <Row label="AI AUTHORITY" value="ZERO" />
      <Row label="PRODUCTION MUTATION" value="DISABLED" />
      <Row label="EVIDENCE FIRST" value="ENABLED" tone="positive" />
    </View>

    {allocation ? <View style={[styles.panel, { borderColor: theme.colors.border, backgroundColor: theme.colors.surface }]} testID="android-capital-allocation">
      <View style={styles.sectionHeader}><View><Text style={[styles.sectionTitle, { color: theme.colors.text }]}>자본 통제</Text><Caption>CAPITAL CONTROL</Caption></View></View>
      <Row label={`투입 가능 ${allocation.investmentPercent}%`} value={krw(allocation.investableCash)} />
      <Row label={`보호 현금 ${allocation.reservePercent}%`} value={krw(allocation.reservedCash)} />
    </View> : null}

    <View style={styles.actionGrid}>
      <Pressable onPress={() => props.onNavigate("Markets")} style={({ pressed }) => [styles.action, { borderColor: theme.colors.borderStrong, opacity: pressed ? 0.7 : 1 }]}><Caption>MARKETS</Caption><Text style={[styles.actionLabel, { color: theme.colors.text }]}>시장 보기</Text></Pressable>
      <Pressable onPress={() => props.onNavigate("Portfolio")} style={({ pressed }) => [styles.action, { borderColor: theme.colors.borderStrong, opacity: pressed ? 0.7 : 1 }]}><Caption>ASSETS</Caption><Text style={[styles.actionLabel, { color: theme.colors.text }]}>자산 감독</Text></Pressable>
      <Pressable onPress={props.onOpenPaperLearning} style={({ pressed }) => [styles.action, { borderColor: theme.colors.borderStrong, opacity: pressed ? 0.7 : 1 }]}><Caption>LEARNING</Caption><Text style={[styles.actionLabel, { color: theme.colors.text }]}>학습 근거</Text></Pressable>
    </View>

    {disconnected || props.readOnlyError ? <Pressable onPress={props.onGoSettings} style={[styles.connectionNotice, { borderColor: theme.colors.warning }]} testID="dashboard-open-settings"><Text style={[styles.connectionTitle, { color: theme.colors.warning }]}>연결 확인 필요</Text><Text style={[styles.body, { color: theme.colors.textMuted }]}>{props.readOnlyError ?? props.notConfigured ?? "PAPER 연결 상태를 확인하세요."}</Text></Pressable> : null}

    <Pressable accessibilityRole="button" onPress={runPrimaryAction} style={({ pressed }) => [styles.primaryAction, { borderColor: theme.colors.primary, opacity: pressed ? theme.interaction.pressedOpacity : 1 }]} testID="home-supervisor-primary-action"><Text style={[styles.primaryActionLabel, { color: theme.colors.primary }]}>{decision.primaryLabel}</Text><Text style={[styles.arrow, { color: theme.colors.primary }]}>→</Text></Pressable>

    <Text style={[styles.footerStatement, { color: theme.colors.textMuted }]}>판단하고, 검증하고, 당신이 결정합니다. · AI ZERO AUTHORITY · LIVE NONE</Text>
  </ScrollView>;
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 18, paddingTop: 20, paddingBottom: 36, gap: 16, width: "100%", maxWidth: 620, alignSelf: "center" },
  brandBlock: { gap: 4, paddingBottom: 4 },
  wordmark: { fontFamily: "serif", fontSize: 34, lineHeight: 40, fontWeight: "400", letterSpacing: 4.2 },
  productLine: { fontFamily: "serif", fontSize: 11, lineHeight: 17, letterSpacing: 0.5 },
  titleRow: { marginTop: 16, flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", gap: 12 },
  pageTitle: { fontSize: 18, lineHeight: 24, fontWeight: "500", letterSpacing: -0.2 },
  androidOnly: { fontSize: 8, lineHeight: 12, fontWeight: "700", letterSpacing: 1.2 },
  caption: { fontSize: 8, lineHeight: 12, fontWeight: "600", letterSpacing: 1.1 },
  modeRail: { borderWidth: 1, borderRadius: 7, flexDirection: "row", overflow: "hidden" },
  modeCell: { flex: 1, minHeight: 58, paddingHorizontal: 10, paddingVertical: 10, justifyContent: "space-between" },
  modeValue: { fontSize: 11, lineHeight: 15, fontWeight: "700", letterSpacing: 0.25 },
  heroCard: { borderWidth: 1, borderRadius: 8, padding: 16, gap: 16 },
  panel: { borderWidth: 1, borderRadius: 8, padding: 15, gap: 10 },
  decisionCard: { borderWidth: 1, borderRadius: 8, padding: 16, gap: 16 },
  sectionHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 10 },
  sectionTitle: { fontSize: 15, lineHeight: 20, fontWeight: "600", letterSpacing: -0.2 },
  source: { fontSize: 8, lineHeight: 12, fontWeight: "700", letterSpacing: 0.9 },
  assetHeroRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 16 },
  assetHeroCopy: { flex: 1, gap: 6 },
  equity: { fontSize: 29, lineHeight: 35, fontWeight: "400", fontVariant: ["tabular-nums"], letterSpacing: -0.8 },
  pnl: { fontSize: 17, lineHeight: 22, fontWeight: "600", fontVariant: ["tabular-nums"] },
  exposureRing: { width: 92, height: 92, borderRadius: 46, borderWidth: 6, alignItems: "center", justifyContent: "center", position: "relative" },
  exposureTick: { position: "absolute", width: 7, height: 20, right: 4, top: 7, borderRadius: 3 },
  exposureValue: { fontSize: 20, lineHeight: 24, fontWeight: "500", fontVariant: ["tabular-nums"] },
  exposureLabel: { marginTop: 3, fontSize: 8, lineHeight: 11 },
  metricPair: { flexDirection: "row", gap: 10 },
  metricCell: { flex: 1, minHeight: 64, justifyContent: "space-between", paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "rgba(255,255,255,0.10)" },
  metricValue: { fontSize: 15, lineHeight: 20, fontWeight: "500", fontVariant: ["tabular-nums"] },
  row: { minHeight: 42, borderTopWidth: StyleSheet.hairlineWidth, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  rowLabel: { flex: 1, fontSize: 11, lineHeight: 16 },
  rowValue: { flexShrink: 1, textAlign: "right", fontSize: 12, lineHeight: 17, fontWeight: "600", fontVariant: ["tabular-nums"] },
  truthNote: { fontSize: 9, lineHeight: 14 },
  emptyBlock: { minHeight: 118, justifyContent: "center", gap: 7 },
  emptyTitle: { fontSize: 19, lineHeight: 25, fontWeight: "500" },
  body: { fontSize: 11, lineHeight: 18 },
  decisionHeadline: { fontFamily: "serif", fontSize: 28, lineHeight: 38, fontWeight: "400", letterSpacing: -0.7 },
  decisionBody: { flexDirection: "row", alignItems: "center", gap: 18 },
  confidenceRing: { width: 116, height: 116, borderRadius: 58, borderWidth: 7, alignItems: "center", justifyContent: "center" },
  confidenceLabel: { fontSize: 7, lineHeight: 10, letterSpacing: 1 },
  confidenceValue: { marginTop: 4, fontSize: 30, lineHeight: 34, fontWeight: "300", fontVariant: ["tabular-nums"] },
  decisionMeta: { flex: 1, gap: 7 },
  nextAction: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 13, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  nextActionText: { marginTop: 4, fontSize: 13, lineHeight: 20, fontWeight: "500" },
  arrow: { fontSize: 21, lineHeight: 24, fontWeight: "300" },
  riskNotice: { borderWidth: 1, borderRadius: 6, padding: 12, gap: 5 },
  riskTitle: { fontSize: 9, lineHeight: 13, fontWeight: "700", letterSpacing: 1 },
  actionGrid: { flexDirection: "row", gap: 8 },
  action: { flex: 1, minHeight: 64, borderWidth: 1, borderRadius: 7, padding: 10, justifyContent: "space-between" },
  actionLabel: { fontSize: 11, lineHeight: 15, fontWeight: "600" },
  connectionNotice: { borderWidth: 1, borderRadius: 7, padding: 13, gap: 5 },
  connectionTitle: { fontSize: 11, lineHeight: 16, fontWeight: "700" },
  primaryAction: { minHeight: 52, borderWidth: 1, borderRadius: 7, paddingHorizontal: 15, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  primaryActionLabel: { fontSize: 11, lineHeight: 16, fontWeight: "700", letterSpacing: 0.25 },
  footerStatement: { fontFamily: "serif", textAlign: "center", fontSize: 10, lineHeight: 18, letterSpacing: 0.2, paddingTop: 6 },
});
