import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppState, Pressable, StyleSheet, Text, TextInput, View, type AppStateStatus } from "react-native";
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
import { DEFAULT_SETTINGS, normalizeSettings, type ThemeSetting } from "./src/settings";
import { VersionedSettingsRepository } from "./src/persistenceRepositories";
import { InMemoryDashboardCredentialSession } from "./src/dashboardCredentialSession";
import { createCloudInvestmentAllocationClient } from "./src/cloudInvestmentAllocationClient";
import { clearPaperConnectionVerification, getConfiguredPaperEndpoint, isPaperConnectionVerified, setConfiguredPaperEndpoint } from "./src/paperConnectionSession";
import { loadPersonalPaperOperations, type PersonalPaperOperationsLoadResult } from "./src/personalPaperOperationsClient";
import { MobileRuntimeCoordinator, initialMobileRuntimeSnapshot, type MobileRuntimeEvent, type MobileRuntimeSnapshot } from "./src/mobileRuntime";
import { resetUpbitReadOnlyState, useUpbitReadOnlyState } from "./src/upbitReadOnlyAccount";
import { loadUpbitPublicCandles, loadUpbitPublicMarkets } from "./src/upbitPublicQuotationClient";
import { UpbitPublicWebSocketClient } from "./src/upbitPublicWebSocketClient";
import type { PublicCandle } from "./src/chartViewModel";
import type { WatchlistMarket } from "./src/watchlist";
import { nativeKeystoreStorage } from "./src/nativeSecureStorage";
import { MobileSessionClient } from "./src/mobileSessionClient";

const tabs = ["Home", "AiSignal", "Markets", "Paper", "Order", "Portfolio"] as const;
type Tab = (typeof tabs)[number];
type UtilityView = "NOTIFICATIONS" | "SETTINGS" | null;
const tabLabels: Readonly<Record<Tab, string>> = { Home: "HOME", AiSignal: "AI SIGNAL", Markets: "MARKETS", Paper: "PAPER", Order: "ORDER", Portfolio: "PORTFOLIO" };
const utilityLabels: Readonly<Record<Exclude<UtilityView, null>, string>> = { NOTIFICATIONS: "알림", SETTINGS: "설정" };
const CHART_MARKET = "KRW-BTC";
const PAPER_REFRESH_INTERVAL_MS = 5000;
const PUBLIC_REFRESH_INTERVAL_MS = 30_000;
const settingsRepository = new VersionedSettingsRepository(AsyncStorage);
const theme = { container: { flex: 1 } } as const;

type PublicMarketsStatus = "LOADING" | "READY" | "STALE" | "ERROR";
interface PublicMarketsState {
  readonly status: PublicMarketsStatus;
  readonly markets: readonly WatchlistMarket[] | null;
  readonly candles: readonly PublicCandle[] | null;
  readonly currentPrice: number | null;
  readonly error: string | null;
  readonly chartError: string | null;
}

const initialPublicMarketsState = (): PublicMarketsState => ({ status: "LOADING", markets: null, candles: null, currentPrice: null, error: null, chartError: null });

function themePreference(value: ThemeSetting): ThemePreference { return value === "SYSTEM" ? "system" : value === "LIGHT" ? "light" : "dark"; }

