import React, { useEffect, useMemo, useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { DataRow, NusaButton, NusaTextField, StatusChip } from "./components";
import { InlineNotice, ScreenHeader, SegmentedControl } from "./uxPrimitives";
import { useTheme } from "./ThemeProvider";
import { buildTradingViewModel, formatTradingAmount, tradingAssetCode, type TradingDraft, type TradingOrderSide, type TradingOrderType } from "./tradingViewModel";
import type { PortfolioAccountResponse } from "./portfolioViewModel";
import { createCashInvestmentEnvelope } from "./capitalAllocationGuard";
import { InMemoryDashboardCredentialSession } from "./dashboardCredentialSession";
import { getConfiguredPaperEndpoint, isPaperConnectionVerified } from "./paperConnectionSession";
import { PersonalPaperOrderRetryIdentity, submitPersonalPaperOrderWithRetryIdentity } from "./personalPaperOrderClient";
import { loadUpbitPublicCandles, loadUpbitPublicMarkets } from "./upbitPublicQuotationClient";
import { buildChartViewModel, type PublicCandle } from "./chartViewModel";
import { LOCAL_PAPER_INITIAL_CASH, LOCAL_PAPER_MARKET, getLocalPaperState, placeLocalPaperOrder, restoreLocalPaperState, setLocalPaperMarkPrice, subscribeLocalPaper, type LocalPaperState } from "./localPaperStore";

interface TradingViewProps { readonly snapshot: PortfolioAccountResponse | null; readonly investmentPercent: number; readonly marketConnectionState: string; readonly stale: boolean; readonly error: string | null; readonly refreshing: boolean; readonly onRefresh: () => void; readonly onSubmit?: (draft: TradingDraft) => void; readonly runtimeCanSubmit?: boolean; }
type OrderPhase = "IDLE" | "REVIEW" | "SUBMITTING" | "FILLED" | "ERROR";
const SIDE_ITEMS = Object.freeze([{ key: "BUY", label: "매수" }, { key: "SELL", label: "매도" }]);
const ORDER_TYPE_ITEMS = Object.freeze([{ key: "MARKET", label: "시장가" }, { key: "LIMIT", label: "지정가" }]);
const idempotencyKey = (): string => `paper-mobile-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
const processPaperOrderRetryIdentity = new PersonalPaperOrderRetryIdentity();

function ErrorState({ message, onRetry }: Readonly<{ message: string; onRetry: () => void }>) { return <View style={styles.state}><InlineNotice title="PAPER 화면을 표시할 수 없습니다" detail={message} tone="danger" /><NusaButton label="다시 불러오기" onPress={onRetry} /></View>; }

export function TradingView({ snapshot, investmentPercent, marketConnectionState, stale, error, refreshing, onRefresh, onSubmit, runtimeCanSubmit = true }: TradingViewProps) {
  const { theme } = useTheme();
  const [side, setSide] = useState<TradingOrderSide>("BUY");
  const [orderType, setOrderType] = useState<TradingOrderType>("MARKET");
  const [priceInput, setPriceInput] = useState("");
  const [quantityInput, setQuantityInput] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitMessage, setSubmitMessage] = useState<string | null>(null);
  const [orderPhase, setOrderPhase] = useState<OrderPhase>("IDLE");
  const [localState, setLocalState] = useState<LocalPaperState>(() => getLocalPaperState());
  const [localCandles, setLocalCandles] = useState<readonly PublicCandle[] | null>(null);
  const [localPriceError, setLocalPriceError] = useState<string | null>(null);
  const [localChartError, setLocalChartError] = useState<string | null>(null);
  const credentialSession = useMemo(() => new InMemoryDashboardCredentialSession(), []);
  const configuredEndpoint = getConfiguredPaperEndpoint();
  const builtInSubmitAvailable = Boolean(configuredEndpoint && credentialSession.isConfigured() && isPaperConnectionVerified(configuredEndpoint));
  const usingLocalPaper = !builtInSubmitAvailable;

  useEffect(() => subscribeLocalPaper(setLocalState), []);
  useEffect(() => { if (usingLocalPaper) void restoreLocalPaperState(); }, [usingLocalPaper]);
  useEffect(() => {
    if (!usingLocalPaper) return;
    let active = true;
    const refreshLocalMarket = async (): Promise<void> => {
      const [tickerResult, candleResult] = await Promise.allSettled([loadUpbitPublicMarkets(), loadUpbitPublicCandles({ market: LOCAL_PAPER_MARKET, count: 120 })]);
      if (!active) return;
      if (tickerResult.status === "fulfilled") {
        const selected = tickerResult.value.find((candidate) => candidate.market === LOCAL_PAPER_MARKET);
        if (selected && Number.isFinite(selected.price) && selected.price > 0) { setLocalPaperMarkPrice(selected.price); setLocalPriceError(null); }
        else { setLocalPaperMarkPrice(null); setLocalPriceError("KRW-BTC 공개 시세를 아직 받지 못했습니다."); }
      } else { setLocalPaperMarkPrice(null); setLocalPriceError(tickerResult.reason instanceof Error ? tickerResult.reason.message : "Upbit 공개 시세를 불러올 수 없습니다."); }
      if (candleResult.status === "fulfilled") { setLocalCandles(candleResult.value); setLocalChartError(null); }
      else setLocalChartError(candleResult.reason instanceof Error ? candleResult.reason.message : "Upbit 공개 캔들을 불러올 수 없습니다.");
    };
    void refreshLocalMarket();
    const timer = setInterval(() => { void refreshLocalMarket(); }, 10_000);
    return () => { active = false; clearInterval(timer); };
  }, [usingLocalPaper]);

  const effectiveSnapshot = usingLocalPaper ? localState.portfolio : snapshot;
  const effectiveMarkPrice = usingLocalPaper ? localState.markPrice : (snapshot?.account.markPrice ?? null);
  const effectiveConnectionState = usingLocalPaper ? (effectiveMarkPrice != null ? "CONNECTED" : "UNKNOWN") : marketConnectionState;
  const effectiveStale = usingLocalPaper ? effectiveMarkPrice == null : stale;
  const draft = useMemo(() => ({ side, orderType, priceInput, quantityInput }), [orderType, priceInput, quantityInput, side]);
  if (!usingLocalPaper && error) return <ErrorState message={error} onRetry={onRefresh} />;
  if (effectiveSnapshot === null) return <ErrorState message="PAPER 상태를 준비할 수 없습니다." onRetry={onRefresh} />;

  const cashEnvelope = createCashInvestmentEnvelope(effectiveSnapshot.account.cash, investmentPercent);
  const localPaperSubmitAvailable = usingLocalPaper && effectiveMarkPrice != null;
  const cloudPaperSubmitAvailable = runtimeCanSubmit && builtInSubmitAvailable;
  const submitAvailable = onSubmit !== undefined || localPaperSubmitAvailable || cloudPaperSubmitAvailable;
  const modelCash = side === "BUY" ? cashEnvelope.investableCash : effectiveSnapshot.account.cash;
  const model = buildTradingViewModel({ market: { market: effectiveSnapshot.account.position.market, connectionState: effectiveConnectionState, stale: effectiveStale, price: effectiveSnapshot.account.markPrice }, account: { mode: effectiveSnapshot.mode, liveMutationAllowed: false, cash: modelCash, assetQuantity: effectiveSnapshot.account.position.quantity, market: effectiveSnapshot.account.position.market }, draft, submitAvailable });
  const submitEnabled = submitAvailable && model.canSubmit && !submitting;
  const marketReady = !model.blockedReasons.includes("MARKET_DATA_NOT_READY");
  const positionQuantity = effectiveSnapshot.account.position.quantity;
  const sellQuantity = Number(quantityInput);
  const sellRatio = positionQuantity > 0 && Number.isFinite(sellQuantity) && sellQuantity > 0 ? Math.max(0, Math.min(100, (sellQuantity / positionQuantity) * 100)) : 0;
  const remainingInvestableCash = model.estimatedNotional === null ? cashEnvelope.investableCash : Math.max(0, cashEnvelope.investableCash - model.estimatedNotional);
  const chartModel = buildChartViewModel({ market: LOCAL_PAPER_MARKET, interval: "1m", rawCandles: localCandles ? [...localCandles] : null, currentPrice: localState.markPrice, connectionState: localState.markPrice != null ? "CONNECTED" : "UNKNOWN", stale: localState.markPrice == null });
  const chartBars = chartModel.bars.slice(-60);
  const recentOrders = [...localState.trading.orders].reverse().slice(0, 6);

  const submitBuiltIn = async (): Promise<void> => {
    setSubmitting(true); setSubmitMessage(null); setOrderPhase("SUBMITTING");
    try {
      const quantity = Number(quantityInput);
      const limitPrice = orderType === "LIMIT" ? Number(priceInput) : undefined;
      if (usingLocalPaper) {
        const price = limitPrice ?? model.currentPrice;
        if (!Number.isFinite(quantity) || quantity <= 0 || price == null || !Number.isFinite(price) || price <= 0) { setSubmitMessage("수량과 공개 시세를 확인하세요."); setOrderPhase("ERROR"); return; }
        const order = await placeLocalPaperOrder({ side, quantity, price, nowMs: Date.now() });
        setSubmitMessage(`LOCAL PAPER 체결 완료 · ${order.id}`); setOrderPhase("FILLED"); setQuantityInput(""); setPriceInput(""); return;
      }
      if (!configuredEndpoint || !isPaperConnectionVerified(configuredEndpoint)) { setSubmitMessage("설정에서 PAPER endpoint와 세션을 먼저 검증하세요."); setOrderPhase("ERROR"); return; }
      const fingerprint = JSON.stringify([model.market, side, orderType, quantity, limitPrice ?? null, investmentPercent]);
      const result = await submitPersonalPaperOrderWithRetryIdentity({ baseUrl: configuredEndpoint, credentialProvider: credentialSession.credentialProvider }, processPaperOrderRetryIdentity, fingerprint, idempotencyKey, { schemaVersion: 1, authority: "PAPER_ONLY", productionMutationAllowed: false, market: model.market, side, orderType, quantity, ...(limitPrice === undefined ? {} : { limitPrice }) });
      if (result.status === "READY") { const filled = result.result.status === "FILLED"; setSubmitMessage(filled ? `PAPER 체결 완료 · ${result.result.order?.id ?? ""}` : `${result.result.status}${result.result.reason ? ` · ${result.result.reason}` : ""}`); setOrderPhase(filled ? "FILLED" : "ERROR"); if (filled) { setQuantityInput(""); setPriceInput(""); } await Promise.resolve(onRefresh()); }
      else { setSubmitMessage(result.reason); setOrderPhase("ERROR"); }
    } catch (submitError) { setSubmitMessage(submitError instanceof Error ? submitError.message : "PAPER 주문을 처리할 수 없습니다."); setOrderPhase("ERROR"); }
    finally { setSubmitting(false); setConfirming(false); }
  };

  const resetReview = (): void => { setConfirming(false); setOrderPhase("IDLE"); };
  const requestSubmit = (): void => { if (!submitEnabled) return; if (onSubmit) { onSubmit(draft); return; } setConfirming(true); setOrderPhase("REVIEW"); };

  return <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl tintColor={theme.colors.primary} refreshing={refreshing} onRefresh={usingLocalPaper ? () => undefined : onRefresh} />} testID="trading-screen">
    <ScreenHeader eyebrow="PAPER" title="주문" description="조건을 입력하고 검토한 뒤 PAPER 주문을 확정합니다." statusLabel="LIVE NONE" statusTone="primary" />
    <View style={styles.hero} testID="paper-quote-hero"><View style={styles.row}><View><Text style={[styles.eyebrow, { color: theme.colors.textMuted }]}>현재 시장</Text><Text style={[styles.market, { color: theme.colors.text }]}>{model.market}</Text></View><View style={styles.chips}><StatusChip label={usingLocalPaper ? "LOCAL PAPER" : "CLOUD PAPER"} tone="primary" /><StatusChip label={marketReady ? "UPBIT PUBLIC LIVE" : "UPBIT 대기"} tone={marketReady ? "success" : "warning"} /></View></View><Text style={[styles.price, { color: theme.colors.text }]}>{model.currentPrice === null ? "-" : formatTradingAmount(model.currentPrice, "KRW")}</Text><Text style={[styles.meta, { color: theme.colors.textMuted }]}>실제 주문 권한 없음 · Production mutation 금지</Text></View>

    {usingLocalPaper ? <View style={[styles.panel, { borderColor: theme.colors.border, backgroundColor: theme.colors.surfaceSunken }]} testID="paper-upbit-market-panel"><View style={styles.row}><Text style={[styles.title, { color: theme.colors.text }]}>KRW-BTC 1분 차트</Text><StatusChip label={chartModel.state === "READY" ? "차트 LIVE" : "차트 대기"} tone={chartModel.state === "READY" ? "success" : "warning"} /></View>{chartModel.state === "READY" ? <View style={styles.miniChart} testID="paper-upbit-chart">{chartBars.map((bar) => <View key={bar.openTime} style={styles.chartColumn}><View style={[styles.chartWick, { backgroundColor: bar.up ? theme.colors.success : theme.colors.danger, top: `${bar.wickTop}%`, height: `${bar.wickHeight}%` }]} /><View style={[styles.chartBody, { backgroundColor: bar.up ? theme.colors.success : theme.colors.danger, top: `${bar.bodyTop}%`, height: `${bar.bodyHeight}%` }]} /></View>)}</View> : <InlineNotice title="차트를 불러오는 중" detail={localChartError ?? chartModel.error ?? "Upbit 1분 캔들을 기다리고 있습니다."} tone="warning" />}{localPriceError ? <InlineNotice title="Upbit 공개 시세 확인 필요" detail={localPriceError} tone="warning" /> : null}</View> : null}

    <View style={styles.ticket} testID="paper-order-ticket">
      {usingLocalPaper ? <InlineNotice title="LOCAL PAPER 즉시 실행" detail={`Cloud 연결 없이 가상자금 KRW ${LOCAL_PAPER_INITIAL_CASH.toLocaleString("ko-KR")}으로 거래합니다. 실제 주문은 전송되지 않습니다.`} tone="success" testID="local-paper-ready" /> : null}
      <View style={[styles.panel, { borderColor: theme.colors.border }]} testID="paper-order-progress"><Text style={[styles.eyebrow, { color: theme.colors.textMuted }]}>ORDER PIPELINE</Text><View style={styles.chips}><StatusChip label="조건 입력" tone={orderPhase === "IDLE" ? "primary" : "info"} /><StatusChip label="검토" tone={orderPhase === "REVIEW" ? "primary" : "info"} /><StatusChip label="전송" tone={orderPhase === "SUBMITTING" ? "warning" : "info"} /><StatusChip label="체결" tone={orderPhase === "FILLED" ? "success" : orderPhase === "ERROR" ? "warning" : "info"} /></View></View>
      <View style={styles.section}><Text style={[styles.eyebrow, { color: theme.colors.textMuted }]}>01 · 주문 조건</Text><SegmentedControl disabled={submitting} items={SIDE_ITEMS} selectedKey={side} onChange={(key) => { setSide(key as TradingOrderSide); resetReview(); }} testID="paper-side-segmented-control" /><SegmentedControl disabled={submitting} items={ORDER_TYPE_ITEMS} selectedKey={orderType} onChange={(key) => { setOrderType(key as TradingOrderType); resetReview(); }} testID="paper-type-segmented-control" />{orderType === "LIMIT" ? <NusaTextField autoCorrect={false} editable={!submitting} keyboardType="decimal-pad" label="지정 가격" value={priceInput} onChangeText={(value) => { setPriceInput(value); resetReview(); }} placeholder="KRW 가격" returnKeyType="done" /> : null}<NusaTextField autoCorrect={false} editable={!submitting} keyboardType="decimal-pad" label={`수량 (${tradingAssetCode(model.market)})`} value={quantityInput} onChangeText={(value) => { setQuantityInput(value); resetReview(); }} placeholder="수량" returnKeyType="done" /></View>

      {side === "BUY" ? <View style={[styles.panel, { borderColor: theme.colors.border, backgroundColor: theme.colors.surfaceSunken }]} testID="paper-allocation-panel"><DataRow label="주문 가능 현금" value={formatTradingAmount(cashEnvelope.investableCash, "KRW")} emphasis /><DataRow label="보호 현금" value={formatTradingAmount(cashEnvelope.reservedCash, "KRW")} /><DataRow label="주문 후 투자 가능 현금" value={formatTradingAmount(remainingInvestableCash, "KRW")} tone="success" testID="paper-remaining-investable-cash" /></View> : <View style={[styles.panel, { borderColor: theme.colors.border, backgroundColor: theme.colors.surfaceSunken }]} testID="paper-holdings-panel"><DataRow label="매도 가능 수량" value={`${positionQuantity} ${tradingAssetCode(model.market)}`} emphasis /><DataRow label="입력 수량 비중" value={`${Math.round(sellRatio)}%`} /><Text style={[styles.meta, { color: theme.colors.textMuted }]}>현금 배분 비중과 무관하게 보유 수량 전체까지 매도 가능</Text></View>}
      {side === "BUY" && cashEnvelope.investmentPercent === 0 ? <InlineNotice title="신규 매수 비중이 0%입니다" detail="설정에서 투자 비중을 높이기 전까지 현금 전액을 보호합니다. 매도는 계속 가능합니다." tone="warning" /> : null}

      <View style={styles.section}><Text style={[styles.eyebrow, { color: theme.colors.textMuted }]}>02 · 주문 검토</Text><View style={[styles.panel, { borderColor: theme.colors.border }]}><DataRow label="예상 주문 금액" value={formatTradingAmount(model.estimatedNotional, "KRW")} emphasis /><DataRow label={side === "BUY" ? "주문 가능" : "보유 가능"} value={formatTradingAmount(model.availableAmount, model.availableUnit)} /></View></View>
      {!submitAvailable ? <InlineNotice title="PAPER 주문 연결이 필요합니다" detail={usingLocalPaper ? "Upbit 공개 KRW-BTC 시세를 받으면 LOCAL PAPER 주문을 사용할 수 있습니다." : "설정에서 Cloud endpoint와 세션을 검증하세요."} tone="warning" /> : null}
      {!usingLocalPaper && !runtimeCanSubmit ? <InlineNotice title="PAPER 주문이 잠시 차단되었습니다" detail="네트워크 또는 복구 상태를 확인하는 동안 신규 주문을 fail-closed로 막습니다." tone="warning" testID="paper-runtime-blocked" /> : null}
      {model.validationErrors.length > 0 || model.blockedReasons.length > 0 ? <InlineNotice title="주문 조건을 확인하세요" detail={[...model.validationErrors, ...model.blockedReasons].join(" · ")} tone="warning" /> : null}

      <View style={styles.section}><Text style={[styles.eyebrow, { color: theme.colors.textMuted }]}>03 · 확정</Text>{!confirming ? <NusaButton label={submitEnabled ? `${side === "BUY" ? "매수" : "매도"} 주문 검토` : "PAPER 주문 사용 불가"} disabled={!submitEnabled} onPress={requestSubmit} /> : <View style={[styles.panel, { borderColor: theme.colors.primary, backgroundColor: theme.colors.surfaceSunken }]}><Text style={[styles.title, { color: theme.colors.text }]}>이 PAPER 주문을 확정할까요?</Text><Text style={[styles.meta, { color: theme.colors.textMuted }]}>{model.market} · {side} · {orderType} · {quantityInput} {tradingAssetCode(model.market)}</Text><View style={styles.actions}><NusaButton label={submitting ? "전송 중..." : "PAPER 주문 확정"} disabled={submitting} onPress={() => void submitBuiltIn()} /><NusaButton label="돌아가기" disabled={submitting} onPress={resetReview} tone="neutral" /></View></View>}</View>
      {submitMessage ? <InlineNotice title="PAPER 주문 결과" detail={submitMessage} tone={orderPhase === "FILLED" ? "success" : "warning"} /> : null}

      {usingLocalPaper ? <View style={[styles.panel, { borderColor: theme.colors.border, backgroundColor: theme.colors.surfaceSunken }]} testID="paper-local-ledger"><View style={styles.row}><Text style={[styles.title, { color: theme.colors.text }]}>LOCAL PAPER LEDGER</Text><StatusChip label={`${localState.trading.orders.length} 체결`} tone={localState.trading.orders.length > 0 ? "success" : "info"} /></View><DataRow label="KRW 현금" value={formatTradingAmount(effectiveSnapshot.account.cash, "KRW")} /><DataRow label="BTC 보유" value={`${effectiveSnapshot.account.position.quantity} BTC`} /><DataRow label="평균 매수가" value={formatTradingAmount(effectiveSnapshot.account.position.averagePrice, "KRW")} /><DataRow label="실현 손익" value={formatTradingAmount(effectiveSnapshot.account.realizedPnl ?? 0, "KRW")} /><DataRow label="평가 손익" value={formatTradingAmount(effectiveSnapshot.account.unrealizedPnl, "KRW")} tone={effectiveSnapshot.account.unrealizedPnl >= 0 ? "success" : undefined} />{recentOrders.length === 0 ? <Text style={[styles.meta, { color: theme.colors.textMuted }]}>아직 체결된 PAPER 주문이 없습니다.</Text> : recentOrders.map((order) => <View key={order.id} style={styles.orderRow}><Text style={[styles.meta, { color: theme.colors.text }]}>{order.side} · {order.quantity} BTC · {formatTradingAmount(order.price, "KRW")}</Text><StatusChip label={order.status} tone={order.status === "FILLED" ? "success" : "warning"} /></View>)}</View> : null}
    </View>
  </ScrollView>;
}

const styles = StyleSheet.create({ content: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 44, gap: 20, width: "100%", maxWidth: 820, alignSelf: "center" }, state: { flex: 1, justifyContent: "center", padding: 20, gap: 12 }, hero: { gap: 8 }, ticket: { gap: 14 }, section: { gap: 10 }, panel: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 18, padding: 14, gap: 10 }, row: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }, chips: { flexDirection: "row", flexWrap: "wrap", gap: 7 }, actions: { flexDirection: "row", flexWrap: "wrap", gap: 10 }, eyebrow: { fontSize: 10, lineHeight: 15, fontWeight: "800", letterSpacing: 1.1 }, market: { marginTop: 4, fontSize: 18, lineHeight: 23, fontWeight: "800" }, title: { fontSize: 18, lineHeight: 24, fontWeight: "800" }, meta: { fontSize: 12, lineHeight: 18 }, price: { fontSize: 38, lineHeight: 45, fontWeight: "800", letterSpacing: -1.4, fontVariant: ["tabular-nums"] }, miniChart: { height: 180, flexDirection: "row", alignItems: "stretch", gap: 1, overflow: "hidden", position: "relative" }, chartColumn: { flex: 1, minWidth: 2, position: "relative" }, chartWick: { position: "absolute", left: "50%", width: 1 }, chartBody: { position: "absolute", left: "15%", right: "15%", minHeight: 2 }, orderRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10, paddingTop: 6 } });
