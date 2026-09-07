import React, { useMemo, useState } from "react";
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { DataRow, MotionReveal, NusaButton, NusaCard, SectionHeading, StatusChip } from "./components";
import { useTheme } from "./ThemeProvider";
import { buildChartViewModel, formatChartMove, formatChartPrice, latestCandleCloseMs, type ChartInterval, type ChartViewModel } from "./chartViewModel";
import { formatFeedAgeMs } from "./watchlist";
import type { PublicQuotationDiagnostic } from "./upbitPublicQuotationClient";

interface ChartViewProps {
  readonly market: string;
  readonly rawCandles: unknown[] | null;
  readonly currentPrice: number | null;
  readonly changeRate?: number | null;
  readonly marketConnectionState: string;
  readonly stale: boolean;
  readonly error: string | null;
  readonly diagnostic?: PublicQuotationDiagnostic | null;
  readonly refreshing: boolean;
  readonly onRefresh: () => void;
}

function DiagnosticRow({ label, value, testID }: Readonly<{ label: string; value: string; testID: string }>) {
  const { theme } = useTheme();
  return <View style={styles.diagnosticRow} testID={testID}>
    <Text style={[styles.diagnosticLabel, { color: theme.colors.textMuted }]}>{label}</Text>
    <Text style={[styles.diagnosticValue, { color: theme.colors.text }]} selectable>{value}</Text>
  </View>;
}

function NetworkDiagnosticsPanel({ diagnostic }: Readonly<{ diagnostic: PublicQuotationDiagnostic }>) {
  const { theme } = useTheme();
  return <View style={[styles.diagnosticsPanel, { borderColor: theme.colors.border, backgroundColor: theme.colors.surfaceSunken }]} testID="network-diagnostics-panel">
    <Text style={[styles.diagnosticsEyebrow, { color: theme.colors.textMuted }]}>NETWORK DIAGNOSTICS · 진단 전용, 실제 요청/응답 값</Text>
    <DiagnosticRow label="URL" testID="network-diagnostics-url" value={diagnostic.requestUrl} />
    <DiagnosticRow label="METHOD" testID="network-diagnostics-method" value={diagnostic.method} />
    <DiagnosticRow label="STATUS" testID="network-diagnostics-status" value={diagnostic.status == null ? "-" : String(diagnostic.status)} />
    <DiagnosticRow label="USER-AGENT" testID="network-diagnostics-user-agent" value={diagnostic.finalUserAgent ?? "확보되지 않음"} />
    <DiagnosticRow label="UPBIT ERROR" testID="network-diagnostics-upbit-error" value={[diagnostic.responseErrorName, diagnostic.responseErrorMessage].filter(Boolean).join(": ") || "-"} />
    <DiagnosticRow label="CONTENT-TYPE" testID="network-diagnostics-content-type" value={diagnostic.responseContentType ?? "-"} />
    <DiagnosticRow label="TIMESTAMP" testID="network-diagnostics-timestamp" value={diagnostic.timestamp} />
  </View>;
}

const intervals: readonly ChartInterval[] = ["1m", "5m", "15m", "1h"];

function StateCard({ title, message, color, onRetry, testID }: Readonly<{ title: string; message: string; color: string; onRetry?: () => void; testID: string }>) {
  const { theme } = useTheme();
  return <View style={styles.state} testID={testID}><NusaCard><Text style={[styles.stateTitle, { color }]}>{title}</Text><Text style={[styles.stateMessage, { color: theme.colors.textMuted }]}>{message}</Text>{onRetry ? <NusaButton label="다시 불러오기" onPress={onRetry} /> : null}</NusaCard></View>;
}

