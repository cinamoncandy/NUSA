import React from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
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

function Dot({ tone = "normal" }: Readonly<{ tone?: Tone }>) {
  const { theme } = useTheme();
  const color = tone === "blocked" ? theme.colors.danger : tone === "warning" ? theme.colors.warning : theme.colors.primary;
  return <View style={[styles.dot, { backgroundColor: color }]} />;
}

function Fact({ label, value, sub, valueColor }: Readonly<{ label: string; value: string; sub?: string; valueColor?: string }>) {
  const { theme } = useTheme();
  return <View style={styles.fact}>
    <Meta>{label}</Meta>
    <Text style={[styles.factValue, { color: valueColor ?? theme.colors.text }]} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
    {sub ? <Text style={[styles.factSub, { color: theme.colors.textMuted }]}>{sub}</Text> : null}
  </View>;
}

function EvidenceCard({ title, text, counter = false }: Readonly<{ title: string; text: string; counter?: boolean }>) {
  const { theme } = useTheme();
  const accent = counter ? theme.colors.danger : theme.colors.primary;
  return <View style={[styles.evidenceCard, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
    <View style={[styles.evidenceIcon, { backgroundColor: counter ? "#FFF0F1" : theme.colors.primarySoft, borderColor: accent }]}><View style={[styles.evidenceCore, { backgroundColor: accent }]} /></View>
    <Text style={[styles.evidenceTitle, { color: theme.colors.text }]}>{title}</Text>
    <Text style={[styles.evidenceText, { color: theme.colors.textMuted }]} numberOfLines={3}>{text}</Text>
  </View>;
}

function Orb() {
  const { theme } = useTheme();
  return <View pointerEvents="none" style={styles.orbWrap} accessibilityElementsHidden>
    <View style={[styles.orbShadow, { backgroundColor: theme.colors.primarySoft }]} />
    <View style={[styles.orbOuter, { borderColor: theme.colors.borderStrong, backgroundColor: "rgba(255,255,255,0.72)" }]}>
      <View style={[styles.orbArcOne, { borderColor: theme.colors.neonBlue }]} />
      <View style={[styles.orbArcTwo, { borderColor: theme.colors.neonPurple }]} />
      <View style={[styles.orbInner, { borderColor: theme.colors.primary }]}><Text style={[styles.orbWord, { color: theme.colors.textMuted }]}>NUSA</Text></View>
    </View>
  </View>;
}

export function AndroidDHomeView(props: Props) {
  const { theme } = useTheme();
  const { width, fontScale } = useWindowDimensions();
  const stacked = width < 430 || fontScale >= 1.35;
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
  const calibratedConfidence = ai?.calibrationStatus === "CALIBRATED" && typeof ai.confidence === "number" ? ai.confidence : null;

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
      title: "연결 상태를 먼저 확인하세요.",
      detail: props.readOnlyError ?? props.notConfigured ?? "PAPER 연결 상태를 확인하세요.",
      tone: "blocked",
      action: "Control 열기",
      onPress: props.onGoSettings,
    }
    : props.snapshot != null && !paperReady
      ? {
        label: "안전 게이트",
        title: "운용보다 확인이 우선입니다.",
        detail: "PAPER 운용 게이트가 닫혀 있습니다. 차단 원인을 먼저 확인하세요.",
        tone: "warning",
        action: "상태 확인",
        onPress: props.onGoSettings,
      }
      : ai?.status === "AVAILABLE"
        ? {
          label: "NUSA 판단",
          title: ai.thesis || "검토할 판단이 있습니다.",
          detail: "근거와 반대 근거를 확인한 뒤 사용자가 결정합니다.",
          tone: "normal",
          action: "Insight 보기",
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

  return <ScrollView
    style={{ backgroundColor: theme.colors.background }}
    contentContainerStyle={styles.content}
    refreshControl={<RefreshControl tintColor={theme.colors.primary} refreshing={props.refreshing} onRefresh={props.onRefresh} />}
    testID="home-screen"
  >
    <View style={styles.brandRow} testID="android-d-brand">
      <View style={styles.brandLockup}>
        <View style={[styles.brandOrb, { borderColor: theme.colors.neonBlue }]}><View style={[styles.brandOrbInner, { borderColor: theme.colors.neonPurple }]} /></View>
        <View><Text style={[styles.wordmark, { color: theme.colors.text }]}>NUSA</Text><Text style={[styles.brandSub, { color: theme.colors.textMuted }]}>AI SUPERVISORY OS</Text></View>
      </View>
      <View style={[styles.avatar, { backgroundColor: theme.colors.primarySoft, borderColor: theme.colors.border }]}><Text style={[styles.avatarText, { color: theme.colors.primary }]}>N</Text></View>
    </View>

    <View style={[styles.truthRail, { backgroundColor: "rgba(255,255,255,0.76)", borderColor: theme.colors.border }]} testID="android-system-truth-rail">
      <View style={styles.truthItem}><Dot /><View><Text style={[styles.truthTitle, { color: theme.colors.text }]}>AI ZERO AUTHORITY</Text><Text style={[styles.truthSub, { color: theme.colors.textMuted }]}>권한 없음</Text></View></View>
      <View style={[styles.truthDivider, { backgroundColor: theme.colors.border }]} />
      <View style={styles.truthItem}><Dot /><View><Text style={[styles.truthTitle, { color: theme.colors.text }]}>PAPER ONLY</Text><Text style={[styles.truthSub, { color: theme.colors.textMuted }]}>LIVE NONE</Text></View></View>
      <View style={[styles.truthDivider, { backgroundColor: theme.colors.border }]} />
      <View style={styles.truthItem}><Dot /><View><Text style={[styles.truthTitle, { color: theme.colors.text }]}>YOU ARE SUPERVISOR</Text><Text style={[styles.truthSub, { color: theme.colors.textMuted }]}>당신이 최종 결정자</Text></View></View>
      <View style={[styles.truthDivider, { backgroundColor: theme.colors.border }]} />
      <View style={styles.truthItem}><Dot tone={marketFresh ? "normal" : "warning"} /><View><Text style={[styles.truthTitle, { color: theme.colors.text }]}>MARKET DATA</Text><Text style={[styles.truthSub, { color: marketFresh ? theme.colors.success : theme.colors.warning }]}>{marketFresh ? "FRESH" : "CHECK"}</Text></View></View>
    </View>

    <View style={[styles.hero, stacked && styles.heroStacked, { backgroundColor: theme.colors.surfaceRaised, borderColor: theme.colors.border }]} testID="android-d-now">
      <View style={styles.heroCopy}>
        <View style={styles.stateRow}><Dot tone={state.tone} /><Text style={[styles.stateLabel, { color: stateColor }]}>NOW · {state.label}</Text></View>
        <Text style={[styles.heroTitle, { color: theme.colors.text }]}>{state.title}</Text>
        <Text style={[styles.heroDetail, { color: theme.colors.textMuted }]}>{state.detail}</Text>
        <Pressable accessibilityRole="button" onPress={state.onPress} style={({ pressed }) => [styles.heroAction, { backgroundColor: theme.colors.surface, borderColor: theme.colors.borderStrong, opacity: pressed ? theme.interaction.pressedOpacity : 1 }]}>
          <Text style={[styles.heroActionText, { color: theme.colors.text }]}>{state.action}</Text><Text style={[styles.heroArrow, { color: theme.colors.primary }]}>→</Text>
        </Pressable>
      </View>
      <Orb />
    </View>

    <Pressable accessibilityRole="button" onPress={() => props.onNavigate("Markets")} style={({ pressed }) => [styles.marketBar, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border, opacity: pressed ? theme.interaction.pressedOpacity : 1 }]} testID="android-d-market">
      <View style={[styles.marketIcon, { backgroundColor: theme.colors.primarySoft }]}><Text style={[styles.marketIconText, { color: theme.colors.primary }]}>M</Text></View>
      <View style={styles.marketMain}><Meta>ACTIVE MARKET</Meta><Text style={[styles.marketName, { color: theme.colors.text }]}>{marketLabel}</Text></View>
      <View style={styles.marketPriceBox}><Meta>LAST</Meta><Text style={[styles.marketPrice, { color: theme.colors.text }]}>{marketPrice}</Text></View>
      <View style={styles.marketStateBox}><Meta>DATA</Meta><Text style={[styles.marketState, { color: marketFresh ? theme.colors.success : theme.colors.warning }]}>{marketFresh ? "FRESH" : "CHECK"}</Text></View>
      <Text style={[styles.marketArrow, { color: theme.colors.textMuted }]}>→</Text>
    </Pressable>

    <View style={[styles.panel, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]} testID="android-d-capital">
      <View style={styles.panelHeader}><Text style={[styles.panelTitle, { color: theme.colors.text }]}>CAPITAL OVERVIEW</Text><Text style={[styles.panelHint, { color: theme.colors.textMuted }]}>PAPER</Text></View>
      <View style={[styles.capitalGrid, stacked && styles.capitalGridStacked]}>
        <Fact label="TOTAL ASSETS" value={account == null ? "—" : money(account.equity)} sub={totalPnl == null ? "PnL 대기" : `PnL ${signedMoney(totalPnl)}`} valueColor={theme.colors.text} />
        <View style={[styles.verticalDivider, { backgroundColor: theme.colors.border }]} />
        <Fact label="EXPOSURE" value={percent(exposure)} sub={positionOpen && account ? account.position.market : "NO POSITION"} />
        <View style={[styles.verticalDivider, { backgroundColor: theme.colors.border }]} />
        <Fact label="POSITIONS" value={positionOpen ? "1" : "0"} sub="현재 PAPER 기준" />
        <View style={[styles.verticalDivider, { backgroundColor: theme.colors.border }]} />
        <Fact label="CASH SHIELD" value={allocation == null || account == null || account.equity <= 0 ? "—" : percent(allocation.reservedCash / account.equity)} sub={allocation == null ? undefined : money(allocation.reservedCash)} />
      </View>
      {totalPnl != null ? <Text style={[styles.pnlText, { color: pnlColor }]}>PAPER PnL {signedMoney(totalPnl)}</Text> : null}
    </View>

    <Pressable accessibilityRole="button" onPress={() => props.onNavigate("AiSignal")} style={({ pressed }) => [styles.judgment, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border, opacity: pressed ? theme.interaction.pressedOpacity : 1 }]} testID="android-d-judgment">
      <View pointerEvents="none" style={styles.judgmentArt}><View style={[styles.judgmentWaveOne, { borderColor: theme.colors.neonPurple }]} /><View style={[styles.judgmentWaveTwo, { borderColor: theme.colors.neonBlue }]} /><View style={[styles.judgmentWaveThree, { borderColor: theme.colors.primary }]} /></View>
      <View style={styles.panelHeader}><Text style={[styles.panelTitle, { color: theme.colors.text }]}>NUSA JUDGMENT</Text><Text style={[styles.panelHint, { color: theme.colors.primary }]}>AI ANALYSIS →</Text></View>
      <Text style={[styles.judgmentText, { color: theme.colors.text }]}>{insight}</Text>
      <Text style={[styles.judgmentSub, { color: theme.colors.textMuted }]}>근거와 반대 근거를 함께 확인하고 최종 판단은 사용자가 내립니다.</Text>
      <View style={styles.judgmentStats}>
        <Fact label="EVIDENCE" value={`${evidence.length}`} sub="검증 근거" />
        <Fact label="COUNTER" value={`${counterEvidence.length}`} sub="반대 근거" />
        <Fact label="CALIBRATION" value={ai?.calibrationStatus ?? "—"} sub={calibratedConfidence == null ? "신뢰도 비공개" : `CONF ${percent(calibratedConfidence)}`} />
      </View>
    </Pressable>

    <View style={styles.sectionHeader}><View><Meta accent>EVIDENCE STREAM</Meta><Text style={[styles.sectionTitle, { color: theme.colors.text }]}>판단 근거 미리보기</Text></View><Pressable accessibilityRole="button" onPress={props.onOpenPaperLearning} style={({ pressed }) => [styles.inlineAction, { opacity: pressed ? theme.interaction.pressedOpacity : 1 }]}><Text style={[styles.inlineActionText, { color: theme.colors.primary }]}>전체 보기 →</Text></Pressable></View>

    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.evidenceRow} testID="android-d-evidence-stream">
      {evidence.length > 0 ? evidence.slice(0, 3).map((item, index) => <EvidenceCard key={`e-${index}`} title={`근거 ${index + 1}`} text={item} />) : <EvidenceCard title="핵심 근거" text="검증된 근거 참조가 아직 없습니다." />}
      {counterEvidence.length > 0 ? counterEvidence.slice(0, 2).map((item, index) => <EvidenceCard counter key={`c-${index}`} title={`반대 근거 ${index + 1}`} text={item} />) : <EvidenceCard counter title="반대 근거" text="등록된 반대 근거가 없습니다." />}
      <EvidenceCard title="판단 변경 조건" text="canonical AI projection에 전용 invalidation 필드가 없어 조건을 임의 생성하지 않습니다." />
    </ScrollView>

    <View style={styles.sectionHeader}><View><Meta accent>OWNER COMMAND</Meta><Text style={[styles.sectionTitle, { color: theme.colors.text }]}>사용자 감독</Text></View></View>
    <View style={[styles.ownerGrid, stacked && styles.ownerGridStacked]} testID="android-d-owner-command">
      <Pressable accessibilityRole="button" onPress={() => props.onNavigate("Markets")} style={({ pressed }) => [styles.ownerCard, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border, opacity: pressed ? theme.interaction.pressedOpacity : 1 }]}><Text style={[styles.ownerIcon, { color: theme.colors.primary }]}>◉</Text><View style={styles.ownerCopy}><Text style={[styles.ownerTitle, { color: theme.colors.text }]}>모니터링 유지</Text><Text style={[styles.ownerSub, { color: theme.colors.textMuted }]}>공개 시장 관찰</Text></View></Pressable>
      <Pressable accessibilityRole="button" onPress={() => props.onNavigate("AiSignal")} style={({ pressed }) => [styles.ownerCard, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border, opacity: pressed ? theme.interaction.pressedOpacity : 1 }]}><Text style={[styles.ownerIcon, { color: theme.colors.neonPurple }]}>◌</Text><View style={styles.ownerCopy}><Text style={[styles.ownerTitle, { color: theme.colors.text }]}>시나리오 분석</Text><Text style={[styles.ownerSub, { color: theme.colors.textMuted }]}>근거와 대안 검토</Text></View></Pressable>
      <Pressable accessibilityRole="button" onPress={() => props.onNavigate("Portfolio")} style={({ pressed }) => [styles.ownerCard, styles.ownerCardPrimary, { backgroundColor: theme.colors.aiSignalSoft, borderColor: theme.colors.neonPurple, opacity: pressed ? theme.interaction.pressedOpacity : 1 }]}><Text style={[styles.ownerIcon, { color: theme.colors.neonPurple }]}>◇</Text><View style={styles.ownerCopy}><Text style={[styles.ownerTitle, { color: theme.colors.text }]}>수동 감독</Text><Text style={[styles.ownerSub, { color: theme.colors.textMuted }]}>포지션 상태 확인</Text></View></Pressable>
    </View>

    <Text style={[styles.footer, { color: theme.colors.textMuted }]}>PAPER ONLY · LIVE NONE · AI ZERO AUTHORITY</Text>
  </ScrollView>;
}

