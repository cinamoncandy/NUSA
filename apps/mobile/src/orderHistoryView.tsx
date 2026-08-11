import React, { useMemo, useState } from "react";
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { DataRow, NusaButton, NusaCard, NusaTextField, SectionHeading, StatusChip } from "./components";
import { useTheme } from "./ThemeProvider";
import { buildOrderHistoryViewModel, type OrderHistoryFilter, type OrderHistoryPeriod, type OrderHistorySort } from "./orderHistory";

interface OrderHistoryViewProps {
  readonly rawOrders: readonly unknown[] | null;
  readonly error: string | null;
  readonly refreshing: boolean;
  readonly onRefresh: () => void;
}

const filters: readonly OrderHistoryFilter[] = ["ALL", "FILLED", "CANCELLED"];
const sorts: readonly OrderHistorySort[] = ["TIME_DESC", "TIME_ASC", "PRICE_DESC", "QUANTITY_DESC"];
const periods: readonly OrderHistoryPeriod[] = ["ALL", "TODAY", "7D", "30D"];
const filterLabels: Readonly<Record<OrderHistoryFilter, string>> = { ALL: "전체", FILLED: "체결", CANCELLED: "취소" };
const sortLabels: Readonly<Record<OrderHistorySort, string>> = { TIME_DESC: "최신순", TIME_ASC: "오래된순", PRICE_DESC: "가격순", QUANTITY_DESC: "수량순" };
const periodLabels: Readonly<Record<OrderHistoryPeriod, string>> = { ALL: "전체", TODAY: "오늘", "7D": "7일", "30D": "30일" };

function money(value: number): string { return `₩${Math.round(value).toLocaleString("ko-KR")}`; }

function OrderRow({ order }: Readonly<{ order: ReturnType<typeof buildOrderHistoryViewModel>["orders"][number] }>) {
  const { theme } = useTheme();
  const statusTone = order.status === "FILLED" ? "success" : order.status === "CANCELLED" ? "warning" : "danger";
  return <NusaCard testID={`order-history-${order.id}`}>
    <View style={styles.rowHeader}><View><Text style={[styles.market, { color: theme.colors.text }]}>{order.market}</Text><Text style={[styles.meta, { color: theme.colors.textMuted }]}>{order.id}</Text></View><StatusChip label={order.status} tone={statusTone} /></View>
    <View style={[styles.divider, { backgroundColor: theme.colors.border }]} />
    <DataRow label="방향 / 수량" value={`${order.side} ${order.quantity}`} />
    <DataRow label="체결 가격" value={money(order.price)} />
    <DataRow label="수수료" value={money(order.fee)} />
    <DataRow label="체결 시각" value={new Date(order.filledAt).toLocaleString("ko-KR")} />
    <Text style={[styles.detailTitle, { color: theme.colors.textMuted }]}>체결 상세 · {order.fills.length}건</Text>
    {order.fills.map((fill) => <Text key={fill.id} style={[styles.meta, { color: theme.colors.textMuted }]} testID={`fill-detail-${fill.id}`}>{fill.id}: {fill.quantity} @ {money(fill.price)}</Text>)}
  </NusaCard>;
}

