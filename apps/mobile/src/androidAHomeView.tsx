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

function TruthPill({ label, tone = "normal" }: Readonly<{ label: string; tone?: Tone }>) {
  const { theme } = useTheme();
  const dot = tone === "blocked" ? theme.colors.danger : tone === "warning" ? theme.colors.warning : theme.colors.primary;
  return <View style={styles.truthPill}><View style={[styles.truthDot, { backgroundColor: dot }]} /><Text style={[styles.truthText, { color: theme.colors.textMuted }]}>{label}</Text></View>;
}

function EvidenceRow({ text, counter = false }: Readonly<{ text: string; counter?: boolean }>) {
  const { theme } = useTheme();
  return <View style={styles.evidenceRow}><View style={[styles.evidenceDot, { backgroundColor: counter ? theme.colors.danger : theme.colors.primary }]} /><Text style={[styles.evidenceText, { color: theme.colors.text }]}>{text}</Text></View>;
}

export function AndroidAHomeView(props: Props) {
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
      title: "연결 상태를 확인하세요",
      detail: props.readOnlyError ?? props.notConfigured ?? "PAPER 연결 상태를 확인하세요.",
      tone: "blocked",
      actionLabel: "CONTROL 열기",
      onPress: props.onGoSettings,
    }
    : props.snapshot != null && !paperReady
      ? {
        eyebrow: "SAFETY GATE",
        title: "현재는 운용보다 확인이 우선입니다",
        detail: "PAPER 운용 게이트가 닫혀 있습니다. 차단 원인을 먼저 확인하세요.",
        tone: "warning",
        actionLabel: "상태 확인",
        onPress: props.onGoSettings,
      }
      : ai?.status === "AVAILABLE"
        ? {
          eyebrow: "NUSA REVIEW READY",
          title: ai.thesis || "새 판단을 검토할 수 있습니다",
          detail: "근거와 반대 근거를 확인한 뒤 사용자가 결정합니다.",
          tone: "normal",
          actionLabel: "판단 보기",
          onPress: () => props.onNavigate("AiSignal"),
        }
        : positionOpen
          ? {
            eyebrow: "POSITION SUPERVISION",
            title: "포지션을 계속 감독하고 있습니다",
            detail: "현재 포지션과 노출 변화를 관찰 중입니다.",
            tone: "normal",
            actionLabel: "자산 보기",
            onPress: () => props.onNavigate("Portfolio"),
          }
          : {
            eyebrow: "MARKETS ARE BEING MONITORED",
            title: "현재 별도 조치가 필요하지 않습니다",
            detail: "NUSA가 시장과 PAPER 운용 상태를 지속적으로 감시하고 있습니다.",
            tone: "normal",
            actionLabel: "시장 보기",
            onPress: () => props.onNavigate("Markets"),
          };

  const stateColor = state.tone === "blocked" ? theme.colors.danger : state.tone === "warning" ? theme.colors.warning : theme.colors.primary;
  const pnlColor = totalPnl == null ? theme.colors.textMuted : totalPnl >= 0 ? theme.colors.success : theme.colors.danger;
  const operatingHealth = disconnected ? "CHECK" : paperReady && marketFresh ? "GOOD" : "WATCH";
  const healthColor = operatingHealth === "GOOD" ? theme.colors.success : operatingHealth === "WATCH" ? theme.colors.warning : theme.colors.danger;
  const marketLabel = props.publicMarket ?? "MARKET";
  const marketPrice = props.publicCurrentPrice == null ? "—" : money(props.publicCurrentPrice);
  const insight = ai?.status === "AVAILABLE" && ai.thesis ? ai.thesis : decision.now;

  return <ScrollView
    style={{ backgroundColor: theme.colors.background }}
    contentContainerStyle={styles.content}
    refreshControl={<RefreshControl tintColor={theme.colors.primary} refreshing={props.refreshing} onRefresh={props.onRefresh} />}
    testID="home-screen"
  >
    <View pointerEvents="none" style={styles.atmosphere}>
      <View style={[styles.orbLarge, { borderColor: theme.colors.neonPurple, backgroundColor: theme.colors.primarySoft }]} />
      <View style={[styles.orbSmall, { borderColor: theme.colors.neonBlue }]} />
      <View style={[styles.lightBand, { backgroundColor: theme.colors.neonGlow }]} />
    </View>

    <View style={styles.brandRow} testID="android-a-brand">
      <View style={styles.brandLockup}>
        <View style={[styles.brandHalo, { borderColor: theme.colors.neonPurple }]} />
        <View><Text style={[styles.wordmark, { color: theme.colors.text }]}>NUSA</Text><Text style={[styles.productLine, { color: theme.colors.textMuted }]}>AI SUPERVISORY OS</Text></View>
      </View>
      <Text style={[styles.conceptMark, { color: theme.colors.textMuted }]}>ANDROID · A</Text>
    </View>

    <View style={[styles.truthRail, { borderColor: theme.colors.border, backgroundColor: theme.colors.surface }]} testID="android-system-truth-rail">
      <TruthPill label="PAPER ONLY" />
      <TruthPill label="AI ZERO AUTHORITY" />
      <TruthPill label="YOU ARE SUPERVISOR" />
      <TruthPill label={marketFresh ? "DATA FRESH" : "DATA CHECK"} tone={marketFresh ? "normal" : "warning"} />
    </View>

    <View style={styles.hero} testID="android-a-now">
      <View style={styles.heroTopLine}><View style={[styles.heroDot, { backgroundColor: stateColor }]} /><Meta accent>{state.eyebrow}</Meta></View>
      <Text style={[styles.heroTitle, { color: theme.colors.text }]}>{state.title}</Text>
      <Text style={[styles.heroDetail, { color: theme.colors.textMuted }]}>{state.detail}</Text>
      <Pressable accessibilityRole="button" onPress={state.onPress} style={({ pressed }) => [styles.heroAction, { borderColor: theme.colors.borderStrong, backgroundColor: theme.colors.surface, opacity: pressed ? theme.interaction.pressedOpacity : 1 }]}>
        <Text style={[styles.heroActionText, { color: theme.colors.text }]}>{state.actionLabel}</Text><Text style={[styles.arrow, { color: stateColor }]}>→</Text>
      </Pressable>
    </View>

    <View style={[styles.marketStrip, { borderColor: theme.colors.border, backgroundColor: theme.colors.surfaceSunken }]} testID="android-a-market-strip">
      <View style={styles.marketPrimary}><Meta>ACTIVE MARKET</Meta><Text style={[styles.marketName, { color: theme.colors.text }]}>{marketLabel}</Text></View>
      <View style={styles.marketMetric}><Meta>PRICE</Meta><Text style={[styles.marketValue, { color: theme.colors.text }]}>{marketPrice}</Text></View>
      <View style={styles.marketMetric}><Meta>STATE</Meta><Text style={[styles.marketValueSmall, { color: marketFresh ? theme.colors.success : theme.colors.warning }]}>{marketFresh ? "FRESH" : "CHECK"}</Text></View>
    </View>

    <View style={[styles.healthSurface, { borderColor: theme.colors.border, backgroundColor: theme.colors.surface }]} testID="android-a-health">
      <View style={styles.healthPrimary}><Meta>OPERATING HEALTH</Meta><Text style={[styles.healthWord, { color: healthColor }]}>{operatingHealth}</Text><Text style={[styles.healthCaption, { color: theme.colors.textMuted }]}>현재 확인 가능한 시스템·시장·PAPER 상태 기준</Text></View>
      <View style={styles.healthMetric}><Meta>TOTAL ASSET</Meta><Text style={[styles.healthValue, { color: theme.colors.text }]}>{account == null ? "—" : money(account.equity)}</Text><Text style={[styles.healthDelta, { color: pnlColor }]}>{totalPnl == null ? "PnL 대기" : signedMoney(totalPnl)}</Text></View>
      <View style={styles.healthMetric}><Meta>EXPOSURE</Meta><Text style={[styles.healthValue, { color: theme.colors.text }]}>{percent(exposure)}</Text><Text style={[styles.healthCaption, { color: theme.colors.textMuted }]}>{positionOpen && account ? account.position.market : "NO POSITION"}</Text></View>
    </View>

    <Pressable accessibilityRole="button" onPress={() => props.onNavigate("AiSignal")} style={({ pressed }) => [styles.insightSurface, { borderColor: theme.colors.borderStrong, backgroundColor: theme.colors.surfaceRaised, opacity: pressed ? theme.interaction.pressedOpacity : 1 }]} testID="android-a-insight">
      <View style={styles.sectionHeader}><View><Meta accent>✦ NUSA INSIGHT</Meta><Text style={[styles.sectionTitle, { color: theme.colors.text }]}>지금의 판단</Text></View><Text style={[styles.arrow, { color: theme.colors.primary }]}>→</Text></View>
      <Text style={[styles.insightText, { color: theme.colors.text }]}>{insight}</Text>
      <View style={styles.insightMetaRow}>
        <View style={styles.insightMeta}><Meta>EVIDENCE</Meta><Text style={[styles.insightMetaValue, { color: theme.colors.text }]}>{evidence.length}</Text></View>
        <View style={styles.insightMeta}><Meta>COUNTER</Meta><Text style={[styles.insightMetaValue, { color: theme.colors.text }]}>{counterEvidence.length}</Text></View>
        <View style={styles.insightMeta}><Meta>CALIBRATION</Meta><Text style={[styles.insightMetaSmall, { color: theme.colors.text }]}>{ai?.calibrationStatus ?? "—"}</Text></View>
      </View>
    </Pressable>

    <View style={styles.focusRow} testID="android-a-focus">
      <Pressable onPress={() => props.onNavigate("Markets")} style={[styles.focusTile, { borderColor: theme.colors.border, backgroundColor: theme.colors.surface }]}><Meta>MARKET</Meta><Text style={[styles.focusTitle, { color: theme.colors.text }]}>{marketLabel}</Text><Text style={[styles.focusSub, { color: theme.colors.textMuted }]}>공개 시장 관찰</Text></Pressable>
      <Pressable onPress={() => props.onNavigate("Portfolio")} style={[styles.focusTile, { borderColor: theme.colors.border, backgroundColor: theme.colors.surface }]}><Meta>ASSETS</Meta><Text style={[styles.focusTitle, { color: theme.colors.text }]}>{positionOpen && account ? account.position.market : "PORTFOLIO"}</Text><Text style={[styles.focusSub, { color: theme.colors.textMuted }]}>노출·PnL 감독</Text></Pressable>
      <Pressable onPress={props.onOpenPaperLearning} style={[styles.focusTile, { borderColor: theme.colors.border, backgroundColor: theme.colors.surface }]}><Meta>LEARNING</Meta><Text style={[styles.focusTitle, { color: theme.colors.text }]}>EVIDENCE</Text><Text style={[styles.focusSub, { color: theme.colors.textMuted }]}>학습 근거 보기</Text></Pressable>
    </View>

    <View style={[styles.sheet, { borderColor: theme.colors.borderStrong, backgroundColor: theme.colors.surfaceRaised }]} testID="android-a-evidence-sheet">
      <View style={[styles.sheetHandle, { backgroundColor: theme.colors.borderStrong }]} />
      <View style={styles.sheetTabs}><Text style={[styles.sheetTabActive, { color: theme.colors.text, borderBottomColor: theme.colors.neonPurple }]}>근거와 분석</Text><Text style={[styles.sheetTab, { color: theme.colors.textMuted }]}>리스크</Text><Text style={[styles.sheetTab, { color: theme.colors.textMuted }]}>히스토리</Text></View>

      <View style={styles.sheetSection}><View style={styles.sheetSectionHeader}><Text style={[styles.sheetSectionTitle, { color: theme.colors.text }]}>핵심 근거</Text><Meta>{evidence.length}</Meta></View>{evidence.length > 0 ? evidence.slice(0, 3).map((item, index) => <EvidenceRow key={`e-${index}`} text={item} />) : <Text style={[styles.emptyText, { color: theme.colors.textMuted }]}>검증된 근거 참조가 아직 없습니다.</Text>}</View>
      <View style={[styles.sheetDivider, { backgroundColor: theme.colors.border }]} />
      <View style={styles.sheetSection}><View style={styles.sheetSectionHeader}><Text style={[styles.sheetSectionTitle, { color: theme.colors.text }]}>반대 근거</Text><Meta>{counterEvidence.length}</Meta></View>{counterEvidence.length > 0 ? counterEvidence.slice(0, 2).map((item, index) => <EvidenceRow counter key={`c-${index}`} text={item} />) : <Text style={[styles.emptyText, { color: theme.colors.textMuted }]}>등록된 반대 근거가 없습니다.</Text>}</View>
      <View style={[styles.sheetDivider, { backgroundColor: theme.colors.border }]} />
      <View style={styles.sheetSection}><Text style={[styles.sheetSectionTitle, { color: theme.colors.text }]}>판단이 바뀌는 조건</Text><Text style={[styles.emptyText, { color: theme.colors.textMuted }]}>현재 canonical AI projection에 전용 invalidation 필드가 없어 조건을 임의 생성하지 않습니다.</Text></View>

      <Pressable accessibilityRole="button" onPress={() => props.onNavigate("AiSignal")} style={({ pressed }) => [styles.sheetAction, { borderColor: theme.colors.borderStrong, opacity: pressed ? theme.interaction.pressedOpacity : 1 }]}><Text style={[styles.sheetActionText, { color: theme.colors.text }]}>NUSA 판단 전체 보기</Text><Text style={[styles.arrow, { color: theme.colors.primary }]}>→</Text></Pressable>
    </View>

    <View style={styles.ownerActions} testID="android-a-owner-actions">
      <Pressable accessibilityRole="button" onPress={() => {
        switch (decision.primaryAction) {
          case "SETTINGS": props.onGoSettings(); break;
          case "PORTFOLIO": props.onNavigate("Portfolio"); break;
          case "AI_SIGNAL": props.onNavigate("AiSignal"); break;
          case "MARKETS": props.onNavigate("Markets"); break;
        }
      }} style={({ pressed }) => [styles.ownerPrimary, { borderColor: theme.colors.neonPurple, backgroundColor: theme.colors.primarySoft, opacity: pressed ? theme.interaction.pressedOpacity : 1 }]} testID="home-supervisor-primary-action"><View><Meta accent>OWNER ACTION</Meta><Text style={[styles.ownerPrimaryTitle, { color: theme.colors.text }]}>{decision.primaryLabel}</Text></View><Text style={[styles.arrow, { color: theme.colors.primary }]}>→</Text></Pressable>
      {allocation ? <View style={[styles.capitalNote, { borderColor: theme.colors.border }]}><Meta>PROTECTED CASH</Meta><Text style={[styles.capitalValue, { color: theme.colors.text }]}>{money(allocation.reservedCash)}</Text></View> : null}
    </View>

    <Text style={[styles.footer, { color: theme.colors.textMuted }]}>판단을 설득하지 않습니다. 검증 가능하게 만들고, 결정은 사용자에게 남깁니다.</Text>
  </ScrollView>;
}

