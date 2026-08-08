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
import { ThemeProvider, useTheme } from "./src/ThemeProvider";
import { PortfolioView } from "./src/portfolioView";
import { TradingView } from "./src/tradingView";
import { MarketsView } from "./src/marketsView";
import { WatchlistRepository } from "./src/watchlist";
import { MoreView } from "./src/moreView";
import type { SettingsRepository } from "./src/settings";
import { VersionedSettingsRepository } from "./src/persistenceRepositories";
import { InMemoryDashboardCredentialSession } from "./src/dashboardCredentialSession";
import { loadPersonalPaperOperations, type PersonalPaperOperationsLoadResult } from "./src/personalPaperOperationsClient";

const BASE_URL = process.env.EXPO_PUBLIC_NUSA_MONITOR_URL ?? "http://127.0.0.1:41731";
const AUTH_MODE = process.env.EXPO_PUBLIC_NUSA_AUTH_MODE ?? "foundation";
const tabs = [
  { key: "Home", label: "홈", glyph: "⌁" },
  { key: "Markets", label: "시장", glyph: "◫" },
  { key: "Trade", label: "거래", glyph: "⇄" },
  { key: "Portfolio", label: "자산", glyph: "◒" },
  { key: "More", label: "더보기", glyph: "•••" },
] as const;
const appTheme = { container: { flex: 1 } } as const;
type Tab = (typeof tabs)[number]["key"];
const CHART_MARKET = "KRW-BTC";

function krw(value: number): string {
  return `₩${Math.round(value).toLocaleString("ko-KR")}`;
}

function healthTone(health: string | undefined): "success" | "warning" | "danger" {
  return health === "HEALTHY" || health === "READY" ? "success" : health === "FAIL_CLOSED" || health === "DOWN" ? "danger" : "warning";
}

export default function App() {
  return <ThemeProvider initialMode="dark"><AuthContextProvider><AuthenticatedApp /></AuthContextProvider></ThemeProvider>;
}

