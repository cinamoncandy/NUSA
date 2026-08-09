import React, { useMemo, useState } from "react";
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { DataRow, NusaButton, NusaCard, NusaTextField, SectionHeading, StatusChip } from "./components";
import { useTheme } from "./ThemeProvider";
import { buildTradingViewModel, formatTradingAmount, tradingAssetCode, type TradingDraft, type TradingOrderSide, type TradingOrderType } from "./tradingViewModel";
import type { PortfolioAccountResponse } from "./portfolioViewModel";
import { InMemoryDashboardCredentialSession } from "./dashboardCredentialSession";
import { getConfiguredPaperEndpoint, isPaperConnectionVerified } from "./paperConnectionSession";
import { PersonalPaperOrderRetryIdentity, submitPersonalPaperOrderWithRetryIdentity } from "./personalPaperOrderClient";

interface TradingViewProps { readonly snapshot: PortfolioAccountResponse | null; readonly marketConnectionState: string; readonly stale: boolean; readonly error: string | null; readonly refreshing: boolean; readonly onRefresh: () => void; readonly onSubmit?: (draft: TradingDraft) => void; }
function ErrorState({ message, onRetry }: Readonly<{ message: string; onRetry: () => void }>) { const { theme } = useTheme(); return <View style={styles.state}><View style={styles.stateInner}><NusaCard><Text style={[styles.stateTitle, { color: theme.colors.danger }]}>PAPER 화면을 표시할 수 없습니다</Text><Text style={[styles.stateMessage, { color: theme.colors.textMuted }]}>{message}</Text><NusaButton label="다시 불러오기" onPress={onRetry} /></NusaCard></View></View>; }
const idempotencyKey = (): string => `paper-mobile-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
// Keep unresolved PAPER submission identities for the whole app process so tab navigation/remounts cannot rotate an ambiguous request key.
const processPaperOrderRetryIdentity = new PersonalPaperOrderRetryIdentity();

export function TradingView({ snapshot, marketConnectionState, stale, error, refreshing, onRefresh, onSubmit }: TradingViewProps) {
  const { theme } = useTheme();
  const [side, setSide] = useState<TradingOrderSide>("BUY");
  const [orderType, setOrderType] = useState<TradingOrderType>("MARKET");
  const [priceInput, setPriceInput] = useState("");
  const [quantityInput, setQuantityInput] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitMessage, setSubmitMessage] = useState<string | null>(null);
  const credentialSession = useMemo(() => new InMemoryDashboardCredentialSession(), []);
  const configuredEndpoint = getConfiguredPaperEndpoint();
  const builtInSubmitAvailable = Boolean(configuredEndpoint && credentialSession.isConfigured() && isPaperConnectionVerified(configuredEndpoint));
  const draft = useMemo(() => ({ side, orderType, priceInput, quantityInput }), [orderType, priceInput, quantityInput, side]);

  if (error) return <ErrorState message={error} onRetry={onRefresh} />;
  if (snapshot === null) return <View style={styles.state}><ActivityIndicator color={theme.colors.primary} /><Text style={[styles.stateTitle, { color: theme.colors.text }]}>PAPER 상태를 불러오는 중</Text></View>;
  if (snapshot.account.available === false || !snapshot.account.position.market.trim()) return <View style={styles.state} testID="trading-empty"><View style={styles.stateInner}><NusaCard><Text style={[styles.stateTitle, { color: theme.colors.text }]}>관찰 가능한 시장이 없습니다</Text><NusaButton label="다시 불러오기" onPress={onRefresh} /></NusaCard></View></View>;

  const submitAvailable = onSubmit !== undefined || builtInSubmitAvailable;
  const model = buildTradingViewModel({ market: { market: snapshot.account.position.market, connectionState: marketConnectionState, stale, price: snapshot.account.markPrice }, account: { mode: snapshot.mode, liveMutationAllowed: false, cash: snapshot.account.cash, assetQuantity: snapshot.account.position.quantity, market: snapshot.account.position.market }, draft, submitAvailable });
  const submitEnabled = submitAvailable && model.canSubmit && !submitting;
  const marketReady = !model.blockedReasons.includes("MARKET_DATA_NOT_READY");
  const submitBuiltIn = async () => {
    if (!configuredEndpoint || !isPaperConnectionVerified(configuredEndpoint)) { setSubmitMessage("설정에서 PAPER endpoint와 세션을 먼저 검증하세요."); return; }
    setSubmitting(true); setSubmitMessage(null);
    try {
      const quantity = Number(quantityInput);
      const limitPrice = orderType === "LIMIT" ? Number(priceInput) : undefined;
      const fingerprint = JSON.stringify([model.market, side, orderType, quantity, limitPrice ?? null]);
      const result = await submitPersonalPaperOrderWithRetryIdentity(
        { baseUrl: configuredEndpoint, credentialProvider: credentialSession.credentialProvider },
        processPaperOrderRetryIdentity,
        fingerprint,
        idempotencyKey,
        { schemaVersion: 1, authority: "PAPER_ONLY", productionMutationAllowed: false, market: model.market, side, orderType, quantity, ...(limitPrice === undefined ? {} : { limitPrice }) }
      );
      if (result.status === "READY") {
        setSubmitMessage(result.result.status === "FILLED" ? `PAPER 체결 완료 · ${result.result.order?.id ?? ""}` : `${result.result.status}${result.result.reason ? ` · ${result.result.reason}` : ""}`);
        if (result.result.status === "FILLED") { setQuantityInput(""); setPriceInput(""); }
        await Promise.resolve(onRefresh());
      } else setSubmitMessage(result.reason);
    } finally {
      setSubmitting(false); setConfirming(false);
    }
  };
  const requestSubmit = () => { if (!submitEnabled) return; if (onSubmit) { onSubmit(draft); return; } setConfirming(true); };

  return <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl tintColor={theme.colors.primary} refreshing={refreshing} onRefresh={onRefresh} />} testID="trading-screen">
    <SectionHeading eyebrow="PAPER WORKSPACE" title="PAPER" description="실제 시장 데이터와 가상 PAPER 계좌로만 주문을 연습합니다." />
    <View style={styles.statusRow}><StatusChip label="PAPER ONLY" tone="primary" /><StatusChip label={marketReady ? "시장 온라인" : "시장 대기"} tone={marketReady ? "success" : "warning"} /><StatusChip label="LIVE 금지" tone="info" /></View>
    <NusaCard raised><View style={styles.marketHeader}><View><Text style={[styles.label, { color: theme.colors.textMuted }]}>관찰 시장</Text><Text style={[styles.market, { color: theme.colors.text }]}>{model.market}</Text></View><StatusChip label={stale ? "데이터 점검" : "최신"} tone={stale ? "warning" : "success"} /></View><Text style={[styles.price, { color: theme.colors.text }]}>{model.currentPrice === null ? "-" : formatTradingAmount(model.currentPrice, "KRW")}</Text><View style={[styles.divider, { backgroundColor: theme.colors.border }]} /><DataRow label="시장 연결" value={marketConnectionState} tone={marketReady ? "success" : "warning"} /><DataRow label="사용 가능 현금" value={formatTradingAmount(snapshot.account.cash, "KRW")} /><DataRow label="보유 수량" value={`${snapshot.account.position.quantity} ${tradingAssetCode(model.market)}`} /></NusaCard>
    {!submitAvailable ? <NusaCard><Text style={[styles.cardTitle, { color: theme.colors.text }]}>PAPER 주문 연결 필요</Text><Text style={[styles.stateMessage, { color: theme.colors.textMuted }]}>설정에서 Cloud endpoint와 메모리 세션 토큰을 검증하면 PAPER 주문 컨트롤이 활성화됩니다.</Text></NusaCard> : <>
      <View style={styles.segmentRow}><NusaButton disabled={submitting} label="매수" onPress={() => { setSide("BUY"); setConfirming(false); }} tone={side === "BUY" ? "primary" : "neutral"} /><NusaButton disabled={submitting} label="매도" onPress={() => { setSide("SELL"); setConfirming(false); }} tone={side === "SELL" ? "danger" : "neutral"} /></View>
      <View style={styles.segmentRow}><NusaButton disabled={submitting} label="시장가" onPress={() => { setOrderType("MARKET"); setConfirming(false); }} tone={orderType === "MARKET" ? "primary" : "neutral"} /><NusaButton disabled={submitting} label="지정가" onPress={() => { setOrderType("LIMIT"); setConfirming(false); }} tone={orderType === "LIMIT" ? "primary" : "neutral"} /></View>
      {orderType === "LIMIT" ? <NusaTextField autoCorrect={false} editable={!submitting} keyboardType="decimal-pad" label="가격" value={priceInput} onChangeText={(value) => { setPriceInput(value); setConfirming(false); }} placeholder="KRW 가격" returnKeyType="done" /> : null}
      <NusaTextField autoCorrect={false} editable={!submitting} keyboardType="decimal-pad" label={`수량 (${tradingAssetCode(model.market)})`} value={quantityInput} onChangeText={(value) => { setQuantityInput(value); setConfirming(false); }} placeholder="수량" returnKeyType="done" />
      <NusaCard><Text style={[styles.label, { color: theme.colors.textMuted }]}>PAPER 주문 미리보기</Text><DataRow label="예상 금액" value={formatTradingAmount(model.estimatedNotional, "KRW")} /><DataRow label="사용 가능" value={formatTradingAmount(model.availableAmount, model.availableUnit)} /></NusaCard>
      {model.validationErrors.length > 0 || model.blockedReasons.length > 0 ? <NusaCard><Text style={[styles.label, { color: theme.colors.warning }]}>주문 차단 사유</Text>{[...model.validationErrors, ...model.blockedReasons].map((reason) => <Text key={reason} style={[styles.reason, { color: theme.colors.textMuted }]}>{reason}</Text>)}</NusaCard> : null}
      {!confirming ? <NusaButton label={submitEnabled ? `${side === "BUY" ? "매수" : "매도"} PAPER 주문 확인` : "PAPER 주문 사용 불가"} disabled={!submitEnabled} onPress={requestSubmit} /> : <NusaCard raised><Text style={[styles.cardTitle, { color: theme.colors.text }]}>최종 PAPER 주문 확인</Text><Text style={[styles.stateMessage, { color: theme.colors.textMuted }]}>실거래가 아닙니다. {model.market} · {side} · {orderType} · {quantityInput} {tradingAssetCode(model.market)}</Text><View style={styles.segmentRow}><NusaButton label={submitting ? "전송 중..." : "PAPER 주문 확정"} disabled={submitting} onPress={() => void submitBuiltIn()} /><NusaButton label="취소" disabled={submitting} onPress={() => setConfirming(false)} tone="neutral" /></View></NusaCard>}
      {submitMessage ? <NusaCard><Text style={[styles.stateMessage, { color: theme.colors.text }]}>{submitMessage}</Text></NusaCard> : null}
    </>}
  </ScrollView>;
}

const styles = StyleSheet.create({ content: { paddingHorizontal: 20, paddingTop: 18, gap: 14, paddingBottom: 32, width: "100%", maxWidth: 1080, alignSelf: "center" }, state: { flex: 1, justifyContent: "center", padding: 20, gap: 14, alignItems: "center" }, stateInner: { width: "100%", maxWidth: 720 }, stateTitle: { fontSize: 18, fontWeight: "700" }, stateMessage: { lineHeight: 21, fontSize: 14 }, statusRow: { flexDirection: "row", gap: 7, flexWrap: "wrap" }, marketHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }, market: { marginTop: 4, fontSize: 20, fontWeight: "700" }, label: { fontSize: 11, fontWeight: "700", letterSpacing: 0.7 }, price: { fontSize: 34, fontWeight: "800", letterSpacing: -1.2, marginTop: 12, fontVariant: ["tabular-nums"] }, divider: { height: 1, marginVertical: 13 }, segmentRow: { flexDirection: "row", gap: 10, flexWrap: "wrap" }, cardTitle: { fontSize: 18, fontWeight: "700", letterSpacing: -0.4 }, reason: { marginTop: 7, fontSize: 13 } });