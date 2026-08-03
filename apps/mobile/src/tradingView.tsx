import React, { useMemo, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { NusaButton, NusaCard, NusaTextField } from "./components";
import { useTheme } from "./ThemeProvider";
import { buildTradingViewModel, formatTradingAmount, tradingAssetCode, type TradingDraft, type TradingOrderSide, type TradingOrderType } from "./tradingViewModel";
import type { PortfolioAccountResponse } from "./portfolioViewModel";

interface TradingViewProps {
  readonly snapshot: PortfolioAccountResponse | null;
  readonly marketConnectionState: string;
  readonly stale: boolean;
  readonly error: string | null;
  readonly refreshing: boolean;
  readonly onRefresh: () => void;
  readonly onSubmit?: (draft: TradingDraft) => void;
}

function StatusPill({ label, ok }: Readonly<{ label: string; ok: boolean }>) {
  const { theme } = useTheme();
  return <View style={[styles.statusPill, { borderColor: ok ? theme.colors.success : theme.colors.warning }]}><Text style={[styles.statusText, { color: ok ? theme.colors.success : theme.colors.warning }]}>{label}</Text></View>;
}

function ErrorState({ message, onRetry }: Readonly<{ message: string; onRetry: () => void }>) {
  const { theme } = useTheme();
  return <View style={styles.state} testID="trading-error"><NusaCard><Text style={[styles.stateTitle, { color: theme.colors.danger }]}>Trading unavailable</Text><Text style={[styles.stateMessage, { color: theme.colors.textMuted }]}>{message}</Text><NusaButton label="Retry" onPress={onRetry} /></NusaCard></View>;
}

export function TradingView({ snapshot, marketConnectionState, stale, error, refreshing, onRefresh, onSubmit }: TradingViewProps) {
  const { theme } = useTheme();
  const [side, setSide] = useState<TradingOrderSide>("BUY");
  const [orderType, setOrderType] = useState<TradingOrderType>("MARKET");
  const [priceInput, setPriceInput] = useState("");
  const [quantityInput, setQuantityInput] = useState("");

  const draft = useMemo(() => ({ side, orderType, priceInput, quantityInput }), [orderType, priceInput, quantityInput, side]);
  if (error) return <ErrorState message={error} onRetry={onRefresh} />;
  if (snapshot === null) return <View style={styles.state} testID="trading-loading"><ActivityIndicator color={theme.colors.primary} /><Text style={[styles.stateTitle, { color: theme.colors.text }]}>Loading trading market...</Text></View>;
  if (snapshot.account.available === false || !snapshot.account.position.market.trim()) return <View style={styles.state} testID="trading-empty"><NusaCard><Text style={[styles.stateTitle, { color: theme.colors.text }]}>No market available</Text><Text style={[styles.stateMessage, { color: theme.colors.textMuted }]}>A verified Paper market is required before order entry.</Text></NusaCard></View>;

  const model = buildTradingViewModel({
    market: { market: snapshot.account.position.market, connectionState: marketConnectionState, stale, price: snapshot.account.markPrice },
    account: { mode: snapshot.mode, liveMutationAllowed: false, cash: snapshot.account.cash, assetQuantity: snapshot.account.position.quantity, market: snapshot.account.position.market },
    draft,
    submitAvailable: onSubmit !== undefined,
  });
  const priceLabel = model.currentPrice === null ? "-" : formatTradingAmount(model.currentPrice, "KRW");
  const submitEnabled = model.canSubmit && onSubmit !== undefined;

  return <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />} testID="trading-screen">
    <View style={styles.titleRow}><View><Text style={[styles.heading, { color: theme.colors.text }]}>Trade</Text><Text style={[styles.market, { color: theme.colors.textMuted }]}>{model.market}</Text></View><StatusPill label="PAPER" ok={snapshot.mode === "PAPER"} /></View>
    <NusaCard testID="trading-safety"><View style={styles.statusRow}><StatusPill label={`Market ${marketConnectionState}`} ok={model.blockedReasons.includes("MARKET_DATA_NOT_READY") === false} /><StatusPill label="Live Mutation Disabled" ok /></View><Text style={[styles.label, { color: theme.colors.textMuted }]}>Current price</Text><Text style={[styles.price, { color: theme.colors.text }]}>{priceLabel}</Text></NusaCard>
    <View style={styles.segmentRow} testID="trading-side-tabs"><NusaButton label="Buy" onPress={() => setSide("BUY")} tone={side === "BUY" ? "primary" : "neutral"} testID="trading-buy" /><NusaButton label="Sell" onPress={() => setSide("SELL")} tone={side === "SELL" ? "danger" : "neutral"} testID="trading-sell" /></View>
    <View style={styles.segmentRow} testID="trading-order-types"><NusaButton label="Market" onPress={() => setOrderType("MARKET")} tone={orderType === "MARKET" ? "primary" : "neutral"} testID="trading-market-order" /><NusaButton label="Limit" onPress={() => setOrderType("LIMIT")} tone={orderType === "LIMIT" ? "primary" : "neutral"} testID="trading-limit-order" /></View>
    {orderType === "LIMIT" ? <NusaTextField label="Price" value={priceInput} onChangeText={setPriceInput} placeholder="Price in KRW" testID="trading-price" /> : null}
    <NusaTextField label={`Quantity (${tradingAssetCode(model.market)})`} value={quantityInput} onChangeText={setQuantityInput} placeholder="Quantity" testID="trading-quantity" />
    <NusaCard testID="trading-preview"><Text style={[styles.label, { color: theme.colors.textMuted }]}>Order preview</Text><Text style={[styles.row, { color: theme.colors.text }]}>Estimated amount {formatTradingAmount(model.estimatedNotional, "KRW")}</Text><Text style={[styles.row, { color: theme.colors.text }]}>Available {formatTradingAmount(model.availableAmount, model.availableUnit)}</Text><Text style={[styles.row, { color: theme.colors.textMuted }]}>Fees and slippage: unavailable until execution</Text></NusaCard>
    {model.validationErrors.length > 0 || model.blockedReasons.length > 0 ? <NusaCard testID="trading-blockers"><Text style={[styles.label, { color: theme.colors.warning }]}>Order disabled</Text>{[...model.validationErrors, ...model.blockedReasons].map((reason) => <Text key={reason} style={[styles.row, { color: theme.colors.textMuted }]}>{reason}</Text>)}</NusaCard> : null}
    <NusaButton label={submitEnabled ? `${side === "BUY" ? "Buy" : "Sell"} in Paper` : "Paper order unavailable"} disabled={!submitEnabled} onPress={() => { if (submitEnabled) onSubmit?.(draft); }} testID="trading-submit" />
  </ScrollView>;
}

const styles = StyleSheet.create({
  content: { padding: 20, gap: 14, paddingBottom: 28 },
  state: { flex: 1, justifyContent: "center", padding: 20, gap: 14 },
  stateTitle: { fontSize: 18, fontWeight: "700" },
  stateMessage: { lineHeight: 22 },
  titleRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  heading: { fontSize: 28, fontWeight: "800" },
  market: { marginTop: 3, fontSize: 16 },
  statusRow: { flexDirection: "row", gap: 8, flexWrap: "wrap", marginBottom: 14 },
  statusPill: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  statusText: { fontSize: 12, fontWeight: "700" },
  label: { fontSize: 12, fontWeight: "600", textTransform: "uppercase" },
  price: { fontSize: 30, fontWeight: "800", marginTop: 6 },
  segmentRow: { flexDirection: "row", gap: 10 },
  row: { marginTop: 8 },
});
