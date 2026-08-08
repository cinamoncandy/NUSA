import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { NusaButton, NusaCard, NusaTextField, SectionHeading, StatusChip } from "./components";
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
const sortLabels: Readonly<Record<WatchlistSort, string>> = { MARKET: "시장", PRICE: "가격", CHANGE: "등락", VOLUME: "거래량" };

function formatPrice(value: number): string { return `₩${Math.round(value).toLocaleString("ko-KR")}`; }
function formatChange(value: number | null): string { return value === null ? "-" : `${value >= 0 ? "+" : ""}${(value * 100).toFixed(2)}%`; }
function formatVolume(value: number | null): string { return value === null ? "-" : value.toLocaleString("ko-KR"); }

function MarketRow({ market, active, onToggle }: Readonly<{ market: WatchlistMarket; active: boolean; onToggle: () => void }>) {
  const { theme } = useTheme();
  const changeColor = market.changeRate === null ? theme.colors.textMuted : market.changeRate >= 0 ? theme.colors.success : theme.colors.danger;
  return <View style={[styles.marketRow, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]} testID={`watchlist-market-${market.market}`}>
    <View style={styles.marketMain}>
      <View style={styles.marketIdentity}><Text style={[styles.market, { color: theme.colors.text }]}>{market.market}</Text><Text style={[styles.meta, { color: theme.colors.textMuted }]}>PUBLIC · READ ONLY</Text></View>
      <View style={styles.marketNumbers}><Text style={[styles.price, { color: theme.colors.text }]}>{formatPrice(market.price)}</Text><Text style={[styles.change, { color: changeColor }]}>{formatChange(market.changeRate)}</Text></View>
      <Pressable accessibilityLabel={`${market.market} ${active ? "관심시장에서 제거" : "관심시장에 추가"}`} accessibilityRole="button" accessibilityState={{ selected: active }} hitSlop={4} onPress={onToggle} style={[styles.favorite, { backgroundColor: active ? theme.colors.primarySoft : theme.colors.surfaceSunken, borderColor: active ? theme.colors.primary : theme.colors.border }]} testID={`watchlist-toggle-${market.market}`}><Text style={[styles.favoriteGlyph, { color: active ? theme.colors.primary : theme.colors.textMuted }]}>{active ? "★" : "☆"}</Text></Pressable>
    </View>
    <View style={[styles.marketMeta, { borderTopColor: theme.colors.border }]}><Text style={[styles.volumeLabel, { color: theme.colors.textMuted }]}>거래량</Text><Text style={[styles.volume, { color: theme.colors.text }]} numberOfLines={1}>{formatVolume(market.volume)}</Text></View>
  </View>;
}