export function OrderHistoryView({ rawOrders, error, refreshing, onRefresh }: OrderHistoryViewProps) {
  const { theme } = useTheme();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<OrderHistoryFilter>("ALL");
  const [sort, setSort] = useState<OrderHistorySort>("TIME_DESC");
  const [page, setPage] = useState(1);
  const [period, setPeriod] = useState<OrderHistoryPeriod>("ALL");
  const model = useMemo(() => buildOrderHistoryViewModel({ rawOrders, query, filter, sort, page, period }), [filter, page, period, query, rawOrders, sort]);
  const setFilterAndReset = (next: OrderHistoryFilter) => { setFilter(next); setPage(1); };
  const setSortAndReset = (next: OrderHistorySort) => { setSort(next); setPage(1); };
  const setPeriodAndReset = (next: OrderHistoryPeriod) => { setPeriod(next); setPage(1); };

  if (error) return <View style={styles.state} testID="order-history-error"><NusaCard><Text style={[styles.stateTitle, { color: theme.colors.danger }]}>주문 이력을 표시할 수 없습니다</Text><Text style={[styles.message, { color: theme.colors.textMuted }]}>{error}</Text><NusaButton label="다시 불러오기" onPress={onRefresh} /></NusaCard></View>;
  if (model.state === "LOADING") return <View style={styles.state} testID="order-history-loading"><ActivityIndicator color={theme.colors.primary} /><Text style={[styles.stateTitle, { color: theme.colors.text }]}>주문 이력을 불러오는 중</Text></View>;
  if (model.state === "ERROR") return <View style={styles.state} testID="order-history-error"><NusaCard><Text style={[styles.stateTitle, { color: theme.colors.danger }]}>주문 데이터 오류</Text><Text style={[styles.message, { color: theme.colors.textMuted }]}>{model.error}</Text></NusaCard></View>;
  if (model.state === "EMPTY") return <View style={styles.state} testID="order-history-empty"><NusaCard><Text style={[styles.stateTitle, { color: theme.colors.text }]}>조건에 맞는 주문 없음</Text><Text style={[styles.message, { color: theme.colors.textMuted }]}>완료된 PAPER 주문이 있으면 여기에 표시됩니다.</Text><NusaButton label="다시 불러오기" onPress={onRefresh} /></NusaCard></View>;

  return <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl tintColor={theme.colors.primary} refreshing={refreshing} onRefresh={onRefresh} />} testID="order-history-screen">
    <View style={styles.titleRow}><SectionHeading eyebrow="PAPER EXECUTION LOG" title="주문 이력" description="서버가 제공한 PAPER 주문·체결 기록을 읽기만 합니다." /><View style={styles.totalBox}><Text style={[styles.totalLabel, { color: theme.colors.textMuted }]}>전체</Text><Text style={[styles.count, { color: theme.colors.primary }]}>{model.total}</Text></View></View>
    <NusaTextField label="주문 검색" value={query} onChangeText={(value) => { setQuery(value); setPage(1); }} placeholder="시장 또는 주문 ID" testID="order-history-search" />
    <View style={styles.controlGroup}><Text style={[styles.controlLabel, { color: theme.colors.textMuted }]}>상태</Text><View style={styles.controlRow} testID="order-history-filters">{filters.map((value) => <NusaButton key={value} label={filterLabels[value]} onPress={() => setFilterAndReset(value)} selected={filter === value} tone={filter === value ? "primary" : "neutral"} testID={`order-history-filter-${value}`} />)}</View></View>
    <View style={styles.controlGroup}><Text style={[styles.controlLabel, { color: theme.colors.textMuted }]}>기간</Text><View style={styles.controlRow} testID="order-history-periods">{periods.map((value) => <NusaButton key={value} label={periodLabels[value]} onPress={() => setPeriodAndReset(value)} selected={period === value} tone={period === value ? "primary" : "neutral"} testID={`order-history-period-${value}`} />)}</View></View>
    <View style={styles.controlGroup}><Text style={[styles.controlLabel, { color: theme.colors.textMuted }]}>정렬</Text><View style={styles.controlRow} testID="order-history-sorts">{sorts.map((value) => <NusaButton key={value} label={sortLabels[value]} onPress={() => setSortAndReset(value)} selected={sort === value} tone={sort === value ? "primary" : "neutral"} testID={`order-history-sort-${value}`} />)}</View></View>
    {model.orders.map((order) => <OrderRow key={order.id} order={order} />)}
    <View style={styles.pagination} testID="order-history-pagination"><NusaButton label="이전" disabled={model.page <= 1} onPress={() => setPage((value) => Math.max(1, value - 1))} /><Text style={[styles.meta, { color: theme.colors.textMuted }]}>{model.page} / {model.pageCount} 페이지</Text><NusaButton label="다음" disabled={model.page >= model.pageCount} onPress={() => setPage((value) => Math.min(model.pageCount, value + 1))} /></View>
  </ScrollView>;
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingTop: 18, gap: 14, paddingBottom: 32 },
  state: { flex: 1, justifyContent: "center", padding: 20, gap: 14 },
  stateTitle: { fontSize: 18, fontWeight: "700" },
  message: { lineHeight: 21, marginTop: 8, fontSize: 14 },
  titleRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 12 },
  totalBox: { alignItems: "flex-end" },
  totalLabel: { fontSize: 11 },
  count: { fontSize: 25, fontWeight: "800" },
  meta: { fontSize: 12, marginTop: 4 },
  controlGroup: { gap: 7 },
  controlLabel: { fontSize: 11, fontWeight: "700", letterSpacing: 0.7 },
  controlRow: { flexDirection: "row", gap: 7, flexWrap: "wrap" },
  rowHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 12 },
  market: { fontSize: 18, fontWeight: "700" },
  divider: { height: 1, marginVertical: 12 },
  detailTitle: { fontSize: 12, fontWeight: "700", marginTop: 10, marginBottom: 3 },
  pagination: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8, marginTop: 4 },
});
