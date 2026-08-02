import React, { useCallback, useEffect, useState } from "react";
import {
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

const BASE_URL = process.env.EXPO_PUBLIC_NUSA_MONITOR_URL ?? "http://127.0.0.1:41731";
const tabs = ["Home", "Markets", "Trade", "Portfolio", "More"] as const;
type Tab = (typeof tabs)[number];
type Monitor = { marketConnectionState: string; warmupState: string; stale: boolean; observedAt: string };
type Account = { mode: string; account: Record<string, unknown>; openOrderCount: number };

async function get<T>(path: string): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`);
  if (!response.ok) throw new Error(`monitor request failed (${response.status})`);
  return response.json() as Promise<T>;
}

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>("Home");
  const [status, setStatus] = useState<Monitor | null>(null);
  const [account, setAccount] = useState<Account | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [nextStatus, nextAccount] = await Promise.all([
        get<Monitor>("/api/status"),
        get<Account>("/api/account"),
      ]);
      setStatus(nextStatus);
      setAccount(nextAccount);
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

  return (
    <SafeAreaView style={theme.container}>
      <View style={styles.header}>
        <Text style={styles.brand}>NUSA</Text>
        <Text style={styles.mode}>Paper Trading</Text>
      </View>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <Text style={styles.heading}>{activeTab}</Text>
        {activeTab === "Home" ? (
          <>
            <Text style={styles.subtitle}>Trading command center</Text>
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <View style={styles.card}>
              <Text style={styles.label}>Market Connection</Text>
              <Text style={styles.value}>{status?.marketConnectionState ?? "Checking"}</Text>
              <Text style={styles.meta}>Warm-up: {status?.warmupState ?? "Checking"}</Text>
              <Text style={styles.meta}>Data: {status?.stale ? "Stale" : "Current"}</Text>
            </View>
            <View style={styles.card}>
              <Text style={styles.label}>Account</Text>
              <Text style={styles.value}>{account ? `${Object.keys(account.account).length} assets` : "Checking"}</Text>
              <Text style={styles.meta}>Open orders: {account?.openOrderCount ?? "-"}</Text>
              <Text style={styles.meta}>Mode: {account?.mode ?? "PAPER"}</Text>
            </View>
          </>
        ) : (
          <View style={styles.card}>
            <Text style={styles.value}>{activeTab}</Text>
            <Text style={styles.meta}>This workspace is ready for the next feature slice.</Text>
          </View>
        )}
      </ScrollView>
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

const theme = {
  container: { flex: 1, backgroundColor: "#0f172a" } as const,
};

const styles = StyleSheet.create({
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
  navigation: { flexDirection: "row", borderTopWidth: 1, borderTopColor: "#334155", backgroundColor: "#111827", paddingVertical: 10 },
  navItem: { flex: 1, alignItems: "center", paddingVertical: 8 },
  navLabel: { color: "#94a3b8", fontSize: 12 },
  navLabelActive: { color: "#2dd4bf", fontWeight: "700" },
});
