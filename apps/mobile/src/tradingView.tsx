import React, { useMemo, useState } from "react";
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { DataRow, NusaButton, NusaTextField, StatusChip } from "./components";
import { InlineNotice, ScreenHeader, SegmentedControl } from "./uxPrimitives";
import { useTheme } from "./ThemeProvider";
import { buildTradingViewModel, formatTradingAmount, tradingAssetCode, type TradingDraft, type TradingOrderSide, type TradingOrderType } from "./tradingViewModel";
import type { PortfolioAccountResponse } from "./portfolioViewModel";
import { createCashInvestmentEnvelope } from "./capitalAllocationGuard";
import { getConfiguredPaperEndpoint, isPaperConnectionVerified } from "./paperConnectionSession";
import { PersonalPaperOrderRetryIdentity, submitPersonalPaperOrderWithRetryIdentity } from "./personalPaperOrderClient";
import { unavailableDashboardCredentialProvider } from "./personalPaperOperationsClient";

interface TradingViewProps { readonly snapshot: PortfolioAccountResponse | null; readonly investmentPercent: number; readonly marketConnectionState: string; readonly stale: boolean; readonly error: string | null; readonly refreshing: boolean; readonly onRefresh: () => void; readonly onSubmit?: (draft: TradingDraft) => void; readonly runtimeCanSubmit?: boolean; }
function ErrorState({ message, onRetry }: Readonly<{ message: string; onRetry: () => void }>) { const { theme } = useTheme(); return <View style={styles.state}><View style={styles.stateInner}><InlineNotice title="PAPER 화면을 표시할 수 없습니다" detail={message} tone="danger" /><NusaButton label="다시 불러오기" onPress={onRetry} /></View></View>; }
const idempotencyKey = (): string => `paper-mobile-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
const processPaperOrderRetryIdentity = new PersonalPaperOrderRetryIdentity();
const SIDE_ITEMS = Object.freeze([{ key: "BUY", label: "매수" }, { key: "SELL", label: "매도" }]);
const ORDER_TYPE_ITEMS = Object.freeze([{ key: "MARKET", label: "시장가" }, { key: "LIMIT", label: "지정가" }]);

export function TradingView({ snapshot, investmentPercent, marketConnectionState, stale, error, refreshing, onRefresh, onSubmit, runtimeCanSubmit = true }: TradingViewProps) {
  const { theme } = useTheme();
  const [side, setSide] = useState<TradingOrderSide>("BUY");
  const [orderType, setOrderType] = useState<TradingOrderType>("MARKET");
  const [priceInput, setPriceInput] = useState("");
  const [quantityInput, setQuantityInput] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitMessage, setSubmitMessage] = useState<string | null>(null);
  const configuredEndpoint = getConfiguredPaperEndpoint();
  const builtInSubmitAvailable = false;
  const draft = useMemo(() => ({ side, orderType, priceInput, quantityInput }), [orderType, priceInput, quantityInput, side]);

  if (error) return <ErrorState message={error} onRetry={onRefresh} />;
  if (snapshot === null) return <View style={styles.state}><ActivityIndicator color={theme.colors.primary} /><Text style={[styles.stateTitle, { color: theme.colors.text }]}>PAPER 상태를 불러오는 중</Text></View>;
  if (snapshot.account.available === false || !snapshot.account.position.market.trim()) return <View style={styles.state} testID="trading-empty"><View style={styles.stateInner}><InlineNotice title="관찰 가능한 시장이 없습니다" detail="시장 데이터가 준비되면 PAPER 주문 작업공간이 활성화됩니다." tone="warning" /><NusaButton label="다시 불러오기" onPress={onRefresh} /></View></View>;

  const cashEnvelope = createCashInvestmentEnvelope(snapshot.account.cash, investmentPercent);
  const submitAvailable = runtimeCanSubmit && (onSubmit !== undefined || builtInSubmitAvailable);
  const modelCash = side === "BUY" ? cashEnvelope.investableCash : snapshot.account.cash;
  const model = buildTradingViewModel({ market: { market: snapshot.account.position.market, connectionState: marketConnectionState, stale, price: snapshot.account.markPrice }, account: { mode: snapshot.mode, liveMutationAllowed: false, cash: modelCash, assetQuantity: snapshot.account.position.quantity, market: snapshot.account.position.market }, draft, submitAvailable });
  const submitEnabled = submitAvailable && model.canSubmit && !submitting;
  const marketReady = !model.blockedReasons.includes("MARKET_DATA_NOT_READY");
  const allocationRatio = Math.max(0, Math.min(100, cashEnvelope.investmentPercent));

  const submitBuiltIn = async () => {
    if (!configuredEndpoint || !isPaperConnectionVerified(configuredEndpoint)) { setSubmitMessage("NUSA Cloud 세션을 사용할 수 없습니다."); return; }
    setSubmitting(true); setSubmitMessage(null);
    try {
      const quantity = Number(quantityInput);
      const limitPrice = orderType === "LIMIT" ? Number(priceInput) : undefined;
      const fingerprint = JSON.stringify([model.market, side, orderType, quantity, limitPrice ?? null, investmentPercent]);
      const result = await submitPersonalPaperOrderWithRetryIdentity({ baseUrl: configuredEndpoint, credentialProvider: unavailableDashboardCredentialProvider }, processPaperOrderRetryIdentity, fingerprint, idempotencyKey, { schemaVersion: 1, authority: "PAPER_ONLY", productionMutationAllowed: false, market: model.market, side, orderType, quantity, ...(limitPrice === undefined ? {} : { limitPrice }) });
      if (result.status === "READY") {
        setSubmitMessage(result.result.status === "FILLED" ? `PAPER 체결 완료 · ${result.result.order?.id ?? ""}` : `${result.result.status}${result.result.reason ? ` · ${result.result.reason}` : ""}`);
        if (result.result.status === "FILLED") { setQuantityInput(""); setPriceInput(""); }
        await Promise.resolve(onRefresh());
      } else setSubmitMessage(result.reason);
    } finally { setSubmitting(false); setConfirming(false); }
  };
  const requestSubmit = () => { if (!submitEnabled) return; if (onSubmit) { onSubmit(draft); return; } setConfirming(true); };
  const changeSide = (key: string) => { setSide(key as TradingOrderSide); setConfirming(false); };
  const changeOrderType = (key: string) => { setOrderType(key as TradingOrderType); setConfirming(false); };

  return <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl tintColor={theme.colors.primary} refreshing={refreshing} onRefresh={onRefresh} />} testID="trading-screen">
    <ScreenHeader eyebrow="PAPER" title="주문" description="조건을 입력하고 검토한 뒤 PAPER 주문을 확정합니다." statusLabel="LIVE NONE" statusTone="primary" />

    <View style={styles.quoteHero} testID="paper-quote-hero">
      <View style={styles.quoteTop}><View><Text style={[styles.eyebrow, { color: theme.colors.textMuted }]}>현재 시장</Text><Text style={[styles.market, { color: theme.colors.text }]}>{model.market}</Text></View><View style={styles.statusRow}><StatusChip label="PAPER ONLY" tone="primary" /><StatusChip label={marketReady ? "온라인" : "대기"} tone={marketReady ? "success" : "warning"} />{stale ? <StatusChip label="데이터 점검" tone="warning" /> : null}</View></View>
      <Text style={[styles.price, { color: theme.colors.text }]}>{model.currentPrice === null ? "-" : formatTradingAmount(model.currentPrice, "KRW")}</Text>
      <Text style={[styles.quoteMeta, { color: theme.colors.textMuted }]}>실제 주문 권한 없음 · Production mutation 금지</Text>
    </View>

    <View style={styles.ticket} testID="paper-order-ticket">
      <View style={styles.ticketSection}><Text style={[styles.stepLabel, { color: theme.colors.textMuted }]}>01 · 주문 조건</Text><SegmentedControl disabled={submitting} items={SIDE_ITEMS} selectedKey={side} onChange={changeSide} testID="paper-side-segmented-control" /><SegmentedControl disabled={submitting} items={ORDER_TYPE_ITEMS} selectedKey={orderType} onChange={changeOrderType} testID="paper-type-segmented-control" />{orderType === "LIMIT" ? <NusaTextField autoCorrect={false} editable={!submitting} keyboardType="decimal-pad" label="지정 가격" value={priceInput} onChangeText={(value) => { setPriceInput(value); setConfirming(false); }} placeholder="KRW 가격" returnKeyType="done" /> : null}<NusaTextField autoCorrect={false} editable={!submitting} keyboardType="decimal-pad" label={`수량 (${tradingAssetCode(model.market)})`} value={quantityInput} onChangeText={(value) => { setQuantityInput(value); setConfirming(false); }} placeholder="수량" returnKeyType="done" /></View>

      {side === "BUY" ? <View style={[styles.allocationPanel, { borderColor: theme.colors.border, backgroundColor: theme.colors.surfaceSunken }]} testID="paper-allocation-panel"><View style={styles.allocationTop}><View><Text style={[styles.eyebrow, { color: theme.colors.textMuted }]}>주문 가능 현금</Text><Text style={[styles.allocationValue, { color: theme.colors.text }]}>{formatTradingAmount(cashEnvelope.investableCash, "KRW")}</Text></View><Text style={[styles.allocationPercent, { color: theme.colors.primary }]}>{cashEnvelope.investmentPercent}%</Text></View><View style={[styles.allocationTrack, { backgroundColor: theme.colors.border }]}><View style={[styles.allocationFill, { width: `${allocationRatio}%`, backgroundColor: theme.colors.primary }]} /></View><View style={styles.allocationAmounts}><Text style={[styles.smallCopy, { color: theme.colors.textMuted }]}>전체 현금 {formatTradingAmount(snapshot.account.cash, "KRW")}</Text><Text style={[styles.smallCopy, { color: theme.colors.textMuted }]}>보호 현금 {formatTradingAmount(cashEnvelope.reservedCash, "KRW")}</Text></View></View> : <InlineNotice title="보유 수량 안에서 매도합니다" detail={`현재 ${snapshot.account.position.quantity} ${tradingAssetCode(model.market)}까지 PAPER 매도를 검증합니다.`} tone="info" />}

      <View style={styles.ticketSection}><Text style={[styles.stepLabel, { color: theme.colors.textMuted }]}>02 · 주문 검토</Text><View style={[styles.preview, { borderColor: theme.colors.border }]}><DataRow label="예상 주문 금액" value={formatTradingAmount(model.estimatedNotional, "KRW")} emphasis /><DataRow label={side === "BUY" ? "주문 가능" : "보유 가능"} value={formatTradingAmount(model.availableAmount, model.availableUnit)} />{side === "BUY" ? <DataRow label="주문 후 보호 현금" value={formatTradingAmount(cashEnvelope.reservedCash, "KRW")} tone="success" /> : null}</View></View>

      {side === "BUY" && cashEnvelope.investmentPercent === 0 ? <InlineNotice title="신규 매수 비중이 0%입니다" detail="설정에서 투자 비중을 높이기 전까지 현금 전액을 보호합니다. 매도는 계속 가능합니다." tone="warning" /> : null}
      {!submitAvailable ? <InlineNotice title="PAPER 주문을 사용할 수 없습니다" detail="NUSA Cloud 모바일 세션이 준비되면 PAPER 권한 범위에서만 사용할 수 있습니다." tone="warning" /> : null}
      {!runtimeCanSubmit ? <InlineNotice title="PAPER 주문이 잠시 차단되었습니다" detail="네트워크 또는 복구 상태를 확인하는 동안 신규 주문을 fail-closed로 막습니다." tone="warning" testID="paper-runtime-blocked" /> : null}
      {model.validationErrors.length > 0 || model.blockedReasons.length > 0 ? <InlineNotice title="주문 조건을 확인하세요" detail={[...model.validationErrors, ...model.blockedReasons].join(" · ")} tone="warning" /> : null}

      <View style={styles.ticketSection}><Text style={[styles.stepLabel, { color: theme.colors.textMuted }]}>03 · 확정</Text>{!confirming ? <NusaButton label={submitEnabled ? `${side === "BUY" ? "매수" : "매도"} 주문 검토` : "PAPER 주문 사용 불가"} disabled={!submitEnabled} onPress={requestSubmit} /> : <View style={[styles.confirmPanel, { borderColor: theme.colors.primary, backgroundColor: theme.colors.surfaceSunken }]}><Text style={[styles.confirmTitle, { color: theme.colors.text }]}>이 PAPER 주문을 확정할까요?</Text><Text style={[styles.confirmCopy, { color: theme.colors.textMuted }]}>{model.market} · {side === "BUY" ? "매수" : "매도"} · {orderType === "MARKET" ? "시장가" : "지정가"} · {quantityInput || "-"} {tradingAssetCode(model.market)}</Text>{side === "BUY" ? <Text style={[styles.confirmCopy, { color: theme.colors.textMuted }]}>투자 {cashEnvelope.investmentPercent}% · 보호 {cashEnvelope.reservePercent}%</Text> : null}<View style={styles.confirmActions}><NusaButton label={submitting ? "전송 중..." : "PAPER 주문 확정"} disabled={submitting} onPress={() => void submitBuiltIn()} /><NusaButton label="돌아가기" disabled={submitting} onPress={() => setConfirming(false)} tone="neutral" /></View></View>}</View>
      {submitMessage ? <InlineNotice title="PAPER 주문 결과" detail={submitMessage} tone={submitMessage.includes("완료") ? "success" : "info"} /> : null}
    </View>
  </ScrollView>;
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingTop: 20, gap: 20, paddingBottom: 44, width: "100%", maxWidth: 820, alignSelf: "center" },
  state: { flex: 1, justifyContent: "center", padding: 20, gap: 14, alignItems: "center" }, stateInner: { width: "100%", maxWidth: 720, gap: 12 }, stateTitle: { fontSize: 18, fontWeight: "700" },
  quoteHero: { paddingVertical: 6, gap: 7 }, quoteTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }, statusRow: { flexDirection: "row", gap: 7, flexWrap: "wrap", justifyContent: "flex-end" }, eyebrow: { fontSize: 10, lineHeight: 15, fontWeight: "800", letterSpacing: 1.2 }, market: { marginTop: 4, fontSize: 18, lineHeight: 23, fontWeight: "800" }, price: { fontSize: 38, lineHeight: 45, fontWeight: "800", letterSpacing: -1.4, fontVariant: ["tabular-nums"] }, quoteMeta: { fontSize: 11, lineHeight: 17 },
  ticket: { gap: 24 }, ticketSection: { gap: 10 }, stepLabel: { fontSize: 10, lineHeight: 15, fontWeight: "800", letterSpacing: 1.15 },
  allocationPanel: { borderWidth: 1, borderRadius: 18, padding: 16, gap: 12 }, allocationTop: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }, allocationValue: { marginTop: 5, fontSize: 24, lineHeight: 30, fontWeight: "800", fontVariant: ["tabular-nums"] }, allocationPercent: { fontSize: 18, lineHeight: 24, fontWeight: "800" }, allocationTrack: { height: 6, borderRadius: 999, overflow: "hidden" }, allocationFill: { height: "100%", borderRadius: 999 }, allocationAmounts: { flexDirection: "row", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }, smallCopy: { fontSize: 11, lineHeight: 17, fontWeight: "600" },
  preview: { borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: 4 }, confirmPanel: { borderWidth: 1, borderRadius: 18, padding: 16, gap: 10 }, confirmTitle: { fontSize: 19, lineHeight: 25, fontWeight: "800" }, confirmCopy: { fontSize: 13, lineHeight: 20, fontWeight: "600" }, confirmActions: { flexDirection: "row", gap: 10, flexWrap: "wrap", marginTop: 4 },
});