function SortChip({ value, selected, onPress }: Readonly<{ value: WatchlistSort; selected: boolean; onPress: () => void }>) {
  const { theme } = useTheme();
  return <Pressable accessibilityLabel={`${sortLabels[value]} 기준 정렬`} accessibilityRole="button" accessibilityState={{ selected }} onPress={onPress} style={[styles.sortChip, { backgroundColor: selected ? theme.colors.primarySoft : theme.colors.surfaceSunken, borderColor: selected ? theme.colors.primary : theme.colors.border }]} testID={`watchlist-sort-${value}`}><Text style={[styles.sortLabel, { color: selected ? theme.colors.primary : theme.colors.textMuted }]}>{sortLabels[value]}</Text></Pressable>;
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
    try { setStorageError(null); setSavedMarkets(await (savedMarkets?.includes(market) ? repository.remove(market) : repository.add(market))); } catch (toggleError) { setStorageError(toggleError instanceof Error ? toggleError.message : "Watchlist storage is unavailable."; }
  };

  if (error) return <View style={styles.state} testID="watchlist-error"><NusaCard><Text style={[styles.stateTitle, { color: theme.colors.danger }]}>시장 정보를 표시할 수 없습니다</Text><Text style={[styles.message, { color: theme.colors.textMuted }]}>{error}</Text><NusaButton label="다시 불러오기" onPress={onRefresh} /></NusaCard></View>;
  if (storageError) return <View style={styles.state} testID="watchlist-storage-error"><NusaCard><Text style={[styles.stateTitle, { color: theme.colors.danger }]}>관심시장 저장소 오류</Text><Text style={[styles.message, { color: theme.colors.textMuted }]}>{storageError}</Text><NusaButton label="다시 시도" onPress={() => { setStorageError(null); void repository.load().then(setSavedMarkets).catch((loadError) => setStorageError(loadError instanceof Error ? loadError.message : "Watchlist storage is unavailable.")); }} /></NusaCard></View>;
  if (model.state === "LOADING") return <View style={styles.state} testID="watchlist-loading"><ActivityIndicator color={theme.colors.primary} /><Text style={[styles.stateTitle, { color: theme.colors.text }]}>공개 시세를 불러오는 중</Text></View>;
  if (model.state === "ERROR") return <View style={styles.state} testID="watchlist-error"><NusaCard><Text style={[styles.stateTitle, { color: theme.colors.danger }]}>시장 데이터가 유효하지 않습니다</Text><Text style={[styles.message, { color: theme.colors.textMuted }]}>{model.error}</Text></NusaCard></View>;
  if (model.state === "EMPTY") return <View style={styles.state} testID="watchlist-empty"><NusaCard><Text style={[styles.stateTitle, { color: theme.colors.text }]}>공개 시장 데이터 없음</Text><Text style={[styles.message, { color: theme.colors.textMuted }]}>검증된 Upbit 공개 데이터가 준비되면 검색하고 관심시장에 저장할 수 있습니다.</Text><NusaButton label="다시 불러오기" onPress={onRefresh} /></NusaCard></View>;

  return <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl tintColor={theme.colors.primary} refreshing={refreshing} onRefresh={onRefresh} />} testID="watchlist-screen">
    <View style={styles.titleRow}><SectionHeading eyebrow="PUBLIC MARKET DATA" title="시장" description="공개 시세를 빠르게 비교합니다. 계좌·주문 권한과 연결되지 않습니다." /><StatusChip label="READ ONLY" tone="info" /></View>
    <NusaTextField label="시장 검색" value={query} onChangeText={setQuery} placeholder="예: KRW-BTC" testID="watchlist-search" />
    <View style={styles.sortRow} testID="watchlist-sort">{sorts.map((value) => <SortChip key={value} value={value} selected={sort === value} onPress={() => setSort(value)} />)}</View>
    <View style={styles.sectionHeader}><Text style={[styles.section, { color: theme.colors.text }]}>관심시장</Text><Text style={[styles.sectionCount, { color: theme.colors.textMuted }]}>{model.activeMarkets.length}</Text></View>
    {model.activeMarkets.length === 0 ? <NusaCard testID="watchlist-saved-empty"><Text style={[styles.message, { color: theme.colors.textMuted }]}>☆ 버튼으로 자주 보는 시장을 저장할 수 있습니다.</Text></NusaCard> : <View style={styles.marketList}>{model.activeMarkets.map((market) => <MarketRow key={`saved-${market.market}`} active market={market} onToggle={() => void toggle(market.market)} />)}</View>}
    <View style={styles.sectionHeader}><Text style={[styles.section, { color: theme.colors.text }]}>전체 결과</Text><Text style={[styles.sectionCount, { color: theme.colors.textMuted }]}>{model.searchResults.length}</Text></View>
    {model.searchResults.length === 0 ? <NusaCard testID="watchlist-search-empty"><Text style={[styles.message, { color: theme.colors.textMuted }]}>조건에 맞는 공개 시장이 없습니다.</Text></NusaCard> : <View style={styles.marketList}>{model.searchResults.map((market) => <MarketRow key={`result-${market.market}`} active={model.watchlist.includes(market.market)} market={market} onToggle={() => void toggle(market.market)} />)}</View>}
  </ScrollView>;
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingTop: 18, gap: 14, paddingBottom: 32 },
  state: { flex: 1, justifyContent: "center", padding: 20, gap: 14 },
  stateTitle: { fontSize: 18, fontWeight: "700" },
  message: { lineHeight: 21, fontSize: 14, marginTop: 8 },
  titleRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 12 },
  sortRow: { flexDirection: "row", gap: 7, flexWrap: "wrap" },
  sortChip: { minHeight: 44, minWidth: 62, borderRadius: 12, borderWidth: 1, paddingHorizontal: 13, alignItems: "center", justifyContent: "center" },
  sortLabel: { fontSize: 12, fontWeight: "700" },
  sectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 4 },
  section: { fontSize: 17, fontWeight: "700", letterSpacing: -0.3 },
  sectionCount: { fontSize: 12, fontWeight: "700" },
  marketList: { gap: 8 },
  marketRow: { borderWidth: 1, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12 },
  marketMain: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: 10 },
  marketIdentity: { flex: 1, minWidth: 92 },
  marketNumbers: { alignItems: "flex-end", justifyContent: "center" },
  market: { fontSize: 15, fontWeight: "800" },
  meta: { fontSize: 9, fontWeight: "700", letterSpacing: 0.5, marginTop: 4 },
  price: { fontSize: 17, fontWeight: "800", letterSpacing: -0.4 },
  change: { fontSize: 12, fontWeight: "700", marginTop: 3 },
  favorite: { width: 44, height: 44, borderRadius: 12, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  favoriteGlyph: { fontSize: 22, lineHeight: 24 },
  marketMeta: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderTopWidth: 1, marginTop: 8, paddingTop: 8, gap: 12 },
  volumeLabel: { fontSize: 10, fontWeight: "700" },
  volume: { flex: 1, textAlign: "right", fontSize: 11, fontWeight: "600" },
});