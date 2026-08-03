import React, { useMemo, useState } from "react";
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { NusaButton, NusaCard, NusaTextField } from "./components";
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

function money(value: number): string { return `KRW ${Math.round(value).toLocaleString("en-US")}`; }

function OrderRow({ order }: Readonly<{ order: ReturnType<typeof buildOrderHistoryViewModel>["orders"][number] }>) {
  const { theme } = useTheme();
  const statusColor = order.status === "FILLED" ? theme.colors.success : order.status === "CANCELLED" ? theme.colors.warning : theme.colors.danger;
  return <NusaCard testID={`order-history-${order.id}`}><View style={styles.rowHeader}><View><Text style={[styles.market, { color: theme.colors.text }]}>{order.market}</Text><Text style={[styles.meta, { color: theme.colors.textMuted }]}>{order.id}</Text></View><Text style={[styles.status, { color: statusColor }]}>{order.status}</Text></View><View style={styles.metrics}><Text style={[styles.metric, { color: theme.colors.text }]}>{order.side} {order.quantity}</Text><Text style={[styles.metric, { color: theme.colors.textMuted }]}>{money(order.price)}</Text><Text style={[styles.metric, { color: theme.colors.textMuted }]}>Fee {money(order.fee)}</Text><Text style={[styles.meta, { color: theme.colors.textMuted }]}>{new Date(order.filledAt).toLocaleString("en-US")}</Text></View><Text style={[styles.meta, { color: theme.colors.textMuted }]}>Order detail · {order.fills.length} fill(s)</Text>{order.fills.map((fill) => <Text key={fill.id} style={[styles.meta, { color: theme.colors.textMuted }]} testID={`fill-detail-${fill.id}`}>Fill {fill.id}: {fill.quantity} @ {money(fill.price)}</Text>)}</NusaCard>;
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

  if (error) return <View style={styles.state} testID="order-history-error"><NusaCard><Text style={[styles.stateTitle, { color: theme.colors.danger }]}>Order history unavailable</Text><Text style={[styles.message, { color: theme.colors.textMuted }]}>{error}</Text><NusaButton label="Retry" onPress={onRefresh} /></NusaCard></View>;
  if (model.state === "LOADING") return <View style={styles.state} testID="order-history-loading"><ActivityIndicator color={theme.colors.primary} /><Text style={[styles.stateTitle, { color: theme.colors.text }]}>Loading order history...</Text></View>;
  if (model.state === "ERROR") return <View style={styles.state} testID="order-history-error"><NusaCard><Text style={[styles.stateTitle, { color: theme.colors.danger }]}>Order history invalid</Text><Text style={[styles.message, { color: theme.colors.textMuted }]}>{model.error}</Text></NusaCard></View>;
  if (model.state === "EMPTY") return <View style={styles.state} testID="order-history-empty"><NusaCard><Text style={[styles.stateTitle, { color: theme.colors.text }]}>No matching orders</Text><Text style={[styles.message, { color: theme.colors.textMuted }]}>Completed Paper orders will appear here when available.</Text><NusaButton label="Retry" onPress={onRefresh} /></NusaCard></View>;

  return <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />} testID="order-history-screen"><View style={styles.titleRow}><View><Text style={[styles.heading, { color: theme.colors.text }]}>Order History</Text><Text style={[styles.meta, { color: theme.colors.textMuted }]}>Paper Trading / Read Only · Portfolio linked</Text></View><Text style={[styles.count, { color: theme.colors.primary }]}>{model.total}</Text></View><NusaTextField label="Search orders" value={query} onChangeText={(value) => { setQuery(value); setPage(1); }} placeholder="Search market or order ID" testID="order-history-search" /><View style={styles.controlRow} testID="order-history-filters">{filters.map((value) => <NusaButton key={value} label={value} onPress={() => setFilterAndReset(value)} tone={filter === value ? "primary" : "neutral"} testID={`order-history-filter-${value}`} />)}</View><View style={styles.controlRow} testID="order-history-periods">{periods.map((value) => <NusaButton key={value} label={value} onPress={() => setPeriodAndReset(value)} tone={period === value ? "primary" : "neutral"} testID={`order-history-period-${value}`} />)}</View><View style={styles.controlRow} testID="order-history-sorts">{sorts.map((value) => <NusaButton key={value} label={value} onPress={() => setSortAndReset(value)} tone={sort === value ? "primary" : "neutral"} testID={`order-history-sort-${value}`} />)}</View>{model.orders.map((order) => <OrderRow key={order.id} order={order} />)}<View style={styles.pagination} testID="order-history-pagination"><NusaButton label="Previous" disabled={model.page <= 1} onPress={() => setPage((value) => Math.max(1, value - 1))} /><Text style={[styles.meta, { color: theme.colors.textMuted }]}>Page {model.page} / {model.pageCount}</Text><NusaButton label="Next" disabled={model.page >= model.pageCount} onPress={() => setPage((value) => Math.min(model.pageCount, value + 1))} /></View></ScrollView>;
}

const styles = StyleSheet.create({ content: { padding: 20, gap: 14, paddingBottom: 28 }, state: { flex: 1, justifyContent: "center", padding: 20, gap: 14 }, stateTitle: { fontSize: 18, fontWeight: "700" }, message: { lineHeight: 22, marginTop: 8 }, titleRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" }, heading: { fontSize: 28, fontWeight: "800" }, count: { fontSize: 24, fontWeight: "800" }, meta: { fontSize: 12, marginTop: 4 }, controlRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" }, rowHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" }, market: { fontSize: 18, fontWeight: "700" }, status: { fontSize: 12, fontWeight: "700" }, metrics: { flexDirection: "row", gap: 12, flexWrap: "wrap", marginTop: 12 }, metric: { fontSize: 13 }, pagination: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8, marginTop: 4 } });
