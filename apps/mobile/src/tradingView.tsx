import React, { useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { StatusChip } from "./components";
import { useTheme } from "./ThemeProvider";
import { buildChartViewModel, type PublicCandle } from "./chartViewModel";
import { InMemoryDashboardCredentialSession } from "./dashboardCredentialSession";
import { getConfiguredPaperEndpoint, isPaperConnectionVerified } from "./paperConnectionSession";
import { loadUpbitPublicCandles, loadUpbitPublicMarkets } from "./upbitPublicQuotationClient";
import { TradingView as LegacyTradingView } from "./tradingViewLegacy";
import { AuthorityRail, MetricStrip, ScreenLead, StateNotice } from "./intelligenceOs";

const TRADE_PUBLIC_MARKET = "KRW-BTC";
const PUBLIC_REFRESH_INTERVAL_MS = 10_000;
type TradingViewProps = React.ComponentProps<typeof LegacyTradingView>;

function price(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `₩${Math.round(value).toLocaleString("ko-KR")}`;
}

function CloudPaperPublicChart() {
  const { theme } = useTheme();
  const [markPrice, setMarkPrice] = useState<number | null>(null);
  const [candles, setCandles] = useState<readonly PublicCandle[] | null>(null);
  const [priceError, setPriceError] = useState<string | null>(null);
  const [chartError, setChartError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const refreshTradePublicMarket = async (): Promise<void> => {
      const [tickerResult, candleResult] = await Promise.allSettled([
        loadUpbitPublicMarkets(),
        loadUpbitPublicCandles({ market: TRADE_PUBLIC_MARKET, count: 120 }),
      ]);
      if (!active) return;
      if (tickerResult.status === "fulfilled") {
        const selected = tickerResult.value.find((market) => market.market === TRADE_PUBLIC_MARKET);
        if (selected && Number.isFinite(selected.price) && selected.price > 0) {
          setMarkPrice(selected.price); setPriceError(null);
        } else { setMarkPrice(null); setPriceError("KRW-BTC 공개 시세를 아직 받지 못했습니다."); }
      } else setPriceError(tickerResult.reason instanceof Error ? tickerResult.reason.message : "Upbit 공개 시세를 불러올 수 없습니다.");
      if (candleResult.status === "fulfilled") { setCandles(candleResult.value); setChartError(null); }
      else setChartError(candleResult.reason instanceof Error ? candleResult.reason.message : "Upbit 공개 캔들을 불러올 수 없습니다.");
    };
    void refreshTradePublicMarket();
    const timer = setInterval(() => { void refreshTradePublicMarket(); }, PUBLIC_REFRESH_INTERVAL_MS);
    return () => { active = false; clearInterval(timer); };
  }, []);

  const chartModel = buildChartViewModel({ market: TRADE_PUBLIC_MARKET, interval: "1m", rawCandles: candles ? [...candles] : null, currentPrice: markPrice, connectionState: markPrice != null ? "CONNECTED" : "UNKNOWN", stale: markPrice == null });
  const chartBars = chartModel.bars.slice(-60);

  return <View style={[styles.marketPanel, { borderColor: theme.colors.border, backgroundColor: theme.colors.surface }]} testID="paper-upbit-market-panel">
    <View style={styles.panelHeader}><View><Text style={[styles.stepLabel, { color: theme.colors.info }]}>PUBLIC CONTEXT</Text><Text style={[styles.panelTitle, { color: theme.colors.text }]}>KRW-BTC 1분 관찰</Text></View><StatusChip label={chartModel.state === "READY" ? "FRESH" : "WAITING"} tone={chartModel.state === "READY" ? "success" : "warning"} /></View>
    <MetricStrip items={[{ label: "MARK", value: price(markPrice) }, { label: "SOURCE", value: "UPBIT PUBLIC" }, { label: "AUTHORITY", value: "READ ONLY", tone: "info" }]} />
    {chartModel.state === "READY" ? <View style={styles.miniChart} testID="paper-upbit-chart">{chartBars.map((bar) => <View key={bar.openTime} style={styles.chartColumn}><View style={[styles.chartWick, { backgroundColor: bar.up ? theme.colors.success : theme.colors.danger, top: `${bar.wickTop}%`, height: `${bar.wickHeight}%` }]} /><View style={[styles.chartBody, { backgroundColor: bar.up ? theme.colors.success : theme.colors.danger, top: `${bar.bodyTop}%`, height: `${bar.bodyHeight}%` }]} /></View>)}</View> : <StateNotice title="PUBLIC CHART WAITING" detail={chartError ?? chartModel.error ?? "Upbit 1분 캔들을 기다리고 있습니다."} tone="warning" />}
    {priceError ? <StateNotice title="MARK PRICE UNAVAILABLE" detail={priceError} tone="warning" /> : null}
    <Text style={[styles.sourceText, { color: theme.colors.textMuted }]}>공개 시장 관찰은 PAPER 전략 신호가 아니며 실제 주문 권한을 갖지 않습니다.</Text>
  </View>;
}

