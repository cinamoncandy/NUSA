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
import { NusaButton, NusaCard, NusaTextField } from "./src/components";
import { ThemeProvider, useTheme } from "./src/ThemeProvider";
import { PortfolioView } from "./src/portfolioView";
import { TradingView } from "./src/tradingView";
import { MarketsView } from "./src/marketsView";
import { WatchlistRepository } from "./src/watchlist";
import { MoreView } from "./src/moreView";
import type { SettingsRepository } from "./src/settings";
import { VersionedSettingsRepository } from "./src/persistenceRepositories";
import { InMemoryDashboardCredentialSession } from "./src/dashboardCredentialSession";
import {
  loadPersonalPaperOperations,
  type PersonalPaperOperationsLoadResult,
} from "./src/personalPaperOperationsClient";

const BASE_URL = process.env.EXPO_PUBLIC_NUSA_MONITOR_URL ?? "http://127.0.0.1:41731";
const AUTH_MODE = process.env.EXPO_PUBLIC_NUSA_AUTH_MODE ?? "foundation";
const tabs = ["Home", "Markets", "Trade", "Portfolio", "More"] as const;
const theme = { container: { flex: 1 } } as const;
type Tab = (typeof tabs)[number];
const CHART_MARKET = "KRW-BTC";

export default function App() {
  return <ThemeProvider initialMode="dark"><AuthContextProvider><AuthenticatedApp /></AuthContextProvider></ThemeProvider>;
}

