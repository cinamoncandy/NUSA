import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppState, Pressable, StyleSheet, Text, View, type AppStateStatus } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { AuthContext, useAuth, type AuthStatus } from "./src/authContext";
import { NusaButton, NusaCard, StatusChip, WaveMark } from "./src/components";
import { ThemeProvider, useTheme, type ThemePreference } from "./src/ThemeProvider";
import { HomeView, type HomeDestination } from "./src/homeView";
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
import { clearPaperConnectionVerification, getConfiguredPaperEndpoint, isPaperConnectionVerified, setConfiguredPaperEndpoint } from "./src/paperConnectionSession";
import { loadPersonalPaperOperations, type PersonalPaperOperationsLoadResult } from "./src/personalPaperOperationsClient";

const tabs = ["Home", "Markets", "Trade", "Portfolio", "More"] as const;
type Tab = (typeof tabs)[number];
type UtilityView = "HISTORY" | "NOTIFICATIONS" | "SETTINGS" | null;
const tabLabels: Readonly<Record<Tab, string>> = { Home: "홈", Markets: "시장", Trade: "PAPER", Portfolio: "자산", More: "AI" };
const utilityLabels: Readonly<Record<Exclude<UtilityView, null>, string>> = { HISTORY: "주문 이력", NOTIFICATIONS: "알림", SETTINGS: "설정" };
const CHART_MARKET = "KRW-BTC";
const PAPER_REFRESH_INTERVAL_MS = 5000;
const settingsRepository = new VersionedSettingsRepository(AsyncStorage);
const theme = { container: { flex: 1 } } as const;

function themePreference(value: ThemeSetting): ThemePreference { return value === "SYSTEM" ? "system" : value === "LIGHT" ? "light" : "dark"; }

function PersistedThemeBridge({ children }: Readonly<{ children: React.ReactNode }>) {
  const { setMode } = useTheme();
  useEffect(() => {
    let active = true;
    void settingsRepository.load().then((stored) => {
      if (!active) return;
      const settings = stored ?? DEFAULT_SETTINGS;
      setConfiguredPaperEndpoint(settings.paperEndpoint);
      setMode(themePreference(settings.theme));
    }).catch(() => { if (active) { setConfiguredPaperEndpoint(""); setMode("system"); } });
    return () => { active = false; };
  }, [setMode]);
  return <>{children}</>;
}

function DashboardConnectionRequired({ reason, onGoSettings }: Readonly<{ reason: string; onGoSettings: () => void }>) {
  const { theme: appTheme } = useTheme();
  return <View style={styles.connectionState} testID="dashboard-connection-required"><View style={styles.connectionStateInner}><NusaCard raised>
    <View style={styles.cardHeader}><View><Text style={[styles.cardEyebrow, { color: appTheme.colors.warning }]}>PAPER CONNECTION</Text><Text style={[styles.cardTitle, { color: appTheme.colors.text }]}>PAPER 서버 연결 필요</Text></View><StatusChip label="연결 안 됨" tone="warning" /></View>
    <Text style={[styles.body, { color: appTheme.colors.textMuted }]}>{reason}</Text>
    <Text style={[styles.meta, { color: appTheme.colors.textMuted }]}>Settings에서 Cloud endpoint와 메모리 전용 세션 토큰을 검증한 뒤 PAPER 데이터와 주문 기능을 사용할 수 있습니다.</Text>
    <NusaButton label="설정에서 연결" onPress={onGoSettings} testID="dashboard-connection-go-settings" />
  </NusaCard></View></View>;
}