export function TradingView(props: TradingViewProps & { readonly credentialSession?: InMemoryDashboardCredentialSession }) {
  const { theme } = useTheme();
  const fallbackSession = useMemo(() => new InMemoryDashboardCredentialSession(), []);
  const credentialSession = props.credentialSession ?? fallbackSession;
  const configuredEndpoint = getConfiguredPaperEndpoint();
  const cloudPaperConnected = Boolean(configuredEndpoint && credentialSession.isConfigured() && isPaperConnectionVerified(configuredEndpoint));

  return <View style={[styles.screen, { backgroundColor: theme.colors.background }]} testID="trading-cloud-chart-shell">
    <View style={styles.top}>
      <AuthorityRail detail="SIMULATED EXECUTION · LIVE NONE · AI ZERO AUTHORITY" status={cloudPaperConnected ? "PAPER CONNECTED" : "LOCAL / DISCONNECTED"} tone={cloudPaperConnected ? "success" : "warning"} testID="paper-authority-rail" />
      <ScreenLead eyebrow="PAPER" title="실행을 감독합니다" detail="전략 판단, 리스크 게이트, 주문, 체결, 회계 결과를 실제 거래와 분리된 PAPER 경로에서 확인합니다." badge="SIMULATION" badgeTone="primary" testID="paper-screen-lead" />
      {!cloudPaperConnected ? <StateNotice title="CLOUD PAPER NOT CONNECTED" detail="Cloud PAPER 세션이 검증되지 않았습니다. 기기 내 PAPER 또는 읽기 전용 상태만 표시될 수 있습니다." tone="warning" /> : null}
    </View>
    {cloudPaperConnected ? <CloudPaperPublicChart /> : null}
    <View style={styles.executionLabel}><Text style={[styles.stepLabel, { color: theme.colors.primary }]}>EXECUTION WORKSPACE</Text><Text style={[styles.executionHint, { color: theme.colors.textMuted }]}>strategy → risk gate → order → fill → accounting</Text></View>
    <View style={styles.legacyWorkspace}><LegacyTradingView {...props} /></View>
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, width: "100%" },
  top: { width: "100%", maxWidth: 680, alignSelf: "center", paddingHorizontal: 20, paddingTop: 14, gap: 14 },
  legacyWorkspace: { flex: 1, minHeight: 0 },
  marketPanel: { borderWidth: 1, borderRadius: 18, padding: 16, gap: 12, marginHorizontal: 20, marginTop: 14, maxWidth: 680, width: "auto", alignSelf: "center" },
  panelHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 12 },
  stepLabel: { fontSize: 9, lineHeight: 13, fontWeight: "900", letterSpacing: 1.15 },
  panelTitle: { marginTop: 4, fontSize: 17, lineHeight: 22, fontWeight: "850" },
  miniChart: { height: 140, flexDirection: "row", alignItems: "stretch", gap: 1, overflow: "hidden", position: "relative" },
  chartColumn: { flex: 1, minWidth: 2, position: "relative" },
  chartWick: { position: "absolute", left: "50%", width: 1 },
  chartBody: { position: "absolute", left: "15%", right: "15%", minHeight: 2 },
  sourceText: { fontSize: 10, lineHeight: 15, fontWeight: "600" },
  executionLabel: { width: "100%", maxWidth: 680, alignSelf: "center", paddingHorizontal: 20, paddingTop: 16, paddingBottom: 6, gap: 3 },
  executionHint: { fontSize: 10, lineHeight: 15, fontWeight: "700" },
});
