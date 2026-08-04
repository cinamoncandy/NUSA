import React, { useMemo, useState } from "react";
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { NusaButton, NusaCard } from "./components";
import { useTheme } from "./ThemeProvider";
import { buildChartViewModel, formatChartPrice, type ChartInterval, type ChartViewModel } from "./chartViewModel";

interface ChartViewProps {
  readonly market: string;
  readonly rawCandles: readonly unknown[] | null;
  readonly currentPrice: number | null;
  readonly marketConnectionState: string;
  readonly stale: boolean;
  readonly error: string | null;
  readonly refreshing: boolean;
  readonly onRefresh: () => void;
}

const intervals: readonly ChartInterval[] = ["1m", "5m", "15m", "1h"];

function StateCard({ title, message, color, onRetry, testID }: Readonly<{ title: string; message: string; color: string; onRetry?: () => void; testID: string }>) {
  return <View style={styles.state} testID={testID}><NusaCard><Text style={[styles.stateTitle, { color }]}>{title}</Text><Text style={styles.stateMessage}>{message}</Text>{onRetry ? <NusaButton label="Retry" onPress={onRetry} /> : null}</NusaCard></View>;
}

function CandlePlot({ model }: Readonly<{ model: ChartViewModel }>) {
  const { theme } = useTheme();
  const maxVolume = Math.max(...model.candles.map((candle) => candle.volume), Number.EPSILON);
  return <View style={styles.plot} testID="chart-candles">
    {model.priceLine === null ? null : <View testID="chart-price-line" style={[styles.priceLine, { backgroundColor: theme.colors.warning, top: `${model.priceLine}%` }]} />}
    <View style={styles.candleRow}>{model.bars.map((bar) => <View key={`${bar.openTime}-${bar.interval}`} style={styles.candleColumn} testID="chart-candle">
      <View style={[styles.wick, { backgroundColor: bar.up ? theme.colors.success : theme.colors.danger, top: `${bar.wickTop}%`, height: `${bar.wickHeight}%` }]} />
      <View style={[styles.body, { backgroundColor: bar.up ? theme.colors.success : theme.colors.danger, top: `${bar.bodyTop}%`, height: `${bar.bodyHeight}%` }]} />
      <View style={styles.volumeTrack}><View style={[styles.volumeBar, { backgroundColor: bar.up ? theme.colors.success : theme.colors.danger, height: Math.max(3, (bar.volume / maxVolume) * 42) }]} /></View>
    </View>)}</View></View>;
}

function ChartSummary({ model }: Readonly<{ model: ChartViewModel }>) {
  const { theme } = useTheme();
  return <NusaCard testID="chart-summary"><Text style={[styles.label, { color: theme.colors.textMuted }]}>Verified Upbit Public Data</Text><Text style={[styles.current, { color: theme.colors.text }]}>{formatChartPrice(model.currentPrice)}</Text><View style={styles.metrics}><Text style={[styles.metric, { color: theme.colors.textMuted }]}>High {formatChartPrice(model.high)}</Text><Text style={[styles.metric, { color: theme.colors.textMuted }]}>Low {formatChartPrice(model.low)}</Text><Text style={[styles.metric, { color: theme.colors.textMuted }]}>Volume {model.volume?.toLocaleString("en-US") ?? "-"}</Text></View></NusaCard>;
}

export function ChartView({ market, rawCandles, currentPrice, marketConnectionState, stale, error, refreshing, onRefresh }: ChartViewProps) {
  const { theme } = useTheme();
  const [interval, setInterval] = useState<ChartInterval>("1m");
  const model = useMemo(() => buildChartViewModel({ market, interval, rawCandles, currentPrice, connectionState: marketConnectionState, stale }), [currentPrice, interval, market, marketConnectionState, rawCandles, stale]);
  if (error) return <StateCard color={theme.colors.danger} message={error} onRetry={onRefresh} testID="chart-error" title="Chart unavailable" />;
  if (model.state === "LOADING") return <View style={styles.state} testID="chart-loading"><ActivityIndicator color={theme.colors.primary} /><Text style={[styles.stateTitle, { color: theme.colors.text }]}>Loading chart...</Text></View>;
  if (model.state === "ERROR") return <StateCard color={theme.colors.warning} message={model.error ?? "Market data is unavailable."} onRetry={onRefresh} testID="chart-error" title="Chart unavailable" />;
  if (model.state === "EMPTY") return <StateCard color={theme.colors.text} message="No complete public candles are available yet." onRetry={onRefresh} testID="chart-empty" title="No chart data" />;
  return <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />} testID="chart-screen">
    <View style={styles.titleRow}><View><Text style={[styles.heading, { color: theme.colors.text }]}>Markets</Text><Text style={[styles.market, { color: theme.colors.textMuted }]}>{model.market}</Text></View><View style={[styles.publicPill, { borderColor: theme.colors.success }]}><Text style={[styles.publicText, { color: theme.colors.success }]}>PUBLIC / READ ONLY</Text></View></View>
    <View style={styles.statusRow}><Text style={[styles.status, { color: theme.colors.textMuted }]}>Market {marketConnectionState}</Text><Text style={[styles.status, { color: theme.colors.textMuted }]}>Live Mutation Disabled</Text></View>
    <View style={styles.intervalRow} testID="chart-intervals">{intervals.map((value) => <NusaButton key={value} label={value} onPress={() => setInterval(value)} tone={interval === value ? "primary" : "neutral"} testID={`chart-interval-${value}`} />)}</View>
    <ChartSummary model={model} />
    <NusaCard testID="chart-plot-card"><CandlePlot model={model} /><Text style={[styles.legend, { color: theme.colors.textMuted }]}>Candles: {model.candles.length} · Volume shown below each bar</Text></NusaCard>
  </ScrollView>;
}

const styles = StyleSheet.create({
  content: { padding: 20, gap: 14, paddingBottom: 28 },
  state: { flex: 1, justifyContent: "center", padding: 20, gap: 14 },
  stateTitle: { fontSize: 18, fontWeight: "700" },
  stateMessage: { color: "#cbd5e1", lineHeight: 22, marginBottom: 12 },
  titleRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  heading: { fontSize: 28, fontWeight: "800" },
  market: { marginTop: 3, fontSize: 16 },
  publicPill: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  publicText: { fontSize: 11, fontWeight: "700" },
  statusRow: { flexDirection: "row", justifyContent: "space-between" },
  status: { fontSize: 12 },
  intervalRow: { flexDirection: "row", gap: 8 },
  label: { fontSize: 12, fontWeight: "600", textTransform: "uppercase" },
  current: { fontSize: 30, fontWeight: "800", marginTop: 8 },
  metrics: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginTop: 10 },
  metric: { fontSize: 12 },
  plot: { height: 230, position: "relative", overflow: "hidden" },
  candleRow: { flex: 1, flexDirection: "row", alignItems: "stretch", gap: 2, paddingBottom: 32 },
  candleColumn: { flex: 1, position: "relative", minWidth: 3 },
  wick: { position: "absolute", width: 1, left: "50%" },
  body: { position: "absolute", left: "20%", right: "20%", minHeight: 2, borderRadius: 1 },
  volumeTrack: { position: "absolute", left: 0, right: 0, bottom: 0, height: 44, justifyContent: "flex-end" },
  volumeBar: { width: "100%", opacity: 0.55 },
  priceLine: { position: "absolute", left: 0, right: 0, height: 1, zIndex: 2 },
  legend: { fontSize: 12, marginTop: 10 },
});