export default function App() {
  return <SafeAreaProvider><ThemeProvider initialMode="system"><PersistedThemeBridge><AuthContextProvider><AuthenticatedApp /></AuthContextProvider></PersistedThemeBridge></ThemeProvider></SafeAreaProvider>;
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
  const [utilityMenuOpen, setUtilityMenuOpen] = useState(false);
  const [operations, setOperations] = useState<PersonalPaperOperationsLoadResult>({ status: "NOT_CONFIGURED", reason: "PAPER connection is not configured." });
  const [refreshing, setRefreshing] = useState(false);
  const [appState, setAppState] = useState<AppStateStatus>(AppState.currentState);
  const credentialSession = useMemo(() => new InMemoryDashboardCredentialSession(), []);
  const watchlistRepository = useMemo(() => new WatchlistRepository(AsyncStorage), []);
  const refreshInFlightRef = useRef<Promise<void> | null>(null);
  const refreshGenerationRef = useRef(0);

  const refresh = useCallback((): Promise<void> => {
    if (refreshInFlightRef.current) return refreshInFlightRef.current;
    const generation = refreshGenerationRef.current;
    const endpoint = getConfiguredPaperEndpoint();
    if (endpoint == null || !isPaperConnectionVerified(endpoint)) {
      setOperations({ status: "NOT_CONFIGURED", reason: "PAPER endpoint must be verified in Settings before dashboard credentials can be used." });
      return Promise.resolve();
    }
    const request = (async () => {
      const result = await loadPersonalPaperOperations({ baseUrl: endpoint, credentialProvider: credentialSession.credentialProvider });
      if (generation !== refreshGenerationRef.current) return;
      const currentEndpoint = getConfiguredPaperEndpoint();
      if (currentEndpoint !== endpoint || !isPaperConnectionVerified(endpoint)) return;
      setOperations(result);
    })();
    refreshInFlightRef.current = request;
    const clearIfCurrent = () => { if (refreshInFlightRef.current === request) refreshInFlightRef.current = null; };
    void request.then(clearIfCurrent, clearIfCurrent);
    return request;
  }, [credentialSession]);

  const closeUtility = useCallback(() => setUtilityView(null), []);
  const goSettings = useCallback(() => { setUtilityMenuOpen(false); setUtilityView("SETTINGS"); }, []);
  const navigateHome = useCallback((destination: HomeDestination) => { setUtilityMenuOpen(false); setUtilityView(null); setActiveTab(destination); }, []);
  const handleSignOut = useCallback(() => {
    refreshGenerationRef.current += 1;
    credentialSession.clear();
    clearPaperConnectionVerification();
    setRefreshing(false);
    setOperations({ status: "NOT_CONFIGURED", reason: "PAPER connection is not configured." });
    setUtilityMenuOpen(false); setUtilityView(null); setActiveTab("Home"); signOut();
  }, [credentialSession, signOut]);

  useEffect(() => { const subscription = AppState.addEventListener("change", setAppState); return () => subscription.remove(); }, []);
  useEffect(() => {
    refreshGenerationRef.current += 1;
    if (authStatus !== "SIGNED_IN" || appState !== "active") return;
    const generation = refreshGenerationRef.current;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const scheduleNext = () => {
      if (cancelled || generation !== refreshGenerationRef.current) return;
      timer = setTimeout(() => { timer = null; void refresh().catch(() => undefined).finally(scheduleNext); }, PAPER_REFRESH_INTERVAL_MS);
    };
    void refresh().catch(() => undefined).finally(scheduleNext);
    return () => { cancelled = true; refreshGenerationRef.current += 1; if (timer !== null) clearTimeout(timer); };
  }, [appState, authStatus, refresh]);

  const onRefresh = useCallback(async () => { setRefreshing(true); try { await refresh(); } finally { setRefreshing(false); } }, [refresh]);

  if (authStatus === "CHECKING") return <SafeAreaView style={[styles.container, { backgroundColor: appTheme.colors.background }]}><View style={styles.authContent}><WaveMark /><Text style={[styles.brand, { color: appTheme.colors.text }]}>NUSA</Text><Text style={[styles.authHeading, { color: appTheme.colors.text }]}>로컬 상태 확인 중</Text></View></SafeAreaView>;
  if (authStatus !== "SIGNED_IN") return <SafeAreaView style={[styles.container, { backgroundColor: appTheme.colors.background }]}><View style={styles.authContent}><View style={styles.authPanel}><View style={styles.authBrand}><WaveMark /><View><Text style={[styles.brand, { color: appTheme.colors.text }]}>NUSA</Text><Text style={[styles.eyebrow, { color: appTheme.colors.primary }]}>PERSONAL INTELLIGENCE</Text></View></View><Text style={[styles.authHeading, { color: appTheme.colors.text }]}>개인 PAPER 모드</Text><Text style={[styles.subtitle, { color: appTheme.colors.textMuted }]}>개인 기기에서 PAPER 작업공간으로 진입합니다. 서버 자격 증명은 Settings에서 별도로 검증합니다.</Text><View style={styles.entryBadges}><StatusChip label="LOCAL ENTRY" tone="neutral" /><StatusChip label="PAPER ONLY" tone="primary" /><StatusChip label="LIVE NONE" tone="info" /></View><NusaButton accessibilityLabel="Start personal mode" label="개인 모드 시작" onPress={signIn} testID="local-entry-submit" /><Text style={[styles.meta, { color: appTheme.colors.textMuted }]}>이 진입 단계는 사용자 신원을 검증하지 않으며 비밀번호를 수집하거나 저장하지 않습니다.</Text></View></View></SafeAreaView>;

  const snapshot = operations.status === "READY" ? operations.snapshot : null;
  const readOnlyError = operations.status === "UNAVAILABLE" ? operations.reason : null;
  const notConfigured = operations.status === "NOT_CONFIGURED" ? operations.reason : null;
  const marketConnectionState = snapshot?.operations.transport === "ONLINE" ? "CONNECTED" : "UNKNOWN";
  const stale = snapshot == null || snapshot.health !== "HEALTHY";
  const selectedMarket = snapshot?.markets.find((market) => market.market === CHART_MARKET) ?? null;
  const ai = snapshot?.ai ?? null;
  const requiresDashboardConnection = notConfigured !== null && (utilityView === "HISTORY" || (utilityView === null && activeTab !== "Home"));

  return <SafeAreaView style={[styles.container, { backgroundColor: appTheme.colors.background }]}>
    <View style={[styles.header, { borderBottomColor: appTheme.colors.border }]}><View style={styles.headerInner}><View style={styles.headerBrand}><WaveMark compact /><View><Text style={[styles.brand, { color: appTheme.colors.text }]}>NUSA</Text><Text style={[styles.eyebrow, { color: appTheme.colors.primary }]}>PERSONAL PAPER</Text></View></View><Pressable accessibilityLabel="도구" accessibilityRole="button" accessibilityState={{ expanded: utilityMenuOpen, selected: utilityMenuOpen || utilityView !== null }} onPress={() => { if (utilityView !== null) { setUtilityView(null); setUtilityMenuOpen(true); return; } setUtilityMenuOpen((current) => !current); }} style={[styles.utilityButton, { borderColor: utilityMenuOpen || utilityView !== null ? appTheme.colors.primary : appTheme.colors.border, backgroundColor: utilityMenuOpen || utilityView !== null ? appTheme.colors.primarySoft : appTheme.colors.surfaceSunken }]} testID="header-tools-menu"><Text style={[styles.utilityText, { color: utilityMenuOpen || utilityView !== null ? appTheme.colors.primary : appTheme.colors.textMuted }]}>도구</Text></Pressable></View></View>
    <View style={[styles.authorityStrip, { borderBottomColor: appTheme.colors.border }]}><View style={styles.authorityStripInner}><StatusChip label="PAPER ONLY" tone="primary" /><StatusChip label="LIVE NONE" tone="info" /><Text style={[styles.authorityCopy, { color: appTheme.colors.textMuted }]}>실제 자금 실행 없음</Text></View></View>
    {utilityMenuOpen ? <View style={[styles.utilityMenu, { backgroundColor: appTheme.colors.surface, borderBottomColor: appTheme.colors.border }]} testID="header-tools-tray"><View style={styles.utilityMenuInner}>{(["HISTORY", "NOTIFICATIONS", "SETTINGS"] as const).map((view) => <Pressable key={view} accessibilityLabel={utilityLabels[view]} accessibilityRole="button" onPress={() => { setUtilityMenuOpen(false); setUtilityView(view); }} style={[styles.utilityMenuButton, { borderColor: appTheme.colors.border, backgroundColor: appTheme.colors.surfaceSunken }]} testID={view === "HISTORY" ? "header-order-history" : view === "NOTIFICATIONS" ? "header-notifications" : "header-settings"}><Text style={[styles.utilityText, { color: appTheme.colors.text }]}>{view === "HISTORY" ? "이력" : view === "NOTIFICATIONS" ? "알림" : "설정"}</Text></Pressable>)}</View></View> : null}
    {utilityView ? <View style={[styles.utilityNavigation, { borderBottomColor: appTheme.colors.border }]} testID="utility-navigation"><View style={styles.utilityNavigationInner}><Text style={[styles.utilityTitle, { color: appTheme.colors.text }]}>{utilityLabels[utilityView]}</Text><Pressable accessibilityLabel={`${utilityLabels[utilityView]} 닫기`} accessibilityRole="button" onPress={closeUtility} style={[styles.utilityClose, { borderColor: appTheme.colors.border, backgroundColor: appTheme.colors.surfaceSunken }]} testID="utility-close"><Text style={[styles.utilityText, { color: appTheme.colors.textMuted }]}>닫기</Text></Pressable></View></View> : null}

    {requiresDashboardConnection ? <DashboardConnectionRequired reason={notConfigured ?? "PAPER 서버 연결이 필요합니다."} onGoSettings={goSettings} />
      : utilityView === "HISTORY" ? <OrderHistoryView error={readOnlyError} onRefresh={onRefresh} rawOrders={snapshot?.orders ?? null} refreshing={refreshing} />
      : utilityView === "NOTIFICATIONS" ? <NotificationView repository={settingsRepository} />
      : utilityView === "SETTINGS" ? <SettingsView onSignOut={handleSignOut} repository={settingsRepository} />
      : activeTab === "Portfolio" ? <PortfolioView error={readOnlyError} onRefresh={onRefresh} refreshing={refreshing} snapshot={snapshot?.portfolio ?? null} />
      : activeTab === "Trade" ? <TradingView error={readOnlyError} marketConnectionState={marketConnectionState} onRefresh={onRefresh} refreshing={refreshing} snapshot={snapshot?.portfolio ?? null} stale={stale} />
      : activeTab === "Markets" ? <MarketsView error={readOnlyError} currentPrice={selectedMarket?.price ?? null} market={CHART_MARKET} marketConnectionState={marketConnectionState} onRefresh={onRefresh} rawCandles={null} rawMarkets={snapshot == null ? null : [...snapshot.markets]} refreshing={refreshing} repository={watchlistRepository} stale={stale} />
      : activeTab === "More" ? <AiView ai={ai} error={readOnlyError} health={snapshot?.health ?? null} killSwitchActive={snapshot?.dashboard.killSwitchActive ?? null} liveAuthority={snapshot?.liveAuthority ?? null} onRefresh={onRefresh} productionMutationAllowed={snapshot?.productionMutationAllowed ?? null} refreshing={refreshing} research={snapshot?.research ?? null} />
      : <HomeView snapshot={snapshot} readOnlyError={readOnlyError} notConfigured={notConfigured} refreshing={refreshing} onRefresh={onRefresh} onGoSettings={goSettings} onNavigate={navigateHome} />}

    <View style={[styles.navigation, { backgroundColor: appTheme.colors.surfaceSunken, borderTopColor: appTheme.colors.border }]}><View accessibilityRole="tablist" style={styles.navigationInner}>{tabs.map((tab) => { const active = utilityView === null && activeTab === tab; return <Pressable key={tab} accessibilityLabel={tabLabels[tab]} accessibilityRole="tab" accessibilityState={{ selected: active }} onPress={() => { setUtilityMenuOpen(false); setUtilityView(null); setActiveTab(tab); }} style={[styles.navItem, active && { backgroundColor: appTheme.colors.primarySoft }]} testID={`tab-${tab}`}><View style={[styles.navIndicator, { backgroundColor: active ? appTheme.colors.primary : "transparent" }]} /><Text style={[styles.navLabel, { color: active ? appTheme.colors.text : appTheme.colors.textMuted }, active && styles.navLabelActive]}>{tabLabels[tab]}</Text></Pressable>; })}</View></View>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  container: theme.container,
  authContent: { flex: 1, justifyContent: "center", padding: 24, alignItems: "center" }, authPanel: { width: "100%", maxWidth: 640, gap: 16 }, authBrand: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 8 }, authHeading: { fontSize: 29, fontWeight: "700", letterSpacing: -0.8 }, subtitle: { fontSize: 14, lineHeight: 21 }, entryBadges: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  header: { minHeight: 64, borderBottomWidth: 1, alignItems: "center" }, headerInner: { width: "100%", maxWidth: 1180, paddingHorizontal: 20, paddingVertical: 10, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, headerBrand: { flexDirection: "row", alignItems: "center", gap: 10 }, brand: { fontSize: 23, fontWeight: "800", letterSpacing: 1.6 }, eyebrow: { fontSize: 9, fontWeight: "800", letterSpacing: 1.7, marginTop: -1 },
  utilityButton: { minWidth: 48, minHeight: 48, paddingHorizontal: 12, borderRadius: 14, borderWidth: 1, alignItems: "center", justifyContent: "center" }, utilityText: { fontSize: 12, fontWeight: "700" }, utilityMenu: { minHeight: 52, borderBottomWidth: 1, alignItems: "center" }, utilityMenuInner: { width: "100%", maxWidth: 1180, paddingHorizontal: 20, paddingVertical: 6, flexDirection: "row", gap: 8, alignItems: "center" }, utilityMenuButton: { flex: 1, minHeight: 48, paddingHorizontal: 10, borderRadius: 12, borderWidth: 1, alignItems: "center", justifyContent: "center" }, utilityNavigation: { minHeight: 48, borderBottomWidth: 1, alignItems: "center" }, utilityNavigationInner: { width: "100%", maxWidth: 1180, paddingHorizontal: 20, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, utilityTitle: { fontSize: 14, fontWeight: "700" }, utilityClose: { minWidth: 48, minHeight: 48, paddingHorizontal: 10, borderRadius: 12, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  authorityStrip: { minHeight: 38, borderBottomWidth: 1, alignItems: "center" }, authorityStripInner: { width: "100%", maxWidth: 1180, paddingHorizontal: 20, minHeight: 38, flexDirection: "row", flexWrap: "wrap", gap: 7, alignItems: "center" }, authorityCopy: { fontSize: 11, fontWeight: "600", marginLeft: 2 },
  connectionState: { flex: 1, justifyContent: "center", padding: 20, alignItems: "center" }, connectionStateInner: { width: "100%", maxWidth: 720 }, cardHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 10 }, cardEyebrow: { fontSize: 10, fontWeight: "800", letterSpacing: 1.2, marginBottom: 4 }, cardTitle: { fontSize: 18, fontWeight: "700", letterSpacing: -0.4 }, body: { fontSize: 13, lineHeight: 20 }, meta: { fontSize: 12, lineHeight: 18 },
  navigation: { borderTopWidth: 1, alignItems: "center" }, navigationInner: { width: "100%", maxWidth: 1180, flexDirection: "row", paddingTop: 7, paddingBottom: 7, paddingHorizontal: 4 }, navItem: { flex: 1, minHeight: 54, alignItems: "center", justifyContent: "center", gap: 6, borderRadius: 12, marginHorizontal: 2 }, navIndicator: { width: 22, height: 3, borderRadius: 2 }, navLabel: { fontSize: 10, fontWeight: "600" }, navLabelActive: { fontWeight: "800" },
});