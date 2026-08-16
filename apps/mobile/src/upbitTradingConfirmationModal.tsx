import React from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { NusaButton, NusaCard, StatusChip } from "./components";
import { useTheme } from "./ThemeProvider";

export interface TradingConfirmationRequest {
  readonly market: string;
  readonly side: "BUY" | "SELL";
  readonly ordType: "LIMIT" | "MARKET" | "BEST";
  readonly volume: number;
  readonly price?: number;
  readonly estimatedKRW: number;
  readonly mode: "PAPER" | "LIVE";
}

export interface UpbitTradingConfirmationModalProps {
  readonly visible: boolean;
  readonly request: TradingConfirmationRequest | null;
  readonly loading: boolean;
  readonly error: string | null;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

export function UpbitTradingConfirmationModal({
  visible,
  request,
  loading,
  error,
  onConfirm,
  onCancel,
}: UpbitTradingConfirmationModalProps) {
  const { theme } = useTheme();

  if (!request) {
    return (
      <Modal
        transparent
        visible={visible}
        onRequestClose={onCancel}
        testID="upbit-trading-confirmation-modal"
      />
    );
  }

  const sideLabel = request.side === "BUY" ? "매수" : "매도";
  const sideTone = request.side === "BUY" ? "danger" : "success";
  const modeLabel = request.mode === "PAPER" ? "시뮬레이션" : "실거래";
  const modeTone = request.mode === "PAPER" ? "primary" : "danger";
  const priceDisplay =
    request.ordType === "LIMIT" && request.price
      ? `₩${Math.round(request.price).toLocaleString("ko-KR")}`
      : request.ordType === "MARKET"
        ? "시장가"
        : "최우선";

  return (
    <Modal
      transparent
      visible={visible}
      onRequestClose={onCancel}
      animationType="fade"
      testID="upbit-trading-confirmation-modal"
    >
      <View style={styles.backdrop}>
        <View
          style={[styles.container, { backgroundColor: theme.colors.surface }]}
        >
          <ScrollView
            contentContainerStyle={styles.content}
            scrollEnabled={false}
          >
            <View style={styles.header}>
              <View>
                <Text
                  style={[
                    styles.eyebrow,
                    { color: theme.colors.textMuted },
                  ]}
                >
                  TRADING CONFIRMATION
                </Text>
                <Text
                  style={[
                    styles.title,
                    { color: theme.colors.text },
                  ]}
                >
                  주문 확인
                </Text>
              </View>
              <StatusChip label={modeLabel} tone={modeTone} />
            </View>

            {error && (
              <View
                style={[
                  styles.errorBox,
                  { backgroundColor: theme.colors.dangerSoft },
                ]}
              >
                <Text style={[styles.errorText, { color: theme.colors.danger }]}>
                  오류: {error}
                </Text>
              </View>
            )}

            <NusaCard>
              <View style={styles.orderCard}>
                <View style={styles.orderHeader}>
                  <Text
                    style={[
                      styles.market,
                      { color: theme.colors.text },
                    ]}
                  >
                    {request.market}
                  </Text>
                  <StatusChip
                    label={sideLabel}
                    tone={sideTone}
                  />
                </View>

                <View style={[styles.divider, { backgroundColor: theme.colors.border }]} />

                <View style={styles.details}>
                  <View style={styles.detailRow}>
                    <Text
                      style={[
                        styles.detailLabel,
                        { color: theme.colors.textMuted },
                      ]}
                    >
                      주문 유형
                    </Text>
                    <Text
                      style={[
                        styles.detailValue,
                        { color: theme.colors.text },
                      ]}
                    >
                      {request.ordType}
                    </Text>
                  </View>

                  <View style={styles.detailRow}>
                    <Text
                      style={[
                        styles.detailLabel,
                        { color: theme.colors.textMuted },
                      ]}
                    >
                      수량
                    </Text>
                    <Text
                      style={[
                        styles.detailValue,
                        { color: theme.colors.text },
                      ]}
                    >
                      {request.volume}
                    </Text>
                  </View>

                  <View style={styles.detailRow}>
                    <Text
                      style={[
                        styles.detailLabel,
                        { color: theme.colors.textMuted },
                      ]}
                    >
                      {request.ordType === "LIMIT" ? "지정가" : "가격"}
                    </Text>
                    <Text
                      style={[
                        styles.detailValue,
                        { color: theme.colors.text },
                      ]}
                    >
                      {priceDisplay}
                    </Text>
                  </View>

                  <View
                    style={[
                      styles.divider,
                      { backgroundColor: theme.colors.border },
                    ]}
                  />

                  <View style={styles.detailRow}>
                    <Text
                      style={[
                        styles.estimatedLabel,
                        { color: theme.colors.textMuted },
                      ]}
                    >
                      예상 금액
                    </Text>
                    <Text
                      style={[
                        styles.estimatedValue,
                        {
                          color: theme.colors.text,
                        },
                      ]}
                    >
                      ₩{Math.round(request.estimatedKRW).toLocaleString("ko-KR")}
                    </Text>
                  </View>
                </View>
              </View>
            </NusaCard>

            {request.mode === "LIVE" && (
              <View
                style={[
                  styles.warningBox,
                  { backgroundColor: theme.colors.warningSoft },
                ]}
              >
                <Text
                  style={[
                    styles.warningText,
                    { color: theme.colors.warning },
                  ]}
                >
                  ⚠️ 실거래 모드입니다. 확인 버튼을 누르면 즉시 실제 주문이 실행됩니다.
                </Text>
              </View>
            )}

            <View style={styles.actions}>
              <Pressable
                onPress={onCancel}
                disabled={loading}
                style={({ pressed }) => [
                  styles.button,
                  styles.cancelButton,
                  {
                    backgroundColor: loading
                      ? theme.colors.surfaceRaised
                      : theme.colors.surfaceSunken,
                    opacity: pressed && !loading ? 0.8 : 1,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.buttonText,
                    {
                      color: loading
                        ? theme.colors.textMuted
                        : theme.colors.text,
                    },
                  ]}
                >
                  취소
                </Text>
              </Pressable>

              <Pressable
                onPress={onConfirm}
                disabled={loading}
                style={({ pressed }) => [
                  styles.button,
                  styles.confirmButton,
                  {
                    backgroundColor: loading
                      ? theme.colors.primarySoft
                      : theme.colors.primary,
                    opacity: pressed && !loading ? 0.8 : 1,
                  },
                ]}
              >
                {loading ? (
                  <Text
                    style={[
                      styles.buttonText,
                      { color: theme.colors.primaryMuted },
                    ]}
                  >
                    처리 중...
                  </Text>
                ) : (
                  <Text
                    style={[
                      styles.buttonText,
                      { color: theme.colors.surfaceSunken },
                    ]}
                  >
                    확인
                  </Text>
                )}
              </Pressable>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: 16,
  },
  container: {
    width: "100%",
    maxWidth: 480,
    borderRadius: 20,
    overflow: "hidden",
  },
  content: {
    paddingHorizontal: 20,
    paddingVertical: 24,
    gap: 16,
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 8,
  },
  eyebrow: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.1,
    marginBottom: 4,
  },
  title: {
    fontSize: 20,
    fontWeight: "800",
    letterSpacing: -0.4,
  },
  errorBox: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
  },
  errorText: {
    fontSize: 13,
    fontWeight: "600",
    lineHeight: 20,
  },
  orderCard: {
    gap: 12,
  },
  orderHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 4,
  },
  market: {
    fontSize: 24,
    fontWeight: "800",
    letterSpacing: -0.6,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
  },
  details: {
    gap: 10,
  },
  detailRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  detailLabel: {
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 0.3,
  },
  detailValue: {
    fontSize: 13,
    fontWeight: "600",
  },
  estimatedLabel: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.3,
  },
  estimatedValue: {
    fontSize: 16,
    fontWeight: "800",
    fontVariant: ["tabular-nums"],
  },
  warningBox: {
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 8,
  },
  warningText: {
    fontSize: 13,
    fontWeight: "600",
    lineHeight: 20,
  },
  actions: {
    flexDirection: "row",
    gap: 12,
  },
  button: {
    flex: 1,
    minHeight: 48,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  cancelButton: {},
  confirmButton: {},
  buttonText: {
    fontSize: 14,
    fontWeight: "700",
  },
});