const styles = StyleSheet.create({
  content: { width: "100%", maxWidth: 760, alignSelf: "center", paddingHorizontal: 18, paddingTop: 14, paddingBottom: 38, gap: 16 },
  meta: { fontSize: 9, lineHeight: 12, fontWeight: "700", letterSpacing: 0.8 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  brandRow: { minHeight: 62, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 16 },
  brandLockup: { flexDirection: "row", alignItems: "center", gap: 12 },
  brandOrb: { width: 46, height: 46, borderRadius: 23, borderWidth: 7, alignItems: "center", justifyContent: "center", transform: [{ rotate: "18deg" }] },
  brandOrbInner: { width: 24, height: 24, borderRadius: 12, borderWidth: 3, transform: [{ rotate: "-36deg" }] },
  wordmark: { fontSize: 27, lineHeight: 31, fontWeight: "700", letterSpacing: 5 },
  brandSub: { marginTop: 2, fontSize: 8, lineHeight: 11, fontWeight: "700", letterSpacing: 1.5 },
  avatar: { width: 48, height: 48, borderRadius: 24, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  avatarText: { fontSize: 17, lineHeight: 22, fontWeight: "700" },
  truthRail: { minHeight: 72, borderWidth: 1, borderRadius: 28, paddingHorizontal: 14, paddingVertical: 10, flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 10 },
  truthItem: { minHeight: 48, minWidth: 120, flex: 1, flexDirection: "row", alignItems: "center", gap: 9 },
  truthDivider: { width: StyleSheet.hairlineWidth, height: 34 },
  truthTitle: { fontSize: 9, lineHeight: 12, fontWeight: "700", letterSpacing: 0.2 },
  truthSub: { marginTop: 3, fontSize: 9, lineHeight: 12, fontWeight: "500" },
  hero: { minHeight: 340, borderWidth: 1, borderRadius: 38, paddingHorizontal: 24, paddingVertical: 26, flexDirection: "row", alignItems: "center", gap: 18, overflow: "hidden" },
  heroStacked: { flexDirection: "column", alignItems: "stretch", minHeight: 520 },
  heroCopy: { flex: 1.15, gap: 13, zIndex: 2 },
  stateRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  stateLabel: { fontSize: 10, lineHeight: 14, fontWeight: "800", letterSpacing: 1 },
  heroTitle: { fontSize: 38, lineHeight: 46, fontWeight: "400", letterSpacing: -1.3 },
  heroDetail: { maxWidth: 430, fontSize: 14, lineHeight: 22, fontWeight: "400" },
  heroAction: { alignSelf: "flex-start", minHeight: 48, borderWidth: 1, borderRadius: 24, paddingHorizontal: 18, flexDirection: "row", alignItems: "center", gap: 18 },
  heroActionText: { fontSize: 11, lineHeight: 15, fontWeight: "700" },
  heroArrow: { fontSize: 18, lineHeight: 20, fontWeight: "400" },
  orbWrap: { flex: 0.9, minHeight: 250, alignItems: "center", justifyContent: "center" },
  orbShadow: { position: "absolute", width: 210, height: 86, borderRadius: 50, bottom: 10, opacity: 0.8, transform: [{ scaleX: 1.18 }] },
  orbOuter: { width: 218, height: 218, borderRadius: 109, borderWidth: 1, alignItems: "center", justifyContent: "center", shadowColor: "#98A7FF", shadowOpacity: 0.18, shadowRadius: 24, shadowOffset: { width: 0, height: 12 }, elevation: 5 },
  orbArcOne: { position: "absolute", width: 174, height: 206, borderRadius: 102, borderWidth: 2, transform: [{ rotate: "34deg" }], opacity: 0.42 },
  orbArcTwo: { position: "absolute", width: 194, height: 154, borderRadius: 98, borderWidth: 2, transform: [{ rotate: "-24deg" }], opacity: 0.35 },
  orbInner: { width: 118, height: 118, borderRadius: 59, borderWidth: 1, alignItems: "center", justifyContent: "center", opacity: 0.84 },
  orbWord: { fontSize: 10, lineHeight: 14, fontWeight: "700", letterSpacing: 5 },
  marketBar: { minHeight: 88, borderWidth: 1, borderRadius: 26, paddingHorizontal: 16, paddingVertical: 12, flexDirection: "row", alignItems: "center", gap: 12, shadowColor: "#101828", shadowOpacity: 0.06, shadowRadius: 14, shadowOffset: { width: 0, height: 5 }, elevation: 2 },
  marketIcon: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  marketIconText: { fontSize: 15, fontWeight: "800" },
  marketMain: { flex: 1.2, gap: 3 },
  marketName: { fontSize: 15, lineHeight: 19, fontWeight: "700" },
  marketPriceBox: { flex: 1.2, gap: 3 },
  marketPrice: { fontSize: 14, lineHeight: 18, fontWeight: "600", fontVariant: ["tabular-nums"] },
  marketStateBox: { flex: 0.8, gap: 3 },
  marketState: { fontSize: 10, lineHeight: 14, fontWeight: "800" },
  marketArrow: { fontSize: 18, lineHeight: 21 },
  panel: { borderWidth: 1, borderRadius: 28, padding: 20, gap: 16, shadowColor: "#101828", shadowOpacity: 0.05, shadowRadius: 15, shadowOffset: { width: 0, height: 6 }, elevation: 2 },
  panelHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  panelTitle: { fontSize: 13, lineHeight: 18, fontWeight: "800", letterSpacing: 0.45 },
  panelHint: { fontSize: 9, lineHeight: 12, fontWeight: "700" },
  capitalGrid: { minHeight: 106, flexDirection: "row", alignItems: "stretch" },
  capitalGridStacked: { flexWrap: "wrap", rowGap: 14 },
  fact: { flex: 1, minWidth: 108, justifyContent: "center", gap: 5, paddingHorizontal: 8 },
  factValue: { fontSize: 20, lineHeight: 25, fontWeight: "600", fontVariant: ["tabular-nums"] },
  factSub: { fontSize: 9, lineHeight: 13, fontWeight: "500" },
  verticalDivider: { width: StyleSheet.hairlineWidth, minHeight: 74, alignSelf: "center" },
  pnlText: { fontSize: 10, lineHeight: 14, fontWeight: "700", fontVariant: ["tabular-nums"] },
  judgment: { minHeight: 260, borderWidth: 1, borderRadius: 30, padding: 20, gap: 14, overflow: "hidden", shadowColor: "#6157D9", shadowOpacity: 0.07, shadowRadius: 20, shadowOffset: { width: 0, height: 7 }, elevation: 2 },
  judgmentArt: { ...StyleSheet.absoluteFill, alignItems: "flex-end", justifyContent: "center", opacity: 0.22 },
  judgmentWaveOne: { position: "absolute", width: 420, height: 180, borderRadius: 210, borderWidth: 1, right: -145, bottom: -42, transform: [{ rotate: "-10deg" }] },
  judgmentWaveTwo: { position: "absolute", width: 360, height: 150, borderRadius: 190, borderWidth: 1, right: -102, bottom: 2, transform: [{ rotate: "8deg" }], opacity: 0.22 },
  judgmentWaveThree: { position: "absolute", width: 300, height: 120, borderRadius: 160, borderWidth: 1, right: -78, bottom: 40, transform: [{ rotate: "-17deg" }] },
  judgmentText: { maxWidth: 560, fontSize: 22, lineHeight: 31, fontWeight: "600", letterSpacing: -0.4, zIndex: 1 },
  judgmentSub: { maxWidth: 520, fontSize: 11, lineHeight: 18, zIndex: 1 },
  judgmentStats: { flexDirection: "row", flexWrap: "wrap", gap: 8, zIndex: 1 },
  sectionHeader: { minHeight: 48, flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", gap: 12 },
  sectionTitle: { marginTop: 3, fontSize: 17, lineHeight: 22, fontWeight: "700", letterSpacing: -0.25 },
  inlineAction: { minHeight: 48, justifyContent: "center", paddingLeft: 12 },
  inlineActionText: { fontSize: 10, lineHeight: 14, fontWeight: "700" },
  evidenceRow: { gap: 10, paddingRight: 18 },
  evidenceCard: { width: 184, minHeight: 142, borderWidth: 1, borderRadius: 22, padding: 14, gap: 8 },
  evidenceIcon: { width: 34, height: 34, borderRadius: 17, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  evidenceCore: { width: 8, height: 8, borderRadius: 4 },
  evidenceTitle: { fontSize: 11, lineHeight: 15, fontWeight: "700" },
  evidenceText: { fontSize: 10, lineHeight: 16 },
  ownerGrid: { flexDirection: "row", gap: 10 },
  ownerGridStacked: { flexDirection: "column" },
  ownerCard: { flex: 1, minHeight: 88, borderWidth: 1, borderRadius: 22, paddingHorizontal: 14, paddingVertical: 12, flexDirection: "row", alignItems: "center", gap: 11 },
  ownerCardPrimary: { shadowColor: "#6157D9", shadowOpacity: 0.10, shadowRadius: 14, shadowOffset: { width: 0, height: 5 }, elevation: 2 },
  ownerIcon: { width: 34, textAlign: "center", fontSize: 25, lineHeight: 29 },
  ownerCopy: { flex: 1, gap: 4 },
  ownerTitle: { fontSize: 12, lineHeight: 17, fontWeight: "700" },
  ownerSub: { fontSize: 9, lineHeight: 13 },
  footer: { textAlign: "center", fontSize: 8, lineHeight: 12, fontWeight: "700", letterSpacing: 1 },
});