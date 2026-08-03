import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { NusaButton, NusaCard, NusaTextField } from "./components";
import { useTheme } from "./ThemeProvider";
import { buildWatchlistViewModel, type WatchlistMarket, type WatchlistRepository, type WatchlistSort } from "./watchlist";

interface WatchlistViewProps {
  readonly repository: WatchlistRepository;
  readonly rawMarkets: unknown[] | null;
  readonly error: string | null;
  readonly refreshing: boolean;
  readonly onRefresh: () => void;
}

const sorts: readonly WatchlistSort[] = ["MARKET", "PRICE", "CHANGE", "VOLUME"];

function formatPrice(value: number): string { return `KRW ${Math.round(value).toLocaleString("en-US")}`; }
function formatChange(value: number | null): string { return value === null ? "-" : `${value >= 0 ? "+" : ""}${(value * 100).toFixed(2)}%`; }
function formatVolume(value: number | null): string { return value === null ? "-" : value.toLocaleString("en-US"); }

function MarketRow({ market, active, onToggle }: Readonly<{ market: WatchlistMarket; active: boolean; onToggle: () => void }>) {
  const { theme } = useTheme();
  const changeColor = market.changeRate === null ? theme.colors.textMuted : market.changeRate >= 0 ? theme.colors.success : theme.colors.danger;
  return <NusaCard testID={`watchlist-market-${market.market}`}><View style={styles.rowHeader}><View><Text style={[styles.market, { color: theme.colors.text }]}>{market.market}</Text><Text style={[styles.meta, { color: theme.colors.textMuted }]}>Upbit Public Ticker</Text></View><NusaButton label={active ? "Remove" : "Add"} onPress={onToggle} tone={active ? "danger" : "primary"} testID={`watchlist-toggle-${market.market}`} /></View><View style={styles.metrics}><Text style={[styles.price, { color: theme.colors.text }]}>{formatPrice(market.price)}</Text><Text style={[styles.metric, { color: changeColor }]}>Change {formatChange(market.changeRate)}</Text><Text style={[styles.metric, { color: theme.colors.textMuted }]}>Volume {formatVolume(market.volume)}</Text></View></NusaCard>;
}

