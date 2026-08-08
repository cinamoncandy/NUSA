import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { DataRow, NusaButton, NusaCard, NusaTextField, SectionHeading, StatusChip } from "./components";
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
  const changeTone = market.changeRate === null ? "default" : market.changeRate >= 0 ? "success" : "danger";
  return <NusaCard testID={`watchlist-market-${market.market}`}>
    <View style={styles.rowHeader}><View><Text style={[styles.market, { color: theme.colors.text }]}>{market.market}</Text><Text style={[styles.meta, { color: theme.colors.textMuted }]}>Upbit 공개 시세 · 읽기 전용</Text></View><NusaButton label={active ? "삭제" : "추가"} onPress={onToggle} tone={active ? "neutral" : "primary"} testID={`watchlist-toggle-${market.market}`} /></View>
    <Text style={[styles.price, { color: theme.colors.text }]}>{formatPrice(market.price)}</Text>
    <View style={[styles.divider, { backgroundColor: theme.colors.border }]} />
    <DataRow label="등락률" value={formatChange(market.changeRate)} tone={changeTone} />
    <DataRow label="거래량" value={formatVolume(market.volume)} />
  </NusaCard>;
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

  if (error) return <View style={styles.state} testID="watchlist-error"><NusaCard><Text style={[styles.stateTitle, { color: theme.colors.danger }]}>시장 정보를 표시할 수 없습니다</Text><Text style={[styles.message, { color: theme.colors.textMuted }]}>{error}</Text><NusaButton label="다시 불러오기" onPress={onRefresh} /></NusaCard></View>;
  if (storageError) return <View style={styles.state} testID="watchlist-storage-error"><NusaCard><Text style={[styles.stateTitle, { color: theme.colors.danger }]}>관심시장 저장소 오류</Text><Text style={[styles.message, { color: theme.colors.textMuted }]}>{storageError}</Text><NusaButton label="다시 시도" onPress={() => { setStorageError(null); void repository.load().then(setSavedMarkets).catch((loadError) => setStorageError(loadError instanceof Error ? loadError.message : "Watchlist storage is unavailable.")); }} /></NusaCard></View>;
  if (model.state === "LOADING") return <View style={styles.state} testID="watchlist-loading"><ActivityIndicator color={theme.colors.primary} /><Text style={[styles.stateTitle, { color: theme.colors.text }]}>공개 시세를 불러오는 중</Text></View>;
  if (model.state === "ERROR") return <View style={styles.state} testID="watchlist-error"><NusaCard><Text style={[styles.stateTitle, { color: theme.colors.danger }]}>시장 데이터가 유효하지 않습니다</Text><Text style={[styles.message, { color: theme.colors.textMuted }]}>{model.error}</Text></NusaCard></View>;
  if (model.state === "EMPTY") return <View style={styles.state} testID="watchlist-empty"><NusaCard><Text style={[styles.stateTitle, { color: theme.colors.text }]}>공개 시장 데이터 없음</Text><Text style={[styles.message, { color: theme.colors.textMuted }]}>검증된 Upbit 공개 데이터가 준비되면 검색하고 관심시장에 저장할 수 있습니다.</Text><NusaButton label="다시 불러오기" onPress={onRefresh} /></NusaCard></View>;

  return <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl tintColor={theme.colors.primary} refreshing={refreshing} onRefresh={onRefresh} />} testID="watchlist-screen">
    <View style={styles.titleRow}><SectionHeading eyebrow="PUBLIC MARKET DATA" title="관심시장" description="공개 시세만 관찰합니다. 계좌·주문 권한과 연결되지 않습니다." /><StatusChip label="READ ONLY" tone="info" /></View>
    <NusaTextField label="시장 검색" value={query} onChangeText={setQuery} placeholder="예: KRW-BTC" testID="watchlist-search" />
    <View style={styles.sortRow} testID="watchlist-sort">{sorts.map((value) => <NusaButton key={value} label={sortLabels[value]} onPress={() => setSort(value)} tone={sort === value ? "primary" : "neutral"} testID={`watchlist-sort-${value}`} />)}</View>
    <Text style={[styles.section, { color: theme.colors.text }]}>저장한 시장</Text>
    {model.activeMarkets.length === 0 ? <NusaCard testID="watchlist-saved-empty"><Text style={[styles.message, { color: theme.colors.textMuted }]}>저장한 시장이 없습니다.</Text></NusaCard> : model.activeMarkets.map((market) => <MarketRow key={`saved-${market.market}`} active market={market} onToggle={() => void toggle(market.market)} />)}
    <Text style={[styles.section, { color: theme.colors.text }]}>검색 결과</Text>
    {model.searchResults.length === 0 ? <NusaCard testID="watchlist-search-empty"><Text style={[styles.message, { color: theme.colors.textMuted }]}>조건에 맞는 공개 시장이 없습니다.</Text></NusaCard> : model.searchResults.map((market) => <MarketRow key={`result-${market.market}`} active={model.watchlist.includes(market.market)} market={market} onToggle={() => void toggle(market.market)} />)}
  </ScrollView>;
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingTop: 18, gap: 14, paddingBottom: 32 },
  state: { flex: 1, justifyContent: "center", padding: 20, gap: 14 },
  stateTitle: { fontSize: 18, fontWeight: "700" },
  message: { lineHeight: 21, fontSize: 14, marginTop: 8 },
  titleRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 12 },
  meta: { fontSize: 11, marginTop: 4 },
  sortRow: { flexDirection: "row", gap: 7, flexWrap: "wrap" },
  section: { fontSize: 18, fontWeight: "700", marginTop: 5, letterSpacing: -0.4 },
  rowHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 12 },
  market: { fontSize: 18, fontWeight: "700" },
  price: { fontSize: 25, fontWeight: "800", letterSpacing: -0.7, marginTop: 14 },
  divider: { height: 1, marginVertical: 12 },
});
