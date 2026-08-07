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
import { MoreView } from "./src/moreView";
import type { SettingsRepository } from "./src/settings";
import { VersionedSettingsRepository } from "./src/persistenceRepositories";

const BASE_URL = process.env.EXPO_PUBLIC_NUSA_MONITOR_URL ?? "http://127.0.0.1:41731";
const AUTH_MODE = process.env.EXPO_PUBLIC_NUSA_AUTH_MODE ?? "foundation";
const tabs = ["Home", "Markets", "Trade", "Portfolio", "More"] as const;
const tabLabels: Record<(typeof tabs)[number], string> = {
  Home: "홈",
  Markets: "시장",
  Trade: "거래",
  Portfolio: "포트폴리오",
  More: "더보기",
};
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

function WaveMark({ compact = false }: Readonly<{ compact?: boolean }>) {
  const width = compact ? 34 : 62;
  return (
    <View accessibilityLabel="NUSA Ocean Current logo" style={[styles.waveMark, { width, height: compact ? 26 : 42 }]}>
      {[0, 1, 2].map((line) => (
        <View
          key={line}
          style={[
            styles.waveLine,
            {
              top: compact ? 4 + line * 7 : 7 + line * 11,
              width: width - line * 3,
              opacity: 1 - line * 0.18,
            },
          ]}
        />
      ))}
    </View>
  );
}

