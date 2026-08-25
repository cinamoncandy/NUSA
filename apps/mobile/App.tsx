import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppState, Pressable, StyleSheet, Text, View, type AppStateStatus } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { AuthContext, useAuth, type AuthStatus } from "./src/authContext";
import { NusaButton, NusaCard, StatusChip, WaveMark } from "./src/components";
import { ThemeProvider, useTheme, type ThemePreference } from "./src/ThemeProvider";
import { HomeView, type HomeDestination } from "./src/homeView";
import { getHomeVisualProfile } from "./src/homeVisualProfile";
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
import { clearPaperConnectionVerification, getConfiguredPaperEndpoint, isPaperConnectionVerified, restoreConfiguredPaperSession, setConfiguredPaperEndpoint } from "./src/paperConnectionSession";
import { mobileApprovedSession } from "./src/mobileApprovedSessionBoundary";
import { loadPersonalPaperOperations, type PersonalPaperOperationsLoadResult } from "./src/personalPaperOperationsClient";
import { loadShadowOperations, type ShadowOperationsLoadResult } from "./src/shadowOperationsClient";
import { loadRealReadOnlyOperations, type RealReadOnlyOperationsLoadResult } from "./src/realReadOnlyOperationsClient";
import { loadLiveReadinessOperations, type LiveReadinessOperationsLoadResult } from "./src/liveReadinessOperationsClient";
import { MobileRuntimeCoordinator, initialMobileRuntimeSnapshot, type MobileRuntimeEvent, type MobileRuntimeSnapshot } from "./src/mobileRuntime";
import { resetUpbitReadOnlyState, useUpbitReadOnlyState } from "./src/upbitReadOnlyAccount";
import { loadUpbitPublicCandles, loadUpbitPublicMarkets, UpbitPublicQuotationError, type PublicQuotationDiagnostic } from "./src/upbitPublicQuotationClient";
import { UpbitPublicWebSocketClient } from "./src/upbitPublicWebSocketClient";
import { PaperShadowMonitorView } from "./src/paperShadowMonitorView";
// PaperLearningMonitorView remains the canonical PAPER monitor rendered by PaperShadowMonitorView.
import { buildPaperLearningScreen } from "./src/paperLearningScreen";
import { getLocalPaperLearningReadiness, recordLocalPaperPublicMarkets } from "./src/localPaperLearningProjection";
import { resolveCanonicalCloudOrigin } from "./src/canonicalOrigin";
import type { PublicCandle } from "./src/chartViewModel";
import type { WatchlistMarket } from "./src/watchlist";

const tabs = ["Home", "Markets", "Paper", "Portfolio"] as const;
type PrimaryTab = (typeof tabs)[number];
type Tab = PrimaryTab | "AiSignal" | "Order";
type UtilityView = "NOTIFICATIONS" | "SETTINGS" | null;
const tabLabels: Readonly<Record<PrimaryTab, string>> = { Home: "HOME", Markets: "MARKET", Paper: "TRADE", Portfolio: "PORTFOLIO" };
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
  /** Set only when chartError came from a real Upbit request/response, for the read-only
   * NETWORK DIAGNOSTICS panel -- see ChartView. Never set for any other failure. */
  readonly chartErrorDiagnostic: PublicQuotationDiagnostic | null;
}

const initialPublicMarketsState = (): PublicMarketsState => ({ status: "LOADING", markets: null, candles: null, currentPrice: null, error: null, chartError: null, chartErrorDiagnostic: null });

function themePreference(value: ThemeSetting): ThemePreference { return value === "SYSTEM" ? "system" : value === "LIGHT" ? "light" : "dark"; }

