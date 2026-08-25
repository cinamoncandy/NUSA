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
import { LOCAL_PAPER_INITIAL_CASH, LOCAL_PAPER_MARKET, buildLocalPortfolio, isLocalPaperActive, placeLocalPaperOrder } from "./localPaperLedger";
import { useLocalPaperSnapshot } from "./localPaperLedgerHooks";

interface TradingViewProps { readonly snapshot: PortfolioAccountResponse | null; readonly investmentPercent: number; readonly marketConnectionState: string; readonly stale: boolean; readonly error: string | null; readonly refreshing: boolean; readonly onRefresh: () => void; readonly onSubmit?: (draft: TradingDraft) => void; readonly runtimeCanSubmit?: boolean; readonly onOpenPaperLearning?: () => void; }
type OrderPhase = "IDLE" | "REVIEW" | "SUBMITTING" | "FILLED" | "ERROR";

function ErrorState({ message, onRetry }: Readonly<{ message: string; onRetry: () => void }>) { const { theme } = useTheme(); return <View style={styles.state}><View style={styles.stateInner}><InlineNotice title="PAPER 화면을 표시할 수 없습니다" detail={message} tone="danger" /><NusaButton label="다시 불러오기" onPress={onRetry} /></View></View>; }
const idempotencyKey = (): string => `paper-mobile-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
const processPaperOrderRetryIdentity = new PersonalPaperOrderRetryIdentity();
const SIDE_ITEMS = Object.freeze([{ key: "BUY", label: "매수" }, { key: "SELL", label: "매도" }]);
const ORDER_TYPE_ITEMS = Object.freeze([{ key: "MARKET", label: "시장가" }, { key: "LIMIT", label: "지정가" }]);

export function TradingView({ snapshot, investmentPercent, marketConnectionState, stale, error, refreshing, onRefresh, onSubmit, runtimeCanSubmit = true, onOpenPaperLearning }: TradingViewProps) {
  const { theme } = useTheme();
  const [side, setSide] = useState<TradingOrderSide>("BUY");
  const [orderType, setOrderType] = useState<TradingOrderType>("MARKET");
  const [priceInput, setPriceInput] = useState("");
  const [quantityInput, setQuantityInput] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitMessage, setSubmitMessage] = useState<string | null>(null);
  const [orderPhase, setOrderPhase] = useState<OrderPhase>("IDLE");
  const localTradingSnapshot = useLocalPaperSnapshot();
  const [localMarkPrice, setLocalMarkPrice] = useState<number | null>(null);
  const [localCandles, setLocalCandles] = useState<readonly PublicCandle[] | null>(null);
  const [localPriceError, setLocalPriceError] = useState<string | null>(null);
  const [localChartError, setLocalChartError] = useState<string | null>(null);
  const credentialSession = useMemo(() => new InMemoryDashboardCredentialSession(), []);
  const configuredEndpoint = getConfiguredPaperEndpoint();
  const usingLocalPaper = isLocalPaperActive();
  const effectiveMarkPrice = localMarkPrice ?? (snapshot?.account.markPrice && snapshot.account.markPrice > 0 ? snapshot.account.markPrice : null);
  const effectiveSnapshot = usingLocalPaper ? buildLocalPortfolio(localTradingSnapshot, effectiveMarkPrice) : snapshot;
  const effectiveConnectionState = usingLocalPaper ? (effectiveMarkPrice != null ? "CONNECTED" : "UNKNOWN") : marketConnectionState;
  const effectiveStale = usingLocalPaper ? effectiveMarkPrice == null : stale;
  const draft = useMemo(() => ({ side, orderType, priceInput, quantityInput }), [orderType, priceInput, quantityInput, side]);

  useEffect(() => {
    if (!usingLocalPaper) return;
    let active = true;
    const refreshLocalMarket = async (): Promise<void> => {
      const [tickerResult, candleResult] = await Promise.allSettled([
        loadUpbitPublicMarkets(),
        loadUpbitPublicCandles({ market: LOCAL_PAPER_MARKET, count: 120 }),
      ]);
      if (!active) return;
      if (tickerResult.status === "fulfilled") {
        const selected = tickerResult.value.find((market) => market.market === LOCAL_PAPER_MARKET);
        if (selected && Number.isFinite(selected.price) && selected.price > 0) { setLocalMarkPrice(selected.price); setLocalPriceError(null); }
        else { setLocalMarkPrice(null); setLocalPriceError("KRW-BTC 공개 시세를 아직 받지 못했습니다."); }
      } else {
        setLocalPriceError(tickerResult.reason instanceof Error ? tickerResult.reason.message : "Upbit 공개 시세를 불러올 수 없습니다.");
      }
      if (candleResult.status === "fulfilled") { setLocalCandles(candleResult.value); setLocalChartError(null); }
      else { setLocalChartError(candleResult.reason instanceof Error ? candleResult.reason.message : "Upbit 공개 캔들을 불러올 수 없습니다."); }
    };
    void refreshLocalMarket();
    const timer = setInterval(() => { void refreshLocalMarket(); }, 10_000);
    return () => { active = false; clearInterval(timer); };
  }, [usingLocalPaper]);

  if (!usingLocalPaper && error) return <ErrorState message={error} onRetry={onRefresh} />;
  if (effectiveSnapshot === null) return <ErrorState message="PAPER 상태를 준비할 수 없습니다." onRetry={onRefresh} />;
  if (effectiveSnapshot.account.available === false || !effectiveSnapshot.account.position.market.trim()) return <View style={styles.state} testID="trading-empty"><View style={styles.stateInner}><InlineNotice title="관찰 가능한 시장이 없습니다" detail="시장 데이터가 준비되면 PAPER 주문 작업공간이 활성화됩니다." tone="warning" /><NusaButton label="다시 불러오기" onPress={onRefresh} /></View></View>;

  const cashEnvelope = createCashInvestmentEnvelope(effectiveSnapshot.account.cash, investmentPercent);
  const localPaperSubmitAvailable = usingLocalPaper && effectiveMarkPrice != null;
  const cloudPaperSubmitAvailable = runtimeCanSubmit && !usingLocalPaper;
  const submitAvailable = onSubmit !== undefined || localPaperSubmitAvailable || cloudPaperSubmitAvailable;
  const modelCash = side === "BUY" ? cashEnvelope.investableCash : effectiveSnapshot.account.cash;
  const model = buildTradingViewModel({ market: { market: effectiveSnapshot.account.position.market, connectionState: effectiveConnectionState, stale: effectiveStale, price: effectiveSnapshot.account.markPrice }, account: { mode: effectiveSnapshot.mode, liveMutationAllowed: false, cash: modelCash, assetQuantity: effectiveSnapshot.account.position.quantity, market: effectiveSnapshot.account.position.market }, draft, submitAvailable });
  const submitEnabled = submitAvailable && model.canSubmit && !submitting;
  const marketReady = !model.blockedReasons.includes("MARKET_DATA_NOT_READY");
  const allocationRatio = Math.max(0, Math.min(100, cashEnvelope.investmentPercent));
  const positionQuantity = effectiveSnapshot.account.position.quantity;
  const sellQuantity = Number(quantityInput);
  const sellRatio = positionQuantity > 0 && Number.isFinite(sellQuantity) && sellQuantity > 0 ? Math.max(0, Math.min(100, (sellQuantity / positionQuantity) * 100)) : 0;
  const remainingInvestableCash = model.estimatedNotional === null ? cashEnvelope.investableCash : Math.max(0, cashEnvelope.investableCash - model.estimatedNotional);
  const chartModel = buildChartViewModel({ market: LOCAL_PAPER_MARKET, interval: "1m", rawCandles: localCandles ? [...localCandles] : null, currentPrice: localMarkPrice, connectionState: localMarkPrice != null ? "CONNECTED" : "UNKNOWN", stale: localMarkPrice == null });
  const chartBars = chartModel.bars.slice(-60);
  const recentOrders = [...localTradingSnapshot.orders].reverse().slice(0, 6);

  const submitBuiltIn = async () => {
    setSubmitting(true); setSubmitMessage(null); setOrderPhase("SUBMITTING");
    try {
      const quantity = Number(quantityInput);
      const limitPrice = orderType === "LIMIT" ? Number(priceInput) : undefined;
      if (usingLocalPaper) {
        const price = limitPrice ?? model.currentPrice;
        if (!Number.isFinite(quantity) || quantity <= 0 || price == null || !Number.isFinite(price) || price <= 0) { setSubmitMessage("수량과 공개 시세를 확인하세요."); setOrderPhase("ERROR"); return; }
        const order = await placeLocalPaperOrder({ market: model.market, side, quantity, price, nowMs: Date.now() });
        setSubmitMessage(`LOCAL PAPER 체결 완료 · ${order.id}`); setOrderPhase("FILLED");
        setQuantityInput(""); setPriceInput(""); return;
      }
      if (!configuredEndpoint || !isPaperConnectionVerified(configuredEndpoint)) { setSubmitMessage("설정에서 PAPER endpoint와 세션을 먼저 검증하세요."); setOrderPhase("ERROR"); return; }
      const fingerprint = JSON.stringify([model.market, side, orderType, quantity, limitPrice ?? null, investmentPercent]);
      const result = await submitPersonalPaperOrderWithRetryIdentity({ baseUrl: configuredEndpoint, credentialProvider: credentialSession.credentialProvider }, processPaperOrderRetryIdentity, fingerprint, idempotencyKey, { schemaVersion: 1, authority: "PAPER_ONLY", productionMutationAllowed: false, market: model.market, side, orderType, quantity, ...(limitPrice === undefined ? {} : { limitPrice }) });
      if (result.status === "READY") { const filled = result.result.status === "FILLED"; setSubmitMessage(filled ? `PAPER 체결 완료 · ${result.result.order?.id ?? ""}` : `${result.result.status}${result.result.reason ? ` · ${result.result.reason}` : ""}`); setOrderPhase(filled ? "FILLED" : "ERROR"); if (filled) { setQuantityInput(""); setPriceInput(""); } await Promise.resolve(onRefresh()); } else { setSubmitMessage(result.reason); setOrderPhase("ERROR"); }
    } catch (submitError) { setSubmitMessage(submitError instanceof Error ? submitError.message : "PAPER 주문을 처리할 수 없습니다."); setOrderPhase("ERROR"); }
    finally { setSubmitting(false); setConfirming(false); }
  };
  const requestSubmit = () => { if (!submitEnabled) return; if (onSubmit) { onSubmit(draft); return; } setConfirming(true); setOrderPhase("REVIEW"); };
  const changeSide = (key: string) => { setSide(key as TradingOrderSide); setConfirming(false); setOrderPhase("IDLE"); };
  const changeOrderType = (key: string) => { setOrderType(key as TradingOrderType); setConfirming(false); setOrderPhase("IDLE"); };

  return <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl tintColor={theme.colors.primary} refreshing={refreshing} onRefresh={usingLocalPaper ? () => undefined : onRefresh} />} testID="trading-screen">
    <ScreenHeader eyebrow="PAPER" title="주문" description="조건을 입력하고 검토한 뒤 PAPER 주문을 확정합니다." statusLabel="LIVE NONE" statusTone="primary" />
    {onOpenPaperLearning ? <NusaButton label="PAPER 학습 보기" tone="neutral" onPress={onOpenPaperLearning} testID="trade-paper-learning" /> : null}
    <View style={styles.quoteHero} testID="paper-quote-hero"><View style={styles.quoteTop}><View><Text style={[styles.eyebrow, { color: theme.colors.textMuted }]}>현재 시장</Text><Text style={[styles.market, { color: theme.colors.text }]}>{model.market}</Text></View><View style={styles.statusRow}><StatusChip label={usingLocalPaper ? "LOCAL PAPER" : "CLOUD PAPER"} tone="primary" /><StatusChip label={marketReady ? "UPBIT PUBLIC LIVE" : "UPBIT 대기"} tone={marketReady ? "success" : "warning"} />{effectiveStale ? <StatusChip label="데이터 점검" tone="warning" /> : null}</View></View><Text style={[styles.price, { color: theme.colors.text }]}>{model.currentPrice === null ? "-" : formatTradingAmount(model.currentPrice, "KRW")}</Text><Text style={[styles.quoteMeta, { color: theme.colors.textMuted }]}>Upbit 공개 시세 연결 · 실제 주문 권한 없음 · Production mutation 금지</Text></View>

    {usingLocalPaper ? <View style={[styles.marketPanel, { borderColor: theme.colors.border, backgroundColor: theme.colors.surfaceSunken }]} testID="paper-upbit-market-panel"><View style={styles.panelHeader}><View><Text style={[styles.stepLabel, { color: theme.colors.textMuted }]}>UPBIT PUBLIC MARKET</Text><Text style={[styles.panelTitle, { color: theme.colors.text }]}>KRW-BTC 1분 차트</Text></View><StatusChip label={chartModel.state === "READY" ? "차트 LIVE" : "차트 대기"} tone={chartModel.state === "READY" ? "success" : "warning"} /></View>{chartModel.state === "READY" ? <View style={styles.miniChart} testID="paper-upbit-chart">{chartBars.map((bar) => <View key={bar.openTime} style={styles.chartColumn}><View style={[styles.chartWick, { backgroundColor: bar.up ? theme.colors.success : theme.colors.danger, top: `${bar.wickTop}%`, height: `${bar.wickHeight}%` }]} /><View style={[styles.chartBody, { backgroundColor: bar.up ? theme.colors.success : theme.colors.danger, top: `${bar.bodyTop}%`, height: `${bar.bodyHeight}%` }]} /></View>)}</View> : <InlineNotice title="차트를 불러오는 중" detail={localChartError ?? chartModel.error ?? "Upbit 1분 캔들을 기다리고 있습니다."} tone="warning" />}{localPriceError ? <InlineNotice title="Upbit 공개 시세 확인 필요" detail={localPriceError} tone="warning" /> : null}</View> : null}

    <View style={styles.ticket} testID="paper-order-ticket">
      {usingLocalPaper ? <InlineNotice title="LOCAL PAPER 즉시 실행" detail={`Cloud 연결 없이 가상자금 KRW ${LOCAL_PAPER_INITIAL_CASH.toLocaleString("ko-KR")}으로 거래합니다. 실제 주문은 전송되지 않습니다.`} tone="success" testID="local-paper-ready" /> : null}
      <View style={[styles.progressPanel, { borderColor: theme.colors.border }]} testID="paper-order-progress"><Text style={[styles.stepLabel, { color: theme.colors.textMuted }]}>ORDER PIPELINE</Text><View style={styles.progressRow}><StatusChip label="조건 입력" tone={orderPhase === "IDLE" ? "primary" : "info"} /><StatusChip label="검토" tone={orderPhase === "REVIEW" ? "primary" : "info"} /><StatusChip label="전송" tone={orderPhase === "SUBMITTING" ? "warning" : "info"} /><StatusChip label="체결" tone={orderPhase === "FILLED" ? "success" : orderPhase === "ERROR" ? "warning" : "info"} /></View></View>
      <View style={styles.ticketSection}><Text style={[styles.stepLabel, { color: theme.colors.textMuted }]}>01 · 주문 조건</Text><SegmentedControl disabled={submitting} items={SIDE_ITEMS} selectedKey={side} onChange={changeSide} testID="paper-side-segmented-control" /><SegmentedControl disabled={submitting} items={ORDER_TYPE_ITEMS} selectedKey={orderType} onChange={changeOrderType} testID="paper-type-segmented-control" />{orderType === "LIMIT" ? <NusaTextField autoCorrect={false} editable={!submitting} keyboardType="decimal-pad" label="지정 가격" value={priceInput} onChangeText={(value) => { setPriceInput(value); setConfirming(false); setOrderPhase("IDLE"); }} placeholder="KRW 가격" returnKeyType="done" /> : null}<NusaTextField autoCorrect={false} editable={!submitting} keyboardType="decimal-pad" label={`수량 (${tradingAssetCode(model.market)})`} value={quantityInput} onChangeText={(value) => { setQuantityInput(value); setConfirming(false); setOrderPhase("IDLE"); }} placeholder="수량" returnKeyType="done" /></View>
      {side === "BUY" ? <View style={[styles.allocationPanel, { borderColor: theme.colors.border, backgroundColor: theme.colors.surfaceSunken }]} testID="paper-allocation-panel"><View style={styles.allocationTop}><View><Text style={[styles.eyebrow, { color: theme.colors.textMuted }]}>주문 가능 현금</Text><Text style={[styles.allocationValue, { color: theme.colors.text }]}>{formatTradingAmount(cashEnvelope.investableCash, "KRW")}</Text></View><Text style={[styles.allocationPercent, { color: theme.colors.primary }]}>{cashEnvelope.investmentPercent}%</Text></View><View style={[styles.allocationTrack, { backgroundColor: theme.colors.border }]}><View style={[styles.allocationFill, { width: `${allocationRatio}%`, backgroundColor: theme.colors.primary }]} /></View><View style={styles.allocationAmounts}><Text style={[styles.smallCopy, { color: theme.colors.textMuted }]}>전체 현금 {formatTradingAmount(effectiveSnapshot.account.cash, "KRW")}</Text><Text style={[styles.smallCopy, { color: theme.colors.textMuted }]}>보호 현금 {formatTradingAmount(cashEnvelope.reservedCash, "KRW")}</Text></View></View> : <View style={[styles.allocationPanel, { borderColor: theme.colors.border, backgroundColor: theme.colors.surfaceSunken }]} testID="paper-holdings-panel"><View style={styles.allocationTop}><View><Text style={[styles.eyebrow, { color: theme.colors.textMuted }]}>매도 가능 수량</Text><Text style={[styles.allocationValue, { color: theme.colors.text }]}>{positionQuantity} {tradingAssetCode(model.market)}</Text></View><Text style={[styles.allocationPercent, { color: theme.colors.primary }]}>{Math.round(sellRatio)}%</Text></View><View style={[styles.allocationTrack, { backgroundColor: theme.colors.border }]}><View style={[styles.allocationFill, { width: `${sellRatio}%`, backgroundColor: theme.colors.primary }]} /></View><View style={styles.allocationAmounts}><Text style={[styles.smallCopy, { color: theme.colors.textMuted }]}>평균 단가 {formatTradingAmount(effectiveSnapshot.account.position.averagePrice, "KRW")}</Text><Text style={[styles.smallCopy, { color: theme.colors.textMuted }]}>현금 배분 비중과 무관하게 보유 수량 전체까지 매도 가능</Text></View></View>}
      <View style={styles.ticketSection}><Text style={[styles.stepLabel, { color: theme.colors.textMuted }]}>02 · 주문 검토</Text><View style={[styles.preview, { borderColor: theme.colors.border }]}><DataRow label="예상 주문 금액" value={formatTradingAmount(model.estimatedNotional, "KRW")} emphasis /><DataRow label={side === "BUY" ? "주문 가능" : "보유 가능"} value={formatTradingAmount(model.availableAmount, model.availableUnit)} />{side === "BUY" ? <DataRow label="주문 후 투자 가능 현금" value={formatTradingAmount(remainingInvestableCash, "KRW")} tone="success" testID="paper-remaining-investable-cash" /> : null}</View></View>
      {side === "BUY" && cashEnvelope.investmentPercent === 0 ? <InlineNotice title="신규 매수 비중이 0%입니다" detail="설정에서 투자 비중을 높이기 전까지 현금 전액을 보호합니다. 매도는 계속 가능합니다." tone="warning" /> : null}
      {!submitAvailable ? <InlineNotice title="PAPER 주문 연결이 필요합니다" detail={usingLocalPaper ? "Upbit 공개 KRW-BTC 시세를 받으면 LOCAL PAPER 주문을 사용할 수 있습니다." : "설정에서 Cloud endpoint와 메모리 세션을 검증하면 주문을 사용할 수 있습니다."} tone="warning" /> : null}
      {!usingLocalPaper && !runtimeCanSubmit ? <InlineNotice title="PAPER 주문이 잠시 차단되었습니다" detail="네트워크 또는 복구 상태를 확인하는 동안 신규 주문을 fail-closed로 막습니다." tone="warning" testID="paper-runtime-blocked" /> : null}
      {model.validationErrors.length > 0 || model.blockedReasons.length > 0 ? <InlineNotice title="주문 조건을 확인하세요" detail={[...model.validationErrors, ...model.blockedReasons].join(" · ")} tone="warning" /> : null}
      <View style={styles.ticketSection}><Text style={[styles.stepLabel, { color: theme.colors.textMuted }]}>03 · 확정</Text>{!confirming ? <NusaButton label={submitEnabled ? `${side === "BUY" ? "매수" : "매도"} 주문 검토` : "PAPER 주문 사용 불가"} disabled={!submitEnabled} onPress={requestSubmit} /> : <View style={[styles.confirmPanel, { borderColor: theme.colors.primary, backgroundColor: theme.colors.surfaceSunken }]}><Text style={[styles.confirmTitle, { color: theme.colors.text }]}>이 PAPER 주문을 확정할까요?</Text><Text style={[styles.confirmCopy, { color: theme.colors.textMuted }]}>{model.market} · {side === "BUY" ? "매수" : "매도"} · {orderType === "MARKET" ? "시장가" : "지정가"} · {quantityInput || "-"} {tradingAssetCode(model.market)}</Text>{side === "BUY" ? <Text style={[styles.confirmCopy, { color: theme.colors.textMuted }]}>투자 {cashEnvelope.investmentPercent}% · 보호 {cashEnvelope.reservePercent}%</Text> : null}<View style={styles.confirmActions}><NusaButton label={submitting ? "전송 중..." : "PAPER 주문 확정"} disabled={submitting} onPress={() => void submitBuiltIn()} /><NusaButton label="돌아가기" disabled={submitting} onPress={() => { setConfirming(false); setOrderPhase("IDLE"); }} tone="neutral" /></View></View>}</View>
      {submitMessage ? <InlineNotice title="PAPER 주문 결과" detail={submitMessage} tone={orderPhase === "FILLED" ? "success" : "warning"} /> : null}

      {usingLocalPaper ? <View style={[styles.ledgerPanel, { borderColor: theme.colors.border, backgroundColor: theme.colors.surfaceSunken }]} testID="paper-local-ledger"><View style={styles.panelHeader}><View><Text style={[styles.stepLabel, { color: theme.colors.textMuted }]}>LOCAL PAPER LEDGER</Text><Text style={[styles.panelTitle, { color: theme.colors.text }]}>잔고 · 포지션 · 최근 체결</Text></View><StatusChip label={`${localTradingSnapshot.orders.length} 체결`} tone={localTradingSnapshot.orders.length > 0 ? "success" : "info"} /></View><DataRow label="KRW 현금" value={formatTradingAmount(effectiveSnapshot.account.cash, "KRW")} /><DataRow label="BTC 보유" value={`${effectiveSnapshot.account.position.quantity} BTC`} /><DataRow label="평균 매수가" value={formatTradingAmount(effectiveSnapshot.account.position.averagePrice, "KRW")} /><DataRow label="평가 손익" value={formatTradingAmount(effectiveSnapshot.account.unrealizedPnl, "KRW")} tone={effectiveSnapshot.account.unrealizedPnl >= 0 ? "success" : undefined} />{recentOrders.length === 0 ? <Text style={[styles.emptyLedger, { color: theme.colors.textMuted }]}>아직 체결된 PAPER 주문이 없습니다.</Text> : recentOrders.map((order) => <View key={order.id} style={[styles.orderRow, { borderTopColor: theme.colors.border }]}><View><Text style={[styles.orderTitle, { color: theme.colors.text }]}>{order.side === "BUY" ? "매수" : "매도"} · {order.quantity} BTC</Text><Text style={[styles.smallCopy, { color: theme.colors.textMuted }]}>{new Date(order.createdAtMs).toLocaleTimeString("ko-KR")} · {formatTradingAmount(order.price, "KRW")}</Text></View><StatusChip label={order.status} tone={order.status === "FILLED" ? "success" : "warning"} /></View>)}</View> : null}
    </View>
  </ScrollView>;
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingTop: 20, gap: 20, paddingBottom: 44, width: "100%", maxWidth: 820, alignSelf: "center" },
  state: { flex: 1, justifyContent: "center", padding: 20, gap: 14, alignItems: "center" }, stateInner: { width: "100%", maxWidth: 720, gap: 12 }, stateTitle: { fontSize: 18, fontWeight: "700" },
  quoteHero: { paddingVertical: 6, gap: 7 }, quoteTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }, statusRow: { flexDirection: "row", gap: 7, flexWrap: "wrap", justifyContent: "flex-end" }, eyebrow: { fontSize: 10, lineHeight: 15, fontWeight: "800", letterSpacing: 1.2 }, market: { marginTop: 4, fontSize: 18, lineHeight: 23, fontWeight: "800" }, price: { fontSize: 38, lineHeight: 45, fontWeight: "800", letterSpacing: -1.4, fontVariant: ["tabular-nums"] }, quoteMeta: { fontSize: 11, lineHeight: 17 },
  marketPanel: { borderWidth: 1, borderRadius: 18, padding: 16, gap: 12 }, panelHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }, panelTitle: { marginTop: 4, fontSize: 18, lineHeight: 24, fontWeight: "800" }, miniChart: { height: 180, flexDirection: "row", alignItems: "stretch", gap: 1, overflow: "hidden", position: "relative" }, chartColumn: { flex: 1, minWidth: 2, position: "relative" }, chartWick: { position: "absolute", left: "50%", width: 1 }, chartBody: { position: "absolute", left: "15%", right: "15%", minHeight: 2 },
  ticket: { gap: 24 }, ticketSection: { gap: 10 }, stepLabel: { fontSize: 10, lineHeight: 15, fontWeight: "800", letterSpacing: 1.15 }, progressPanel: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 16, padding: 14, gap: 10 }, progressRow: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  allocationPanel: { borderWidth: 1, borderRadius: 18, padding: 16, gap: 12 }, allocationTop: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }, allocationValue: { marginTop: 5, fontSize: 24, lineHeight: 30, fontWeight: "800", fontVariant: ["tabular-nums"] }, allocationPercent: { fontSize: 18, lineHeight: 24, fontWeight: "800" }, allocationTrack: { height: 6, borderRadius: 999, overflow: "hidden" }, allocationFill: { height: "100%", borderRadius: 999 }, allocationAmounts: { flexDirection: "row", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }, smallCopy: { fontSize: 11, lineHeight: 17, fontWeight: "600" },
  preview: { borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: 4 }, confirmPanel: { borderWidth: 1, borderRadius: 18, padding: 16, gap: 10 }, confirmTitle: { fontSize: 19, lineHeight: 25, fontWeight: "800" }, confirmCopy: { fontSize: 13, lineHeight: 20, fontWeight: "600" }, confirmActions: { flexDirection: "row", gap: 10, flexWrap: "wrap", marginTop: 4 },
  ledgerPanel: { borderWidth: 1, borderRadius: 18, padding: 16, gap: 8 }, emptyLedger: { fontSize: 12, lineHeight: 18, marginTop: 8 }, orderRow: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 10, marginTop: 4, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }, orderTitle: { fontSize: 13, lineHeight: 19, fontWeight: "700" },
});
