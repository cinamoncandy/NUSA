import React from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { useTheme } from "./ThemeProvider";
import { HomeView as LegacyHomeView } from "./homeViewLegacy";
import { createCashInvestmentEnvelope } from "./capitalAllocationGuard";
import { buildHomeDecisionSurface } from "./homeDecisionSurface";
import { buildLocalPortfolio, isLocalPaperActive } from "./localPaperLedger";
import { useLocalPaperMarkPrice, useLocalPaperSnapshot } from "./localPaperLedgerHooks";

type Props = React.ComponentProps<typeof LegacyHomeView>;
type Tone = "normal" | "warning" | "blocked";

function money(value: number): string {
  return `₩${Math.round(value).toLocaleString("ko-KR")}`;
}

function signedMoney(value: number): string {
  return `${value >= 0 ? "+" : "-"}${money(Math.abs(value))}`;
}

function percent(value: number | null): string {
  return value == null || !Number.isFinite(value) ? "—" : `${(value * 100).toFixed(1)}%`;
}

function Meta({ children, accent = false }: Readonly<{ children: React.ReactNode; accent?: boolean }>) {
  const { theme } = useTheme();
  return <Text style={[styles.meta, { color: accent ? theme.colors.primary : theme.colors.textMuted }]}>{children}</Text>;
}

function StatusDot({ tone = "normal" }: Readonly<{ tone?: Tone }>) {
  const { theme } = useTheme();
  const color = tone === "blocked" ? theme.colors.danger : tone === "warning" ? theme.colors.warning : theme.colors.primary;
  return <View style={[styles.statusDot, { backgroundColor: color }]} />;
}

function LedgerRow({ label, value, valueColor }: Readonly<{ label: string; value: string; valueColor?: string }>) {
  const { theme } = useTheme();
  return <View style={styles.ledgerRow}>
    <Meta>{label}</Meta>
    <Text style={[styles.ledgerValue, { color: valueColor ?? theme.colors.text }]}>{value}</Text>
  </View>;
}

function EvidenceLine({ text, counter = false }: Readonly<{ text: string; counter?: boolean }>) {
  const { theme } = useTheme();
  return <View style={styles.evidenceLine}>
    <View style={[styles.evidenceRule, { backgroundColor: counter ? theme.colors.danger : theme.colors.primary }]} />
    <Text style={[styles.evidenceText, { color: theme.colors.text }]}>{text}</Text>
  </View>;
}

