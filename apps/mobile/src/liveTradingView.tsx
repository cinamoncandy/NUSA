import React from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { useTheme } from "./ThemeProvider";
import { FactRow, IntelligenceSection, ScreenLead, StateNotice } from "./intelligenceOs";

/**
 * LIVE TRADING is an independent navigation destination from TRADING (PAPER), never a toggle
 * inside it, so the PAPER/LIVE authority boundary stays visible at the UI level and not just in
 * backend state. This is presentation-only: it activates no LIVE authority, holds no exchange
 * credential flow, and submits no order. Every mutation control is absent, not merely disabled --
 * there is nothing here for a pressed control to do.
 */
export function LiveTradingView(): React.JSX.Element {
  const { theme } = useTheme();
  return (
    <ScrollView
      style={{ backgroundColor: theme.colors.background }}
      contentContainerStyle={styles.content}
      testID="live-trading-screen"
    >
      <ScreenLead
        eyebrow="LIVE TRADING"
        title="실거래는 비활성 상태입니다"
        detail="LIVE trading is not enabled. 계좌 연동, 주문 제출, 자금 이동 기능이 존재하지 않습니다."
        badge="DISABLED"
        badgeTone="warning"
        testID="live-trading-lead"
      />
      <StateNotice
        title="LIVE trading is not enabled."
        detail="liveAuthority = NONE · productionMutationAllowed = false · aiAuthority = ZERO_AUTHORITY"
        tone="warning"
        testID="live-trading-disabled-notice"
      />
      <IntelligenceSection title="AUTHORITY" kicker="STATUS" tone="neutral" testID="live-trading-authority-section">
        <FactRow label="LIVE AUTHORITY" value="NONE" tone="warning" testID="live-trading-authority-value" />
        <FactRow label="PRODUCTION MUTATION" value="FALSE" tone="warning" />
        <FactRow label="AI AUTHORITY" value="ZERO_AUTHORITY" tone="warning" />
        <FactRow label="EXCHANGE CONNECTION" value="NOT CONFIGURED" tone="neutral" />
      </IntelligenceSection>
      <IntelligenceSection title="계좌" kicker="PLACEHOLDER" tone="neutral" testID="live-trading-account-section">
        <FactRow label="LIVE 계좌 상태" value="사용 불가" />
        <FactRow label="LIVE 포지션" value="없음" />
        <FactRow label="LIVE 주문" value="없음" />
      </IntelligenceSection>
      <View style={[styles.footnote, { borderColor: theme.colors.border }]} testID="live-trading-footnote">
        <StateNotice
          title="PAPER과 구분됩니다"
          detail="TRADING 탭의 PAPER 운용은 이 화면과 별개입니다. 여기서 표시되는 값은 실거래 계좌가 아니며, 향후 실거래 승인 전까지 어떤 주문도 제출되지 않습니다."
          tone="info"
        />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 12, paddingBottom: 48 },
  footnote: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 12 },
});