export function CandlePlot({ model }: Readonly<{ model: ChartViewModel }>) {
  const { theme } = useTheme();
  const maxVolume = Math.max(...model.candles.map((candle) => candle.volume), Number.EPSILON);
  return <View style={[styles.plot, { backgroundColor: theme.colors.surfaceSunken, borderColor: theme.colors.border }]} testID="chart-candles">
    {model.priceLine === null ? null : <View testID="chart-price-line" style={[styles.priceLine, { backgroundColor: theme.colors.warning, top: `${model.priceLine}%` }]} />}
    <View style={styles.candleRow}>{model.bars.map((bar) => <View key={`${bar.openTime}-${bar.interval}`} style={styles.candleColumn} testID="chart-candle">
      <View style={[styles.wick, { backgroundColor: bar.up ? theme.colors.success : theme.colors.danger, top: `${bar.wickTop}%`, height: `${bar.wickHeight}%` }]} />
      <View style={[styles.body, { backgroundColor: bar.up ? theme.colors.success : theme.colors.danger, top: `${bar.bodyTop}%`, height: `${bar.bodyHeight}%` }]} />
      <View style={styles.volumeTrack}><View style={[styles.volumeBar, { backgroundColor: bar.up ? theme.colors.success : theme.colors.danger, height: Math.max(3, (bar.volume / maxVolume) * 42) }]} /></View>
    </View>)}</View>
  </View>;
}

function ChartSummary({ model }: Readonly<{ model: ChartViewModel }>) {
  const { theme } = useTheme();
  const moveColor = model.move === null ? theme.colors.textMuted : model.move >= 0 ? theme.colors.success : theme.colors.danger;
  return <View style={styles.summary} testID="chart-summary">
    <View style={styles.summaryCopy}>
      <Text style={[styles.label, { color: theme.colors.textMuted }]}>CURRENT PRICE</Text>
      <View style={styles.priceRow}>
        <Text style={[styles.current, { color: theme.colors.text }]}>{formatChartPrice(model.currentPrice)}</Text>
        <Text style={[styles.move, { color: moveColor }]} testID="chart-move">{formatChartMove(model.move)}</Text>
      </View>
      <View style={styles.summaryMeta}>
        <Text style={[styles.meta, { color: theme.colors.textMuted }]}>고가 {formatChartPrice(model.high)}</Text>
        <Text style={[styles.meta, { color: theme.colors.textMuted }]}>저가 {formatChartPrice(model.low)}</Text>
      </View>
    </View>
    <View style={[styles.summaryDetails, { borderTopColor: theme.colors.border }]}>
      <DataRow label="거래량" value={model.volume?.toLocaleString("ko-KR") ?? "-"} />
      <Text style={[styles.dataSource, { color: theme.colors.textMuted }]}>UPBIT 공개 시세 · 읽기 전용</Text>
    </View>
  </View>;
}

