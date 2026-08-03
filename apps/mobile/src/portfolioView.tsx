import React from "react";
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { NusaButton, NusaCard } from "./components";
import { useTheme } from "./ThemeProvider";
import { buildPortfolioViewModel, type PortfolioAccountResponse, type PortfolioViewModel } from "./portfolioViewModel";

export type { PortfolioAccountResponse } from "./portfolioViewModel";

function money(value: number): string {
  return `KRW ${Math.round(value).toLocaleString("en-US")}`;
}

function signedMoney(value: number): string {
  return `${value >= 0 ? "+" : "-"}${money(Math.abs(value))}`;
}

function LoadingState({ theme }: Readonly<{ theme: ReturnType<typeof useTheme>["theme"] }>) {
  return <View style={styles.state} testID="portfolio-loading"><ActivityIndicator color={theme.colors.primary} /><Text style={[styles.stateTitle, { color: theme.colors.text }]}>Loading portfolio...</Text></View>;
}

function ErrorState({ theme, message, onRetry }: Readonly<{ theme: ReturnType<typeof useTheme>["theme"]; message: string; onRetry: () => void }>) {
  return <View style={styles.state} testID="portfolio-error"><NusaCard><Text style={[styles.stateTitle, { color: theme.colors.danger }]}>Portfolio unavailable</Text><Text style={[styles.stateMessage, { color: theme.colors.textMuted }]}>{message}</Text><NusaButton label="Retry" onPress={onRetry} /></NusaCard></View>;
}

export interface PortfolioViewProps {
  readonly snapshot: PortfolioAccountResponse | null;
  readonly error: string | null;
  readonly refreshing: boolean;
  readonly onRefresh: () => void;
}

function renderPosition(model: PortfolioViewModel, theme: ReturnType<typeof useTheme>["theme"]) {
  if (!model.position) return <NusaCard testID="portfolio-empty"><Text style={[styles.stateTitle, { color: theme.colors.text }]}>No open positions</Text><Text style={[styles.stateMessage, { color: theme.colors.textMuted }]}>Your cash balance is available. Market overview will appear here when data is ready.</Text></NusaCard>;
  return <NusaCard testID="portfolio-position"><Text style={[styles.label, { color: theme.colors.textMuted }]}>Open Position</Text><Text style={[styles.positionMarket, { color: theme.colors.text }]}>{model.position.market}</Text><Text style={[styles.row, { color: theme.colors.textMuted }]}>Quantity {model.position.quantity}</Text><Text style={[styles.row, { color: theme.colors.textMuted }]}>Average {money(model.position.averagePrice)}</Text><Text style={[styles.row, { color: theme.colors.textMuted }]}>Current {money(model.position.currentPrice)}</Text><Text style={[styles.pnl, { color: model.position.unrealizedPnl >= 0 ? theme.colors.success : theme.colors.danger }]}>{signedMoney(model.position.unrealizedPnl)}</Text></NusaCard>;
}

export function PortfolioView({ snapshot, error, refreshing, onRefresh }: PortfolioViewProps) {
  const { theme } = useTheme();
  if (error) return <ErrorState theme={theme} message={error} onRetry={onRefresh} />;
  if (snapshot === null) return <LoadingState theme={theme} />;

  let model: PortfolioViewModel;
  try {
    model = buildPortfolioViewModel(snapshot);
  } catch (validationError) {
    return <ErrorState theme={theme} message={validationError instanceof Error ? validationError.message : "Portfolio data is invalid."} onRetry={onRefresh} />;
  }

  return <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />} testID="portfolio-screen">
    <Text style={[styles.heading, { color: theme.colors.text }]}>Portfolio</Text>
    <NusaCard testID="portfolio-summary"><Text style={[styles.label, { color: theme.colors.textMuted }]}>Total Equity</Text><Text style={[styles.total, { color: theme.colors.text }]}>{money(model.totalEquity)}</Text><Text style={[styles.pnl, { color: model.totalPnl >= 0 ? theme.colors.success : theme.colors.danger }]}>{signedMoney(model.totalPnl)} total PnL</Text></NusaCard>
    <View style={styles.metrics}><NusaCard testID="portfolio-pnl"><Text style={[styles.label, { color: theme.colors.textMuted }]}>Unrealized PnL</Text><Text style={[styles.metric, { color: model.unrealizedPnl >= 0 ? theme.colors.success : theme.colors.danger }]}>{signedMoney(model.unrealizedPnl)}</Text></NusaCard><NusaCard testID="portfolio-return"><Text style={[styles.label, { color: theme.colors.textMuted }]}>Return</Text><Text style={[styles.metric, { color: theme.colors.text }]}>{model.returnRate === null ? "-" : `${(model.returnRate * 100).toFixed(2)}%`}</Text></NusaCard></View>
    <NusaCard testID="portfolio-allocation"><Text style={[styles.label, { color: theme.colors.textMuted }]}>Allocation</Text><Text style={[styles.row, { color: theme.colors.text }]}>Cash {money(model.cash)}</Text><Text style={[styles.row, { color: theme.colors.text }]}>Active positions {money(model.assetValue)}</Text><Text style={[styles.row, { color: theme.colors.text }]}>Open orders {model.openOrderCount}</Text></NusaCard>
    {renderPosition(model, theme)}
  </ScrollView>;
}

const styles = StyleSheet.create({
  content: { padding: 20, gap: 14, paddingBottom: 28 },
  state: { flex: 1, justifyContent: "center", padding: 20, gap: 14 },
  stateTitle: { fontSize: 18, fontWeight: "700" },
  stateMessage: { lineHeight: 22 },
  heading: { fontSize: 28, fontWeight: "800" },
  label: { fontSize: 12, fontWeight: "600", textTransform: "uppercase" },
  total: { fontSize: 32, fontWeight: "800", marginTop: 8 },
  pnl: { fontSize: 16, fontWeight: "700", marginTop: 8 },
  metrics: { flexDirection: "row", gap: 12 },
  metric: { fontSize: 18, fontWeight: "700", marginTop: 8 },
  row: { marginTop: 8 },
  positionMarket: { fontSize: 20, fontWeight: "700", marginTop: 8 },
});
