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

function StateMark({ tone = "normal" }: Readonly<{ tone?: Tone }>) {
  const { theme } = useTheme();
  const color = tone === "blocked" ? theme.colors.danger : tone === "warning" ? theme.colors.warning : theme.colors.primary;
  return <View style={[styles.stateMark, { backgroundColor: color }]} />;
}

function Fact({ label, value, sub, valueColor }: Readonly<{ label: string; value: string; sub?: string; valueColor?: string }>) {
  const { theme } = useTheme();
  return <View style={styles.fact}>
    <Meta>{label}</Meta>
    <Text style={[styles.factValue, { color: valueColor ?? theme.colors.text }]}>{value}</Text>
    {sub ? <Text style={[styles.factSub, { color: theme.colors.textMuted }]}>{sub}</Text> : null}
  </View>;
}

function EvidenceItem({ text, counter = false }: Readonly<{ text: string; counter?: boolean }>) {
  const { theme } = useTheme();
  return <View style={styles.evidenceItem}>
    <View style={[styles.evidenceSymbol, { borderColor: counter ? theme.colors.danger : theme.colors.primary }]} />
    <Text style={[styles.evidenceText, { color: theme.colors.text }]}>{text}</Text>
  </View>;
}

export function AndroidCHomeView(props: Props) {
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

  const state: Readonly<{ label: string; title: string; detail: string; tone: Tone; action: string; onPress: () => void }> = disconnected
    ? {
      label: "연결 확인 필요",
      title: "먼저 연결 상태를 확인하세요.",
      detail: props.readOnlyError ?? props.notConfigured ?? "PAPER 연결 상태를 확인하세요.",
      tone: "blocked",
      action: "Control 열기",
      onPress: props.onGoSettings,
    }
    : props.snapshot != null && !paperReady
      ? {
        label: "안전 게이트",
        title: "지금은 운용보다 확인이 우선입니다.",
        detail: "PAPER 운용 게이트가 닫혀 있습니다. 차단 원인을 먼저 확인하세요.",
        tone: "warning",
        action: "상태 확인",
        onPress: props.onGoSettings,
      }
      : ai?.status === "AVAILABLE"
        ? {
          label: "새 판단",
          title: ai.thesis || "검토할 판단이 있습니다.",
          detail: "근거와 반대 근거를 확인한 뒤 사용자가 결정합니다.",
          tone: "normal",
          action: "판단 검토",
          onPress: () => props.onNavigate("AiSignal"),
        }
        : positionOpen
          ? {
            label: "포지션 감독 중",
            title: "현재 포지션을 계속 지켜보고 있습니다.",
            detail: "포지션과 노출 변화가 현재 우선 감시 대상입니다.",
            tone: "normal",
            action: "자산 보기",
            onPress: () => props.onNavigate("Portfolio"),
          }
          : {
            label: "시장 감시 중",
            title: "지금은 별도 조치가 필요하지 않습니다.",
            detail: "NUSA가 시장과 PAPER 운용 상태를 계속 감시하고 있습니다.",
            tone: "normal",
            action: "시장 보기",
            onPress: () => props.onNavigate("Markets"),
          };

  const stateColor = state.tone === "blocked" ? theme.colors.danger : state.tone === "warning" ? theme.colors.warning : theme.colors.primary;
  const pnlColor = totalPnl == null ? theme.colors.textMuted : totalPnl >= 0 ? theme.colors.success : theme.colors.danger;
  const marketLabel = props.publicMarket ?? "MARKET";
  const marketPrice = props.publicCurrentPrice == null ? "—" : money(props.publicCurrentPrice);
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
    <View style={styles.appBar} testID="android-c-brand">
      <Text style={[styles.wordmark, { color: theme.colors.text }]}>NUSA</Text>
      <View style={[styles.paperCapsule, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
        <StateMark />
        <Text style={[styles.paperText, { color: theme.colors.text }]}>PAPER</Text>
      </View>
    </View>

    <View style={[styles.hero, { backgroundColor: theme.colors.surfaceRaised, borderColor: theme.colors.border }]} testID="android-c-now">
      <View style={styles.heroHeader}>
        <View style={styles.stateLabel}><StateMark tone={state.tone} /><Text style={[styles.stateLabelText, { color: stateColor }]}>{state.label}</Text></View>
        <Text style={[styles.conceptMark, { color: theme.colors.textMuted }]}>C</Text>
      </View>
      <Text style={[styles.heroTitle, { color: theme.colors.text }]}>{state.title}</Text>
      <Text style={[styles.heroDetail, { color: theme.colors.textMuted }]}>{state.detail}</Text>
      <Pressable accessibilityRole="button" onPress={state.onPress} style={({ pressed }) => [styles.heroAction, { backgroundColor: theme.colors.text, opacity: pressed ? theme.interaction.pressedOpacity : 1 }]}>
        <Text style={[styles.heroActionText, { color: theme.colors.background }]}>{state.action}</Text>
        <Text style={[styles.heroActionArrow, { color: theme.colors.background }]}>→</Text>
      </Pressable>
      <View style={[styles.heroFooter, { borderTopColor: theme.colors.border }]}>
        <View style={styles.heroMarket}><Meta>MARKET</Meta><Text style={[styles.heroMarketValue, { color: theme.colors.text }]}>{marketLabel}</Text></View>
        <View style={styles.heroMarket}><Meta>LAST</Meta><Text style={[styles.heroMarketValue, { color: theme.colors.text }]}>{marketPrice}</Text></View>
        <View style={styles.heroMarket}><Meta>DATA</Meta><Text style={[styles.heroMarketValue, { color: marketFresh ? theme.colors.success : theme.colors.warning }]}>{marketFresh ? "FRESH" : "CHECK"}</Text></View>
      </View>
    </View>

    <View style={styles.truthLine} testID="android-system-truth-rail">
      <Text style={[styles.truthText, { color: theme.colors.textMuted }]}>PAPER ONLY</Text>
      <View style={[styles.truthDot, { backgroundColor: theme.colors.borderStrong }]} />
      <Text style={[styles.truthText, { color: theme.colors.textMuted }]}>AI ZERO AUTHORITY</Text>
      <View style={[styles.truthDot, { backgroundColor: theme.colors.borderStrong }]} />
      <Text style={[styles.truthText, { color: theme.colors.textMuted }]}>USER SUPERVISION</Text>
    </View>

    <View style={styles.sectionHead}>
      <View><Meta accent>자산</Meta><Text style={[styles.sectionTitle, { color: theme.colors.text }]}>현재 상태</Text></View>
      <Pressable accessibilityRole="button" onPress={() => props.onNavigate("Portfolio")} style={({ pressed }) => [styles.inlineButton, { opacity: pressed ? theme.interaction.pressedOpacity : 1 }]}><Text style={[styles.inlineButtonText, { color: theme.colors.primary }]}>전체 보기 →</Text></Pressable>
    </View>

    <View style={[styles.capitalBand, { borderTopColor: theme.colors.border, borderBottomColor: theme.colors.border }]} testID="android-c-capital">
      <Fact label="TOTAL ASSET" value={account == null ? "—" : money(account.equity)} sub={totalPnl == null ? "PnL 대기" : signedMoney(totalPnl)} valueColor={theme.colors.text} />
      <View style={[styles.factDivider, { backgroundColor: theme.colors.border }]} />
      <Fact label="EXPOSURE" value={percent(exposure)} sub={positionOpen && account ? account.position.market : "NO POSITION"} />
      <View style={[styles.factDivider, { backgroundColor: theme.colors.border }]} />
      <Fact label="PROTECTED" value={allocation == null ? "—" : money(allocation.reservedCash)} sub="reserved cash" />
    </View>
    {totalPnl != null ? <Text style={[styles.pnlLine, { color: pnlColor }]}>PAPER PnL {signedMoney(totalPnl)}</Text> : null}

    <Pressable accessibilityRole="button" onPress={() => props.onNavigate("AiSignal")} style={({ pressed }) => [styles.nusaSurface, { backgroundColor: theme.colors.primarySoft, borderColor: theme.colors.borderStrong, opacity: pressed ? theme.interaction.pressedOpacity : 1 }]} testID="android-c-nusa">
      <View style={styles.nusaTop}>
        <View style={[styles.nusaGlyph, { backgroundColor: theme.colors.primary }]}><Text style={[styles.nusaGlyphText, { color: theme.colors.onPrimary }]}>N</Text></View>
        <View style={styles.nusaMeta}><Meta accent>NUSA</Meta><Text style={[styles.nusaKicker, { color: theme.colors.textMuted }]}>검증 가능한 판단</Text></View>
        <Text style={[styles.nusaArrow, { color: theme.colors.primary }]}>↗</Text>
      </View>
      <Text style={[styles.nusaInsight, { color: theme.colors.text }]}>{insight}</Text>
      <View style={styles.nusaStats}>
        <Fact label="EVIDENCE" value={`${evidence.length}`} />
        <Fact label="COUNTER" value={`${counterEvidence.length}`} />
        <Fact label="CALIBRATION" value={ai?.calibrationStatus ?? "—"} />
      </View>
    </Pressable>

    <View style={styles.sectionHead}>
      <View><Meta accent>근거</Meta><Text style={[styles.sectionTitle, { color: theme.colors.text }]}>왜 그렇게 판단했는가</Text></View>
      <Pressable accessibilityRole="button" onPress={props.onOpenPaperLearning} style={({ pressed }) => [styles.inlineButton, { opacity: pressed ? theme.interaction.pressedOpacity : 1 }]}><Text style={[styles.inlineButtonText, { color: theme.colors.primary }]}>학습 근거 →</Text></Pressable>
    </View>

    <View style={[styles.evidenceSurface, { borderColor: theme.colors.border }]} testID="android-c-evidence">
      <Meta>KEY EVIDENCE</Meta>
      {evidence.length > 0
        ? evidence.slice(0, 2).map((item, index) => <EvidenceItem key={`e-${index}`} text={item} />)
        : <Text style={[styles.emptyText, { color: theme.colors.textMuted }]}>검증된 근거 참조가 아직 없습니다.</Text>}
      <View style={[styles.evidenceDivider, { backgroundColor: theme.colors.border }]} />
      <Meta>COUNTER EVIDENCE</Meta>
      {counterEvidence.length > 0
        ? counterEvidence.slice(0, 2).map((item, index) => <EvidenceItem counter key={`c-${index}`} text={item} />)
        : <Text style={[styles.emptyText, { color: theme.colors.textMuted }]}>등록된 반대 근거가 없습니다.</Text>}
      <View style={[styles.evidenceDivider, { backgroundColor: theme.colors.border }]} />
      <Meta>INVALIDATION</Meta>
      <Text style={[styles.emptyText, { color: theme.colors.textMuted }]}>현재 canonical AI projection에 전용 invalidation 필드가 없어 조건을 임의 생성하지 않습니다.</Text>
    </View>

    <Pressable accessibilityRole="button" onPress={runPrimaryAction} style={({ pressed }) => [styles.ownerAction, { backgroundColor: theme.colors.text, opacity: pressed ? theme.interaction.pressedOpacity : 1 }]} testID="home-supervisor-primary-action">
      <View>
        <Text style={[styles.ownerEyebrow, { color: theme.colors.background }]}>OWNER ACTION</Text>
        <Text style={[styles.ownerTitle, { color: theme.colors.background }]}>{decision.primaryLabel}</Text>
      </View>
      <Text style={[styles.ownerArrow, { color: theme.colors.background }]}>→</Text>
    </Pressable>

    <Text style={[styles.footer, { color: theme.colors.textMuted }]}>AI는 제안합니다. 권한은 갖지 않습니다.</Text>
  </ScrollView>;
}

const styles = StyleSheet.create({
  content: { width: "100%", maxWidth: 700, alignSelf: "center", paddingHorizontal: 18, paddingTop: 12, paddingBottom: 42, gap: 24 },
  appBar: { minHeight: 56, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 16 },
  wordmark: { fontSize: 24, lineHeight: 29, fontWeight: "700", letterSpacing: -0.5 },
  paperCapsule: { minHeight: 40, borderWidth: 1, borderRadius: 20, paddingHorizontal: 13, flexDirection: "row", alignItems: "center", gap: 8 },
  paperText: { fontSize: 9, lineHeight: 12, fontWeight: "700", letterSpacing: 0.9 },
  stateMark: { width: 8, height: 8, borderRadius: 4 },
  hero: { minHeight: 382, borderWidth: 1, borderTopLeftRadius: 38, borderTopRightRadius: 38, borderBottomLeftRadius: 38, borderBottomRightRadius: 12, padding: 24, gap: 16, justifyContent: "center" },
  heroHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 16 },
  stateLabel: { minHeight: 36, flexDirection: "row", alignItems: "center", gap: 9 },
  stateLabelText: { fontSize: 11, lineHeight: 15, fontWeight: "700" },
  conceptMark: { fontSize: 10, lineHeight: 14, fontWeight: "700" },
  heroTitle: { maxWidth: 560, fontSize: 39, lineHeight: 48, fontWeight: "500", letterSpacing: -1.4 },
  heroDetail: { maxWidth: 500, fontSize: 14, lineHeight: 22, fontWeight: "400" },
  heroAction: { alignSelf: "flex-start", minHeight: 52, borderRadius: 26, paddingHorizontal: 18, flexDirection: "row", alignItems: "center", gap: 18, marginTop: 4 },
  heroActionText: { fontSize: 12, lineHeight: 16, fontWeight: "700" },
  heroActionArrow: { fontSize: 18, lineHeight: 20, fontWeight: "400" },
  heroFooter: { borderTopWidth: StyleSheet.hairlineWidth, marginTop: 12, paddingTop: 16, flexDirection: "row", gap: 18 },
  heroMarket: { flex: 1, gap: 4 },
  heroMarketValue: { fontSize: 11, lineHeight: 15, fontWeight: "600", fontVariant: ["tabular-nums"] },
  truthLine: { minHeight: 32, flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "center", gap: 9 },
  truthText: { fontSize: 8, lineHeight: 11, fontWeight: "700", letterSpacing: 0.75 },
  truthDot: { width: 3, height: 3, borderRadius: 2 },
  meta: { fontSize: 8, lineHeight: 11, fontWeight: "700", letterSpacing: 1.05 },
  sectionHead: { minHeight: 50, flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", gap: 16 },
  sectionTitle: { marginTop: 5, fontSize: 21, lineHeight: 27, fontWeight: "600", letterSpacing: -0.5 },
  inlineButton: { minHeight: 48, justifyContent: "center", paddingHorizontal: 2 },
  inlineButtonText: { fontSize: 10, lineHeight: 14, fontWeight: "700" },
  capitalBand: { minHeight: 142, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: "row", alignItems: "stretch", paddingVertical: 18 },
  fact: { flex: 1, justifyContent: "center", gap: 5 },
  factValue: { fontSize: 18, lineHeight: 23, fontWeight: "500", fontVariant: ["tabular-nums"] },
  factSub: { fontSize: 9, lineHeight: 13, fontWeight: "500" },
  factDivider: { width: StyleSheet.hairlineWidth, marginHorizontal: 14 },
  pnlLine: { marginTop: -14, fontSize: 10, lineHeight: 14, fontWeight: "700", fontVariant: ["tabular-nums"] },
  nusaSurface: { minHeight: 236, borderWidth: 1, borderTopLeftRadius: 32, borderTopRightRadius: 12, borderBottomLeftRadius: 32, borderBottomRightRadius: 32, padding: 22, gap: 18 },
  nusaTop: { flexDirection: "row", alignItems: "center", gap: 12 },
  nusaGlyph: { width: 44, height: 44, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  nusaGlyphText: { fontSize: 17, lineHeight: 21, fontWeight: "800" },
  nusaMeta: { flex: 1, gap: 3 },
  nusaKicker: { fontSize: 10, lineHeight: 14, fontWeight: "600" },
  nusaArrow: { fontSize: 20, lineHeight: 24, fontWeight: "400" },
  nusaInsight: { maxWidth: 580, fontSize: 21, lineHeight: 31, fontWeight: "500", letterSpacing: -0.45 },
  nusaStats: { flexDirection: "row", gap: 16 },
  evidenceSurface: { borderWidth: 1, borderRadius: 24, padding: 20, gap: 13 },
  evidenceItem: { minHeight: 42, flexDirection: "row", alignItems: "flex-start", gap: 12 },
  evidenceSymbol: { width: 10, height: 10, borderRadius: 5, borderWidth: 2, marginTop: 4 },
  evidenceText: { flex: 1, fontSize: 11, lineHeight: 18 },
  evidenceDivider: { height: StyleSheet.hairlineWidth, width: "100%" },
  emptyText: { fontSize: 10, lineHeight: 17 },
  ownerAction: { minHeight: 88, borderTopLeftRadius: 26, borderTopRightRadius: 26, borderBottomLeftRadius: 26, borderBottomRightRadius: 8, paddingHorizontal: 20, paddingVertical: 16, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 18 },
  ownerEyebrow: { fontSize: 8, lineHeight: 11, fontWeight: "800", letterSpacing: 1 },
  ownerTitle: { marginTop: 5, fontSize: 16, lineHeight: 21, fontWeight: "700" },
  ownerArrow: { fontSize: 25, lineHeight: 29, fontWeight: "400" },
  footer: { textAlign: "center", paddingTop: 2, fontSize: 9, lineHeight: 13, fontWeight: "500" },
});