export function AndroidBHomeView(props: Props) {
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
  const evidence = ai?.evidenceReferences ?? [];
  const counterEvidence = ai?.counterEvidence ?? [];

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
    aiEvidenceCount: ai?.status === "AVAILABLE" ? evidence.length : 0,
    aiCalibrationStatus: ai?.calibrationStatus,
    aiConfidence: ai?.confidence,
  });

  const state: Readonly<{ eyebrow: string; title: string; detail: string; tone: Tone; actionLabel: string; onPress: () => void }> = disconnected
    ? {
      eyebrow: "SYSTEM ATTENTION",
      title: "연결 상태를 먼저 확인하세요",
      detail: props.readOnlyError ?? props.notConfigured ?? "PAPER 연결 상태를 확인하세요.",
      tone: "blocked",
      actionLabel: "CONTROL 열기",
      onPress: props.onGoSettings,
    }
    : props.snapshot != null && !paperReady
      ? {
        eyebrow: "SAFETY GATE",
        title: "운용보다 확인이 우선입니다",
        detail: "PAPER 운용 게이트가 닫혀 있습니다. 차단 원인을 먼저 확인하세요.",
        tone: "warning",
        actionLabel: "상태 확인",
        onPress: props.onGoSettings,
      }
      : ai?.status === "AVAILABLE"
        ? {
          eyebrow: "DECISION REVIEW",
          title: ai.thesis || "새 판단을 검토할 수 있습니다",
          detail: "근거와 반대 근거를 확인한 뒤 사용자가 결정합니다.",
          tone: "normal",
          actionLabel: "판단 검토",
          onPress: () => props.onNavigate("AiSignal"),
        }
        : positionOpen
          ? {
            eyebrow: "POSITION WATCH",
            title: "현재 포지션을 감독하고 있습니다",
            detail: "포지션과 노출 변화가 우선 감시 대상입니다.",
            tone: "normal",
            actionLabel: "포트폴리오",
            onPress: () => props.onNavigate("Portfolio"),
          }
          : {
            eyebrow: "MARKET WATCH",
            title: "지금은 별도 조치가 필요하지 않습니다",
            detail: "NUSA가 시장과 PAPER 운용 상태를 계속 감시하고 있습니다.",
            tone: "normal",
            actionLabel: "시장 보기",
            onPress: () => props.onNavigate("Markets"),
          };

  const stateColor = state.tone === "blocked" ? theme.colors.danger : state.tone === "warning" ? theme.colors.warning : theme.colors.primary;
  const pnlColor = totalPnl == null ? theme.colors.textMuted : totalPnl >= 0 ? theme.colors.success : theme.colors.danger;
  const marketLabel = props.publicMarket ?? "MARKET";
  const marketPrice = props.publicCurrentPrice == null ? "—" : money(props.publicCurrentPrice);
  const healthLabel = disconnected ? "CHECK" : paperReady && marketFresh ? "READY" : "WATCH";
  const healthTone: Tone = disconnected ? "blocked" : paperReady && marketFresh ? "normal" : "warning";
  const insight = ai?.status === "AVAILABLE" && ai.thesis ? ai.thesis : decision.now;

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
    <View pointerEvents="none" style={styles.atmosphere}>
      <View style={[styles.glowNorth, { backgroundColor: theme.colors.neonGlow }]} />
      <View style={[styles.glowEast, { borderColor: theme.colors.neonPurple }]} />
      <View style={[styles.axisLine, { backgroundColor: theme.colors.border }]} />
    </View>

    <View style={styles.topBar} testID="android-b-brand">
      <View>
        <Text style={[styles.brand, { color: theme.colors.text }]}>NUSA</Text>
        <Text style={[styles.brandSub, { color: theme.colors.textMuted }]}>SUPERVISORY DESK</Text>
      </View>
      <View style={[styles.modeBadge, { borderColor: theme.colors.borderStrong, backgroundColor: theme.colors.surface }]}>
        <StatusDot />
        <Text style={[styles.modeBadgeText, { color: theme.colors.text }]}>PAPER · B</Text>
      </View>
    </View>

    <View style={[styles.controlRail, { borderColor: theme.colors.border, backgroundColor: theme.colors.surfaceSunken }]} testID="android-system-truth-rail">
      <View style={styles.controlRailItem}><Meta>AUTHORITY</Meta><Text style={[styles.controlRailValue, { color: theme.colors.text }]}>ZERO AI</Text></View>
      <View style={[styles.controlDivider, { backgroundColor: theme.colors.border }]} />
      <View style={styles.controlRailItem}><Meta>DATA</Meta><Text style={[styles.controlRailValue, { color: marketFresh ? theme.colors.success : theme.colors.warning }]}>{marketFresh ? "FRESH" : "CHECK"}</Text></View>
      <View style={[styles.controlDivider, { backgroundColor: theme.colors.border }]} />
      <View style={styles.controlRailItem}><Meta>OPERATING</Meta><View style={styles.inlineStatus}><StatusDot tone={healthTone} /><Text style={[styles.controlRailValue, { color: theme.colors.text }]}>{healthLabel}</Text></View></View>
    </View>

    <View style={styles.heroGrid} testID="android-b-now">
      <View style={styles.heroIndex}>
        <Meta accent>NOW / 01</Meta>
        <View style={[styles.heroIndexRule, { backgroundColor: stateColor }]} />
      </View>
      <View style={styles.heroBody}>
        <View style={styles.heroEyebrow}><StatusDot tone={state.tone} /><Meta accent>{state.eyebrow}</Meta></View>
        <Text style={[styles.heroTitle, { color: theme.colors.text }]}>{state.title}</Text>
        <Text style={[styles.heroDetail, { color: theme.colors.textMuted }]}>{state.detail}</Text>
        <Pressable accessibilityRole="button" onPress={state.onPress} style={({ pressed }) => [styles.heroAction, { borderColor: theme.colors.borderStrong, backgroundColor: theme.colors.surface, opacity: pressed ? theme.interaction.pressedOpacity : 1 }]}>
          <Text style={[styles.heroActionText, { color: theme.colors.text }]}>{state.actionLabel}</Text>
          <Text style={[styles.arrow, { color: stateColor }]}>↗</Text>
        </Pressable>
      </View>
    </View>

    <View style={[styles.marketDesk, { borderColor: theme.colors.borderStrong, backgroundColor: theme.colors.surfaceRaised }]} testID="android-b-market-desk">
      <View style={styles.marketIdentity}>
        <Meta>ACTIVE MARKET</Meta>
        <Text style={[styles.marketName, { color: theme.colors.text }]}>{marketLabel}</Text>
        <Text style={[styles.marketSub, { color: theme.colors.textMuted }]}>PUBLIC MARKET OBSERVATION</Text>
      </View>
      <View style={styles.marketQuote}>
        <Meta>LAST</Meta>
        <Text style={[styles.marketPrice, { color: theme.colors.text }]}>{marketPrice}</Text>
        <Text style={[styles.marketState, { color: marketFresh ? theme.colors.success : theme.colors.warning }]}>{marketFresh ? "DATA FRESH" : "DATA CHECK"}</Text>
      </View>
    </View>

    <View style={styles.sectionLead}>
      <Meta accent>CAPITAL / 02</Meta>
      <Text style={[styles.sectionLeadText, { color: theme.colors.textMuted }]}>현재 확인 가능한 PAPER 자산 상태만 표시합니다.</Text>
    </View>

    <View style={[styles.capitalLedger, { borderTopColor: theme.colors.borderStrong, borderBottomColor: theme.colors.borderStrong }]} testID="android-b-capital-ledger">
      <View style={styles.capitalHero}>
        <Meta>TOTAL ASSET</Meta>
        <Text style={[styles.capitalHeroValue, { color: theme.colors.text }]}>{account == null ? "—" : money(account.equity)}</Text>
        <Text style={[styles.capitalPnl, { color: pnlColor }]}>{totalPnl == null ? "PnL 대기" : signedMoney(totalPnl)}</Text>
      </View>
      <View style={[styles.ledgerColumn, { borderLeftColor: theme.colors.border }]}>
        <LedgerRow label="EXPOSURE" value={percent(exposure)} />
        <View style={[styles.ledgerDivider, { backgroundColor: theme.colors.border }]} />
        <LedgerRow label="POSITION" value={positionOpen && account ? account.position.market : "NO POSITION"} />
        <View style={[styles.ledgerDivider, { backgroundColor: theme.colors.border }]} />
        <LedgerRow label="PROTECTED CASH" value={allocation == null ? "—" : money(allocation.reservedCash)} />
      </View>
    </View>

    <Pressable accessibilityRole="button" onPress={() => props.onNavigate("AiSignal")} style={({ pressed }) => [styles.decisionDesk, { borderColor: theme.colors.borderStrong, backgroundColor: theme.colors.surface, opacity: pressed ? theme.interaction.pressedOpacity : 1 }]} testID="android-b-decision-desk">
      <View style={styles.decisionHeader}>
        <View><Meta accent>NUSA / 03</Meta><Text style={[styles.decisionLabel, { color: theme.colors.textMuted }]}>VERIFIABLE JUDGMENT</Text></View>
        <Text style={[styles.arrow, { color: theme.colors.primary }]}>→</Text>
      </View>
      <Text style={[styles.decisionText, { color: theme.colors.text }]}>{insight}</Text>
      <View style={styles.decisionStats}>
        <View style={styles.decisionStat}><Meta>EVIDENCE</Meta><Text style={[styles.decisionStatValue, { color: theme.colors.text }]}>{evidence.length}</Text></View>
        <View style={styles.decisionStat}><Meta>COUNTER</Meta><Text style={[styles.decisionStatValue, { color: theme.colors.text }]}>{counterEvidence.length}</Text></View>
        <View style={styles.decisionStat}><Meta>CALIBRATION</Meta><Text style={[styles.decisionStatSmall, { color: theme.colors.text }]}>{ai?.calibrationStatus ?? "—"}</Text></View>
      </View>
    </Pressable>

    <View style={[styles.evidenceDesk, { borderColor: theme.colors.border, backgroundColor: theme.colors.surfaceSunken }]} testID="android-b-evidence-desk">
      <View style={styles.evidenceHeader}>
        <View><Meta accent>EVIDENCE / 04</Meta><Text style={[styles.evidenceTitle, { color: theme.colors.text }]}>판단 근거</Text></View>
        <Pressable accessibilityRole="button" onPress={props.onOpenPaperLearning} style={({ pressed }) => [styles.textAction, { opacity: pressed ? theme.interaction.pressedOpacity : 1 }]}>
          <Text style={[styles.textActionLabel, { color: theme.colors.primary }]}>학습 근거 ↗</Text>
        </Pressable>
      </View>

      <View style={styles.evidenceGroup}>
        <Meta>KEY EVIDENCE</Meta>
        {evidence.length > 0
          ? evidence.slice(0, 2).map((item, index) => <EvidenceLine key={`e-${index}`} text={item} />)
          : <Text style={[styles.emptyText, { color: theme.colors.textMuted }]}>검증된 근거 참조가 아직 없습니다.</Text>}
      </View>

      <View style={[styles.horizontalRule, { backgroundColor: theme.colors.border }]} />

      <View style={styles.evidenceGroup}>
        <Meta>COUNTER EVIDENCE</Meta>
        {counterEvidence.length > 0
          ? counterEvidence.slice(0, 2).map((item, index) => <EvidenceLine counter key={`c-${index}`} text={item} />)
          : <Text style={[styles.emptyText, { color: theme.colors.textMuted }]}>등록된 반대 근거가 없습니다.</Text>}
      </View>

      <View style={[styles.horizontalRule, { backgroundColor: theme.colors.border }]} />
      <View style={styles.invalidationBlock}>
        <Meta>INVALIDATION</Meta>
        <Text style={[styles.emptyText, { color: theme.colors.textMuted }]}>현재 canonical AI projection에 전용 invalidation 필드가 없어 조건을 임의 생성하지 않습니다.</Text>
      </View>
    </View>

    <View style={styles.quickActions} testID="android-b-quick-actions">
      <Pressable accessibilityRole="button" onPress={() => props.onNavigate("Markets")} style={({ pressed }) => [styles.quickAction, { borderColor: theme.colors.border, opacity: pressed ? theme.interaction.pressedOpacity : 1 }]}><Meta>MARKETS</Meta><Text style={[styles.quickActionValue, { color: theme.colors.text }]}>{marketLabel}</Text><Text style={[styles.quickArrow, { color: theme.colors.primary }]}>→</Text></Pressable>
      <Pressable accessibilityRole="button" onPress={() => props.onNavigate("Portfolio")} style={({ pressed }) => [styles.quickAction, { borderColor: theme.colors.border, opacity: pressed ? theme.interaction.pressedOpacity : 1 }]}><Meta>PORTFOLIO</Meta><Text style={[styles.quickActionValue, { color: theme.colors.text }]}>{positionOpen ? "SUPERVISE" : "REVIEW"}</Text><Text style={[styles.quickArrow, { color: theme.colors.primary }]}>→</Text></Pressable>
    </View>

    <Pressable accessibilityRole="button" onPress={runPrimaryAction} style={({ pressed }) => [styles.ownerCommand, { borderColor: theme.colors.neonPurple, backgroundColor: theme.colors.primarySoft, opacity: pressed ? theme.interaction.pressedOpacity : 1 }]} testID="home-supervisor-primary-action">
      <View>
        <Meta accent>OWNER COMMAND</Meta>
        <Text style={[styles.ownerCommandTitle, { color: theme.colors.text }]}>{decision.primaryLabel}</Text>
        <Text style={[styles.ownerCommandSub, { color: theme.colors.textMuted }]}>AI는 제안하고, 최종 결정은 사용자에게 남습니다.</Text>
      </View>
      <Text style={[styles.ownerCommandArrow, { color: theme.colors.primary }]}>↗</Text>
    </Pressable>

    <Text style={[styles.footer, { color: theme.colors.textMuted }]}>PAPER ONLY · AI ZERO AUTHORITY · USER SUPERVISION</Text>
  </ScrollView>;
}