const styles = StyleSheet.create({
  content: { width: "100%", maxWidth: 680, alignSelf: "center", paddingHorizontal: 20, paddingTop: 18, paddingBottom: 44, gap: 20, overflow: "hidden" },
  atmosphere: { ...StyleSheet.absoluteFillObject, overflow: "hidden" },
  orbLarge: { position: "absolute", width: 470, height: 470, borderRadius: 235, borderWidth: 1, right: -270, top: 150, opacity: 0.26 },
  orbSmall: { position: "absolute", width: 210, height: 210, borderRadius: 105, borderWidth: 1, right: -80, top: 300, opacity: 0.26 },
  lightBand: { position: "absolute", width: 620, height: 160, right: -320, top: 260, transform: [{ rotate: "-28deg" }], opacity: 0.35 },
  brandRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 16 },
  brandLockup: { flexDirection: "row", alignItems: "center", gap: 13 },
  brandHalo: { width: 44, height: 44, borderRadius: 22, borderWidth: 2, opacity: 0.9 },
  wordmark: { fontSize: 30, lineHeight: 35, fontWeight: "300", letterSpacing: 5 },
  productLine: { marginTop: 1, fontSize: 8, lineHeight: 11, fontWeight: "600", letterSpacing: 2 },
  conceptMark: { fontSize: 8, lineHeight: 11, fontWeight: "600", letterSpacing: 1 },
  truthRail: { minHeight: 48, borderWidth: 1, borderRadius: 24, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", flexWrap: "wrap", columnGap: 13, rowGap: 5 },
  truthPill: { minHeight: 34, flexDirection: "row", alignItems: "center", gap: 6 },
  truthDot: { width: 6, height: 6, borderRadius: 3 },
  truthText: { fontSize: 8, lineHeight: 11, fontWeight: "600", letterSpacing: 0.45 },
  meta: { fontSize: 8, lineHeight: 11, fontWeight: "700", letterSpacing: 1.15 },
  hero: { minHeight: 350, justifyContent: "center", paddingHorizontal: 6, paddingVertical: 28, gap: 14 },
  heroTopLine: { flexDirection: "row", alignItems: "center", gap: 8 },
  heroDot: { width: 7, height: 7, borderRadius: 4 },
  heroTitle: { maxWidth: 540, fontSize: 41, lineHeight: 50, fontWeight: "300", letterSpacing: -1.2 },
  heroDetail: { maxWidth: 430, fontSize: 14, lineHeight: 23, fontWeight: "400" },
  heroAction: { alignSelf: "flex-start", minHeight: 48, borderWidth: 1, borderRadius: 24, paddingHorizontal: 18, flexDirection: "row", alignItems: "center", gap: 16, marginTop: 8 },
  heroActionText: { fontSize: 12, lineHeight: 16, fontWeight: "600" },
  arrow: { fontSize: 19, lineHeight: 21, fontWeight: "300" },
  marketStrip: { minHeight: 66, borderWidth: 1, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 10, flexDirection: "row", alignItems: "center", gap: 16 },
  marketPrimary: { flex: 1.25, gap: 3 },
  marketMetric: { flex: 1, gap: 3 },
  marketName: { fontSize: 15, lineHeight: 19, fontWeight: "600" },
  marketValue: { fontSize: 14, lineHeight: 18, fontWeight: "500", fontVariant: ["tabular-nums"] },
  marketValueSmall: { fontSize: 10, lineHeight: 14, fontWeight: "700" },
  healthSurface: { borderWidth: 1, borderRadius: 24, padding: 20, flexDirection: "row", gap: 20, alignItems: "stretch" },
  healthPrimary: { flex: 1.3, gap: 5 },
  healthMetric: { flex: 1, gap: 5, justifyContent: "center" },
  healthWord: { fontSize: 31, lineHeight: 36, fontWeight: "500", letterSpacing: 0.2 },
  healthValue: { fontSize: 19, lineHeight: 24, fontWeight: "400", fontVariant: ["tabular-nums"] },
  healthDelta: { fontSize: 10, lineHeight: 14, fontWeight: "600", fontVariant: ["tabular-nums"] },
  healthCaption: { fontSize: 9, lineHeight: 14 },
  insightSurface: { minHeight: 170, borderWidth: 1, borderRadius: 26, padding: 20, gap: 16 },
  sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 16 },
  sectionTitle: { marginTop: 5, fontSize: 13, lineHeight: 18, fontWeight: "600" },
  insightText: { maxWidth: 560, fontSize: 18, lineHeight: 29, fontWeight: "400", letterSpacing: -0.25 },
  insightMetaRow: { flexDirection: "row", gap: 10 },
  insightMeta: { flex: 1, minHeight: 52, justifyContent: "center", gap: 4 },
  insightMetaValue: { fontSize: 18, lineHeight: 22, fontWeight: "500", fontVariant: ["tabular-nums"] },
  insightMetaSmall: { fontSize: 10, lineHeight: 14, fontWeight: "600" },
  focusRow: { flexDirection: "row", gap: 10 },
  focusTile: { flex: 1, minHeight: 82, borderWidth: 1, borderRadius: 18, padding: 13, justifyContent: "center", gap: 4 },
  focusTitle: { fontSize: 12, lineHeight: 16, fontWeight: "700" },
  focusSub: { fontSize: 9, lineHeight: 13 },
  sheet: { borderWidth: 1, borderRadius: 30, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 20, gap: 15 },
  sheetHandle: { width: 42, height: 4, borderRadius: 2, alignSelf: "center", opacity: 0.8 },
  sheetTabs: { minHeight: 44, flexDirection: "row", alignItems: "center", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "rgba(255,255,255,0.08)" },
  sheetTabActive: { flex: 1, height: 44, textAlign: "center", textAlignVertical: "center", fontSize: 10, lineHeight: 14, fontWeight: "700", borderBottomWidth: 2 },
  sheetTab: { flex: 1, textAlign: "center", fontSize: 10, lineHeight: 14, fontWeight: "600" },
  sheetSection: { gap: 9 },
  sheetSectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  sheetSectionTitle: { fontSize: 13, lineHeight: 18, fontWeight: "600" },
  evidenceRow: { minHeight: 34, flexDirection: "row", alignItems: "flex-start", gap: 9 },
  evidenceDot: { width: 6, height: 6, borderRadius: 3, marginTop: 6 },
  evidenceText: { flex: 1, fontSize: 11, lineHeight: 18 },
  emptyText: { fontSize: 10, lineHeight: 17 },
  sheetDivider: { height: StyleSheet.hairlineWidth, width: "100%" },
  sheetAction: { minHeight: 52, borderWidth: 1, borderRadius: 18, paddingHorizontal: 16, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sheetActionText: { fontSize: 11, lineHeight: 15, fontWeight: "700" },
  ownerActions: { gap: 10 },
  ownerPrimary: { minHeight: 72, borderWidth: 1, borderRadius: 22, paddingHorizontal: 17, paddingVertical: 12, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  ownerPrimaryTitle: { marginTop: 4, fontSize: 14, lineHeight: 19, fontWeight: "700" },
  capitalNote: { minHeight: 54, borderTopWidth: StyleSheet.hairlineWidth, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  capitalValue: { fontSize: 12, lineHeight: 16, fontWeight: "600", fontVariant: ["tabular-nums"] },
  footer: { paddingHorizontal: 14, textAlign: "center", fontSize: 9, lineHeight: 15 },
});