function AgentStep({ index, label, state }: Readonly<{ index: string; label: string; state: "완료" | "진행중" | "대기" }>) {
  const active = state === "진행중";
  const done = state === "완료";
  return (
    <View style={styles.agentStep}>
      <View style={[styles.stepIndex, active && styles.stepIndexActive, done && styles.stepIndexDone]}>
        <Text style={styles.stepIndexText}>{index}</Text>
      </View>
      <View style={styles.stepBody}>
        <Text style={styles.stepLabel}>{label}</Text>
        <Text style={[styles.stepState, active && styles.stepStateActive, done && styles.stepStateDone]}>{state}</Text>
      </View>
    </View>
  );
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
  const settingsRepository = useMemo<SettingsRepository>(() => new VersionedSettingsRepository(AsyncStorage), []);

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
      setError("시장 데이터 연결을 확인하고 있습니다.");
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
    return <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]}><View style={styles.authContent}><WaveMark /><Text style={[styles.brand, { color: theme.colors.text }]}>NUSA</Text><Text style={[styles.subtitle, { color: theme.colors.textMuted }]}>시장의 흐름을 읽고 있습니다.</Text></View></SafeAreaView>;
  }

  if (authStatus !== "SIGNED_IN") {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]}>
        <View style={styles.authContent}>
          <WaveMark />
          <Text style={[styles.brand, { color: theme.colors.text }]}>NUSA</Text>
          <Text style={[styles.heading, { color: theme.colors.text }]}>다시 만나서 반가워요</Text>
          <Text style={[styles.subtitle, { color: theme.colors.textMuted }]}>AI와 함께 시장의 흐름을 살펴보세요.</Text>
          <NusaTextField accessibilityLabel="Email" label="이메일" onChangeText={setEmail} placeholder="이메일" testID="auth-email" value={email} />
          <NusaTextField accessibilityLabel="Password" label="비밀번호" onChangeText={setPassword} placeholder="비밀번호" secureTextEntry testID="auth-password" value={password} />
          <NusaButton accessibilityLabel="Sign in" label="로그인" onPress={signIn} testID="auth-submit" />
          <Text style={styles.meta}>PAPER 모드 · 안전한 가상 거래 환경 · {AUTH_MODE}</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <View style={styles.header}>
        <View style={styles.brandRow}><WaveMark compact /><View><Text style={[styles.brandSmall, { color: theme.colors.text }]}>NUSA</Text><Text style={[styles.mode, { color: theme.colors.textMuted }]}>AI 투자 플랫폼 · PAPER</Text></View></View>
        <View style={styles.livePill}><View style={styles.liveDot} /><Text style={styles.liveText}>{status?.stale ? "확인 중" : "실시간"}</Text></View>
      </View>
      {activeTab === "Portfolio" ? <PortfolioView error={error} onRefresh={onRefresh} refreshing={refreshing} snapshot={account} /> : activeTab === "Trade" ? <TradingView error={error} marketConnectionState={status?.marketConnectionState ?? "UNKNOWN"} onRefresh={onRefresh} refreshing={refreshing} snapshot={account} stale={status?.stale ?? true} /> : activeTab === "Markets" ? <MarketsView error={error} currentPrice={account?.account.available === false ? null : account?.account.markPrice ?? null} market={CHART_MARKET} marketConnectionState={status?.marketConnectionState ?? "UNKNOWN"} onRefresh={onRefresh} rawCandles={candles} rawMarkets={markets} refreshing={refreshing} repository={watchlistRepository} stale={status?.stale ?? true} /> : activeTab === "More" ? <MoreView error={error} onRefresh={onRefresh} rawOrders={account?.account.orders ?? null} refreshing={refreshing} settingsRepository={settingsRepository} /> : <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#00dfff" />}
      >
        <Text style={[styles.eyebrow, { color: theme.colors.focus }]}>NUSA INTELLIGENCE</Text>
        <Text style={[styles.heading, { color: theme.colors.text }]}>안녕하세요, 트레이더님</Text>
        <Text style={[styles.subtitle, { color: theme.colors.textMuted }]}>AI가 지금 시장을 분석하고 있어요.</Text>
        {error ? <Text style={[styles.error, { color: theme.colors.warning }]}>{error}</Text> : null}

        <View style={styles.heroCard}>
          <View style={styles.heroTop}><View><Text style={styles.heroLabel}>AI 신뢰도</Text><Text style={styles.heroValue}>94%</Text><Text style={styles.heroPositive}>매우 높음</Text></View><WaveMark /></View>
          <View style={styles.heroDivider} />
          <Text style={styles.heroLabel}>내 포트폴리오</Text>
          <Text style={styles.assetValue}>{account ? "₩10,000,000" : "확인 중"}</Text>
          <Text style={styles.heroPositive}>PAPER 자산 · 실거래 아님</Text>
        </View>

        <View style={styles.sectionHeader}><Text style={styles.sectionTitle}>AI 에이전트가 일하고 있어요</Text><Text style={styles.sectionLink}>자세히</Text></View>
        <NusaCard testID="agent-pipeline-card">
          <AgentStep index="01" label="데이터 수집" state={status?.stale ? "진행중" : "완료"} />
          <AgentStep index="02" label="이상 징후 탐지" state="완료" />
          <AgentStep index="03" label="전략 생성" state="진행중" />
          <AgentStep index="04" label="백테스트" state="대기" />
          <AgentStep index="05" label="리스크 검토" state="대기" />
        </NusaCard>

        <Text style={styles.sectionTitle}>오늘의 인사이트</Text>
        <View style={styles.insightGrid}>
          <View style={styles.glassCard}><Text style={styles.cardLabel}>시장 연결</Text><Text style={styles.cardValue}>{status?.marketConnectionState ?? "확인 중"}</Text><Text style={styles.cardMeta}>공개 시장 데이터</Text></View>
          <View style={styles.glassCard}><Text style={styles.cardLabel}>시장 위험</Text><Text style={[styles.cardValue, styles.safeText]}>낮음</Text><Text style={styles.cardMeta}>Fail-closed 적용</Text></View>
        </View>
        <View style={styles.waveInsightCard}><View style={{ flex: 1 }}><Text style={styles.cardLabel}>흐름 감지</Text><Text style={styles.insightTitle}>변동성이 낮은 안정 구간이에요.</Text><Text style={styles.cardMeta}>AI는 전략을 제안하지만 직접 주문하지 않습니다.</Text></View><WaveMark compact /></View>
      </ScrollView>}
      <View style={styles.navigation}>
        {tabs.map((tab) => (
          <Pressable key={tab} testID={`tab-${tab}`} accessibilityLabel={tab} accessibilityRole="button" onPress={() => setActiveTab(tab)} style={[styles.navItem, activeTab === tab && styles.navItemActive]}>
            {tab === "Home" && activeTab === tab ? <WaveMark compact /> : <View style={styles.navGlyph}><Text style={styles.navGlyphText}>{tab === "Home" ? "≈" : tab === "Markets" ? "⌕" : tab === "Trade" ? "↕" : tab === "Portfolio" ? "◔" : "•••"}</Text></View>}
            <Text style={[styles.navLabel, activeTab === tab && styles.navLabelActive]}>{tabLabels[tab]}</Text>
          </Pressable>
        ))}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: theme.container,
  authContent: { flex: 1, justifyContent: "center", padding: 24, gap: 14 },
  header: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 10, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  brandRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  brand: { fontSize: 32, fontWeight: "700", letterSpacing: 8 },
  brandSmall: { fontSize: 18, fontWeight: "700", letterSpacing: 4 },
  mode: { marginTop: 2, fontSize: 11 },
  livePill: { flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderColor: "#203858", backgroundColor: "#0d1b32", paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999 },
  liveDot: { width: 7, height: 7, borderRadius: 999, backgroundColor: "#00e6a7" },
  liveText: { color: "#9eb5d5", fontSize: 11 },
  content: { padding: 20, gap: 14, paddingBottom: 34 },
  eyebrow: { fontSize: 11, letterSpacing: 2.2, fontWeight: "700" },
  heading: { fontSize: 28, fontWeight: "700" },
  subtitle: { marginTop: -6 },
  heroCard: { backgroundColor: "#0d1b32", borderRadius: 24, borderWidth: 1, borderColor: "#203858", padding: 20, gap: 8, shadowColor: "#006eff", shadowOpacity: 0.22, shadowRadius: 24, shadowOffset: { width: 0, height: 10 }, elevation: 7 },
  heroTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  heroLabel: { color: "#8fa6c7", fontSize: 12 },
  heroValue: { color: "#f5f7fa", fontSize: 38, fontWeight: "700", marginTop: 4 },
  heroPositive: { color: "#00e6a7", fontSize: 12, marginTop: 2 },
  assetValue: { color: "#f5f7fa", fontSize: 28, fontWeight: "700", letterSpacing: 0.5 },
  heroDivider: { height: 1, backgroundColor: "#203858", marginVertical: 8 },
  sectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 4 },
  sectionTitle: { color: "#f5f7fa", fontSize: 18, fontWeight: "700" },
  sectionLink: { color: "#62cfff", fontSize: 12 },
  agentStep: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 8 },
  stepIndex: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "#314969", backgroundColor: "#132543" },
  stepIndexActive: { borderColor: "#1a73ff", backgroundColor: "#12366b" },
  stepIndexDone: { borderColor: "#00a67a", backgroundColor: "#0b3a38" },
  stepIndexText: { color: "#d7e6f8", fontSize: 11, fontWeight: "700" },
  stepBody: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  stepLabel: { color: "#e7eef8", fontWeight: "600" },
  stepState: { color: "#7289a8", fontSize: 11, backgroundColor: "#132543", paddingHorizontal: 9, paddingVertical: 5, borderRadius: 999 },
  stepStateActive: { color: "#6cc8ff", backgroundColor: "#12366b" },
  stepStateDone: { color: "#59e8bd", backgroundColor: "#0b3a38" },
  insightGrid: { flexDirection: "row", gap: 10 },
  glassCard: { flex: 1, backgroundColor: "#0d1b32", borderWidth: 1, borderColor: "#203858", borderRadius: 18, padding: 16, gap: 7 },
  cardLabel: { color: "#8fa6c7", fontSize: 11 },
  cardValue: { color: "#5fc9ff", fontSize: 18, fontWeight: "700" },
  safeText: { color: "#00e6a7" },
  cardMeta: { color: "#8198b8", fontSize: 11, lineHeight: 17 },
  insightTitle: { color: "#f5f7fa", fontSize: 16, fontWeight: "600", marginVertical: 6, lineHeight: 23 },
  waveInsightCard: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 20, padding: 18, borderWidth: 1, borderColor: "#203858", backgroundColor: "#0d1b32" },
  waveMark: { position: "relative", justifyContent: "center" },
  waveLine: { position: "absolute", height: 4, left: 0, borderRadius: 999, backgroundColor: "#1a73ff", transform: [{ rotate: "-5deg" }], shadowColor: "#00dfff", shadowOpacity: 0.9, shadowRadius: 8, shadowOffset: { width: 0, height: 0 } },
  error: { backgroundColor: "#35280d", borderColor: "#725313", borderWidth: 1, padding: 12, borderRadius: 12 },
  meta: { color: "#8fa6c7", fontSize: 12 },
  navigation: { flexDirection: "row", borderTopWidth: 1, borderTopColor: "#203858", backgroundColor: "#09172a", paddingTop: 8, paddingBottom: 8, paddingHorizontal: 6 },
  navItem: { flex: 1, alignItems: "center", justifyContent: "center", gap: 3, minHeight: 52, borderRadius: 16 },
  navItemActive: { backgroundColor: "#0d1f3a" },
  navGlyph: { height: 26, alignItems: "center", justifyContent: "center" },
  navGlyphText: { color: "#7f96b5", fontSize: 20 },
  navLabel: { color: "#7f96b5", fontSize: 10 },
  navLabelActive: { color: "#6ecfff", fontWeight: "700" },
});