function AuthContextProvider({ children }: Readonly<{ children: React.ReactNode }>) {
  const [status, setStatus] = useState<AuthStatus>("CHECKING");
  const value = useMemo(() => ({ status, signIn: () => setStatus("SIGNED_IN"), signOut: () => setStatus("SIGNED_OUT") }), [status]);
  useEffect(() => { const timer = setTimeout(() => setStatus("SIGNED_OUT"), 250); return () => clearTimeout(timer); }, []);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

function AuthenticatedApp() {
  const { status: authStatus, signIn } = useAuth();
  const { theme } = useTheme();
  const [activeTab, setActiveTab] = useState<Tab>("Home");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [dashboardTokenDraft, setDashboardTokenDraft] = useState("");
  const [operations, setOperations] = useState<PersonalPaperOperationsLoadResult>({ status: "NOT_CONFIGURED", reason: "Secure dashboard credential is not configured." });
  const [refreshing, setRefreshing] = useState(false);
  const credentialSession = useMemo(() => new InMemoryDashboardCredentialSession(), []);
  const watchlistRepository = useMemo(() => new WatchlistRepository(AsyncStorage), []);
  const settingsRepository = useMemo<SettingsRepository>(() => new VersionedSettingsRepository(AsyncStorage), []);

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

  useEffect(() => { void refresh(); const timer = setInterval(() => void refresh(), 5000); return () => clearInterval(timer); }, [refresh]);
  const onRefresh = useCallback(async () => { setRefreshing(true); await refresh(); setRefreshing(false); }, [refresh]);

  if (authStatus === "CHECKING") return <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]}><View style={styles.authContent}><WaveMark /><Text style={[styles.brand, { color: theme.colors.text }]}>NUSA</Text><Text style={[styles.authHeading, { color: theme.colors.text }]}>보안 상태 확인 중</Text></View></SafeAreaView>;

  if (authStatus !== "SIGNED_IN") {
    return <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]}><View style={styles.authContent}>
      <View style={styles.authBrand}><WaveMark /><View><Text style={[styles.brand, { color: theme.colors.text }]}>NUSA</Text><Text style={[styles.eyebrow, { color: theme.colors.primary }]}>PERSONAL INTELLIGENCE</Text></View></View>
      <Text style={[styles.authHeading, { color: theme.colors.text }]}>다시 오신 것을 환영합니다</Text>
      <Text style={[styles.subtitle, { color: theme.colors.textMuted }]}>로컬 인증은 개인 화면 진입용이며, 서버 대시보드 자격 증명과 분리됩니다.</Text>
      <NusaTextField accessibilityLabel="Email" label="이메일" onChangeText={setEmail} placeholder="Email" testID="auth-email" value={email} />
      <NusaTextField accessibilityLabel="Password" label="비밀번호" onChangeText={setPassword} placeholder="Password" secureTextEntry testID="auth-password" value={password} />
      <NusaButton accessibilityLabel="Sign in" label="로그인" onPress={signIn} testID="auth-submit" />
      <Text style={[styles.meta, { color: theme.colors.textMuted }]}>인증 모드: {AUTH_MODE} · 서버 읽기 자격 증명은 로그인 정보에서 추론하거나 저장하지 않습니다.</Text>
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
  const aiConfidence = ai != null && ai.status !== "UNAVAILABLE" ? `${Math.round(ai.confidence * 100)}%` : "-";
  const runtimeTone = healthTone(snapshot?.operations.runtimeState);

  return <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]}>
    <View style={[styles.header, { borderBottomColor: theme.colors.border }]}>
      <View style={styles.headerBrand}><WaveMark compact /><View><Text style={[styles.brand, { color: theme.colors.text }]}>NUSA</Text><Text style={[styles.eyebrow, { color: theme.colors.primary }]}>INTELLIGENCE</Text></View></View>
      <View style={styles.headerStatus}><StatusChip label="PAPER" tone="primary" /><StatusChip label="읽기 전용" tone="info" /></View>
    </View>
    {activeTab === "Portfolio" ? <PortfolioView error={readOnlyError ?? notConfigured} onRefresh={onRefresh} refreshing={refreshing} snapshot={snapshot?.portfolio ?? null} />
      : activeTab === "Trade" ? <TradingView error={readOnlyError ?? notConfigured} marketConnectionState={marketConnectionState} onRefresh={onRefresh} refreshing={refreshing} snapshot={snapshot?.portfolio ?? null} stale={stale} />
      : activeTab === "Markets" ? <MarketsView error={readOnlyError ?? notConfigured} currentPrice={selectedMarket?.price ?? null} market={CHART_MARKET} marketConnectionState={marketConnectionState} onRefresh={onRefresh} rawCandles={null} rawMarkets={snapshot == null ? null : [...snapshot.markets]} refreshing={refreshing} repository={watchlistRepository} stale={stale} />
      : activeTab === "More" ? <MoreView error={readOnlyError ?? notConfigured} onRefresh={onRefresh} rawOrders={snapshot?.orders ?? null} refreshing={refreshing} settingsRepository={settingsRepository} />
      : <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl tintColor={theme.colors.primary} refreshing={refreshing} onRefresh={onRefresh} />} testID="home-screen">
        <SectionHeading eyebrow="PERSONAL PAPER" title="오늘의 운영 상태" description="실제 PAPER 런타임과 읽기 전용 스냅샷만 표시합니다." />
        {readOnlyError ? <View style={[styles.error, { backgroundColor: theme.colors.surfaceSunken, borderColor: theme.colors.danger }]}><Text style={[styles.errorTitle, { color: theme.colors.danger }]}>대시보드 연결 오류</Text><Text style={[styles.meta, { color: theme.colors.textMuted }]}>{readOnlyError}</Text></View> : null}
        {notConfigured ? <NusaCard testID="dashboard-session-card" raised>
          <View style={styles.cardHeader}><View><Text style={[styles.cardEyebrow, { color: theme.colors.primary }]}>READ-ONLY SESSION</Text><Text style={[styles.cardTitle, { color: theme.colors.text }]}>대시보드 연결</Text></View><StatusChip label="메모리 전용" tone="info" /></View>
          <Text style={[styles.notice, { color: theme.colors.textMuted }]}>{notConfigured}</Text>
          <NusaTextField accessibilityLabel="Dashboard credential" label="대시보드 자격 증명" onChangeText={setDashboardTokenDraft} placeholder="로컬 대시보드 토큰 입력" secureTextEntry testID="dashboard-credential" value={dashboardTokenDraft} />
          <NusaButton accessibilityLabel="Connect read only" label="읽기 전용으로 연결" onPress={() => { void connectReadOnly(); }} testID="dashboard-connect" />
          <Text style={[styles.meta, { color: theme.colors.textMuted }]}>자격 증명은 프로세스 메모리에만 유지되며 연결 해제 또는 앱 재시작 시 사라집니다.</Text>
        </NusaCard> : null}
        {snapshot ? <>
          <NusaCard testID="account-hero-card" raised>
            <View style={styles.heroTop}><View><Text style={[styles.cardEyebrow, { color: theme.colors.textMuted }]}>PAPER EQUITY</Text><Text style={[styles.heroValue, { color: theme.colors.text }]}>{account ? krw(account.equity) : "포트폴리오 없음"}</Text></View><StatusChip label={snapshot.operations.runtimeState} tone={runtimeTone} /></View>
            {totalPnl != null ? <Text style={[styles.heroPnl, { color: totalPnl >= 0 ? theme.colors.success : theme.colors.danger }]}>{totalPnl >= 0 ? "+" : ""}{krw(totalPnl)} 누적 손익</Text> : <Text style={[styles.meta, { color: theme.colors.textMuted }]}>계좌 평가 정보가 아직 없습니다.</Text>}
            <View style={[styles.divider, { backgroundColor: theme.colors.border }]} />
            <DataRow label="시장 전송 상태" value={snapshot.operations.transport === "ONLINE" ? "온라인" : "오프라인"} tone={snapshot.operations.transport === "ONLINE" ? "success" : "warning"} />
            <DataRow label="PAPER 운영 준비" value={snapshot.readyForPaperOperations ? "준비됨" : "대기/차단"} tone={snapshot.readyForPaperOperations ? "success" : "warning"} />
          </NusaCard>
          <AuthorityBanner />
          <NusaCard testID="ai-card">
            <View style={styles.cardHeader}><View><Text style={[styles.cardEyebrow, { color: theme.colors.info }]}>AI READ-ONLY</Text><Text style={[styles.cardTitle, { color: theme.colors.text }]}>AI 인텔리전스</Text></View><StatusChip label={ai?.status ?? "UNAVAILABLE"} tone={ai?.status === "AVAILABLE" ? "success" : ai?.status === "INCOMPLETE" ? "warning" : "neutral"} /></View>
            <Text style={[styles.aiThesis, { color: ai?.thesis ? theme.colors.text : theme.colors.textMuted }]}>{ai?.thesis ?? "현재 표시할 AI 분석이 없습니다."}</Text>
            <DataRow label="신뢰도" value={aiConfidence} />
            <DataRow label="모델" value={ai?.modelVersion ?? "-"} />
            <DataRow label="비판 심각도" value={ai?.criticSeverity ?? "-"} tone={ai?.criticSeverity === "critical" || ai?.criticSeverity === "high" ? "danger" : ai?.criticSeverity === "medium" ? "warning" : "default"} />
          </NusaCard>
          <NusaCard testID="operations-card"><View style={styles.cardHeader}><Text style={[styles.cardTitle, { color: theme.colors.text }]}>운영</Text><StatusChip label={snapshot.operations.runtimeState} tone={runtimeTone} /></View><DataRow label="전송" value={snapshot.operations.transport} /><DataRow label="스케줄러" value={snapshot.operations.schedulerMode} /><DataRow label="대기 쓰기" value={String(snapshot.operations.pendingWrites)} tone={snapshot.operations.pendingWrites > 0 ? "warning" : "default"} /></NusaCard>
          <NusaCard testID="research-card"><View style={styles.cardHeader}><Text style={[styles.cardTitle, { color: theme.colors.text }]}>리서치</Text><StatusChip label={snapshot.research?.health ?? "UNAVAILABLE"} tone={healthTone(snapshot.research?.health)} /></View><DataRow label="Champion" value={snapshot.research?.champion.strategyId ?? "-"} /><DataRow label="Champion 권한" value={snapshot.research?.champion.authority ?? "-"} /><DataRow label="Challenger" value={snapshot.research?.challenger.strategyId ?? "-"} /><DataRow label="Challenger 권한" value={snapshot.research?.challenger.authority ?? "-"} /><DataRow label="후보 수" value={String(snapshot.research?.candidateCount ?? "-")} /></NusaCard>
          <NusaCard testID="safety-card"><View style={styles.cardHeader}><Text style={[styles.cardTitle, { color: theme.colors.text }]}>안전 경계</Text><StatusChip label={snapshot.health} tone={healthTone(snapshot.health)} /></View><DataRow label="킬 스위치" value={snapshot.dashboard.killSwitchActive ? "활성" : "비활성"} tone={snapshot.dashboard.killSwitchActive ? "danger" : "success"} /><DataRow label="LIVE 권한" value={snapshot.liveAuthority} emphasis /><DataRow label="Production mutation" value={snapshot.productionMutationAllowed ? "허용" : "금지"} tone={snapshot.productionMutationAllowed ? "danger" : "success"} /></NusaCard>
          <NusaButton accessibilityLabel="Disconnect read only" label="읽기 전용 연결 해제" onPress={disconnectReadOnly} tone="neutral" testID="dashboard-disconnect" />
        </> : null}
      </ScrollView>}
    <View style={[styles.navigation, { backgroundColor: theme.colors.surfaceSunken, borderTopColor: theme.colors.border }]}>{tabs.map((tab) => {
      const active = activeTab === tab.key;
      return <Pressable key={tab.key} accessibilityLabel={tab.label} accessibilityRole="button" accessibilityState={{ selected: active }} onPress={() => setActiveTab(tab.key)} style={styles.navItem}><View style={[styles.navGlyphWrap, active && { backgroundColor: theme.colors.primarySoft }]}><Text style={[styles.navGlyph, { color: active ? theme.colors.primary : theme.colors.textMuted }]}>{tab.glyph}</Text></View><Text style={[styles.navLabel, { color: active ? theme.colors.text : theme.colors.textMuted }, active && styles.navLabelActive]}>{tab.label}</Text></Pressable>;
    })}</View>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  container: appTheme.container,
  authContent: { flex: 1, justifyContent: "center", padding: 24, gap: 16 },
  authBrand: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 8 },
  header: { minHeight: 68, paddingHorizontal: 20, paddingVertical: 10, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomWidth: 1 },
  headerBrand: { flexDirection: "row", alignItems: "center", gap: 10 },
  headerStatus: { flexDirection: "row", gap: 6, alignItems: "center" },
  brand: { fontSize: 23, fontWeight: "800", letterSpacing: 1.6 },
  eyebrow: { fontSize: 9, fontWeight: "800", letterSpacing: 1.7, marginTop: -1 },
  content: { paddingHorizontal: 20, paddingTop: 18, gap: 14, paddingBottom: 32 },
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
  heroValue: { fontSize: 34, fontWeight: "800", letterSpacing: -1.4, marginTop: 5 },
  heroPnl: { marginTop: 7, fontSize: 15, fontWeight: "700" },
  divider: { height: 1, marginVertical: 14 },
  aiThesis: { fontSize: 16, fontWeight: "600", lineHeight: 24, marginBottom: 10 },
  navigation: { flexDirection: "row", borderTopWidth: 1, paddingTop: 7, paddingBottom: 7 },
  navItem: { flex: 1, minHeight: 54, alignItems: "center", justifyContent: "center", gap: 3 },
  navGlyphWrap: { minWidth: 32, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center", paddingHorizontal: 7 },
  navGlyph: { fontSize: 15, fontWeight: "700" },
  navLabel: { fontSize: 10, fontWeight: "600" },
  navLabelActive: { fontWeight: "800" },
});
