import React, { useCallback, useEffect, useMemo, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { AuthContext, useAuth, type AuthStatus } from "./src/authContext";
import { AuthorityBanner, DataRow, NusaButton, NusaCard, NusaTextField, SectionHeading, StatusChip, WaveMark } from "./src/components";
import { ThemeProvider, useTheme, type ThemePreference } from "./src/ThemeProvider";
import { PortfolioView } from "./src/portfolioView";
import { TradingView } from "./src/tradingView";
import { MarketsView } from "./src/marketsView";
import { AiView } from "./src/aiView";
import { NotificationView } from "./src/notificationView";
import { SettingsView } from "./src/settingsView";
import { OrderHistoryView } from "./src/orderHistoryView";
import { WatchlistRepository } from "./src/watchlist";
import { DEFAULT_SETTINGS, type ThemeSetting } from "./src/settings";
import { VersionedSettingsRepository } from "./src/persistenceRepositories";
import { InMemoryDashboardCredentialSession } from "./src/dashboardCredentialSession";
import { loadPersonalPaperOperations, type PersonalPaperOperationsLoadResult } from "./src/personalPaperOperationsClient";

const BASE_URL = process.env.EXPO_PUBLIC_NUSA_MONITOR_URL ?? "http://127.0.0.1:41731";
const AUTH_MODE = process.env.EXPO_PUBLIC_NUSA_AUTH_MODE ?? "foundation";
const tabs = ["Home", "Markets", "Trade", "Portfolio", "More"] as const;
type Tab = (typeof tabs)[number];
type UtilityView = "HISTORY" | "NOTIFICATIONS" | "SETTINGS" | null;
const tabLabels: Readonly<Record<Tab, string>> = { Home: "홈", Markets: "시장", Trade: "PAPER", Portfolio: "자산", More: "AI" };
const tabGlyphs: Readonly<Record<Tab, string>> = { Home: "⌁", Markets: "◫", Trade: "⇄", Portfolio: "◒", More: "✦" };
const utilityLabels: Readonly<Record<Exclude<UtilityView, null>, string>> = { HISTORY: "주문 이력", NOTIFICATIONS: "알림", SETTINGS: "설정" };
const theme = { container: { flex: 1 } } as const;
const CHART_MARKET = "KRW-BTC";
const settingsRepository = new VersionedSettingsRepository(AsyncStorage);

function krw(value: number): string {
  return `₩${Math.round(value).toLocaleString("ko-KR")}`;
}

function healthTone(health: string | undefined): "success" | "warning" | "danger" {
  return health === "HEALTHY" || health === "READY" ? "success" : health === "FAIL_CLOSED" || health === "DOWN" ? "danger" : "warning";
}

function themePreference(value: ThemeSetting): ThemePreference {
  return value === "SYSTEM" ? "system" : value === "LIGHT" ? "light" : "dark";
}

function PersistedThemeBridge({ children }: Readonly<{ children: React.ReactNode }>) {
  const { setMode } = useTheme();
  useEffect(() => {
    let active = true;
    void settingsRepository.load().then((stored) => { if (active) setMode(themePreference((stored ?? DEFAULT_SETTINGS).theme)); }).catch(() => { if (active) setMode("system"); });
    return () => { active = false; };
  }, [setMode]);
  return <>{children}</>;
}

function DashboardConnectionRequired({ reason, onGoHome }: Readonly<{ reason: string; onGoHome: () => void }>) {
  const { theme: appTheme } = useTheme();
  return <View style={styles.connectionState} testID="dashboard-connection-required"><NusaCard raised>
    <View style={styles.cardHeader}><View><Text style={[styles.cardEyebrow, { color: appTheme.colors.warning }]}>READ-ONLY CONNECTION</Text><Text style={[styles.cardTitle, { color: appTheme.colors.text }]}>대시보드 연결 필요</Text></View><StatusChip label="연결 안 됨" tone="warning" /></View>
    <Text style={[styles.notice, { color: appTheme.colors.textMuted }]}>{reason}</Text>
    <Text style={[styles.meta, { color: appTheme.colors.textMuted }]}>이 화면의 데이터는 인증된 읽기 전용 PAPER 스냅샷이 필요합니다. 홈에서 대시보드를 연결해 주세요.</Text>
    <NusaButton label="홈에서 연결" onPress={onGoHome} testID="dashboard-connection-go-home" />
  </NusaCard></View>;
}

export default function App() {
  return <ThemeProvider initialMode="system"><PersistedThemeBridge><AuthContextProvider><AuthenticatedApp /></AuthContextProvider></PersistedThemeBridge></ThemeProvider>;
}

function AuthContextProvider({ children }: Readonly<{ children: React.ReactNode }>) {
  const [status, setStatus] = useState<AuthStatus>("CHECKING");
  const value = useMemo(() => ({ status, signIn: () => setStatus("SIGNED_IN"), signOut: () => setStatus("SIGNED_OUT") }), [status]);
  useEffect(() => { const timer = setTimeout(() => setStatus("SIGNED_OUT"), 250); return () => clearTimeout(timer); }, []);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

function AuthenticatedApp() {
  const { status: authStatus, signIn, signOut } = useAuth();
  const { theme: appTheme } = useTheme();
  const [activeTab, setActiveTab] = useState<Tab>("Home");
  const [utilityView, setUtilityView] = useState<UtilityView>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [dashboardTokenDraft, setDashboardTokenDraft] = useState("");
  const [operations, setOperations] = useState<PersonalPaperOperationsLoadResult>({ status: "NOT_CONFIGURED", reason: "Secure dashboard credential is not configured." });
  const [refreshing, setRefreshing] = useState(false);
  const credentialSession = useMemo(() => new InMemoryDashboardCredentialSession(), []);
  const watchlistRepository = useMemo(() => new WatchlistRepository(AsyncStorage), []);

  const refresh = useCallback(async () => {
    setOperations(await loadPersonalPaperOperations({ baseUrl: BASE_URL, credentialProvider: credentialSession.credentialProvider }));
  }, [credentialSession]);

  const connectReadOnly = useCallback(async () => {
    try {
      credentialSession.connect(dashboardTokenDraft);
      setDashboardTokenDraft("");
      await refresh();
    } catch (error) {
      credentialSession.clear();
      setOperations({ status: "NOT_CONFIGURED", reason: error instanceof Error ? error.message : "Dashboard credential is invalid." });
    }
  }, [credentialSession, dashboardTokenDraft, refresh]);

  const disconnectReadOnly = useCallback(() => {
    credentialSession.clear();
    setDashboardTokenDraft("");
    setOperations({ status: "NOT_CONFIGURED", reason: "Secure dashboard credential is not configured." });
  }, [credentialSession]);

  const closeUtility = useCallback(() => setUtilityView(null), []);
  const goHome = useCallback(() => { setUtilityView(null); setActiveTab("Home"); }, []);
  const handleSignOut = useCallback(() => {
    credentialSession.clear();
    setDashboardTokenDraft("");
    setOperations({ status: "NOT_CONFIGURED", reason: "Secure dashboard credential is not configured." });
    setUtilityView(null);
    setActiveTab("Home");
    setEmail("");
    setPassword("");
    signOut();
  }, [credentialSession, signOut]);

  useEffect(() => {
    if (authStatus !== "SIGNED_IN") return;
    void refresh();
    const timer = setInterval(() => void refresh(), 5000);
    return () => clearInterval(timer);
  }, [authStatus, refresh]);
  const onRefresh = useCallback(async () => { setRefreshing(true); await refresh(); setRefreshing(false); }, [refresh]);

  if (authStatus === "CHECKING") return <SafeAreaView style={[styles.container, { backgroundColor: appTheme.colors.background }]}><View style={styles.authContent}><WaveMark /><Text style={[styles.brand, { color: appTheme.colors.text }]}>NUSA</Text><Text style={[styles.authHeading, { color: appTheme.colors.text }]}>보안 상태 확인 중</Text></View></SafeAreaView>;

  if (authStatus !== "SIGNED_IN") {
    return <SafeAreaView style={[styles.container, { backgroundColor: appTheme.colors.background }]}><View style={styles.authContent}>
      <View style={styles.authBrand}><WaveMark /><View><Text style={[styles.brand, { color: appTheme.colors.text }]}>NUSA</Text><Text style={[styles.eyebrow, { color: appTheme.colors.primary }]}>PERSONAL INTELLIGENCE</Text></View></View>
      <Text style={[styles.authHeading, { color: appTheme.colors.text }]}>다시 오신 것을 환영합니다</Text>
      <Text style={[styles.subtitle, { color: appTheme.colors.textMuted }]}>로컬 인증은 개인 화면 진입용이며, 서버 대시보드 자격 증명과 분리됩니다.</Text>
      <NusaTextField accessibilityLabel="Email" label="이메일" onChangeText={setEmail} placeholder="Email" testID="auth-email" value={email} />
      <NusaTextField accessibilityLabel="Password" label="비밀번호" onChangeText={setPassword} placeholder="Password" secureTextEntry testID="auth-password" />
      <NusaButton accessibilityLabel="Sign in" label="로그인" onPress={signIn} testID="auth-submit" />
      <Text style={[styles.meta, { color: appTheme.colors.textMuted }]}>인증 모드: {AUTH_MODE} · 서버 읽기 자격 증명은 로그인 정보에서 추론하거나 저장하지 않습니다.</Text>
    </View></SafeAreaView>;
  }

  const snapshot = operations.status === "READY" ? operations.snapshot : null;
  const readOnlyError = operations.status === "UNAVAILABLE" ? operations.reason : null;
  const notConfigured = operations.status === "NOT_CONFIGURED" ? operations.reason : null;
  const marketConnectionState = snapshot?.operations.transport === "ONLINE" ? "CONNECTED" : "UNKNOWN";
  const stale = snapshot == null || snapshot.health !== "HEALTHY";
  const selectedMarket = snapshot?.markets.find((market) => market.market === CHART_MARKET) ?? null;
  const account = snapshot?.portfolio?.account ?? null;
  const totalPnl = account == null ? null : (account.realizedPnl ?? account.position.realizedPnl) + account.unrealizedPnl;
  const ai = snapshot?.ai ?? null;
  const aiRawProbability = ai?.rawProbability == null || !Number.isFinite(ai.rawProbability) ? "-" : `${Math.round(ai.rawProbability * 100)}%`;
  const aiTrustedConfidence = ai?.calibrationStatus === "CALIBRATED" ? `${Math.round(ai.confidence * 100)}%` : "-";
  const runtimeTone = healthTone(snapshot?.operations.runtimeState);
  const aiInsightAvailable = ai?.status === "AVAILABLE" && Boolean(ai.thesis?.trim()) && ai.evidenceReferences.length > 0;
  const nextAction: Readonly<{ title: string; detail: string; label: string; tab: Tab }> | null = snapshot == null ? null
    : snapshot.health !== "HEALTHY" || snapshot.dashboard.killSwitchActive || !snapshot.readyForPaperOperations
      ? { title: "안전 상태 우선", detail: "차단·저하 또는 PAPER 운영 대기 상태에서는 실행보다 PAPER 관찰 상태를 먼저 확인합니다.", label: "PAPER 상태 보기", tab: "Trade" }
      : aiInsightAvailable
        ? { title: "최신 AI 분석 확인", detail: "검증된 최신 AI 분석과 근거를 읽기 전용으로 확인합니다.", label: "AI 분석 보기", tab: "More" }
        : { title: "시장 관찰 계속", detail: "AI 분석이 없을 때는 공개 시장 데이터부터 확인합니다.", label: "시장 보기", tab: "Markets" };
  const requiresDashboardConnection = notConfigured !== null && (utilityView === "HISTORY" || (utilityView === null && activeTab !== "Home"));

  return <SafeAreaView style={[styles.container, { backgroundColor: appTheme.colors.background }]}>
    <View style={[styles.header, { borderBottomColor: appTheme.colors.border }]}>
      <View style={styles.headerBrand}><WaveMark compact /><View><Text style={[styles.brand, { color: appTheme.colors.text }]}>NUSA</Text><Text style={[styles.eyebrow, { color: appTheme.colors.primary }]}>INTELLIGENCE</Text></View></View>
      <View style={styles.headerTools}>
        <Pressable accessibilityLabel="주문 이력" accessibilityRole="button" accessibilityState={{ selected: utilityView === "HISTORY" }} onPress={() => setUtilityView((current) => current === "HISTORY" ? null : "HISTORY")} style={[styles.utilityButton, { borderColor: utilityView === "HISTORY" ? appTheme.colors.primary : appTheme.colors.border, backgroundColor: utilityView === "HISTORY" ? appTheme.colors.primarySoft : appTheme.colors.surfaceSunken }]} testID="header-order-history"><Text style={[styles.utilityText, { color: utilityView === "HISTORY" ? appTheme.colors.primary : appTheme.colors.textMuted }]}>이력</Text></Pressable>
        <Pressable accessibilityLabel="알림" accessibilityRole="button" accessibilityState={{ selected: utilityView === "NOTIFICATIONS" }} onPress={() => setUtilityView((current) => current === "NOTIFICATIONS" ? null : "NOTIFICATIONS")} style={[styles.utilityButton, { borderColor: utilityView === "NOTIFICATIONS" ? appTheme.colors.primary : appTheme.colors.border, backgroundColor: utilityView === "NOTIFICATIONS" ? appTheme.colors.primarySoft : appTheme.colors.surfaceSunken }]} testID="header-notifications"><Text style={[styles.utilityText, { color: utilityView === "NOTIFICATIONS" ? appTheme.colors.primary : appTheme.colors.textMuted }]}>알림</Text></Pressable>
        <Pressable accessibilityLabel="설정" accessibilityRole="button" accessibilityState={{ selected: utilityView === "SETTINGS" }} onPress={() => setUtilityView((current) => current === "SETTINGS" ? null : "SETTINGS")} style={[styles.utilityButton, { borderColor: utilityView === "SETTINGS" ? appTheme.colors.primary : appTheme.colors.border, backgroundColor: utilityView === "SETTINGS" ? appTheme.colors.primarySoft : appTheme.colors.surfaceSunken }]} testID="header-settings"><Text style={[styles.utilityText, { color: utilityView === "SETTINGS" ? appTheme.colors.primary : appTheme.colors.textMuted }]}>설정</Text></Pressable>
      </View>
    </View>
    <View style={[styles.authorityStrip, { borderBottomColor: appTheme.colors.border }]}><StatusChip label="PAPER" tone="primary" /><StatusChip label="READ ONLY" tone="info" /><Text style={[styles.authorityCopy, { color: appTheme.colors.textMuted }]}>실행 권한 없음</Text></View>
    {utilityView ? <View style={[styles.utilityNavigation, { borderBottomColor: appTheme.colors.border }]} testID="utility-navigation"><Text style={[styles.utilityTitle, { color: appTheme.colors.text }]}>{utilityLabels[utilityView]}</Text><Pressable accessibilityLabel={`${utilityLabels[utilityView]} 닫기`} accessibilityRole="button" onPress={closeUtility} style={[styles.utilityClose, { borderColor: appTheme.colors.border, backgroundColor: appTheme.colors.surfaceSunken }]} testID="utility-close"><Text style={[styles.utilityText, { color: appTheme.colors.textMuted }]}>닫기</Text></Pressable></View> : null}
    {requiresDashboardConnection ? <DashboardConnectionRequired reason={notConfigured ?? "대시보드 연결이 필요합니다."} onGoHome={goHome} />
      : utilityView === "HISTORY" ? <OrderHistoryView error={readOnlyError} onRefresh={onRefresh} rawOrders={snapshot?.orders ?? null} refreshing={refreshing} />
      : utilityView === "NOTIFICATIONS" ? <NotificationView repository={settingsRepository} />
      : utilityView === "SETTINGS" ? <SettingsView onSignOut={handleSignOut} repository={settingsRepository} />
      : activeTab === "Portfolio" ? <PortfolioView error={readOnlyError} onRefresh={onRefresh} refreshing={refreshing} snapshot={snapshot?.portfolio ?? null} />
      : activeTab === "Trade" ? <TradingView error={readOnlyError} marketConnectionState={marketConnectionState} onRefresh={onRefresh} refreshing={refreshing} snapshot={snapshot?.portfolio ?? null} stale={stale} />
      : activeTab === "Markets" ? <MarketsView error={readOnlyError} currentPrice={selectedMarket?.price ?? null} market={CHART_MARKET} marketConnectionState={marketConnectionState} onRefresh={onRefresh} rawCandles={null} rawMarkets={snapshot == null ? null : [...snapshot.markets]} refreshing={refreshing} repository={watchlistRepository} stale={stale} />
      : activeTab === "More" ? <AiView ai={ai} error={readOnlyError} health={snapshot?.health ?? null} killSwitchActive={snapshot?.dashboard.killSwitchActive ?? null} liveAuthority={snapshot?.liveAuthority ?? null} onRefresh={onRefresh} productionMutationAllowed={snapshot?.productionMutationAllowed ?? null} refreshing={refreshing} research={snapshot?.research ?? null} />
      : <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl tintColor={appTheme.colors.primary} refreshing={refreshing} onRefresh={onRefresh} />} testID="home-screen">
        <SectionHeading eyebrow="PERSONAL PAPER" title="오늘의 운영 상태" description="실제 PAPER 런타임과 읽기 전용 스냅샷만 표시합니다." />
        {readOnlyError ? <View style={[styles.error, { backgroundColor: appTheme.colors.surfaceSunken, borderColor: appTheme.colors.danger }]}><Text style={[styles.errorTitle, { color: appTheme.colors.danger }]}>대시보드 연결 오류</Text><Text style={[styles.meta, { color: appTheme.colors.textMuted }]}>{readOnlyError}</Text></View> : null}
        {notConfigured ? <NusaCard testID="dashboard-session-card" raised>
          <View style={styles.cardHeader}><View><Text style={[styles.cardEyebrow, { color: appTheme.colors.primary }]}>READ-ONLY SESSION</Text><Text style={[styles.cardTitle, { color: appTheme.colors.text }]}>대시보드 연결</Text></View><StatusChip label="메모리 전용" tone="info" /></View>
          <Text style={[styles.notice, { color: appTheme.colors.textMuted }]}>{notConfigured}</Text>
          <NusaTextField accessibilityLabel="Dashboard credential" label="대시보드 자격 증명" onChangeText={setDashboardTokenDraft} placeholder="로컬 대시보드 토큰 입력" secureTextEntry testID="dashboard-credential" value={dashboardTokenDraft} />
          <NusaButton accessibilityLabel="Connect read only" label="읽기 전용으로 연결" onPress={() => { void connectReadOnly(); }} testID="dashboard-connect" />
          <Text style={[styles.meta, { color: appTheme.colors.textMuted }]}>자격 증명은 프로세스 메모리에만 유지되며 연결 해제 또는 앱 재시작 시 사라집니다.</Text>
        </NusaCard> : null}
        {snapshot ? <>
          <NusaCard testID="account-hero-card" raised>
            <View style={styles.heroTop}><View><Text style={[styles.cardEyebrow, { color: appTheme.colors.textMuted }]}>PAPER EQUITY</Text><Text style={[styles.heroValue, { color: appTheme.colors.text }]}>{account ? krw(account.equity) : "포트폴리오 없음"}</Text></View><StatusChip label={snapshot.operations.runtimeState} tone={runtimeTone} /></View>
            {totalPnl != null ? <Text style={[styles.heroPnl, { color: totalPnl >= 0 ? appTheme.colors.success : appTheme.colors.danger }]}>{totalPnl >= 0 ? "+" : ""}{krw(totalPnl)} 누적 손익</Text> : <Text style={[styles.meta, { color: appTheme.colors.textMuted }]}>계좌 평가 정보가 아직 없습니다.</Text>}
          </NusaCard>
          {nextAction ? <NusaCard testID="home-next-action">
            <View style={styles.cardHeader}><View><Text style={[styles.cardEyebrow, { color: appTheme.colors.primary }]}>NEXT</Text><Text style={[styles.cardTitle, { color: appTheme.colors.text }]}>{nextAction.title}</Text></View><StatusChip label={nextAction.tab === "Trade" ? "우선 확인" : "다음 단계"} tone={nextAction.tab === "Trade" ? "warning" : "primary"} /></View>
            <Text style={[styles.notice, { color: appTheme.colors.textMuted }]}>{nextAction.detail}</Text>
            <NusaButton accessibilityLabel={nextAction.label} label={nextAction.label} onPress={() => { setUtilityView(null); setActiveTab(nextAction.tab); }} testID="home-next-action-button" />
          </NusaCard> : null}
          <AuthorityBanner />
          <NusaCard testID="ai-card">
            <View style={styles.cardHeader}><View><Text style={[styles.cardEyebrow, { color: appTheme.colors.info }]}>AI READ-ONLY</Text><Text style={[styles.cardTitle, { color: appTheme.colors.text }]}>AI 인텔리전스</Text></View><StatusChip label={ai?.status ?? "UNAVAILABLE"} tone={ai?.status === "AVAILABLE" ? "success" : ai?.status === "INCOMPLETE" ? "warning" : "neutral"} /></View>
            <Text style={[styles.aiThesis, { color: ai?.thesis ? appTheme.colors.text : appTheme.colors.textMuted }]}>{ai?.thesis ?? "현재 표시할 AI 분석이 없습니다."}</Text>
            <DataRow label="원시 모델 확률 (미보정)" value={aiRawProbability} />
            <DataRow label="검증 신뢰도" value={aiTrustedConfidence} />
            <DataRow label="불확실성" value={ai?.uncertainty ?? "-"} />
            <DataRow label="보정 상태" value={ai?.calibrationStatus ?? "UNKNOWN"} />
          </NusaCard>
          <NusaCard testID="safety-card"><View style={styles.cardHeader}><Text style={[styles.cardTitle, { color: appTheme.colors.text }]}>안전 및 운영 상태</Text><StatusChip label={snapshot.health} tone={healthTone(snapshot.health)} /></View><DataRow label="PAPER 런타임" value={snapshot.operations.runtimeState} tone={runtimeTone} /><DataRow label="시장 연결" value={snapshot.operations.transport === "ONLINE" ? "온라인" : "오프라인"} tone={snapshot.operations.transport === "ONLINE" ? "success" : "warning"} /><DataRow label="PAPER 운영 준비" value={snapshot.readyForPaperOperations ? "준비됨" : "대기/차단"} tone={snapshot.readyForPaperOperations ? "success" : "warning"} /><DataRow label="킬 스위치" value={snapshot.dashboard.killSwitchActive ? "활성" : "비활성"} tone={snapshot.dashboard.killSwitchActive ? "danger" : "success"} /><DataRow label="LIVE 권한" value={snapshot.liveAuthority} emphasis /><DataRow label="Production mutation" value={snapshot.productionMutationAllowed ? "허용" : "금지"} tone={snapshot.productionMutationAllowed ? "danger" : "success"} /></NusaCard>
          <NusaButton accessibilityLabel="Disconnect read only" label="읽기 전용 연결 해제" onPress={disconnectReadOnly} tone="neutral" testID="dashboard-disconnect" />
        </> : null}
      </ScrollView>}
    <View style={[styles.navigation, { backgroundColor: appTheme.colors.surfaceSunken, borderTopColor: appTheme.colors.border }]}>{tabs.map((tab) => {
      const active = utilityView === null && activeTab === tab;
      return <Pressable key={tab} accessibilityLabel={tabLabels[tab]} accessibilityRole="button" accessibilityState={{ selected: active }} onPress={() => { setUtilityView(null); setActiveTab(tab); }} style={styles.navItem}><View style={[styles.navGlyphWrap, active && { backgroundColor: appTheme.colors.primarySoft }]}><Text style={[styles.navGlyph, { color: active ? appTheme.colors.primary : appTheme.colors.textMuted }]}>{tabGlyphs[tab]}</Text></View><Text style={[styles.navLabel, { color: active ? appTheme.colors.text : appTheme.colors.textMuted }, active && styles.navLabelActive]}>{tabLabels[tab]}</Text></Pressable>;
    })}</View>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  container: theme.container,
  authContent: { flex: 1, justifyContent: "center", padding: 24, gap: 16 },
  authBrand: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 8 },
  header: { minHeight: 64, paddingHorizontal: 20, paddingVertical: 10, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomWidth: 1 },
  headerBrand: { flexDirection: "row", alignItems: "center", gap: 10 },
  headerTools: { flexDirection: "row", gap: 8, alignItems: "center" },
  utilityButton: { minWidth: 48, minHeight: 44, paddingHorizontal: 10, borderRadius: 12, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  utilityText: { fontSize: 12, fontWeight: "700" },
  utilityNavigation: { minHeight: 48, paddingHorizontal: 20, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomWidth: 1 },
  utilityTitle: { fontSize: 14, fontWeight: "700" },
  utilityClose: { minWidth: 48, minHeight: 44, paddingHorizontal: 10, borderRadius: 12, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  authorityStrip: { minHeight: 38, paddingHorizontal: 20, flexDirection: "row", gap: 7, alignItems: "center", borderBottomWidth: 1 },
  authorityCopy: { fontSize: 11, fontWeight: "600", marginLeft: 2 },
  brand: { fontSize: 23, fontWeight: "800", letterSpacing: 1.6 },
  eyebrow: { fontSize: 9, fontWeight: "800", letterSpacing: 1.7, marginTop: -1 },
  content: { paddingHorizontal: 20, paddingTop: 18, gap: 14, paddingBottom: 32 },
  connectionState: { flex: 1, justifyContent: "center", padding: 20 },
  authHeading: { fontSize: 29, fontWeight: "700", letterSpacing: -0.8 },
  subtitle: { fontSize: 14, lineHeight: 21 },
  meta: { fontSize: 12, lineHeight: 18 },
  notice: { fontSize: 13, lineHeight: 20 },
  error: { borderWidth: 1, padding: 14, borderRadius: 14, gap: 6 },
  errorTitle: { fontSize: 14, fontWeight: "700" },
  cardHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 10 },
  cardEyebrow: { fontSize: 10, fontWeight: "800", letterSpacing: 1.2, marginBottom: 4 },
  cardTitle: { fontSize: 18, fontWeight: "700", letterSpacing: -0.4 },
  heroTop: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 },
  heroValue: { fontSize: 34, fontWeight: "800", letterSpacing: -1.4, marginTop: 5, fontVariant: ["tabular-nums"] },
  heroPnl: { marginTop: 7, fontSize: 15, fontWeight: "700", fontVariant: ["tabular-nums"] },
  divider: { height: 1, marginVertical: 14 },
  aiThesis: { fontSize: 16, fontWeight: "600", lineHeight: 24, marginBottom: 10 },
  navigation: { flexDirection: "row", borderTopWidth: 1, paddingTop: 7, paddingBottom: 7 },
  navItem: { flex: 1, minHeight: 54, alignItems: "center", justifyContent: "center", gap: 3 },
  navGlyphWrap: { minWidth: 32, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center", paddingHorizontal: 7 },
  navGlyph: { fontSize: 15, fontWeight: "700" },
  navLabel: { fontSize: 10, fontWeight: "600" },
  navLabelActive: { fontWeight: "800" },
});