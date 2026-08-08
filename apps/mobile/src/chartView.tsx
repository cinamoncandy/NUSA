import React, { useMemo, useState } from "react";
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { DataRow, NusaButton, NusaCard, SectionHeading, StatusChip } from "./components";
import { useTheme } from "./ThemeProvider";
import { buildChartViewModel, formatChartPrice, type ChartInterval, type ChartViewModel } from "./chartViewModel";

interface ChartViewProps {
  readonly market: string;
  readonly rawCandles: unknown[] | null;
  readonly currentPrice: number | null;
  readonly marketConnectionState: string;
  readonly stale: boolean;
  readonly error: string | null;
  readonly refreshing: boolean;
  readonly onRefresh: () => void;
}

const intervals: readonly ChartInterval[] = ["1m", "5m", "15m", "1h"];

function StateCard({ title, message, color, onRetry, testID }: Readonly<{ title: string; message: string; color: string; onRetry?: () => void; testID: string }>) {
  const { theme } = useTheme();
  return <View style={styles.state} testID={testID}><NusaCard><Text style={[styles.stateTitle, { color }]}>{title}</Text><Text style={[styles.stateMessage, { color: theme.colors.textMuted }]}>{message}</Text>{onRetry ? <NusaButton label="다시 불러오기" onPress={onRetry} /> : null}</NusaCard></View>;
}

function CandlePlot({ model }: Readonly<{ model: ChartViewModel }>) {
  const { theme } = useTheme();
  const maxVolume = Math.max(...model.candles.map((candle) => candle.volume), Number.EPSILON);
  return <View style={[styles.plot, { backgroundColor: theme.colors.surfaceSunken }]} testID="chart-candles">
    {model.priceLine === null ? null : <View testID="chart-price-line" style={[styles.priceLine, { backgroundColor: theme.colors.warning, top: `${model.priceLine}%` }]} />}
    <View style={styles.candleRow}>{model.bars.map((bar) => <View key={`${bar.openTime}-${bar.interval}`} style={styles.candleColumn} testID="chart-candle">
      <View style={[styles.wick, { backgroundColor: bar.up ? theme.colors.success : theme.colors.danger, top: `${bar.wickTop}%`, height: `${bar.wickHeight}%` }]} />
      <View style={[styles.body, { backgroundColor: bar.up ? theme.colors.success : theme.colors.danger, top: `${bar.bodyTop}%`, height: `${bar.bodyHeight}%` }]} />
      <View style={styles.volumeTrack}><View style={[styles.volumeBar, { backgroundColor: bar.up ? theme.colors.success : theme.colors.danger, height: Math.max(3, (bar.volume / maxVolume) * 42) }]} /></View>
    </View>)}</View></View>;
}

function ChartSummary({ model }: Readonly<{ model: ChartViewModel }>) {
  const { theme } = useTheme();
  return <NusaCard testID="chart-summary" raised><Text style={[styles.label, { color: theme.colors.textMuted }]}>UPBIT 공개 시세</Text><Text style={[styles.current, { color: theme.colors.text }]}>{formatChartPrice(model.currentPrice)}</Text><View style={[styles.divider, { backgroundColor: theme.colors.border }]} /><DataRow label="고가" value={formatChartPrice(model.high)} /><DataRow label="저가" value={formatChartPrice(model.low)} /><DataRow label="거래량" value={model.volume?.toLocaleString("ko-KR") ?? "-"} /></NusaCard>;
}

export function ChartView({ market, rawCandles, currentPrice, marketConnectionState, stale, error, refreshing, onRefresh }: ChartViewProps) {
  const { theme } = useTheme();
  const [interval, setInterval] = useState<ChartInterval>("1m");
  const model = useMemo(() => buildChartViewModel({ market, interval, rawCandles, currentPrice, connectionState: marketConnectionState, stale }), [currentPrice, interval, market, marketConnectionState, rawCandles, stale]);
  if (error) return <StateCard color={theme.colors.danger} message={error} onRetry={onRefresh} testID="chart-error" title="차트를 표시할 수 없습니다" />;
  if (model.state === "LOADING") return <View style={styles.state} testID="chart-loading"><ActivityIndicator color={theme.colors.primary} /><Text style={[styles.stateTitle, { color: theme.colors.text }]}>차트를 불러오는 중</Text></View>;
  if (model.state === "ERROR") return <StateCard color={theme.colors.warning} message={model.error ?? "Market data is unavailable."} onRetry={onRefresh} testID="chart-error" title="차트 데이터 오류" />;
  if (model.state === "EMPTY") return <StateCard color={theme.colors.text} message="아직 완성된 공개 캔들 데이터가 없습니다." onRetry={onRefresh} testID="chart-empty" title="차트 데이터 없음" />;
  return <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl tintColor={theme.colors.primary} refreshing={refreshing} onRefresh={onRefresh} />} testID="chart-screen">
    <View style={styles.titleRow}><SectionHeading eyebrow="PUBLIC MARKET DATA" title="시장 차트" description={model.market} /><StatusChip label="PUBLIC / READ ONLY" tone="info" /></View>
    <View style={styles.statusRow}><StatusChip label={marketConnectionState === "CONNECTED" ? "시장 온라인" : "시장 대기"} tone={marketConnectionState === "CONNECTED" ? "success" : "warning"} /><StatusChip label={stale ? "데이터 점검" : "최신"} tone={stale ? "warning" : "success"} /></View>
    <View style={styles.intervalRow} testID="chart-intervals">{intervals.map((value) => <NusaButton key={value} label={value} onPress={() => setInterval(value)} tone={interval === value ? "primary" : "neutral"} testID={`chart-interval-${value}`} />)}</View>
    <ChartSummary model={model} />
    <NusaCard testID="chart-plot-card"><CandlePlot model={model} /><Text style={[styles.legend, { color: theme.colors.textMuted }]}>캔들 {model.candles.length}개 · 각 막대 아래 거래량 표시</Text></NusaCard>
  </ScrollView>;
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingTop: 18, gap: 14, paddingBottom: 32 },
  state: { flex: 1, justifyContent: "center", padding: 20, gap: 14 },
  stateTitle: { fontSize: 18, fontWeight: "700" },
  stateMessage: { lineHeight: 21, marginBottom: 12, fontSize: 14 },
  titleRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 12 },
  statusRow: { flexDirection: "row", gap: 7, flexWrap: "wrap" },
  intervalRow: { flexDirection: "row", gap: 7, flexWrap: "wrap" },
  label: { fontSize: 11, fontWeight: "700", letterSpacing: 0.7 },
  current: { fontSize: 32, fontWeight: "800", letterSpacing: -1, marginTop: 8 },
  divider: { height: 1, marginVertical: 12 },
  plot: { height: 230, position: "relative", overflow: "hidden", borderRadius: 10, padding: 8 },
  candleRow: { flex: 1, flexDirection: "row", alignItems: "stretch", gap: 2, paddingBottom: 32 },
  candleColumn: { flex: 1, position: "relative", minWidth: 3 },
  wick: { position: "absolute", width: 1, left: "50%" },
  body: { position: "absolute", left: "20%", right: "20%", minHeight: 2, borderRadius: 1 },
  volumeTrack: { position: "absolute", left: 0, right: 0, bottom: 0, height: 44, justifyContent: "flex-end" },
  volumeBar: { width: "100%", opacity: 0.55 },
  priceLine: { position: "absolute", left: 0, right: 0, height: 1, zIndex: 2 },
  legend: { fontSize: 12, marginTop: 10 },
});
