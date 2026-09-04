import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { NusaButton, NusaCard, NusaTextField, StatusChip } from "./components";
import { SegmentedControl } from "./uxPrimitives";
import { useTheme } from "./ThemeProvider";
import { buildWatchlistViewModel, formatFeedAgeMs, freshestObservedAtMs, type WatchlistMarket, type WatchlistRepository, type WatchlistSort } from "./watchlist";

interface WatchlistViewProps {
  readonly repository: WatchlistRepository;
  readonly rawMarkets: unknown[] | null;
  readonly error: string | null;
  readonly stale: boolean;
  readonly refreshing: boolean;
  readonly onRefresh: () => void;
  readonly selectedMarket?: string;
  readonly onSelectMarket?: (market: string) => void;
}
const sorts: readonly WatchlistSort[] = ["MARKET", "PRICE", "CHANGE", "VOLUME"];
const sortLabels: Readonly<Record<WatchlistSort, string>> = { MARKET: "시장", PRICE: "가격", CHANGE: "등락", VOLUME: "거래량" };
const sortItems = sorts.map((key) => ({ key, label: sortLabels[key] }));
function formatPrice(value: number): string { return `₩${Math.round(value).toLocaleString("ko-KR")}`; }
function formatChange(value: number | null): string { return value === null ? "-" : `${value >= 0 ? "+" : ""}${(value * 100).toFixed(2)}%`; }
function formatVolume(value: number | null): string { return value === null ? "-" : value.toLocaleString("ko-KR"); }

function MarketRow({ market, active, selected, onToggle, onSelect }: Readonly<{ market: WatchlistMarket; active: boolean; selected: boolean; onToggle: () => void; onSelect?: () => void }>) {
  const { theme } = useTheme();
  const changeColor = market.changeRate === null ? theme.colors.textMuted : market.changeRate >= 0 ? theme.colors.success : theme.colors.danger;
  return <View style={[styles.marketRow, { borderBottomColor: theme.colors.border, backgroundColor: selected ? theme.colors.primarySoft : "transparent" }]} testID={`watchlist-market-${market.market}`}>
    <View style={styles.marketMain}>
      <Pressable
        accessibilityLabel={`${market.market} 차트 보기`}
        accessibilityRole="button"
        accessibilityState={{ selected }}
        disabled={onSelect == null}
        onPress={onSelect}
        style={({ pressed }) => [styles.marketSelect, { opacity: pressed ? theme.interaction.pressedOpacity : 1 }]}
        testID={`watchlist-select-${market.market}`}
      >
        <View style={styles.marketIdentity}><Text style={[styles.market, { color: selected ? theme.colors.primary : theme.colors.text }]}>{market.market}</Text><Text style={[styles.volumeInline, { color: theme.colors.textMuted }]} numberOfLines={1}>거래량 {formatVolume(market.volume)}</Text></View>
        <View style={styles.marketNumbers}><Text style={[styles.price, { color: theme.colors.text }]}>{formatPrice(market.price)}</Text><Text style={[styles.change, { color: changeColor }]}>{formatChange(market.changeRate)}</Text></View>
      </Pressable>
      <Pressable accessibilityLabel={`${market.market} ${active ? "관심시장에서 제거" : "관심시장에 추가"}`} accessibilityRole="button" accessibilityState={{ selected: active }} hitSlop={4} onPress={onToggle} style={[styles.favorite, { backgroundColor: active ? theme.colors.primarySoft : "transparent", borderColor: active ? theme.colors.primary : theme.colors.border }]} testID={`watchlist-toggle-${market.market}`}><Text style={[styles.favoriteLabel, { color: active ? theme.colors.primary : theme.colors.textMuted }]}>{active ? "관심중" : "관심"}</Text></Pressable>
    </View>
  </View>;
}