function PersistedThemeBridge({ children }: Readonly<{ children: React.ReactNode }>) {
  const { setMode } = useTheme();
  useEffect(() => {
    let active = true;
    void settingsRepository.load().then((stored) => {
      if (!active) return;
      const settings = normalizeSettings(stored ?? DEFAULT_SETTINGS);
      const canonical = resolveCanonicalCloudOrigin();
      setConfiguredPaperEndpoint(settings.paperEndpoint);
      if (!settings.paperEndpoint && canonical.status === "READY") setConfiguredPaperEndpoint(canonical.origin);
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
  const value = useMemo(() => ({ status, signIn: () => setStatus("SIGNED_IN"), signOut: () => setStatus("SIGNED_OUT") }), [status]);
  useEffect(() => {
    let active = true;
    void settingsRepository.load().then((stored) => {
      const settings = normalizeSettings(stored ?? DEFAULT_SETTINGS);
      const canonical = resolveCanonicalCloudOrigin();
      const endpoint = settings.paperEndpoint || (canonical.status === "READY" ? canonical.origin : null);
      if (endpoint == null) return false;
      setConfiguredPaperEndpoint(endpoint);
      return restoreConfiguredPaperSession(endpoint);
    }).then((restored) => {
      if (active) setStatus(restored ? "SIGNED_IN" : "SIGNED_OUT");
    }).catch(() => { if (active) { mobileApprovedSession().clearMemory(); setStatus("SIGNED_OUT"); } });
    return () => { active = false; };
  }, []);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

function AuthenticatedApp() {
  const { status: authStatus, signIn, signOut } = useAuth();
  const { theme: appTheme } = useTheme();
  const upbitState = useUpbitReadOnlyState();
  const [activeTab, setActiveTab] = useState<Tab>("Home");
  const [paperLearningOpen, setPaperLearningOpen] = useState(false);
  const [utilityView, setUtilityView] = useState<UtilityView>(null);
  const [utilityMenuOpen, setUtilityMenuOpen] = useState(false);
  const [operations, setOperations] = useState<PersonalPaperOperationsLoadResult>({ status: "NOT_CONFIGURED", reason: "PAPER connection is not configured." });
  const [shadowOperations, setShadowOperations] = useState<ShadowOperationsLoadResult>({ status: "NOT_CONFIGURED", reason: "SHADOW observability is not configured." });
  const [realReadOnlyOperations, setRealReadOnlyOperations] = useState<RealReadOnlyOperationsLoadResult>({ status: "NOT_CONFIGURED", reason: "REAL_READ_ONLY observability is not configured." });
  const [liveReadinessOperations, setLiveReadinessOperations] = useState<LiveReadinessOperationsLoadResult>({ status: "NOT_CONFIGURED", reason: "LIVE readiness observability is not configured." });
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
      setShadowOperations({ status: "NOT_CONFIGURED", reason: "PAPER endpoint must be verified before SHADOW reads." });
      setRealReadOnlyOperations({ status: "NOT_CONFIGURED", reason: "PAPER endpoint must be verified before REAL_READ_ONLY reads." });
      setLiveReadinessOperations({ status: "NOT_CONFIGURED", reason: "PAPER endpoint must be verified before LIVE readiness reads." });
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
      const shadowResult = await loadShadowOperations({ baseUrl: endpoint, credentialProvider: credentialSession.credentialProvider });
      if (generation === refreshGenerationRef.current && getConfiguredPaperEndpoint() === endpoint && isPaperConnectionVerified(endpoint)) setShadowOperations(shadowResult);
      // REAL_READ_ONLY loads on the same verified session as SHADOW and lands in its own state
      // slot. It is never merged into PAPER operations state: the two describe different accounts.
      const realResult = await loadRealReadOnlyOperations({ baseUrl: endpoint, credentialProvider: credentialSession.credentialProvider });
      if (generation === refreshGenerationRef.current && getConfiguredPaperEndpoint() === endpoint && isPaperConnectionVerified(endpoint)) setRealReadOnlyOperations(realResult);
      const liveResult = await loadLiveReadinessOperations({ baseUrl: endpoint, credentialProvider: credentialSession.credentialProvider });
      if (generation === refreshGenerationRef.current && getConfiguredPaperEndpoint() === endpoint && isPaperConnectionVerified(endpoint)) setLiveReadinessOperations(liveResult);
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
          ? { ...previous, status: "ERROR" as const, error: tickerError, chartError: null, chartErrorDiagnostic: null }
          : { ...previous, status: "STALE" as const, error: null, chartError: null, chartErrorDiagnostic: null };
        publicMarketsRef.current = next;
        setPublicMarkets(next);
        return;
      }
      const markets = tickerResult.value;
      const selected = markets.find((market) => market.market === CHART_MARKET) ?? null;
      const chartError = candleResult.status === "rejected" ? (candleResult.reason instanceof Error ? candleResult.reason.message : "Public candle data is unavailable.") : null;
      const chartErrorDiagnostic = candleResult.status === "rejected" && candleResult.reason instanceof UpbitPublicQuotationError
        ? candleResult.reason.diagnostic
        : null;
      const next: PublicMarketsState = {
        status: "READY",
        markets,
        candles: candleResult.status === "fulfilled" ? candleResult.value : null,
        currentPrice: selected?.price ?? null,
        error: null,
        chartError,
        chartErrorDiagnostic,
      };
      publicMarketsRef.current = next;
      setPublicMarkets(next);
    })();
    publicRefreshInFlightRef.current = request;
    const clearIfCurrent = () => { if (publicRefreshInFlightRef.current === request) publicRefreshInFlightRef.current = null; setPublicRefreshing(false); };
    void request.then(clearIfCurrent, clearIfCurrent);
    return request;
  }, []);

  const handleLiveTicker = useCallback((ticker: WatchlistMarket): void => {
    // WebSocket observations are the same validated public-input boundary as REST observations.
    // Record them before the UI market list guard so LOCAL PAPER does not depend on a Cloud state.
    recordLocalPaperPublicMarkets([ticker]);
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
  const openPaperTrade = useCallback(() => { setUtilityMenuOpen(false); setUtilityView(null); setActiveTab("Paper"); }, []);
  const openPaperLearning = useCallback(() => { setUtilityMenuOpen(false); setUtilityView(null); setPaperLearningOpen(true); }, []);
  const handleSignOut = useCallback(() => {
    refreshGenerationRef.current += 1; publicRefreshGenerationRef.current += 1; credentialSession.clear(); clearPaperConnectionVerification(); resetUpbitReadOnlyState(); setRefreshing(false); setPublicRefreshing(false);
    const initialPublicState = initialPublicMarketsState(); publicMarketsRef.current = initialPublicState; setPublicMarkets(initialPublicState); liveMarketsKeyRef.current = "";
    setOperations({ status: "NOT_CONFIGURED", reason: "PAPER connection is not configured." }); setShadowOperations({ status: "NOT_CONFIGURED", reason: "SHADOW observability is not configured." }); setRealReadOnlyOperations({ status: "NOT_CONFIGURED", reason: "REAL_READ_ONLY observability is not configured." }); setLiveReadinessOperations({ status: "NOT_CONFIGURED", reason: "LIVE readiness observability is not configured." }); setUtilityMenuOpen(false); setUtilityView(null); setPaperLearningOpen(false); setActiveTab("Home"); signOut();
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
    if (authStatus !== "SIGNED_IN" || appState !== "active") return;
    const generation = refreshGenerationRef.current;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const scheduleNext = () => { if (cancelled || generation !== refreshGenerationRef.current) return; timer = setTimeout(() => { timer = null; void refresh().catch(() => undefined).finally(scheduleNext); }, PAPER_REFRESH_INTERVAL_MS); };
    void refresh().catch(() => undefined).finally(scheduleNext);
    return () => { cancelled = true; refreshGenerationRef.current += 1; if (timer !== null) clearTimeout(timer); };
  }, [appState, authStatus, refresh]);

  useEffect(() => {
    publicRefreshGenerationRef.current += 1;
    // Public quotation data is read-only and does not require a Cloud/bootstrap session.
    if (authStatus === "CHECKING" || appState !== "active") return;
    const generation = publicRefreshGenerationRef.current;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const scheduleNext = () => { if (cancelled || generation !== publicRefreshGenerationRef.current) return; timer = setTimeout(() => { timer = null; void refreshPublicMarkets().catch(() => undefined).finally(scheduleNext); }, PUBLIC_REFRESH_INTERVAL_MS); };
    void refreshPublicMarkets().catch(() => undefined).finally(scheduleNext);
    return () => { cancelled = true; publicRefreshGenerationRef.current += 1; if (timer !== null) clearTimeout(timer); };
  }, [appState, authStatus, refreshPublicMarkets]);

  useEffect(() => {
    // The WebSocket carries public ticker observations only; it must not inherit private
    // dashboard/bridge credential requirements from the Cloud or REAL_READ_ONLY paths.
    if (authStatus === "CHECKING" || appState !== "active") { liveTickerClient.disconnect(); return; }
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

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refresh();
    } finally {
      // Cloud PAPER remains independently fail-closed; LOCAL PAPER also refreshes its
      // credential-free public feed so recovery does not depend on an optional session.
      await refreshPublicMarkets().catch(() => undefined);
      setRefreshing(false);
    }
  }, [refresh, refreshPublicMarkets]);

  const entryProfile = getHomeVisualProfile(appTheme.preset);
  if (authStatus === "CHECKING") return <SafeAreaView style={[styles.container, { backgroundColor: appTheme.colors.background }]}><View style={[styles.authContent, { padding: entryProfile.screen.horizontalPadding }]}><WaveMark /><Text style={[styles.brand, { color: appTheme.colors.text }]}>NUSA</Text><Text style={[styles.authHeading, { color: appTheme.colors.text }]}>로컬 상태 확인 중</Text></View></SafeAreaView>;
  if (authStatus !== "SIGNED_IN") return <SafeAreaView style={[styles.container, { backgroundColor: appTheme.colors.background }]}><View style={[styles.authContent, { padding: entryProfile.screen.horizontalPadding }]}><View style={[styles.authPanel, { maxWidth: entryProfile.screen.maxWidth, gap: entryProfile.density.contentGap }]}><View style={styles.authBrand}><WaveMark /><View><Text style={[styles.brand, { color: appTheme.colors.text }]}>NUSA</Text><Text style={[styles.eyebrow, { color: appTheme.colors.primary }]}>PERSONAL INTELLIGENCE</Text></View></View><Text style={[styles.authHeading, { color: appTheme.colors.text, fontSize: entryProfile.hero.balanceSize * 0.66, letterSpacing: entryProfile.hero.balanceLetterSpacing * 0.35 }]}>개인 PAPER 모드</Text><Text style={[styles.subtitle, { color: appTheme.colors.textMuted, fontSize: entryProfile.type.body, lineHeight: entryProfile.type.bodyLineHeight }]}>개인 기기에서 PAPER 작업공간으로 진입합니다. 서버 자격 증명은 Settings에서 별도로 검증합니다.</Text><View style={[styles.entryBadges, { gap: entryProfile.density.metricGap }]}><StatusChip label="LOCAL ENTRY" tone="neutral" /><StatusChip label="PAPER ONLY" tone="primary" /><StatusChip label="LIVE NONE" tone="info" /></View><NusaButton accessibilityLabel="Start personal mode" label="개인 모드 시작" onPress={signIn} testID="local-entry-submit" /><Text style={[styles.meta, { color: appTheme.colors.textMuted, fontSize: entryProfile.type.meta }]}>이 진입 단계는 계정 인증이 아닙니다. 사용자 신원을 검증하지 않으며 비밀번호를 수집하거나 저장하지 않습니다.</Text></View></View></SafeAreaView>;

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
  const requiresDashboardConnection = notConfigured !== null && utilityView === null && activeTab !== "Home" && activeTab !== "Markets" && activeTab !== "Portfolio" && activeTab !== "Paper";
  const homeShellActive = utilityView === null && activeTab === "Home";
  const localPaperReadiness = getLocalPaperLearningReadiness();
  const paperLearningRuntimeStatus = snapshot?.paperLearning?.events?.length
    ? snapshot.paperLearning.runtimeStatus
    : snapshot?.paperLearning?.runtimeStatus === "HALTED" || snapshot?.paperLearning?.runtimeStatus === "ERROR"
      ? snapshot.paperLearning.runtimeStatus
      : localPaperReadiness.status;
  // Issue #755: report the observed upstream condition instead of letting an empty timeline be
  // explained by a guess. Only this component knows which of these actually happened.
  const paperLearningServerSource = operations.status === "NOT_CONFIGURED"
    ? "NOT_CONFIGURED" as const
    : operations.status === "UNAVAILABLE"
      ? "UNAVAILABLE" as const
      : snapshot?.paperLearning == null
        ? "PROJECTION_ABSENT" as const
        : (snapshot.paperLearning.events?.length ?? 0) > 0
          ? "SERVER_STREAM" as const
          : "PROJECTION_EMPTY" as const;
  const paperLearningState = buildPaperLearningScreen(snapshot?.paperLearning?.events ?? [], paperLearningRuntimeStatus, paperLearningServerSource);

  return <SafeAreaView style={[styles.container, { backgroundColor: appTheme.colors.background }]}>
    {!homeShellActive ? <View style={[styles.header, { borderBottomColor: appTheme.colors.border }]}><View style={styles.headerInner}><View style={styles.headerBrand}><WaveMark compact /><View><Text style={[styles.brand, { color: appTheme.colors.text }]}>NUSA</Text><Text style={[styles.eyebrow, { color: appTheme.colors.primary }]}>PERSONAL PAPER</Text></View></View><Pressable accessibilityLabel="도구" accessibilityRole="button" accessibilityState={{ expanded: utilityMenuOpen, selected: utilityMenuOpen || utilityView !== null }} onPress={() => { if (utilityView !== null) { setUtilityView(null); setUtilityMenuOpen(true); return; } setUtilityMenuOpen((current) => !current); }} style={[styles.utilityButton, { borderColor: utilityMenuOpen || utilityView !== null ? appTheme.colors.primary : appTheme.colors.border, backgroundColor: utilityMenuOpen || utilityView !== null ? appTheme.colors.primarySoft : appTheme.colors.surfaceSunken }]} testID="header-tools-menu"><Text style={[styles.utilityText, { color: utilityMenuOpen || utilityView !== null ? appTheme.colors.primary : appTheme.colors.textMuted }]}>도구</Text></Pressable></View></View> : null}
    {!homeShellActive && utilityMenuOpen ? <View style={[styles.utilityMenu, { backgroundColor: appTheme.colors.surface, borderBottomColor: appTheme.colors.border }]} testID="header-tools-tray"><View style={styles.utilityMenuInner}>{(["NOTIFICATIONS", "SETTINGS"] as const).map((view) => <Pressable key={view} accessibilityLabel={utilityLabels[view]} accessibilityRole="button" onPress={() => { setUtilityMenuOpen(false); setUtilityView(view); }} style={[styles.utilityMenuButton, { borderColor: appTheme.colors.border, backgroundColor: appTheme.colors.surfaceSunken }]} testID={view === "NOTIFICATIONS" ? "header-notifications" : "header-settings"}><Text style={[styles.utilityText, { color: appTheme.colors.text }]}>{view === "NOTIFICATIONS" ? "알림" : "설정"}</Text></Pressable>)}</View></View> : null}
    {utilityView ? <View style={[styles.utilityNavigation, { borderBottomColor: appTheme.colors.border }]} testID="utility-navigation"><View style={styles.utilityNavigationInner}><Text style={[styles.utilityTitle, { color: appTheme.colors.text }]}>{utilityLabels[utilityView]}</Text><Pressable accessibilityLabel={`${utilityLabels[utilityView]} 닫기`} accessibilityRole="button" onPress={closeUtility} style={[styles.utilityClose, { borderColor: appTheme.colors.border, backgroundColor: appTheme.colors.surfaceSunken }]} testID="utility-close"><Text style={[styles.utilityText, { color: appTheme.colors.textMuted }]}>닫기</Text></Pressable></View></View> : null}

     {paperLearningOpen ? <PaperShadowMonitorView paper={paperLearningState} shadow={shadowOperations.status === "READY" ? shadowOperations.snapshot : null} shadowReason={shadowOperations.status === "READY" ? undefined : shadowOperations.reason} real={realReadOnlyOperations.status === "READY" ? realReadOnlyOperations.snapshot : null} realReason={realReadOnlyOperations.status === "READY" ? undefined : realReadOnlyOperations.reason} live={liveReadinessOperations.status === "READY" ? liveReadinessOperations.snapshot : null} liveReason={liveReadinessOperations.status === "READY" ? undefined : liveReadinessOperations.reason} refreshing={refreshing} onRefresh={onRefresh} onClose={() => setPaperLearningOpen(false)} />
       : requiresDashboardConnection ? <DashboardConnectionRequired reason={notConfigured ?? "PAPER 서버 연결이 필요합니다."} onGoSettings={goSettings} />
      : utilityView === "NOTIFICATIONS" ? <NotificationView repository={settingsRepository} />
      : utilityView === "SETTINGS" ? <SettingsView canonicalEndpoint={getConfiguredPaperEndpoint()} credentialSession={credentialSession} exchangeCash={accountCash} onCloudInvestmentPercentSave={investmentAllocationClient.save} onInvestmentPercentChanged={setInvestmentPercent} onSignOut={handleSignOut} repository={settingsRepository} />
       : activeTab === "Portfolio" ? <PortfolioView error={readOnlyError} investmentPercent={investmentPercent} onOpenPaperLearning={openPaperLearning} onRefresh={onRefresh} refreshing={refreshing} snapshot={snapshot?.portfolio ?? null} upbitError={upbitState.error} upbitSnapshot={upbitState.snapshot} upbitStatus={upbitState.status} />
       : activeTab === "Paper" ? <TradingView error={readOnlyError} investmentPercent={investmentPercent} marketConnectionState={marketConnectionState} onOpenPaperLearning={openPaperLearning} onRefresh={onRefresh} refreshing={refreshing} runtimeCanSubmit={runtimeCanSubmit} snapshot={snapshot?.portfolio ?? null} stale={stale} />
      : activeTab === "Markets" ? <MarketsView chartError={publicMarkets.chartError} chartErrorDiagnostic={publicMarkets.chartErrorDiagnostic} error={publicMarkets.status === "ERROR" ? publicMarkets.error : null} currentPrice={publicMarkets.currentPrice} market={CHART_MARKET} marketConnectionState={publicMarketConnectionState} marketsStale={publicMarkets.status === "STALE"} onPaperTrade={openPaperTrade} onRefresh={refreshPublicMarkets} rawCandles={publicMarkets.candles === null ? null : [...publicMarkets.candles]} rawMarkets={publicMarkets.markets === null ? null : [...publicMarkets.markets]} refreshing={publicRefreshing} repository={watchlistRepository} stale={publicMarkets.status !== "READY"} />
      : activeTab === "AiSignal" ? <AiView ai={ai} error={readOnlyError} health={snapshot?.health ?? null} killSwitchActive={snapshot?.dashboard.killSwitchActive ?? null} liveAuthority={snapshot?.liveAuthority ?? null} onRefresh={onRefresh} productionMutationAllowed={snapshot?.productionMutationAllowed ?? null} refreshing={refreshing} research={snapshot?.research ?? null} />
      : activeTab === "Order" ? <OrderHistoryView error={readOnlyError} onRefresh={onRefresh} rawOrders={snapshot?.orders ?? null} refreshing={refreshing} />
       : <HomeView snapshot={snapshot} investmentPercent={investmentPercent} readOnlyError={readOnlyError} notConfigured={notConfigured} refreshing={refreshing} onRefresh={onRefresh} onGoSettings={goSettings} onNavigate={navigateHome} onOpenPaperLearning={openPaperLearning} />}

     <View style={[styles.navigation, { backgroundColor: appTheme.colors.navSurface, borderTopColor: appTheme.colors.border }]}><View accessibilityRole="tablist" style={styles.navigationInner}>{tabs.map((tab) => { const active = !paperLearningOpen && utilityView === null && activeTab === tab; return <Pressable key={tab} accessibilityLabel={tabLabels[tab]} accessibilityRole="tab" accessibilityState={{ selected: active }} onPress={() => { setUtilityMenuOpen(false); setUtilityView(null); setActiveTab(tab); setPaperLearningOpen(false); }} style={[styles.navItem, { opacity: active ? 1 : 0.72 }]} testID={`tab-${tab}`}><View style={[styles.navIndicator, { backgroundColor: active ? appTheme.colors.aiSignalEnd : appTheme.colors.border, width: active ? 22 : 4, opacity: active ? 0.95 : 0.35 }]} /><Text style={[styles.navLabel, { color: active ? appTheme.colors.text : appTheme.colors.textMuted }, active && styles.navLabelActive]}>{tabLabels[tab]}</Text></Pressable>; })}</View></View>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  container: theme.container,
  authContent: { flex: 1, justifyContent: "center", padding: 24, alignItems: "center" }, authPanel: { width: "100%", maxWidth: 640, gap: 16 }, authBrand: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 8 }, authHeading: { fontSize: 29, fontWeight: "700", letterSpacing: -0.8 }, subtitle: { fontSize: 14, lineHeight: 21 }, entryBadges: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  header: { minHeight: 64, borderBottomWidth: 1, alignItems: "center" }, headerInner: { width: "100%", maxWidth: 1080, paddingHorizontal: 20, paddingVertical: 10, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, headerBrand: { flexDirection: "row", alignItems: "center", gap: 10 }, brand: { fontSize: 23, fontWeight: "800", letterSpacing: 1.6 }, eyebrow: { fontSize: 9, fontWeight: "800", letterSpacing: 1.7, marginTop: -1 },
  utilityButton: { minWidth: 48, minHeight: 48, paddingHorizontal: 12, borderRadius: 14, borderWidth: 1, alignItems: "center", justifyContent: "center" }, utilityText: { fontSize: 12, fontWeight: "700" }, utilityMenu: { minHeight: 52, borderBottomWidth: 1, alignItems: "center" }, utilityMenuInner: { width: "100%", maxWidth: 1080, paddingHorizontal: 20, paddingVertical: 6, flexDirection: "row", gap: 8, alignItems: "center" }, utilityMenuButton: { flex: 1, minHeight: 48, paddingHorizontal: 10, borderRadius: 12, borderWidth: 1, alignItems: "center", justifyContent: "center" }, utilityNavigation: { minHeight: 48, borderBottomWidth: 1, alignItems: "center" }, utilityNavigationInner: { width: "100%", maxWidth: 1080, paddingHorizontal: 20, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, utilityTitle: { fontSize: 14, fontWeight: "700" }, utilityClose: { minWidth: 48, minHeight: 48, paddingHorizontal: 10, borderRadius: 12, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  connectionState: { flex: 1, justifyContent: "center", padding: 20, alignItems: "center" }, connectionStateInner: { width: "100%", maxWidth: 720 }, cardHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 10 }, cardEyebrow: { fontSize: 10, fontWeight: "800", letterSpacing: 1.2, marginBottom: 4 }, cardTitle: { fontSize: 18, fontWeight: "700", letterSpacing: -0.4 }, body: { fontSize: 13, lineHeight: 20 }, meta: { fontSize: 12, lineHeight: 18 },
  navigation: { borderTopWidth: StyleSheet.hairlineWidth, alignItems: "center" }, navigationInner: { width: "100%", maxWidth: 1080, flexDirection: "row", paddingTop: 5, paddingBottom: 7, paddingHorizontal: 6 }, navItem: { flex: 1, minHeight: 50, alignItems: "center", justifyContent: "center", gap: 5, marginHorizontal: 1 }, navIndicator: { height: 2, borderRadius: 1 }, navLabel: { fontSize: 9, fontWeight: "600", letterSpacing: 0.45 }, navLabelActive: { fontWeight: "800", letterSpacing: 0.65 },
});
