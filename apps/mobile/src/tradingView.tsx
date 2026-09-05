import React, { useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { StatusChip } from "./components";
import { useTheme } from "./ThemeProvider";
import { buildChartViewModel, type PublicCandle } from "./chartViewModel";
import { InMemoryDashboardCredentialSession } from "./dashboardCredentialSession";
import { getConfiguredPaperEndpoint, isPaperConnectionVerified } from "./paperConnectionSession";
import { loadUpbitPublicCandles, loadUpbitPublicMarkets } from "./upbitPublicQuotationClient";
import { TradingView as LegacyTradingView } from "./tradingViewLegacy";

const TRADE_PUBLIC_MARKET = "KRW-BTC";
const PUBLIC_REFRESH_INTERVAL_MS = 10_000;
type TradingViewProps = React.ComponentProps<typeof LegacyTradingView>;

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
          setMarkPrice(selected.price);
          setPriceError(null);
        } else {
          setMarkPrice(null);
          setPriceError("KRW-BTC 공개 시세를 아직 받지 못했습니다.");
        }
      } else {
        setPriceError(tickerResult.reason instanceof Error ? tickerResult.reason.message : "Upbit 공개 시세를 불러올 수 없습니다.");
      }

      if (candleResult.status === "fulfilled") {
        setCandles(candleResult.value);
        setChartError(null);
      } else {
        setChartError(candleResult.reason instanceof Error ? candleResult.reason.message : "Upbit 공개 캔들을 불러올 수 없습니다.");
      }
    };

    void refreshTradePublicMarket();
    const timer = setInterval(() => { void refreshTradePublicMarket(); }, PUBLIC_REFRESH_INTERVAL_MS);
    return () => { active = false; clearInterval(timer); };
  }, []);

  const chartModel = buildChartViewModel({
    market: TRADE_PUBLIC_MARKET,
    interval: "1m",
    rawCandles: candles ? [...candles] : null,
    currentPrice: markPrice,
    connectionState: markPrice != null ? "CONNECTED" : "UNKNOWN",
    stale: markPrice == null,
  });
  const chartBars = chartModel.bars.slice(-60);

  return <View style={[styles.marketPanel, { borderColor: theme.colors.border, backgroundColor: theme.colors.surfaceSunken }]} testID="paper-upbit-market-panel">
    <View style={styles.panelHeader}>
      <View>
        <Text style={[styles.stepLabel, { color: theme.colors.textMuted }]}>UPBIT PUBLIC MARKET</Text>
        <Text style={[styles.panelTitle, { color: theme.colors.text }]}>KRW-BTC 1분 차트</Text>
      </View>
      <StatusChip label={chartModel.state === "READY" ? "차트 LIVE" : "차트 대기"} tone={chartModel.state === "READY" ? "success" : "warning"} />
    </View>
    {chartModel.state === "READY" ? <View style={styles.miniChart} testID="paper-upbit-chart">
      {chartBars.map((bar) => <View key={bar.openTime} style={styles.chartColumn}>
        <View style={[styles.chartWick, { backgroundColor: bar.up ? theme.colors.success : theme.colors.danger, top: `${bar.wickTop}%`, height: `${bar.wickHeight}%` }]} />
        <View style={[styles.chartBody, { backgroundColor: bar.up ? theme.colors.success : theme.colors.danger, top: `${bar.bodyTop}%`, height: `${bar.bodyHeight}%` }]} />
      </View>)}
    </View> : <Text style={[styles.stateText, { color: theme.colors.textMuted }]}>{chartError ?? chartModel.error ?? "Upbit 1분 캔들을 기다리고 있습니다."}</Text>}
    {priceError ? <Text style={[styles.stateText, { color: theme.colors.warning }]}>{priceError}</Text> : null}
    <Text style={[styles.sourceText, { color: theme.colors.textMuted }]}>Upbit 공개 시세 · 읽기 전용 · PAPER 실행 경로와 독립</Text>
  </View>;
}

export function TradingView(props: TradingViewProps & { readonly credentialSession?: InMemoryDashboardCredentialSession }) {
  const { theme } = useTheme();
  const fallbackSession = useMemo(() => new InMemoryDashboardCredentialSession(), []);
  // Prefer the App-owned session so the cloud/legacy branch matches the
  // verified session elsewhere; the fallback preserves standalone usage.
  const credentialSession = props.credentialSession ?? fallbackSession;
  const configuredEndpoint = getConfiguredPaperEndpoint();
  const cloudPaperConnected = Boolean(
    configuredEndpoint
    && credentialSession.isConfigured()
    && isPaperConnectionVerified(configuredEndpoint),
  );

  if (!cloudPaperConnected) return <LegacyTradingView {...props} />;

  return <View style={[styles.screen, { backgroundColor: theme.colors.background }]} testID="trading-cloud-chart-shell">
    <CloudPaperPublicChart />
    <View style={styles.legacyWorkspace}><LegacyTradingView {...props} /></View>
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, width: "100%" },
  legacyWorkspace: { flex: 1, minHeight: 0 },
  marketPanel: { borderWidth: 1, borderRadius: 18, padding: 16, gap: 12, marginHorizontal: 20, marginTop: 12 },
  panelHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 12 },
  stepLabel: { fontSize: 10, lineHeight: 15, fontWeight: "800", letterSpacing: 1.15 },
  panelTitle: { marginTop: 4, fontSize: 18, lineHeight: 24, fontWeight: "800" },
  miniChart: { height: 180, flexDirection: "row", alignItems: "stretch", gap: 1, overflow: "hidden", position: "relative" },
  chartColumn: { flex: 1, minWidth: 2, position: "relative" },
  chartWick: { position: "absolute", left: "50%", width: 1 },
  chartBody: { position: "absolute", left: "15%", right: "15%", minHeight: 2 },
  stateText: { fontSize: 12, lineHeight: 18 },
  sourceText: { fontSize: 10, lineHeight: 15, fontWeight: "600" },
});