function AuthContextProvider({ children }: Readonly<{ children: React.ReactNode }>) {
  const [status, setStatus] = useState<AuthStatus>("CHECKING");
  const value = useMemo(() => ({ status, signIn: () => setStatus("SIGNED_IN"), signOut: () => setStatus("SIGNED_OUT") }), [status]);
  useEffect(() => {
    const timer = setTimeout(() => setStatus("SIGNED_OUT"), 250);
    return () => clearTimeout(timer);
  }, []);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

function AuthenticatedApp() {
  const { status: authStatus, signIn } = useAuth();
  const { theme } = useTheme();
  const [activeTab, setActiveTab] = useState<Tab>("Home");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [dashboardTokenDraft, setDashboardTokenDraft] = useState("");
  const [operations, setOperations] = useState<PersonalPaperOperationsLoadResult>({
    status: "NOT_CONFIGURED",
    reason: "Secure dashboard credential is not configured."
  });
  const [refreshing, setRefreshing] = useState(false);
  const credentialSession = useMemo(() => new InMemoryDashboardCredentialSession(), []);
  const watchlistRepository = useMemo(() => new WatchlistRepository(AsyncStorage), []);
  const settingsRepository = useMemo<SettingsRepository>(() => new VersionedSettingsRepository(AsyncStorage), []);

  const refresh = useCallback(async () => {
    const next = await loadPersonalPaperOperations({
      baseUrl: BASE_URL,
      credentialProvider: credentialSession.credentialProvider
    });
    setOperations(next);
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

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 5000);
    return () => clearInterval(timer);
  }, [refresh]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  }, [refresh]);

  if (authStatus === "CHECKING") {
    return <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]}><View style={styles.authContent}><Text style={[styles.brand, { color: theme.colors.text }]}>NUSA</Text><Text style={[styles.heading, { color: theme.colors.text }]}>Loading</Text></View></SafeAreaView>;
  }

  if (authStatus !== "SIGNED_IN") {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]}>
        <View style={styles.authContent}>
          <Text style={[styles.brand, { color: theme.colors.text }]}>NUSA</Text>
          <Text style={[styles.heading, { color: theme.colors.text }]}>Sign in</Text>
          <Text style={[styles.subtitle, { color: theme.colors.textMuted }]}>Local authentication foundation</Text>
          <NusaTextField accessibilityLabel="Email" label="Email" onChangeText={setEmail} placeholder="Email" testID="auth-email" value={email} />
          <NusaTextField accessibilityLabel="Password" label="Password" onChangeText={setPassword} placeholder="Password" secureTextEntry testID="auth-password" value={password} />
          <NusaButton accessibilityLabel="Sign in" label="Sign in" onPress={signIn} testID="auth-submit" />
          <Text style={styles.meta}>Mode: {AUTH_MODE}. Server dashboard credentials are separate and never inferred from local sign-in.</Text>
        </View>
      </SafeAreaView>
    );
  }

  const snapshot = operations.status === "READY" ? operations.snapshot : null;
  const readOnlyError = operations.status === "UNAVAILABLE" ? operations.reason : null;
  const notConfigured = operations.status === "NOT_CONFIGURED" ? operations.reason : null;
  const marketConnectionState = snapshot?.operations.transport === "ONLINE" ? "CONNECTED" : "UNKNOWN";
  const stale = snapshot == null || snapshot.health !== "HEALTHY";
  const selectedMarket = snapshot?.markets?.find((market) => market.market === CHART_MARKET) ?? null;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <View style={styles.header}>
        <Text style={[styles.brand, { color: theme.colors.text }]}>NUSA</Text>
        <Text style={[styles.mode, { color: theme.colors.textMuted }]}>Personal PAPER · Read Only</Text>
      </View>
      {activeTab === "Portfolio" ? <PortfolioView error={readOnlyError ?? notConfigured} onRefresh={onRefresh} refreshing={refreshing} snapshot={snapshot?.portfolio ?? null} /> : activeTab === "Trade" ? <TradingView error={readOnlyError ?? notConfigured} marketConnectionState={marketConnectionState} onRefresh={onRefresh} refreshing={refreshing} snapshot={null} stale={stale} /> : activeTab === "Markets" ? <MarketsView error={readOnlyError ?? notConfigured} currentPrice={selectedMarket?.trade_price ?? null} market={CHART_MARKET} marketConnectionState={marketConnectionState} onRefresh={onRefresh} rawCandles={null} rawMarkets={snapshot?.markets ?? null} refreshing={refreshing} repository={watchlistRepository} stale={stale} /> : activeTab === "More" ? <MoreView error={readOnlyError ?? notConfigured} onRefresh={onRefresh} rawOrders={snapshot?.orders ?? null} refreshing={refreshing} settingsRepository={settingsRepository} /> : <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <Text style={[styles.heading, { color: theme.colors.text }]}>Home</Text>
        <Text style={[styles.subtitle, { color: theme.colors.textMuted }]}>Authenticated PAPER operations snapshot</Text>
        {readOnlyError ? <Text style={[styles.error, { color: theme.colors.danger }]}>{readOnlyError}</Text> : null}
        {notConfigured ? <NusaCard testID="dashboard-session-card">
          <Text style={[styles.label, { color: theme.colors.textMuted }]}>Read-only session</Text>
          <Text style={[styles.notice, { color: theme.colors.textMuted }]}>{notConfigured}</Text>
          <NusaTextField accessibilityLabel="Dashboard credential" label="Dashboard credential" onChangeText={setDashboardTokenDraft} placeholder="Enter local dashboard token" secureTextEntry testID="dashboard-credential" value={dashboardTokenDraft} />
          <NusaButton accessibilityLabel="Connect read only" label="Connect read only" onPress={() => { void connectReadOnly(); }} testID="dashboard-connect" />
          <Text style={styles.meta}>Credential stays in process memory only and is cleared on disconnect or app restart.</Text>
        </NusaCard> : <NusaButton accessibilityLabel="Disconnect read only" label="Disconnect read only" onPress={disconnectReadOnly} testID="dashboard-disconnect" />}
        <NusaCard testID="operations-card">
          <Text style={[styles.label, { color: theme.colors.textMuted }]}>Operations</Text>
          <Text style={[styles.value, { color: theme.colors.primary }]}>{snapshot?.operations.runtimeState ?? "Not configured"}</Text>
          <Text style={styles.meta}>Transport: {snapshot?.operations.transport ?? "-"}</Text>
          <Text style={styles.meta}>Scheduler: {snapshot?.operations.schedulerMode ?? "-"}</Text>
          <Text style={styles.meta}>Pending writes: {snapshot?.operations.pendingWrites ?? "-"}</Text>
        </NusaCard>
        <NusaCard testID="research-card">
          <Text style={[styles.label, { color: theme.colors.textMuted }]}>Research</Text>
          <Text style={[styles.value, { color: theme.colors.primary }]}>{snapshot?.research?.health ?? "Unavailable"}</Text>
          <Text style={styles.meta}>Champion: {snapshot?.research?.champion.strategyId ?? "-"} · PAPER_ONLY</Text>
          <Text style={styles.meta}>Challenger: {snapshot?.research?.challenger.strategyId ?? "-"} · ZERO_AUTHORITY</Text>
          <Text style={styles.meta}>Candidates: {snapshot?.research?.candidateCount ?? "-"}</Text>
        </NusaCard>
        <NusaCard testID="safety-card">
          <Text style={[styles.label, { color: theme.colors.textMuted }]}>Safety</Text>
          <Text style={[styles.value, { color: snapshot?.health === "FAIL_CLOSED" ? theme.colors.danger : theme.colors.primary }]}>{snapshot?.health ?? "FAIL_CLOSED"}</Text>
          <Text style={styles.meta}>PAPER ready: {snapshot?.readyForPaperOperations ? "Yes" : "No"}</Text>
          <Text style={styles.meta}>Kill switch: {snapshot?.dashboard.killSwitchActive ? "ACTIVE" : "Not active"}</Text>
          <Text style={styles.meta}>LIVE authority: {snapshot?.liveAuthority ?? "NONE"}</Text>
        </NusaCard>
      </ScrollView>}
      <View style={styles.navigation}>
        {tabs.map((tab) => (
          <Pressable key={tab} accessibilityRole="button" onPress={() => setActiveTab(tab)} style={styles.navItem}>
            <Text style={[styles.navLabel, activeTab === tab && styles.navLabelActive]}>{tab}</Text>
          </Pressable>
        ))}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: theme.container,
  authContent: { flex: 1, justifyContent: "center", padding: 24, gap: 14 },
  header: { paddingHorizontal: 20, paddingTop: 14, paddingBottom: 8 },
  brand: { color: "#f8fafc", fontSize: 26, fontWeight: "800" },
  mode: { color: "#94a3b8", marginTop: 2 },
  content: { padding: 20, gap: 14, paddingBottom: 28 },
  heading: { color: "#f8fafc", fontSize: 28, fontWeight: "800" },
  subtitle: { color: "#94a3b8" },
  card: { backgroundColor: "#1e293b", borderRadius: 10, padding: 18, gap: 8 },
  label: { color: "#94a3b8", fontSize: 12, textTransform: "uppercase" },
  value: { color: "#2dd4bf", fontSize: 24, fontWeight: "700" },
  meta: { color: "#cbd5e1" },
  notice: { backgroundColor: "#1e293b", padding: 12, borderRadius: 8 },
  error: { color: "#fecaca", backgroundColor: "#450a0a", padding: 12, borderRadius: 8 },
  input: { backgroundColor: "#1e293b", borderRadius: 8, color: "#f8fafc", padding: 14 },
  primaryButton: { backgroundColor: "#2dd4bf", borderRadius: 8, alignItems: "center", padding: 14 },
  primaryButtonLabel: { color: "#0f172a", fontWeight: "700" },
  navigation: { flexDirection: "row", borderTopWidth: 1, borderTopColor: "#334155", backgroundColor: "#111827", paddingVertical: 10 },
  navItem: { flex: 1, alignItems: "center", paddingVertical: 8 },
  navLabel: { color: "#94a3b8", fontSize: 12 },
  navLabelActive: { color: "#2dd4bf", fontWeight: "700" },
});