export function WatchlistView({ repository, rawMarkets, error, refreshing, onRefresh }: WatchlistViewProps) {
  const { theme } = useTheme();
  const [savedMarkets, setSavedMarkets] = useState<readonly string[] | null>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<WatchlistSort>("MARKET");
  const [storageError, setStorageError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void repository.load().then((markets) => { if (active) setSavedMarkets(markets); }).catch((loadError) => { if (active) setStorageError(loadError instanceof Error ? loadError.message : "Watchlist storage is unavailable."); });
    return () => { active = false; };
  }, [repository]);

  const model = useMemo(() => buildWatchlistViewModel({ rawMarkets, watchlist: savedMarkets, query, sort }), [query, rawMarkets, savedMarkets, sort]);
  const toggle = async (market: string): Promise<void> => {
    try { setStorageError(null); setSavedMarkets(await (savedMarkets?.includes(market) ? repository.remove(market) : repository.add(market))); } catch (toggleError) { setStorageError(toggleError instanceof Error ? toggleError.message : "Watchlist storage is unavailable."); }
  };

  if (error) return <View style={styles.state} testID="watchlist-error"><NusaCard><Text style={[styles.stateTitle, { color: theme.colors.danger }]}>Watchlist unavailable</Text><Text style={[styles.message, { color: theme.colors.textMuted }]}>{error}</Text><NusaButton label="Retry" onPress={onRefresh} /></NusaCard></View>;
  if (storageError) return <View style={styles.state} testID="watchlist-storage-error"><NusaCard><Text style={[styles.stateTitle, { color: theme.colors.danger }]}>Watchlist storage unavailable</Text><Text style={[styles.message, { color: theme.colors.textMuted }]}>{storageError}</Text><NusaButton label="Retry" onPress={() => { setStorageError(null); void repository.load().then(setSavedMarkets).catch((loadError) => setStorageError(loadError instanceof Error ? loadError.message : "Watchlist storage is unavailable.")); }} /></NusaCard></View>;
  if (model.state === "LOADING") return <View style={styles.state} testID="watchlist-loading"><ActivityIndicator color={theme.colors.primary} /><Text style={[styles.stateTitle, { color: theme.colors.text }]}>Loading watchlist...</Text></View>;
  if (model.state === "ERROR") return <View style={styles.state} testID="watchlist-error"><NusaCard><Text style={[styles.stateTitle, { color: theme.colors.danger }]}>Market data invalid</Text><Text style={[styles.message, { color: theme.colors.textMuted }]}>{model.error}</Text></NusaCard></View>;
  if (model.state === "EMPTY") return <View style={styles.state} testID="watchlist-empty"><NusaCard><Text style={[styles.stateTitle, { color: theme.colors.text }]}>No public markets</Text><Text style={[styles.message, { color: theme.colors.textMuted }]}>Verified Upbit public data is required before searching or saving a market.</Text><NusaButton label="Retry" onPress={onRefresh} /></NusaCard></View>;

  return <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />} testID="watchlist-screen">
    <View style={styles.titleRow}><View><Text style={[styles.heading, { color: theme.colors.text }]}>Watchlist</Text><Text style={[styles.meta, { color: theme.colors.textMuted }]}>Upbit Public Data</Text></View><View style={[styles.readOnly, { borderColor: theme.colors.success }]}><Text style={[styles.readOnlyText, { color: theme.colors.success }]}>READ ONLY</Text></View></View>
    <NusaTextField label="Search markets" value={query} onChangeText={setQuery} placeholder="Search KRW-BTC" testID="watchlist-search" />
    <View style={styles.sortRow} testID="watchlist-sort">{sorts.map((value) => <NusaButton key={value} label={value} onPress={() => setSort(value)} tone={sort === value ? "primary" : "neutral"} testID={`watchlist-sort-${value}`} />)}</View>
    <Text style={[styles.section, { color: theme.colors.text }]}>Saved markets</Text>
    {model.activeMarkets.length === 0 ? <NusaCard testID="watchlist-saved-empty"><Text style={[styles.message, { color: theme.colors.textMuted }]}>No saved markets.</Text></NusaCard> : model.activeMarkets.map((market) => <MarketRow key={`saved-${market.market}`} active market={market} onToggle={() => void toggle(market.market)} />)}
    <Text style={[styles.section, { color: theme.colors.text }]}>Search results</Text>
    {model.searchResults.length === 0 ? <NusaCard testID="watchlist-search-empty"><Text style={[styles.message, { color: theme.colors.textMuted }]}>No matching public market.</Text></NusaCard> : model.searchResults.map((market) => <MarketRow key={`result-${market.market}`} active={model.watchlist.includes(market.market)} market={market} onToggle={() => void toggle(market.market)} />)}
  </ScrollView>;
}

const styles = StyleSheet.create({
  content: { padding: 20, gap: 14, paddingBottom: 28 },
  state: { flex: 1, justifyContent: "center", padding: 20, gap: 14 },
  stateTitle: { fontSize: 18, fontWeight: "700" },
  message: { lineHeight: 22, marginTop: 8 },
  titleRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  heading: { fontSize: 28, fontWeight: "800" },
  readOnly: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  readOnlyText: { fontSize: 11, fontWeight: "700" },
  meta: { fontSize: 12, marginTop: 4 },
  sortRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  section: { fontSize: 18, fontWeight: "700", marginTop: 4 },
  rowHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  market: { fontSize: 20, fontWeight: "700" },
  metrics: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginTop: 14 },
  price: { fontSize: 18, fontWeight: "700" },
  metric: { fontSize: 13, marginTop: 3 },
});