const styles = StyleSheet.create({
  content: { width: "100%", maxWidth: 700, alignSelf: "center", paddingHorizontal: 20, paddingTop: 18, paddingBottom: 48, gap: 22, overflow: "hidden" },
  atmosphere: { ...StyleSheet.absoluteFillObject, overflow: "hidden" },
  glowNorth: { position: "absolute", width: 560, height: 280, borderRadius: 280, top: -190, right: -160, opacity: 0.62 },
  glowEast: { position: "absolute", width: 420, height: 420, borderRadius: 210, borderWidth: 1, right: -300, top: 410, opacity: 0.2 },
  axisLine: { position: "absolute", width: 1, height: 940, right: 34, top: 120, opacity: 0.42 },
  topBar: { minHeight: 60, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 16 },
  brand: { fontSize: 28, lineHeight: 32, fontWeight: "300", letterSpacing: 6 },
  brandSub: { marginTop: 3, fontSize: 8, lineHeight: 11, fontWeight: "700", letterSpacing: 1.9 },
  modeBadge: { minHeight: 40, borderWidth: 1, borderRadius: 20, paddingHorizontal: 13, flexDirection: "row", alignItems: "center", gap: 8 },
  modeBadgeText: { fontSize: 9, lineHeight: 12, fontWeight: "700", letterSpacing: 0.8 },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  meta: { fontSize: 8, lineHeight: 11, fontWeight: "700", letterSpacing: 1.2 },
  controlRail: { minHeight: 64, borderWidth: 1, borderRadius: 18, paddingHorizontal: 16, flexDirection: "row", alignItems: "center" },
  controlRailItem: { flex: 1, gap: 5 },
  controlDivider: { width: StyleSheet.hairlineWidth, height: 30, marginHorizontal: 12 },
  controlRailValue: { fontSize: 10, lineHeight: 14, fontWeight: "700", letterSpacing: 0.4 },
  inlineStatus: { flexDirection: "row", alignItems: "center", gap: 7 },
  heroGrid: { minHeight: 330, flexDirection: "row", paddingTop: 26, paddingBottom: 30 },
  heroIndex: { width: 62, paddingTop: 7, alignItems: "flex-start", gap: 10 },
  heroIndexRule: { width: 28, height: 1 },
  heroBody: { flex: 1, justifyContent: "center", gap: 14, paddingRight: 8 },
  heroEyebrow: { flexDirection: "row", alignItems: "center", gap: 9 },
  heroTitle: { maxWidth: 540, fontSize: 38, lineHeight: 47, fontWeight: "300", letterSpacing: -1.1 },
  heroDetail: { maxWidth: 470, fontSize: 13, lineHeight: 22, fontWeight: "400" },
  heroAction: { alignSelf: "flex-start", minHeight: 50, borderWidth: 1, borderRadius: 16, marginTop: 5, paddingHorizontal: 16, flexDirection: "row", alignItems: "center", gap: 18 },
  heroActionText: { fontSize: 11, lineHeight: 15, fontWeight: "700" },
  arrow: { fontSize: 18, lineHeight: 21, fontWeight: "300" },
  marketDesk: { minHeight: 118, borderWidth: 1, borderRadius: 22, padding: 18, flexDirection: "row", alignItems: "center", gap: 20 },
  marketIdentity: { flex: 1, gap: 6 },
  marketName: { fontSize: 20, lineHeight: 25, fontWeight: "500" },
  marketSub: { fontSize: 8, lineHeight: 11, fontWeight: "600", letterSpacing: 0.8 },
  marketQuote: { alignItems: "flex-end", gap: 5 },
  marketPrice: { fontSize: 20, lineHeight: 24, fontWeight: "400", fontVariant: ["tabular-nums"] },
  marketState: { fontSize: 9, lineHeight: 12, fontWeight: "700", letterSpacing: 0.5 },
  sectionLead: { gap: 5, paddingTop: 4 },
  sectionLeadText: { fontSize: 10, lineHeight: 16 },
  capitalLedger: { minHeight: 178, borderTopWidth: 1, borderBottomWidth: 1, flexDirection: "row", paddingVertical: 22 },
  capitalHero: { flex: 1.35, justifyContent: "center", gap: 7, paddingRight: 18 },
  capitalHeroValue: { fontSize: 30, lineHeight: 36, fontWeight: "300", fontVariant: ["tabular-nums"] },
  capitalPnl: { fontSize: 11, lineHeight: 15, fontWeight: "700", fontVariant: ["tabular-nums"] },
  ledgerColumn: { flex: 1, borderLeftWidth: 1, paddingLeft: 18, justifyContent: "center" },
  ledgerRow: { minHeight: 42, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  ledgerValue: { flexShrink: 1, textAlign: "right", fontSize: 11, lineHeight: 15, fontWeight: "600", fontVariant: ["tabular-nums"] },
  ledgerDivider: { height: StyleSheet.hairlineWidth, width: "100%" },
  decisionDesk: { minHeight: 212, borderWidth: 1, borderRadius: 24, padding: 20, gap: 17 },
  decisionHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 16 },
  decisionLabel: { marginTop: 5, fontSize: 8, lineHeight: 11, fontWeight: "700", letterSpacing: 1 },
  decisionText: { maxWidth: 580, fontSize: 20, lineHeight: 30, fontWeight: "400", letterSpacing: -0.3 },
  decisionStats: { flexDirection: "row", gap: 12 },
  decisionStat: { flex: 1, minHeight: 48, justifyContent: "center", gap: 4 },
  decisionStatValue: { fontSize: 18, lineHeight: 22, fontWeight: "500", fontVariant: ["tabular-nums"] },
  decisionStatSmall: { fontSize: 10, lineHeight: 14, fontWeight: "600" },
  evidenceDesk: { borderWidth: 1, borderRadius: 24, padding: 20, gap: 16 },
  evidenceHeader: { minHeight: 48, flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 },
  evidenceTitle: { marginTop: 4, fontSize: 17, lineHeight: 22, fontWeight: "500" },
  textAction: { minHeight: 48, justifyContent: "center", paddingLeft: 12 },
  textActionLabel: { fontSize: 10, lineHeight: 14, fontWeight: "700" },
  evidenceGroup: { gap: 10 },
  evidenceLine: { minHeight: 38, flexDirection: "row", alignItems: "flex-start", gap: 11 },
  evidenceRule: { width: 2, minHeight: 28, borderRadius: 1, marginTop: 2 },
  evidenceText: { flex: 1, fontSize: 11, lineHeight: 18 },
  emptyText: { fontSize: 10, lineHeight: 17 },
  horizontalRule: { height: StyleSheet.hairlineWidth, width: "100%" },
  invalidationBlock: { gap: 8 },
  quickActions: { flexDirection: "row", gap: 10 },
  quickAction: { flex: 1, minHeight: 84, borderWidth: 1, borderRadius: 18, padding: 14, justifyContent: "center", gap: 5 },
  quickActionValue: { fontSize: 13, lineHeight: 17, fontWeight: "700" },
  quickArrow: { position: "absolute", top: 13, right: 13, fontSize: 16, lineHeight: 18, fontWeight: "300" },
  ownerCommand: { minHeight: 90, borderWidth: 1, borderRadius: 24, paddingHorizontal: 18, paddingVertical: 15, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 18 },
  ownerCommandTitle: { marginTop: 5, fontSize: 15, lineHeight: 20, fontWeight: "700" },
  ownerCommandSub: { marginTop: 4, maxWidth: 430, fontSize: 9, lineHeight: 14 },
  ownerCommandArrow: { fontSize: 26, lineHeight: 30, fontWeight: "300" },
  footer: { textAlign: "center", paddingTop: 2, fontSize: 8, lineHeight: 12, fontWeight: "600", letterSpacing: 1.1 },
});