export function WatchlistView({ repository, rawMarkets, error, stale, refreshing, onRefresh, selectedMarket, onSelectMarket }: WatchlistViewProps) {
  const { theme } = useTheme();
  const [savedMarkets, setSavedMarkets] = useState<readonly string[] | null>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<WatchlistSort>("MARKET");
  const [storageError, setStorageError] = useState<string | null>(null);
  useEffect(() => { let active = true; void repository.load().then((markets) => { if (active) setSavedMarkets(markets); }).catch((loadError) => { if (active) setStorageError(loadError instanceof Error ? loadError.message : "Watchlist storage is unavailable."); }); return () => { active = false; }; }, [repository]);
  const model = useMemo(() => buildWatchlistViewModel({ rawMarkets, watchlist: savedMarkets, query, sort }), [query, rawMarkets, savedMarkets, sort]);
  const feedRows = model.searchResults.length > 0 ? model.searchResults : model.activeMarkets;
  const feedAge = useMemo(() => {
    const freshMs = freshestObservedAtMs(feedRows);
    return freshMs === null ? null : formatFeedAgeMs(freshMs, Date.now());
  }, [feedRows]);
  const toggle = async (market: string): Promise<void> => { try { setStorageError(null); setSavedMarkets(await (savedMarkets?.includes(market) ? repository.remove(market) : repository.add(market))); } catch (toggleError) { setStorageError(toggleError instanceof Error ? toggleError.message : "Watchlist storage is unavailable."); } };
  const renderMarket = useCallback(({ item }: { item: WatchlistMarket }) => <MarketRow market={item} active={model.watchlist.includes(item.market)} selected={selectedMarket === item.market} onSelect={onSelectMarket ? () => onSelectMarket(item.market) : undefined} onToggle={() => void toggle(item.market)} />, [model.watchlist, onSelectMarket, selectedMarket]); // eslint-disable-line react-hooks/exhaustive-deps
  const keyExtractor = useCallback((item: WatchlistMarket) => item.market, []);

  if (error) return <View style={styles.state} testID="watchlist-error"><NusaCard><Text style={[styles.stateTitle, { color: theme.colors.danger }]}>시장 정보를 표시할 수 없습니다</Text><Text style={[styles.message, { color: theme.colors.textMuted }]}>{error}</Text><NusaButton label="다시 불러오기" onPress={onRefresh} /></NusaCard></View>;
  if (storageError) return <View style={styles.state} testID="watchlist-storage-error"><NusaCard><Text style={[styles.stateTitle, { color: theme.colors.danger }]}>관심시장 저장소 오류</Text><Text style={[styles.message, { color: theme.colors.textMuted }]}>{storageError}</Text><NusaButton label="다시 시도" onPress={() => { setStorageError(null); void repository.load().then(setSavedMarkets).catch((loadError) => setStorageError(loadError instanceof Error ? loadError.message : "Watchlist storage is unavailable.")); }} /></NusaCard></View>;
  if (model.state === "LOADING") return <View style={styles.state} testID="watchlist-loading"><ActivityIndicator color={theme.colors.primary} /><Text style={[styles.stateTitle, { color: theme.colors.text }]}>공개 시세를 불러오는 중</Text></View>;
  if (model.state === "ERROR") return <View style={styles.state} testID="watchlist-error"><NusaCard><Text style={[styles.stateTitle, { color: theme.colors.danger }]}>시장 데이터가 유효하지 않습니다</Text><Text style={[styles.message, { color: theme.colors.textMuted }]}>{model.error}</Text></NusaCard></View>;
  if (model.state === "EMPTY") return <View style={styles.state} testID="watchlist-empty"><NusaCard><Text style={[styles.stateTitle, { color: theme.colors.text }]}>공개 시장 데이터 없음</Text><Text style={[styles.message, { color: theme.colors.textMuted }]}>검증된 공개 데이터가 준비되면 검색하고 관심시장에 저장할 수 있습니다.</Text><NusaButton label="다시 불러오기" onPress={onRefresh} /></NusaCard></View>;

  const header = <View style={styles.headerBlock}>
    <View style={styles.workspaceHeader}><View><Text style={[styles.eyebrow, { color: theme.colors.textMuted }]}>WATCHLIST</Text><Text style={[styles.workspaceTitle, { color: theme.colors.text }]}>관심시장</Text></View><View style={styles.statusChips}>{feedAge === null ? null : <Text style={[styles.freshness, { color: theme.colors.textMuted }]} testID="watchlist-freshness">{feedAge} 업데이트</Text>}<StatusChip label="READ ONLY" tone="info" />{stale ? <StatusChip label="STALE" tone="warning" /> : null}</View></View>
    <Text style={[styles.readOnlyNote, { color: theme.colors.textMuted }]}>{stale ? "마지막으로 검증된 공개 시세를 표시 중입니다. 새 시세를 받으면 자동으로 갱신됩니다." : "시장 행을 누르면 해당 공개 차트를 엽니다. 관심시장 저장은 이 기기의 로컬 보기 설정이며 계좌·주문 권한과 연결되지 않습니다."}</Text>
    <NusaTextField label="시장 검색" value={query} onChangeText={setQuery} placeholder="예: KRW-BTC" testID="watchlist-search" />
    <View style={styles.sortGroup}><Text style={[styles.controlLabel, { color: theme.colors.textMuted }]}>정렬</Text><SegmentedControl items={sortItems} selectedKey={sort} onChange={(key) => setSort(key as WatchlistSort)} testID="watchlist-sort" /></View>
    <View style={styles.sectionHeader}><Text style={[styles.section, { color: theme.colors.text }]}>저장한 시장</Text><Text style={[styles.sectionCount, { color: theme.colors.textMuted }]}>{model.activeMarkets.length}</Text></View>
    {model.activeMarkets.length === 0 ? <NusaCard testID="watchlist-saved-empty"><Text style={[styles.message, { color: theme.colors.textMuted }]}>시장 행의 관심 버튼으로 자주 보는 시장을 저장할 수 있습니다.</Text></NusaCard> : <View style={styles.marketList}>{model.activeMarkets.map((item) => <MarketRow key={`saved-${item.market}`} active market={item} selected={selectedMarket === item.market} onSelect={onSelectMarket ? () => onSelectMarket(item.market) : undefined} onToggle={() => void toggle(item.market)} />)}</View>}
    <View style={styles.sectionHeader}><Text style={[styles.section, { color: theme.colors.text }]}>전체 결과</Text><Text style={[styles.sectionCount, { color: theme.colors.textMuted }]}>{model.searchResults.length}</Text></View>
  </View>;

  return <FlatList
    testID="watchlist-screen"
    contentContainerStyle={styles.content}
    refreshControl={<RefreshControl tintColor={theme.colors.primary} refreshing={refreshing} onRefresh={onRefresh} />}
    data={model.searchResults}
    keyExtractor={keyExtractor}
    renderItem={renderMarket}
    ListHeaderComponent={header}
    ListEmptyComponent={<NusaCard testID="watchlist-search-empty"><Text style={[styles.message, { color: theme.colors.textMuted }]}>조건에 맞는 공개 시장이 없습니다.</Text></NusaCard>}
    ItemSeparatorComponent={() => <View style={styles.marketListGap} />}
  />;
}

