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
import { PortfolioView, type PortfolioAccountResponse } from "./src/portfolioView";
import { TradingView } from "./src/tradingView";
import { MarketsView } from "./src/marketsView";
import { WatchlistRepository } from "./src/watchlist";
import { OrderHistoryView } from "./src/orderHistoryView";

const BASE_URL = process.env.EXPO_PUBLIC_NUSA_MONITOR_URL ?? "http://127.0.0.1:41731";
const AUTH_MODE = process.env.EXPO_PUBLIC_NUSA_AUTH_MODE ?? "foundation";
const tabs = ["Home", "Markets", "Trade", "Portfolio", "More"] as const;
const theme = { container: { flex: 1 } } as const;
type Tab = (typeof tabs)[number];
type Monitor = { marketConnectionState: string; warmupState: string; stale: boolean; observedAt: string };
type Account = PortfolioAccountResponse;
type CandleResponse = { readonly market: string; readonly interval: string; readonly candles: unknown[] };
type MarketsResponse = { readonly markets: unknown[] };
const CHART_MARKET = "KRW-BTC";

async function get<T>(path: string): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`);
  if (!response.ok) throw new Error(`monitor request failed (${response.status})`);
  return response.json() as Promise<T>;
}

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
  const [status, setStatus] = useState<Monitor | null>(null);
  const [account, setAccount] = useState<Account | null>(null);
  const [markets, setMarkets] = useState<unknown[] | null>(null);
  const [candles, setCandles] = useState<unknown[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const watchlistRepository = useMemo(() => new WatchlistRepository(AsyncStorage), []);

  const refresh = useCallback(async () => {
    try {
      const [nextStatus, nextAccount, nextMarkets] = await Promise.all([
        get<Monitor>("/api/status"),
        get<Account>("/api/account"),
        get<MarketsResponse>("/api/markets"),
      ]);
      const nextCandles = await get<CandleResponse>(`/api/candles?market=${encodeURIComponent(CHART_MARKET)}&interval=1m&count=120`);
      setStatus(nextStatus);
      setAccount(nextAccount);
      setMarkets(nextMarkets.markets);
      setCandles(nextCandles.candles);
      setError(null);
    } catch {
      setError("Monitor connection is unavailable.");
    }
  }, []);

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
          <Text style={[styles.subtitle, { color: theme.colors.textMuted }]}>Authentication foundation</Text>
          <NusaTextField accessibilityLabel="Email" label="Email" onChangeText={setEmail} placeholder="Email" testID="auth-email" value={email} />
          <NusaTextField accessibilityLabel="Password" label="Password" onChangeText={setPassword} placeholder="Password" secureTextEntry testID="auth-password" value={password} />
          <NusaButton accessibilityLabel="Sign in" label="Sign in" onPress={signIn} testID="auth-submit" />
          <Text style={styles.meta}>Mode: {AUTH_MODE}. Server authentication is out of scope.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <View style={styles.header}>
        <Text style={[styles.brand, { color: theme.colors.text }]}>NUSA</Text>
        <Text style={[styles.mode, { color: theme.colors.textMuted }]}>Paper Trading</Text>
      </View>
      {activeTab === "Portfolio" ? <PortfolioView error={error} onRefresh={onRefresh} refreshing={refreshing} snapshot={account} /> : activeTab === "Trade" ? <TradingView error={error} marketConnectionState={status?.marketConnectionState ?? "UNKNOWN"} onRefresh={onRefresh} refreshing={refreshing} snapshot={account} stale={status?.stale ?? true} /> : activeTab === "Markets" ? <MarketsView error={error} currentPrice={account?.account.available === false ? null : account?.account.markPrice ?? null} market={CHART_MARKET} marketConnectionState={status?.marketConnectionState ?? "UNKNOWN"} onRefresh={onRefresh} rawCandles={candles} rawMarkets={markets} refreshing={refreshing} repository={watchlistRepository} stale={status?.stale ?? true} /> : activeTab === "More" ? <OrderHistoryView error={error} onRefresh={onRefresh} rawOrders={account?.account.orders ?? null} refreshing={refreshing} /> : <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <Text style={[styles.heading, { color: theme.colors.text }]}>{activeTab}</Text>
        {activeTab === "Home" ? (
          <>
            <Text style={[styles.subtitle, { color: theme.colors.textMuted }]}>Trading command center</Text>
            {error ? <Text style={[styles.error, { color: theme.colors.danger }]}>{error}</Text> : null}
            <NusaCard testID="market-card"><Text style={[styles.label, { color: theme.colors.textMuted }]}>Market Connection</Text><Text style={[styles.value, { color: theme.colors.primary }]}>{status?.marketConnectionState ?? "Checking"}</Text><Text style={styles.meta}>Warm-up: {status?.warmupState ?? "Checking"}</Text><Text style={styles.meta}>Data: {status?.stale ? "Stale" : "Current"}</Text></NusaCard>
            <NusaCard testID="account-card"><Text style={[styles.label, { color: theme.colors.textMuted }]}>Account</Text><Text style={[styles.value, { color: theme.colors.primary }]}>{account ? `${Object.keys(account.account).length} assets` : "Checking"}</Text><Text style={styles.meta}>Open orders: {account?.openOrderCount ?? "-"}</Text><Text style={styles.meta}>Mode: {account?.mode ?? "PAPER"}</Text></NusaCard>
          </>
        ) : (
          <View style={styles.card}>
            <Text style={styles.value}>{activeTab}</Text>
            <Text style={styles.meta}>This workspace is ready for the next feature slice.</Text>
          </View>
        )}
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
  error: { color: "#fecaca", backgroundColor: "#450a0a", padding: 12, borderRadius: 8 },
  input: { backgroundColor: "#1e293b", borderRadius: 8, color: "#f8fafc", padding: 14 },
  primaryButton: { backgroundColor: "#2dd4bf", borderRadius: 8, alignItems: "center", padding: 14 },
  primaryButtonLabel: { color: "#0f172a", fontWeight: "700" },
  navigation: { flexDirection: "row", borderTopWidth: 1, borderTopColor: "#334155", backgroundColor: "#111827", paddingVertical: 10 },
  navItem: { flex: 1, alignItems: "center", paddingVertical: 8 },
  navLabel: { color: "#94a3b8", fontSize: 12 },
  navLabelActive: { color: "#2dd4bf", fontWeight: "700" },
});
