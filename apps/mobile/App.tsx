import React, { useCallback, useEffect, useState } from "react";
import { RefreshControl, SafeAreaView, ScrollView, StyleSheet, Text, View } from "react-native";

const BASE_URL = process.env.EXPO_PUBLIC_NUSA_MONITOR_URL ?? "http://127.0.0.1:41731";
type Monitor = { app: "NUSA"; mode: string; marketConnectionState: string; warmupState: string; stale: boolean; observedAt: string };
type Account = { observedAt: string; mode: string; account: Record<string, unknown>; openOrderCount: number };

async function get<T>(path: string): Promise<T> { const response = await fetch(`${BASE_URL}${path}`); if (!response.ok) throw new Error(`monitor request failed (${response.status})`); return response.json() as Promise<T>; }

export default function App() {
  const [status, setStatus] = useState<Monitor | null>(null);
  const [account, setAccount] = useState<Account | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const refresh = useCallback(async () => { try { const [nextStatus, nextAccount] = await Promise.all([get<Monitor>("/api/status"), get<Account>("/api/account")]); setStatus(nextStatus); setAccount(nextAccount); setError(null); } catch { setError("로컬 monitor에 연결할 수 없습니다."); } }, []);
  useEffect(() => { void refresh(); const timer = setInterval(() => void refresh(), 5000); return () => clearInterval(timer); }, [refresh]);
  const onRefresh = useCallback(async () => { setRefreshing(true); await refresh(); setRefreshing(false); }, [refresh]);
  return <SafeAreaView style={styles.root}><ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
    <Text style={styles.title}>NUSA Monitor</Text><Text style={styles.subtitle}>읽기 전용 · Paper only</Text>
    {error ? <Text style={styles.error}>{error}</Text> : null}
    <View style={styles.card}><Text style={styles.label}>상태</Text><Text style={styles.value}>{status?.marketConnectionState ?? "확인 중"}</Text><Text style={styles.meta}>Warm-up: {status?.warmupState ?? "—"}</Text><Text style={styles.meta}>관측 시각: {status?.observedAt ?? "—"}</Text></View>
    <View style={styles.card}><Text style={styles.label}>계좌 요약</Text><Text style={styles.value}>{account ? `${Object.keys(account.account).length}개 항목` : "확인 중"}</Text><Text style={styles.meta}>미체결 주문: {account?.openOrderCount ?? "—"}</Text><Text style={styles.meta}>모드: {account?.mode ?? "PAPER"}</Text></View>
  </ScrollView></SafeAreaView>;
}
const styles = StyleSheet.create({ root: { flex: 1, backgroundColor: "#0f172a" }, content: { padding: 20, gap: 14 }, title: { color: "#f8fafc", fontSize: 28, fontWeight: "800" }, subtitle: { color: "#94a3b8" }, card: { backgroundColor: "#1e293b", borderRadius: 12, padding: 18, gap: 8 }, label: { color: "#94a3b8", fontSize: 12 }, value: { color: "#2dd4bf", fontSize: 24, fontWeight: "700" }, meta: { color: "#cbd5e1" }, error: { color: "#fca5a5", backgroundColor: "#450a0a", padding: 12, borderRadius: 8 } });