const styles = StyleSheet.create({
  sortChip: { minHeight: 44 },
  content: { paddingBottom: 32 }, headerBlock: { gap: 14, marginBottom: 14 }, marketListGap: { height: 0 }, state: { flex: 1, justifyContent: "center", padding: 20, gap: 14 }, stateTitle: { fontSize: 18, fontWeight: "700" }, message: { lineHeight: 21, fontSize: 14, marginTop: 8 }, workspaceHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }, statusChips: { flexDirection: "row", flexWrap: "wrap", gap: 6, justifyContent: "flex-end", alignItems: "center" }, freshness: { fontSize: 10, lineHeight: 14, fontWeight: "700", fontVariant: ["tabular-nums"] }, eyebrow: { fontSize: 10, fontWeight: "800", letterSpacing: 1.7, marginBottom: 4 }, workspaceTitle: { fontSize: 25, lineHeight: 30, fontWeight: "800", letterSpacing: -0.7 }, readOnlyNote: { fontSize: 12, lineHeight: 18, maxWidth: 620 }, sortGroup: { gap: 7 }, controlLabel: { fontSize: 10, fontWeight: "800", letterSpacing: 1.1 }, sectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 8 }, section: { fontSize: 17, fontWeight: "800", letterSpacing: -0.3 }, sectionCount: { fontSize: 12, fontWeight: "700", fontVariant: ["tabular-nums"] }, marketList: { backgroundColor: "transparent" }, marketRow: { borderBottomWidth: StyleSheet.hairlineWidth, paddingHorizontal: 2, paddingVertical: 4 }, marketMain: { minHeight: 60, flexDirection: "row", alignItems: "center", gap: 8 }, marketSelect: { flex: 1, minWidth: 0, minHeight: 52, flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 8 }, marketIdentity: { flex: 1, minWidth: 84 }, marketNumbers: { minWidth: 112, alignItems: "flex-end", justifyContent: "center" }, market: { fontSize: 16, fontWeight: "800", letterSpacing: -0.2 }, volumeInline: { marginTop: 5, fontSize: 10, lineHeight: 14, fontWeight: "600", fontVariant: ["tabular-nums"] }, price: { fontSize: 18, fontWeight: "800", letterSpacing: -0.5, fontVariant: ["tabular-nums"] }, change: { fontSize: 12, fontWeight: "700", marginTop: 3, fontVariant: ["tabular-nums"] }, favorite: { minWidth: 52, minHeight: 48, paddingHorizontal: 8, borderRadius: 999, borderWidth: 1, alignItems: "center", justifyContent: "center" }, favoriteLabel: { fontSize: 11, fontWeight: "800" },
});
