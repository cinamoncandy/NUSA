import React, { useMemo, useState } from "react";
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { AuthorityBanner, DataRow, NusaButton, NusaCard, NusaTextField, SectionHeading, StatusChip } from "./components";
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

function ErrorState({ message, onRetry }: Readonly<{ message: string; onRetry: () => void }>) {
  const { theme } = useTheme();
  return <View style={styles.state} testID="trading-error"><NusaCard><Text style={[styles.stateTitle, { color: theme.colors.danger }]}>PAPER 관찰 화면을 표시할 수 없습니다</Text><Text style={[styles.stateMessage, { color: theme.colors.textMuted }]}>{message}</Text><NusaButton label="다시 불러오기" onPress={onRetry} /></NusaCard></View>;
}

export function TradingView({ snapshot, marketConnectionState, stale, error, refreshing, onRefresh, onSubmit }: TradingViewProps) {
  const { theme } = useTheme();
  const [side, setSide] = useState<TradingOrderSide>("BUY");
  const [orderType, setOrderType] = useState<TradingOrderType>("MARKET");
  const [priceInput, setPriceInput] = useState("");
  const [quantityInput, setQuantityInput] = useState("");

  const draft = useMemo(() => ({ side, orderType, priceInput, quantityInput }), [orderType, priceInput, quantityInput, side]);
  if (error) return <ErrorState message={error} onRetry={onRefresh} />;
  if (snapshot === null) return <View style={styles.state} testID="trading-loading"><ActivityIndicator color={theme.colors.primary} /><Text style={[styles.stateTitle, { color: theme.colors.text }]}>PAPER 상태를 불러오는 중</Text></View>;
  if (snapshot.account.available === false || !snapshot.account.position.market.trim()) return <View style={styles.state} testID="trading-empty"><NusaCard><Text style={[styles.stateTitle, { color: theme.colors.text }]}>관찰 가능한 시장이 없습니다</Text><Text style={[styles.stateMessage, { color: theme.colors.textMuted }]}>검증된 PAPER 시장 정보가 준비되면 여기에 표시됩니다.</Text></NusaCard></View>;

  const model = buildTradingViewModel({
    market: { market: snapshot.account.position.market, connectionState: marketConnectionState, stale, price: snapshot.account.markPrice },
    account: { mode: snapshot.mode, liveMutationAllowed: false, cash: snapshot.account.cash, assetQuantity: snapshot.account.position.quantity, market: snapshot.account.position.market },
    draft,
    submitAvailable: onSubmit !== undefined,
  });
  const priceLabel = model.currentPrice === null ? "-" : formatTradingAmount(model.currentPrice, "KRW");
  const readOnly = onSubmit === undefined;
  const submitEnabled = !readOnly && model.canSubmit;
  const marketReady = model.blockedReasons.includes("MARKET_DATA_NOT_READY") === false;

  return <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl tintColor={theme.colors.primary} refreshing={refreshing} onRefresh={onRefresh} />} testID="trading-screen">
    <SectionHeading eyebrow="PAPER WORKSPACE" title="PAPER" description={readOnly ? "현재 앱 경로에는 주문 제출 기능이 연결되어 있지 않습니다. 검증된 PAPER 상태만 관찰합니다." : "명시적으로 연결된 PAPER 주문 입력 상태를 확인합니다."} />
    <View style={styles.statusRow}><StatusChip label="PAPER" tone="primary" /><StatusChip label={marketReady ? "시장 온라인" : "시장 대기"} tone={marketReady ? "success" : "warning"} /><StatusChip label={readOnly ? "주문 권한 없음" : "PAPER 입력"} tone={readOnly ? "info" : "primary"} /></View>
    <NusaCard testID="trading-safety" raised>
      <View style={styles.marketHeader}><View><Text style={[styles.label, { color: theme.colors.textMuted }]}>관찰 시장</Text><Text style={[styles.market, { color: theme.colors.text }]}>{model.market}</Text></View><StatusChip label={stale ? "데이터 점검" : "최신"} tone={stale ? "warning" : "success"} /></View>
      <Text style={[styles.price, { color: theme.colors.text }]}>{priceLabel}</Text>
      <View style={[styles.divider, { backgroundColor: theme.colors.border }]} />
      <DataRow label="시장 연결" value={marketConnectionState} tone={marketReady ? "success" : "warning"} />
      <DataRow label="사용 가능 현금" value={formatTradingAmount(snapshot.account.cash, "KRW")} />
      <DataRow label="보유 수량" value={`${snapshot.account.position.quantity} ${tradingAssetCode(model.market)}`} />
    </NusaCard>
    {readOnly ? <>
      <AuthorityBanner detail="이 화면은 가격·PAPER 잔고·주문 상태를 읽기만 합니다. 매수/매도 요청을 서버로 전송할 수 없습니다." />
      <NusaCard testID="trading-readonly-state" raised>
        <View style={styles.cardHeader}><View><Text style={[styles.label, { color: theme.colors.info }]}>EXECUTION BOUNDARY</Text><Text style={[styles.cardTitle, { color: theme.colors.text }]}>주문 입력 비활성</Text></View><StatusChip label="READ ONLY" tone="info" /></View>
        <Text style={[styles.stateMessage, { color: theme.colors.textMuted }]}>현재 App wiring에는 주문 제출 callback이 없습니다. 실행 가능한 컨트롤을 흉내 내지 않고 관찰 상태만 표시합니다.</Text>
        <View style={[styles.divider, { backgroundColor: theme.colors.border }]} />
        <DataRow label="PAPER 모드" value={snapshot.mode} emphasis />
        <DataRow label="주문 제출" value="연결 안 됨" tone="success" />
        <DataRow label="서버 mutation" value="불가" tone="success" />
      </NusaCard>
    </> : <>
      <View style={styles.segmentRow} testID="trading-side-tabs"><NusaButton label="매수" onPress={() => setSide("BUY")} tone={side === "BUY" ? "primary" : "neutral"} testID="trading-buy" /><NusaButton label="매도" onPress={() => setSide("SELL")} tone={side === "SELL" ? "danger" : "neutral"} testID="trading-sell" /></View>
      <View style={styles.segmentRow} testID="trading-order-types"><NusaButton label="시장가" onPress={() => setOrderType("MARKET")} tone={orderType === "MARKET" ? "primary" : "neutral"} testID="trading-market-order" /><NusaButton label="지정가" onPress={() => setOrderType("LIMIT")} tone={orderType === "LIMIT" ? "primary" : "neutral"} testID="trading-limit-order" /></View>
      {orderType === "LIMIT" ? <NusaTextField label="가격" value={priceInput} onChangeText={setPriceInput} placeholder="KRW 가격" testID="trading-price" /> : null}
      <NusaTextField label={`수량 (${tradingAssetCode(model.market)})`} value={quantityInput} onChangeText={setQuantityInput} placeholder="수량" testID="trading-quantity" />
      <NusaCard testID="trading-preview"><Text style={[styles.label, { color: theme.colors.textMuted }]}>PAPER 주문 미리보기</Text><DataRow label="예상 금액" value={formatTradingAmount(model.estimatedNotional, "KRW")} /><DataRow label="사용 가능" value={formatTradingAmount(model.availableAmount, model.availableUnit)} /><Text style={[styles.stateMessage, { color: theme.colors.textMuted }]}>수수료와 슬리피지는 실행 전에는 확정할 수 없습니다.</Text></NusaCard>
      {model.validationErrors.length > 0 || model.blockedReasons.length > 0 ? <NusaCard testID="trading-blockers"><Text style={[styles.label, { color: theme.colors.warning }]}>주문 차단 사유</Text>{[...model.validationErrors, ...model.blockedReasons].map((reason) => <Text key={reason} style={[styles.reason, { color: theme.colors.textMuted }]}>{reason}</Text>)}</NusaCard> : null}
      <NusaButton label={submitEnabled ? `${side === "BUY" ? "매수" : "매도"} PAPER 주문` : "PAPER 주문 사용 불가"} disabled={!submitEnabled} onPress={() => { if (submitEnabled) onSubmit?.(draft); }} testID="trading-submit" />
    </>}
  </ScrollView>;
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingTop: 18, gap: 14, paddingBottom: 32 },
  state: { flex: 1, justifyContent: "center", padding: 20, gap: 14 },
  stateTitle: { fontSize: 18, fontWeight: "700" },
  stateMessage: { lineHeight: 21, fontSize: 14 },
  statusRow: { flexDirection: "row", gap: 7, flexWrap: "wrap" },
  marketHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 },
  market: { marginTop: 4, fontSize: 20, fontWeight: "700" },
  label: { fontSize: 11, fontWeight: "700", letterSpacing: 0.7 },
  price: { fontSize: 34, fontWeight: "800", letterSpacing: -1.2, marginTop: 12 },
  divider: { height: 1, marginVertical: 13 },
  segmentRow: { flexDirection: "row", gap: 10 },
  cardHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 8 },
  cardTitle: { fontSize: 18, fontWeight: "700", letterSpacing: -0.4, marginTop: 4 },
  reason: { marginTop: 7, fontSize: 13 },
});