function PersistedThemeBridge({ children }: Readonly<{ children: React.ReactNode }>) {
  const { setMode } = useTheme();
  useEffect(() => {
    let active = true;
    void settingsRepository.load().then((stored) => {
      if (!active) return;
      const settings = normalizeSettings(stored ?? DEFAULT_SETTINGS);
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
    <NusaButton label="설정에서 연결" onPress={onGoSettings} testID="dashboard-open-settings" />
  </NusaCard></View></View>;
}

export default function App() { return <SafeAreaProvider><ThemeProvider initialMode="system"><PersistedThemeBridge><AuthContextProvider><AuthenticatedApp /></AuthContextProvider></PersistedThemeBridge></ThemeProvider></SafeAreaProvider>; }

function AuthContextProvider({ children }: Readonly<{ children: React.ReactNode }>) {
  const [status, setStatus] = useState<AuthStatus>("CHECKING");
  const client = useMemo(() => new MobileSessionClient({ secureStorage: nativeKeystoreStorage, baseUrl: process.env.EXPO_PUBLIC_NUSA_API_BASE_URL ?? "https://nusa-api.duckdns.org", production: !__DEV__ }), []);
  const signIn = useCallback(async (bootstrapToken: string) => { setStatus("AUTHENTICATING"); try { await client.bootstrap(bootstrapToken); setStatus("ACTIVE"); } catch (error) { setStatus(client.state); throw error; } }, [client]);
  const signOut = useCallback(async () => { await client.logout(); setStatus("SIGNED_OUT"); }, [client]);
  useEffect(() => { let cancelled = false; void client.restore().then((identity) => { if (!cancelled) setStatus(identity == null ? "SIGNED_OUT" : "ACTIVE"); }).catch(() => { if (!cancelled) setStatus("SIGNED_OUT"); }); return () => { cancelled = true; }; }, [client]);
  const value = useMemo(() => ({ status, signIn, signOut }), [signIn, signOut, status]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

function AuthenticatedApp() {
  const { status: authStatus, signIn, signOut } = useAuth();
  const [bootstrapToken, setBootstrapToken] = useState("");
  const { theme: appTheme } = useTheme();
  const upbitState = useUpbitReadOnlyState();
  const [activeTab, setActiveTab] = useState<Tab>("Home");
  const [utilityView, setUtilityView] = useState<UtilityView>(null);
  const [utilityMenuOpen, setUtilityMenuOpen] = useState(false);
  const [operations, setOperations] = useState<PersonalPaperOperationsLoadResult>({ status: "NOT_CONFIGURED", reason: "PAPER connection is not configured." });
  const [refreshing, setRefreshing] = useState(false);
  const [appState, setAppState] = useState<AppStateStatus>(AppState.currentState);
  const [runtimeSnapshot, setRuntimeSnapshot] = useState<MobileRuntimeSnapshot>(() => initialMobileRuntimeSnapshot());
  const [publicMarkets, setPublicMarkets] = useState<PublicMarketsState>(() => initialPublicMarketsState());
  const [publicRefreshing, setPublicRefreshing] = useState(false);
  const [investmentPercent, setInvestmentPercent] = useState(DEFAULT_SETTINGS.capitalAllocation.investmentPercent);
  const credentialSession = useMemo(() => new InMemoryDashboardCredentialSession(), []);
  const investmentAllocationClient = useMemo(() => createCloudInvestmentAllocationClient({ credentialProvider: credentialSession.credentialProvider }), [credentialSession]);
  const watchlistRepository = useMemo(() => new WatchlistRepository(AsyncStorage), []);
  const refreshInFlightRef = useRef<Promise<void> | null>(null);
  const refreshGenerationRef = useRef(0);
  const publicRefreshInFlightRef = useRef<Promise<void> | null>(null);
  const publicRefreshGenerationRef = useRef(0);
  const publicMarketsRef = useRef<PublicMarketsState>(initialPublicMarketsState());
  const liveMarketsKeyRef = useRef<string>("");
  const runtimeCoordinator = useMemo(() => new MobileRuntimeCoordinator({ load: () => undefined, save: setRuntimeSnapshot }), []);
  const dispatchRuntime = useCallback((event: MobileRuntimeEvent): void => {
    try {
      runtimeCoordinator.dispatch(event);
    } catch {
      try { runtimeCoordinator.dispatch({ type: "RECOVERY_FAILED", reason: "mobile runtime state transition failed" }); } catch { /* remain blocked by the last known state */ }
    }
  }, [runtimeCoordinator]);

  useEffect(() => {
    let active = true;
    void settingsRepository.load().then((stored) => { if (active) setInvestmentPercent(normalizeSettings(stored ?? DEFAULT_SETTINGS).capitalAllocation.investmentPercent); }).catch(() => { if (active) setInvestmentPercent(DEFAULT_SETTINGS.capitalAllocation.investmentPercent); });
    return () => { active = false; };
  }, []);

  const refresh = useCallback((): Promise<void> => {
    if (refreshInFlightRef.current) return refreshInFlightRef.current;
    const generation = refreshGenerationRef.current;
    const endpoint = getConfiguredPaperEndpoint();
    if (endpoint == null || !isPaperConnectionVerified(endpoint)) {
      setOperations({ status: "NOT_CONFIGURED", reason: "PAPER endpoint must be verified in Settings before dashboard credentials can be used." });
      return Promise.resolve();
    }
    dispatchRuntime({ type: "RECOVERY_STARTED" });
    const request = (async () => {
      let result: PersonalPaperOperationsLoadResult;
      try {
        result = await loadPersonalPaperOperations({ baseUrl: endpoint, credentialProvider: credentialSession.credentialProvider });
      } catch (error) {
        dispatchRuntime({ type: "NETWORK_OFFLINE" });
        throw error;
      }
      if (generation !== refreshGenerationRef.current) return;
      const currentEndpoint = getConfiguredPaperEndpoint();
      if (currentEndpoint !== endpoint || !isPaperConnectionVerified(endpoint)) return;
      setOperations(result);
      if (result.status === "READY") {
        const nextVersion = runtimeCoordinator.current().lastPersistedVersion + 1;
        dispatchRuntime({ type: "RECOVERY_MATCHED", version: nextVersion });
      } else {
        dispatchRuntime({ type: "RECOVERY_FAILED", reason: result.reason || "PAPER recovery is unavailable" });
      }
    })();
    refreshInFlightRef.current = request;
    const clearIfCurrent = () => { if (refreshInFlightRef.current === request) refreshInFlightRef.current = null; };
    void request.then(clearIfCurrent, clearIfCurrent);
    return request;
  }, [credentialSession, dispatchRuntime, runtimeCoordinator]);

  const refreshPublicMarkets = useCallback((): Promise<void> => {
    if (publicRefreshInFlightRef.current) return publicRefreshInFlightRef.current;
    const generation = publicRefreshGenerationRef.current;
    const previous = publicMarketsRef.current;
    setPublicRefreshing(true);
    setPublicMarkets({ ...previous, status: previous.markets === null ? "LOADING" : "STALE", error: null });
    const request = (async () => {
      const [tickerResult, candleResult] = await Promise.allSettled([
        loadUpbitPublicMarkets(),
        loadUpbitPublicCandles({ market: CHART_MARKET }),
      ]);
      if (generation !== publicRefreshGenerationRef.current) return;
      const tickerError = tickerResult.status === "rejected" ? (tickerResult.reason instanceof Error ? tickerResult.reason.message : "Public ticker data is unavailable.") : null;
      if (tickerResult.status === "rejected") {
        const next = previous.markets === null
          ? { ...previous, status: "ERROR" as const, error: tickerError, chartError: null }
          : { ...previous, status: "STALE" as const, error: null, chartError: null };
        publicMarketsRef.current = next;
        setPublicMarkets(next);
        return;
      }
      const markets = tickerResult.value;
      const selected = markets.find((market) => market.market === CHART_MARKET) ?? null;
      const chartError = candleResult.status === "rejected" ? (candleResult.reason instanceof Error ? candleResult.reason.message : "Public candle data is unavailable.") : null;
      const next: PublicMarketsState = {
        status: "READY",
        markets,
        candles: candleResult.status === "fulfilled" ? candleResult.value : null,
        currentPrice: selected?.price ?? null,
        error: null,
        chartError,
      };
      publicMarketsRef.current = next;
      setPublicMarkets(next);
    })();
    publicRefreshInFlightRef.current = request;
    const clearIfCurrent = () => { if (publicRefreshInFlightRef.current === request) publicRefreshInFlightRef.current = null; setPublicRefreshing(false); };
    void request.then(clearIfCurrent, clearIfCurrent);
    return request;
  }, []);

  // Real-time layer on top of the 30s REST poll above: a live Upbit ticker only ever updates an
  // entry already established by that REST baseline (never invents a market on its own), so a
  // socket outage silently degrades back to polling-only instead of losing or fabricating data.
  const handleLiveTicker = useCallback((ticker: WatchlistMarket): void => {
    const previous = publicMarketsRef.current;
    if (previous.markets === null) return;
    const index = previous.markets.findIndex((market) => market.market === ticker.market);
    if (index === -1) return;
    const markets = previous.markets.map((market, position) => (position === index ? ticker : market));
    const next: PublicMarketsState = { ...previous, status: "READY", markets: Object.freeze(markets), currentPrice: ticker.market === CHART_MARKET ? ticker.price : previous.currentPrice };
    publicMarketsRef.current = next;
    setPublicMarkets(next);
  }, []);
  const liveTickerClient = useMemo(() => new UpbitPublicWebSocketClient(handleLiveTicker), [handleLiveTicker]);

  const closeUtility = useCallback(() => setUtilityView(null), []);
  const goSettings = useCallback(() => { setUtilityMenuOpen(false); setUtilityView("SETTINGS"); }, []);
  const navigateHome = useCallback((destination: HomeDestination) => { setUtilityMenuOpen(false); setUtilityView(null); setActiveTab(destination); }, []);
  const handleSignOut = useCallback(() => {
    refreshGenerationRef.current += 1; publicRefreshGenerationRef.current += 1; credentialSession.clear(); clearPaperConnectionVerification(); resetUpbitReadOnlyState(); setRefreshing(false); setPublicRefreshing(false);
    const initialPublicState = initialPublicMarketsState(); publicMarketsRef.current = initialPublicState; setPublicMarkets(initialPublicState); liveMarketsKeyRef.current = "";
    setOperations({ status: "NOT_CONFIGURED", reason: "PAPER connection is not configured." }); setUtilityMenuOpen(false); setUtilityView(null); setActiveTab("Home"); signOut();
  }, [credentialSession, signOut]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      setAppState(nextState);
      dispatchRuntime({ type: nextState === "active" ? "APP_FOREGROUND" : "APP_BACKGROUND" });
      if (nextState === "active" && runtimeCoordinator.current().recovery === "READY") dispatchRuntime({ type: "RECOVERY_STARTED" });
    });
    return () => subscription.remove();
  }, [dispatchRuntime, runtimeCoordinator]);
  useEffect(() => {
    refreshGenerationRef.current += 1;
    if (authStatus !== "ACTIVE" || appState !== "active") return;
    const generation = refreshGenerationRef.current;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const scheduleNext = () => { if (cancelled || generation !== refreshGenerationRef.current) return; timer = setTimeout(() => { timer = null; void refresh().catch(() => undefined).finally(scheduleNext); }, PAPER_REFRESH_INTERVAL_MS); };
    void refresh().catch(() => undefined).finally(scheduleNext);
    return () => { cancelled = true; refreshGenerationRef.current += 1; if (timer !== null) clearTimeout(timer); };
  }, [appState, authStatus, refresh]);

  useEffect(() => {
    publicRefreshGenerationRef.current += 1;
    if (authStatus !== "ACTIVE" || appState !== "active") return;
    const generation = publicRefreshGenerationRef.current;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const scheduleNext = () => { if (cancelled || generation !== publicRefreshGenerationRef.current) return; timer = setTimeout(() => { timer = null; void refreshPublicMarkets().catch(() => undefined).finally(scheduleNext); }, PUBLIC_REFRESH_INTERVAL_MS); };
    void refreshPublicMarkets().catch(() => undefined).finally(scheduleNext);
    return () => { cancelled = true; publicRefreshGenerationRef.current += 1; if (timer !== null) clearTimeout(timer); };
  }, [appState, authStatus, refreshPublicMarkets]);

  useEffect(() => {
    if (authStatus !== "ACTIVE" || appState !== "active") { liveTickerClient.disconnect(); return; }
    void liveTickerClient.connect();
    return () => liveTickerClient.disconnect();
  }, [appState, authStatus, liveTickerClient]);
  useEffect(() => {
    if (publicMarkets.markets === null) return;
    const codes = publicMarkets.markets.map((market) => market.market).sort();
    const key = codes.join(",");
    if (key === liveMarketsKeyRef.current) return;
    liveMarketsKeyRef.current = key;
    liveTickerClient.setMarkets(codes);
  }, [publicMarkets.markets, liveTickerClient]);

  const onRefresh = useCallback(async () => { setRefreshing(true); try { await refresh(); } finally { setRefreshing(false); } }, [refresh]);

  if (authStatus === "CHECKING") return <SafeAreaView style={[styles.container, { backgroundColor: appTheme.colors.background }]}><View style={styles.authContent}><WaveMark /><Text style={[styles.brand, { color: appTheme.colors.text }]}>NUSA</Text><Text style={[styles.authHeading, { color: appTheme.colors.text }]}>로컬 상태 확인 중</Text></View></SafeAreaView>;
  if (authStatus !== "ACTIVE") return <SafeAreaView style={[styles.container, { backgroundColor: appTheme.colors.background }]}><View style={styles.authContent}><View style={styles.authPanel}><View style={styles.authBrand}><WaveMark /><View><Text style={[styles.brand, { color: appTheme.colors.text }]}>NUSA</Text><Text style={[styles.eyebrow, { color: appTheme.colors.primary }]}>SECURE NUSA SESSION</Text></View></View><Text style={[styles.authHeading, { color: appTheme.colors.text }]}>{authStatus === "AUTHENTICATING" ? "서버 인증 중" : "NUSA 인증 필요"}</Text><Text style={[styles.subtitle, { color: appTheme.colors.textMuted }]}>OWNER가 발급한 일회용 bootstrap token으로 NUSA 세션을 시작합니다. 토큰은 저장하지 않으며 서버가 승인한 세션만 활성화됩니다.</Text><View style={styles.entryBadges}><StatusChip label={authStatus} tone="neutral" /><StatusChip label="PAPER ONLY" tone="primary" /><StatusChip label="LIVE NONE" tone="info" /></View><TextInput accessibilityLabel="Bootstrap token" autoCapitalize="none" autoCorrect={false} onChangeText={setBootstrapToken} placeholder="일회용 bootstrap token" placeholderTextColor={appTheme.colors.textMuted} secureTextEntry style={[styles.bootstrapInput, { borderColor: appTheme.colors.border, color: appTheme.colors.text }]} value={bootstrapToken} /><NusaButton accessibilityLabel="Authenticate with NUSA" label="NUSA에 연결" onPress={() => { void signIn(bootstrapToken).then(() => setBootstrapToken("")).catch(() => undefined); }} testID="nusa-auth-submit" /><Text style={[styles.meta, { color: appTheme.colors.textMuted }]}>Firebase 외부 provisioning이 연결되기 전까지는 서버 발급 bootstrap token 경로만 사용합니다. 인증 실패 시 PAPER 데이터와 작업은 차단됩니다.</Text></View></View></SafeAreaView>;

  const snapshot = operations.status === "READY" ? operations.snapshot : null;
  const readOnlyError = operations.status === "UNAVAILABLE" ? operations.reason : null;
  const notConfigured = operations.status === "NOT_CONFIGURED" ? operations.reason : null;
  const marketConnectionState = snapshot?.operations.transport === "ONLINE" ? "CONNECTED" : "UNKNOWN";
  const publicMarketConnectionState = publicMarkets.status === "READY" || publicMarkets.status === "STALE" ? "CONNECTED" : "UNKNOWN";
  const stale = snapshot == null || snapshot.health !== "HEALTHY";
  const ai = snapshot?.ai ?? null;
  const accountCash = snapshot?.portfolio?.account.cash ?? 0;
  const runtimeCanSubmit = !runtimeSnapshot.tradingBlocked
    && runtimeSnapshot.lifecycle === "FOREGROUND"
    && runtimeSnapshot.network === "ONLINE"
    && runtimeSnapshot.recovery === "READY";
  const requiresDashboardConnection = notConfigured !== null && (utilityView === null && activeTab !== "Home" && activeTab !== "Markets") && activeTab !== "Portfolio";

  return <SafeAreaView style={[styles.container, { backgroundColor: appTheme.colors.background }]}>
    <View style={[styles.header, { borderBottomColor: appTheme.colors.border }]}><View style={styles.headerInner}><View style={styles.headerBrand}><WaveMark compact /><View><Text style={[styles.brand, { color: appTheme.colors.text }]}>NUSA</Text><Text style={[styles.eyebrow, { color: appTheme.colors.primary }]}>PERSONAL PAPER</Text></View></View><Pressable accessibilityLabel="도구" accessibilityRole="button" accessibilityState={{ expanded: utilityMenuOpen, selected: utilityMenuOpen || utilityView !== null }} onPress={() => { if (utilityView !== null) { setUtilityView(null); setUtilityMenuOpen(true); return; } setUtilityMenuOpen((current) => !current); }} style={[styles.utilityButton, { borderColor: utilityMenuOpen || utilityView !== null ? appTheme.colors.primary : appTheme.colors.border, backgroundColor: utilityMenuOpen || utilityView !== null ? appTheme.colors.primarySoft : appTheme.colors.surfaceSunken }]} testID="header-tools-menu"><Text style={[styles.utilityText, { color: utilityMenuOpen || utilityView !== null ? appTheme.colors.primary : appTheme.colors.textMuted }]}>도구</Text></Pressable></View></View>
    {utilityMenuOpen ?<View style={[styles.utilityMenu, { backgroundColor: appTheme.colors.surface, borderBottomColor: appTheme.colors.border }]} testID="header-tools-tray"><View style={styles.utilityMenuInner}>{(["NOTIFICATIONS", "SETTINGS"] as const).map((view) => <Pressable key={view} accessibilityLabel={utilityLabels[view]} accessibilityRole="button" onPress={() => { setUtilityMenuOpen(false); setUtilityView(view); }} style={[styles.utilityMenuButton, { borderColor: appTheme.colors.border, backgroundColor: appTheme.colors.surfaceSunken }]} testID={view === "NOTIFICATIONS" ? "header-notifications" : "header-settings"}><Text style={[styles.utilityText, { color: appTheme.colors.text }]}>{view === "NOTIFICATIONS" ? "알림" : "설정"}</Text></Pressable>)}</View></View> : null}
    {utilityView ? <View style={[styles.utilityNavigation, { borderBottomColor: appTheme.colors.border }]} testID="utility-navigation"><View style={styles.utilityNavigationInner}><Text style={[styles.utilityTitle, { color: appTheme.colors.text }]}>{utilityLabels[utilityView]}</Text><Pressable accessibilityLabel={`${utilityLabels[utilityView]} 닫기`} accessibilityRole="button" onPress={closeUtility} style={[styles.utilityClose, { borderColor: appTheme.colors.border, backgroundColor: appTheme.colors.surfaceSunken }]} testID="utility-close"><Text style={[styles.utilityText, { color: appTheme.colors.textMuted }]}>닫기</Text></Pressable></View></View> : null}

    {/* MarketsView's rawCandles stays null: no real candle/OHLC fetch path exists yet anywhere
        in this client (a separately-scoped data-integration gap, not a UI decision). ChartView
        renders its own truthful "unavailable" state rather than fabricating candle data. */}
    {requiresDashboardConnection ? <DashboardConnectionRequired reason={notConfigured ?? "PAPER 서버 연결이 필요합니다."} onGoSettings={goSettings} />
      : utilityView === "NOTIFICATIONS" ? <NotificationView repository={settingsRepository} />
      : utilityView === "SETTINGS" ? <SettingsView exchangeCash={accountCash} onCloudInvestmentPercentSave={investmentAllocationClient.save} onInvestmentPercentChanged={setInvestmentPercent} onSignOut={handleSignOut} repository={settingsRepository} />
      : activeTab === "Portfolio" ? <PortfolioView error={readOnlyError} investmentPercent={investmentPercent} onRefresh={onRefresh} refreshing={refreshing} snapshot={snapshot?.portfolio ?? null} upbitError={upbitState.error} upbitSnapshot={upbitState.snapshot} upbitStatus={upbitState.status} />
      : activeTab === "Paper" ? <TradingView error={readOnlyError} investmentPercent={investmentPercent} marketConnectionState={marketConnectionState} onRefresh={onRefresh} refreshing={refreshing} runtimeCanSubmit={runtimeCanSubmit} snapshot={snapshot?.portfolio ?? null} stale={stale} />
      : activeTab === "Markets" ? <MarketsView chartError={publicMarkets.chartError} error={publicMarkets.status === "ERROR" ? publicMarkets.error : null} currentPrice={publicMarkets.currentPrice} market={CHART_MARKET} marketConnectionState={publicMarketConnectionState} marketsStale={publicMarkets.status === "STALE"} onRefresh={refreshPublicMarkets} rawCandles={publicMarkets.candles === null ? null : [...publicMarkets.candles]} rawMarkets={publicMarkets.markets === null ? null : [...publicMarkets.markets]} refreshing={publicRefreshing} repository={watchlistRepository} stale={publicMarkets.status !== "READY"} />
      : activeTab === "AiSignal" ? <AiView ai={ai} error={readOnlyError} health={snapshot?.health ?? null} killSwitchActive={snapshot?.dashboard.killSwitchActive ?? null} liveAuthority={snapshot?.liveAuthority ?? null} onRefresh={onRefresh} productionMutationAllowed={snapshot?.productionMutationAllowed ?? null} refreshing={refreshing} research={snapshot?.research ?? null} />
      : activeTab === "Order" ? <OrderHistoryView error={readOnlyError} onRefresh={onRefresh} rawOrders={snapshot?.orders ?? null} refreshing={refreshing} />
      : <HomeView snapshot={snapshot} investmentPercent={investmentPercent} readOnlyError={readOnlyError} notConfigured={notConfigured} refreshing={refreshing} onRefresh={onRefresh} onGoSettings={goSettings} onNavigate={navigateHome} />}

    <View style={[styles.navigation, { backgroundColor: appTheme.colors.navSurface, borderTopColor: appTheme.colors.border }]}><View accessibilityRole="tablist" style={styles.navigationInner}>{tabs.map((tab) => { const active = utilityView === null && activeTab === tab; return <Pressable key={tab} accessibilityLabel={tabLabels[tab]} accessibilityRole="tab" accessibilityState={{ selected: active }} onPress={() => { setUtilityMenuOpen(false); setUtilityView(null); setActiveTab(tab); }} style={[styles.navItem, { borderColor: active ? appTheme.colors.neonBlue : "transparent", backgroundColor: active ? appTheme.colors.neonGlow : "transparent", shadowColor: active ? appTheme.colors.neonBlue : "transparent", shadowOpacity: active ? 0.3 : 0, shadowRadius: active ? 8 : 0, elevation: active ? 2 : 0 }]} testID={`tab-${tab}`}><View style={[styles.navIndicator, { backgroundColor: active ? appTheme.colors.aiSignalEnd : "transparent", width: active ? 30 : 12, shadowColor: active ? appTheme.colors.aiSignalEnd : "transparent", shadowOpacity: active ? 0.6 : 0, shadowRadius: active ? 6 : 0, elevation: active ? 1 : 0 }]} /><Text style={[styles.navLabel, { color: active ? appTheme.colors.neonTeal : appTheme.colors.textMuted }, active && styles.navLabelActive]}>{tabLabels[tab]}</Text></Pressable>; })}</View></View>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  container: theme.container,
  authContent: { flex: 1, justifyContent: "center", padding: 24, alignItems: "center" }, authPanel: { width: "100%", maxWidth: 640, gap: 16 }, authBrand: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 8 }, authHeading: { fontSize: 29, fontWeight: "700", letterSpacing: -0.8 }, subtitle: { fontSize: 14, lineHeight: 21 }, entryBadges: { flexDirection: "row", flexWrap: "wrap", gap: 7 }, bootstrapInput: { minHeight: 52, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14 },
  header: { minHeight: 64, borderBottomWidth: 1, alignItems: "center" }, headerInner: { width: "100%", maxWidth: 1080, paddingHorizontal: 20, paddingVertical: 10, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, headerBrand: { flexDirection: "row", alignItems: "center", gap: 10 }, brand: { fontSize: 23, fontWeight: "800", letterSpacing: 1.6 }, eyebrow: { fontSize: 9, fontWeight: "800", letterSpacing: 1.7, marginTop: -1 },
  utilityButton: { minWidth: 48, minHeight: 48, paddingHorizontal: 12, borderRadius: 14, borderWidth: 1, alignItems: "center", justifyContent: "center" }, utilityText: { fontSize: 12, fontWeight: "700" }, utilityMenu: { minHeight: 52, borderBottomWidth: 1, alignItems: "center" }, utilityMenuInner: { width: "100%", maxWidth: 1080, paddingHorizontal: 20, paddingVertical: 6, flexDirection: "row", gap: 8, alignItems: "center" }, utilityMenuButton: { flex: 1, minHeight: 48, paddingHorizontal: 10, borderRadius: 12, borderWidth: 1, alignItems: "center", justifyContent: "center" }, utilityNavigation: { minHeight: 48, borderBottomWidth: 1, alignItems: "center" }, utilityNavigationInner: { width: "100%", maxWidth: 1080, paddingHorizontal: 20, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, utilityTitle: { fontSize: 14, fontWeight: "700" }, utilityClose: { minWidth: 48, minHeight: 48, paddingHorizontal: 10, borderRadius: 12, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  connectionState: { flex: 1, justifyContent: "center", padding: 20, alignItems: "center" }, connectionStateInner: { width: "100%", maxWidth: 720 }, cardHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 10 }, cardEyebrow: { fontSize: 10, fontWeight: "800", letterSpacing: 1.2, marginBottom: 4 }, cardTitle: { fontSize: 18, fontWeight: "700", letterSpacing: -0.4 }, body: { fontSize: 13, lineHeight: 20 }, meta: { fontSize: 12, lineHeight: 18 },
  navigation: { borderTopWidth: 1, alignItems: "center" }, navigationInner: { width: "100%", maxWidth: 1080, flexDirection: "row", paddingTop: 8, paddingBottom: 9, paddingHorizontal: 6 }, navItem: { flex: 1, minHeight: 54, alignItems: "center", justifyContent: "center", gap: 6, borderRadius: 16, borderWidth: 1, marginHorizontal: 2 }, navIndicator: { height: 2, borderRadius: 2 }, navLabel: { fontSize: 10, fontWeight: "600", letterSpacing: 0.1 }, navLabelActive: { fontWeight: "800", letterSpacing: 0.25 },
});