export function ChartView({ market, rawCandles, currentPrice, changeRate = null, marketConnectionState, stale, error, diagnostic = null, refreshing, onRefresh }: ChartViewProps) {
  const { theme } = useTheme();
  const [interval, setInterval] = useState<ChartInterval>("1m");
  const model = useMemo(() => buildChartViewModel({ market, interval, rawCandles, currentPrice, connectionState: marketConnectionState, stale, changeRate }), [changeRate, currentPrice, interval, market, marketConnectionState, rawCandles, stale]);
  const candleAge = useMemo(() => {
    const latestClose = latestCandleCloseMs(model.candles);
    return latestClose === null ? null : formatFeedAgeMs(latestClose, Date.now());
  }, [model]);

  if (error) return <>
    <StateCard color={theme.colors.danger} message={error} onRetry={onRefresh} testID="chart-error" title="차트를 표시할 수 없습니다" />
    {diagnostic ? <NetworkDiagnosticsPanel diagnostic={diagnostic} /> : null}
  </>;
  if (model.state === "LOADING") return <View style={styles.state} testID="chart-loading"><ActivityIndicator color={theme.colors.primary} /><Text style={[styles.stateTitle, { color: theme.colors.text }]}>차트를 불러오는 중</Text></View>;
  if (model.state === "ERROR") return <StateCard color={theme.colors.warning} message={model.error ?? "Market data is unavailable."} onRetry={onRefresh} testID="chart-error" title="차트 데이터 오류" />;
  if (model.state === "EMPTY") return <StateCard color={theme.colors.text} message="아직 완성된 공개 캔들 데이터가 없습니다." onRetry={onRefresh} testID="chart-empty" title="차트 데이터 없음" />;

  return <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl tintColor={theme.colors.primary} refreshing={refreshing} onRefresh={onRefresh} />} testID="chart-screen">
    <View style={styles.titleRow}>
      <SectionHeading eyebrow="PUBLIC MARKET DATA" title={model.market} description="가격 움직임과 실제 1분 캔들을 확인합니다." />
      <StatusChip label={stale ? "STALE" : "READ ONLY"} tone={stale ? "warning" : "info"} />
    </View>
    <View style={styles.statusRow}><Text accessibilityRole="text" style={[styles.statusText, { color: marketConnectionState === "CONNECTED" ? theme.colors.success : theme.colors.warning }]}>{marketConnectionState === "CONNECTED" ? "시장 온라인" : "시장 대기"}</Text>{candleAge === null ? null : <Text style={[styles.statusText, { color: theme.colors.textMuted }]} testID="chart-freshness">{candleAge} 업데이트</Text>}</View>
    <MotionReveal testID="chart-data-reveal">
      <ChartSummary model={model} />
      <View style={styles.intervalRow} testID="chart-intervals">{intervals.map((value) => <NusaButton key={value} label={value} onPress={() => setInterval(value)} tone={interval === value ? "primary" : "neutral"} testID={`chart-interval-${value}`} />)}</View>
      <NusaCard testID="chart-plot-card">
        <Text style={[styles.plotEyebrow, { color: theme.colors.textMuted }]}>REAL CANDLES</Text>
        <CandlePlot model={model} />
        <Text style={[styles.legend, { color: theme.colors.textMuted }]}>캔들 {model.candles.length}개 · 실제 거래량은 하단에 표시</Text>
      </NusaCard>
    </MotionReveal>
  </ScrollView>;
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingTop: 18, gap: 12, paddingBottom: 32, maxWidth: 1080, width: "100%", alignSelf: "center" },
  state: { flex: 1, justifyContent: "center", padding: 20, gap: 14 },
  stateTitle: { fontSize: 18, fontWeight: "700" },
  stateMessage: { lineHeight: 21, marginBottom: 12, fontSize: 14 },
  titleRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 12 },
  statusRow: { flexDirection: "row", gap: 7, flexWrap: "wrap" },
  statusText: { fontSize: 12, fontWeight: "700" },
  intervalRow: { flexDirection: "row", gap: 7, flexWrap: "wrap", marginTop: 10, marginBottom: 10 },
  summary: { paddingTop: 2, gap: 8 },
  summaryCopy: { minHeight: 96, justifyContent: "center" },
  label: { fontSize: 10, fontWeight: "800", letterSpacing: 1.5 },
  priceRow: { flexDirection: "row", alignItems: "baseline", gap: 10, flexWrap: "wrap", marginTop: 8 },
  current: { fontSize: 38, lineHeight: 44, fontWeight: "800", letterSpacing: -1.5, fontVariant: ["tabular-nums"] },
  move: { fontSize: 15, fontWeight: "700", fontVariant: ["tabular-nums"] },
  summaryMeta: { flexDirection: "row", flexWrap: "wrap", gap: 14, marginTop: 8 },
  meta: { fontSize: 12, fontWeight: "600", fontVariant: ["tabular-nums"] },
  summaryDetails: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 8, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  dataSource: { fontSize: 11, fontWeight: "600" },
  plotEyebrow: { fontSize: 10, fontWeight: "800", letterSpacing: 1.4, marginBottom: 8 },
  plot: { height: 260, position: "relative", overflow: "hidden", borderRadius: 14, padding: 8, borderWidth: 1 },
  candleRow: { flex: 1, flexDirection: "row", alignItems: "stretch", gap: 2, paddingBottom: 32 },
  candleColumn: { flex: 1, position: "relative", minWidth: 3 },
  wick: { position: "absolute", width: 1, left: "50%" },
  body: { position: "absolute", left: "20%", right: "20%", minHeight: 2, borderRadius: 1 },
  volumeTrack: { position: "absolute", left: 0, right: 0, bottom: 0, height: 44, justifyContent: "flex-end" },
  volumeBar: { width: "100%", opacity: 0.55 },
  priceLine: { position: "absolute", left: 0, right: 0, height: 1, zIndex: 2 },
  legend: { fontSize: 12, marginTop: 10 },
  diagnosticsPanel: { marginHorizontal: 20, marginTop: 4, borderWidth: 1, borderRadius: 12, padding: 14, gap: 8 },
  diagnosticsEyebrow: { fontSize: 10, fontWeight: "800", letterSpacing: 1.1, marginBottom: 2 },
  diagnosticRow: { gap: 2 },
  diagnosticLabel: { fontSize: 10, fontWeight: "700", letterSpacing: 0.8 },
  diagnosticValue: { fontSize: 12, lineHeight: 17 },
});
