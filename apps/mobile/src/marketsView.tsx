import React, { useState } from "react";
import { StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { StatusChip } from "./components";
import { useTheme } from "./ThemeProvider";
import { ChartView } from "./chartView";
import { WatchlistView } from "./watchlistView";
import type { WatchlistRepository } from "./watchlist";
import { InlineNotice, ScreenHeader, SegmentedControl } from "./uxPrimitives";
import { uxLayout } from "./uxLayout";

interface MarketsViewProps { readonly repository: WatchlistRepository; readonly market: string; readonly rawMarkets: unknown[] | null; readonly rawCandles: unknown[] | null; readonly currentPrice: number | null; readonly marketConnectionState: string; readonly stale: boolean; readonly error: string | null; readonly refreshing: boolean; readonly onRefresh: () => void; }
const formatPrice = (value: number | null): string => value == null || !Number.isFinite(value) ? "-" : `₩${Math.round(value).toLocaleString("ko-KR")}`;
const PANELS = Object.freeze([{ key: "WATCHLIST", label: "관심시장" }, { key: "CHART", label: "차트" }]);

export function MarketsView({ repository, market, rawMarkets, rawCandles, currentPrice, marketConnectionState, stale, error, refreshing, onRefresh }: MarketsViewProps) {
  const { theme } = useTheme();
  const { width } = useWindowDimensions();
  const [panel, setPanel] = useState<"WATCHLIST" | "CHART">("CHART");
  const chartAvailable = Array.isArray(rawCandles) && rawCandles.length > 0;
  const wide = width >= 840;
  const visiblePanel = chartAvailable ? panel : "WATCHLIST";
  const connected = marketConnectionState === "CONNECTED";

  return <View style={[styles.workspace, { backgroundColor: theme.colors.background }]} testID="markets-workspace"><View style={styles.content}>
    <ScreenHeader eyebrow="MARKETS" title="시장" description="가격, 차트, 관심시장을 한 작업공간에서 확인합니다." statusLabel={connected ? (stale ? "데이터 점검" : "온라인") : "연결 대기"} statusTone={connected ? (stale ? "warning" : "success") : "warning"} />
    <View style={styles.marketHero} testID="markets-status-card">
      <View style={styles.marketIdentity}><Text style={[styles.marketLabel, { color: theme.colors.textMuted }]}>SELECTED MARKET</Text><Text style={[styles.marketName, { color: theme.colors.text }]}>{market}</Text></View>
      <View style={styles.priceBlock}><Text style={[styles.priceLabel, { color: theme.colors.textMuted }]}>현재 가격</Text><Text style={[styles.priceValue, { color: theme.colors.text }]} adjustsFontSizeToFit numberOfLines={1}>{formatPrice(currentPrice)}</Text></View>
      <View style={styles.statusRow}><StatusChip label={marketConnectionState} tone={connected ? "success" : "warning"} /><StatusChip label={stale ? "신선도 점검" : "최신 데이터"} tone={stale ? "warning" : "success"} />{chartAvailable ? <StatusChip label="차트 준비" tone="info" /> : null}</View>
    </View>
    {!chartAvailable ? <InlineNotice title="차트 데이터가 아직 없습니다" detail="수신되지 않은 캔들 데이터는 임의로 만들지 않습니다. 현재는 관심시장과 연결 상태만 확인할 수 있습니다." tone="info" /> : null}
    {error ? <InlineNotice title="일부 시장 데이터를 불러오지 못했습니다" detail={error} tone="warning" /> : null}
    <View style={[styles.layout, wide && styles.layoutWide]} testID="markets-responsive-layout">
      <View style={[styles.chartColumn, wide && styles.chartColumnWide]}>{chartAvailable ? <ChartView error={error} currentPrice={currentPrice} market={market} marketConnectionState={marketConnectionState} onRefresh={onRefresh} rawCandles={rawCandles} refreshing={refreshing} stale={stale} /> : <View style={[styles.chartPlaceholder, { borderColor: theme.colors.border }]}><Text style={[styles.placeholderLabel, { color: theme.colors.textMuted }]}>CHART UNAVAILABLE</Text><Text style={[styles.placeholderTitle, { color: theme.colors.text }]}>실제 캔들 데이터 대기 중</Text></View>}</View>
      <View style={[styles.watchColumn, wide && styles.watchColumnWide]}>{!wide && chartAvailable ? <View style={styles.panels} testID="markets-panels"><SegmentedControl items={PANELS} selectedKey={visiblePanel} onChange={(key) => setPanel(key as "WATCHLIST" | "CHART")} testID="markets-panel-segmented-control" /></View> : null}<View style={styles.panelBody}>{wide ? <WatchlistView error={error} onRefresh={onRefresh} rawMarkets={rawMarkets} refreshing={refreshing} repository={repository} /> : visiblePanel === "WATCHLIST" ? <WatchlistView error={error} onRefresh={onRefresh} rawMarkets={rawMarkets} refreshing={refreshing} repository={repository} /> : <ChartView error={error} currentPrice={currentPrice} market={market} marketConnectionState={marketConnectionState} onRefresh={onRefresh} rawCandles={rawCandles} refreshing={refreshing} stale={stale} />}</View></View>
    </View>
  </View></View>;
}

const styles = StyleSheet.create({ workspace: { flex: 1, alignItems: "center" }, content: { flex: 1, width: "100%", maxWidth: uxLayout.maxWorkspaceWidth, paddingHorizontal: uxLayout.phoneGutter, paddingTop: 18, gap: 18 }, marketHero: { gap: 12, paddingBottom: 18 }, marketIdentity: { gap: 3 }, marketLabel: { fontSize: 10, fontWeight: "800", letterSpacing: 1.2 }, marketName: { fontSize: 18, lineHeight: 24, fontWeight: "800", letterSpacing: -0.4 }, priceBlock: { gap: 3 }, priceLabel: { fontSize: 11, fontWeight: "700" }, priceValue: { fontSize: 40, lineHeight: 46, fontWeight: "800", letterSpacing: -1.8, fontVariant: ["tabular-nums"] }, statusRow: { flexDirection: "row", flexWrap: "wrap", gap: 7 }, layout: { flex: 1, gap: 14 }, layoutWide: { flexDirection: "row", alignItems: "flex-start" }, chartColumn: { flex: 1, minWidth: 0 }, chartColumnWide: { flexGrow: 1, flexBasis: 620 }, watchColumn: { flex: 1, minWidth: 0 }, watchColumnWide: { width: 320, flexGrow: 0, flexShrink: 0 }, panelBody: { flex: 1, width: "100%" }, panels: { paddingBottom: 10 }, chartPlaceholder: { minHeight: 280, borderTopWidth: 1, borderBottomWidth: 1, justifyContent: "center", paddingVertical: 28 }, placeholderLabel: { fontSize: 10, fontWeight: "800", letterSpacing: 1.2 }, placeholderTitle: { marginTop: 5, fontSize: 18, fontWeight: "800", letterSpacing: -0.4 } });