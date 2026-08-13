import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { NusaButton, StatusChip, WaveMark } from "./components";
import { useTheme } from "./ThemeProvider";

export type ApprovalGatewayStatus = "PENDING" | "ACTIVE" | "REJECTED" | "SUSPENDED";

interface ApprovalGatewayProps {
  readonly status: ApprovalGatewayStatus;
  readonly displayName?: string;
  readonly onRetry?: () => void;
  readonly onSignOut?: () => void;
  readonly onEnter?: () => void;
}

const COPY: Readonly<Record<ApprovalGatewayStatus, Readonly<{ eyebrow: string; title: string; detail: string; chip: string; tone: "primary" | "success" | "danger" | "warning" }>>> = Object.freeze({
  PENDING: Object.freeze({
    eyebrow: "ACCESS REQUESTED",
    title: "NUSA 입장 승인을 기다리고 있어요",
    detail: "운영자가 계정을 확인하면 자동으로 이용할 수 있습니다. 승인 전에는 자산·시장·PAPER 기능에 접근할 수 없습니다.",
    chip: "승인 대기",
    tone: "warning"
  }),
  ACTIVE: Object.freeze({
    eyebrow: "ACCESS APPROVED",
    title: "NUSA에 오신 것을 환영합니다",
    detail: "승인이 확인되었습니다. 이제 개인 PAPER 워크스페이스에 안전하게 들어갈 수 있습니다.",
    chip: "승인 완료",
    tone: "success"
  }),
  REJECTED: Object.freeze({
    eyebrow: "ACCESS NOT APPROVED",
    title: "현재 계정은 이용할 수 없습니다",
    detail: "운영자가 이 계정의 이용 요청을 승인하지 않았습니다. 다른 계정으로 로그인하거나 운영자에게 문의하세요.",
    chip: "승인 거절",
    tone: "danger"
  }),
  SUSPENDED: Object.freeze({
    eyebrow: "ACCESS PAUSED",
    title: "NUSA 이용이 일시 중지되었습니다",
    detail: "보호된 데이터와 PAPER 기능 접근이 즉시 차단되었습니다. 상태가 복구되기 전까지 앱 기능을 사용할 수 없습니다.",
    chip: "이용 정지",
    tone: "danger"
  })
});

export function ApprovalGateway({ status, displayName, onRetry, onSignOut, onEnter }: ApprovalGatewayProps) {
  const { theme } = useTheme();
  const copy = COPY[status];
  const active = status === "ACTIVE";
  const retryable = status === "PENDING" && onRetry != null;

  return (
    <View style={[styles.screen, { backgroundColor: theme.colors.background }]} testID={`approval-gateway-${status.toLowerCase()}`}>
      <View style={styles.content}>
        <View style={styles.brandRow}>
          <WaveMark />
          <View>
            <Text style={[styles.brand, { color: theme.colors.text }]}>NUSA</Text>
            <Text style={[styles.brandCaption, { color: theme.colors.textMuted }]}>YOUR FINANCIAL ISLAND</Text>
          </View>
        </View>

        <View style={[styles.horizon, { backgroundColor: theme.colors.border }]}>
          <View style={[styles.horizonGlow, { backgroundColor: active ? theme.colors.primary : theme.colors.info }]} />
        </View>

        <View style={styles.copyBlock}>
          <Text style={[styles.eyebrow, { color: theme.colors.textMuted }]}>{copy.eyebrow}</Text>
          <StatusChip label={copy.chip} tone={copy.tone} />
          <Text style={[styles.title, { color: theme.colors.text }]}>{copy.title}</Text>
          {displayName ? <Text style={[styles.name, { color: theme.colors.primary }]}>{displayName}</Text> : null}
          <Text style={[styles.detail, { color: theme.colors.textMuted }]}>{copy.detail}</Text>
        </View>

        <View style={[styles.safetyCard, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
          <Text style={[styles.safetyTitle, { color: theme.colors.text }]}>안전 경계</Text>
          <Text style={[styles.safetyCopy, { color: theme.colors.textMuted }]}>승인 상태는 서버에서 확인합니다. 승인 전에는 보호된 화면을 열지 않으며, 정지되면 기존 세션도 즉시 차단됩니다.</Text>
          <View style={styles.badges}>
            <StatusChip label="PAPER ONLY" tone="primary" />
            <StatusChip label="LIVE NONE" tone="neutral" />
          </View>
        </View>

        <View style={styles.actions}>
          {active && onEnter ? <NusaButton label="NUSA 들어가기" onPress={onEnter} testID="approval-enter" /> : null}
          {retryable ? <NusaButton label="승인 상태 다시 확인" onPress={onRetry!} testID="approval-retry" /> : null}
          {onSignOut ? <NusaButton label="다른 계정 사용" onPress={onSignOut} tone="neutral" testID="approval-sign-out" /> : null}
        </View>

        {status === "PENDING" ? <Pressable accessibilityRole="text" style={styles.footerNote}><Text style={[styles.footerText, { color: theme.colors.textMuted }]}>승인 전까지 기다리는 동안 앱을 다시 설치하거나 자격 증명을 반복 입력할 필요는 없습니다.</Text></Pressable> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, justifyContent: "center", paddingHorizontal: 22, paddingVertical: 28 },
  content: { width: "100%", maxWidth: 560, alignSelf: "center", gap: 24 },
  brandRow: { flexDirection: "row", alignItems: "center", gap: 14 },
  brand: { fontSize: 22, lineHeight: 28, fontWeight: "800", letterSpacing: 1.8 },
  brandCaption: { marginTop: 2, fontSize: 9, lineHeight: 13, fontWeight: "700", letterSpacing: 1.7 },
  horizon: { height: 1, overflow: "visible", position: "relative" },
  horizonGlow: { position: "absolute", left: 0, top: -1, width: 72, height: 3, borderRadius: 999 },
  copyBlock: { gap: 11 },
  eyebrow: { fontSize: 10, lineHeight: 15, fontWeight: "800", letterSpacing: 1.5 },
  title: { marginTop: 4, fontSize: 34, lineHeight: 42, fontWeight: "800", letterSpacing: -1.3, maxWidth: 500 },
  name: { fontSize: 15, lineHeight: 22, fontWeight: "700" },
  detail: { fontSize: 15, lineHeight: 24, maxWidth: 520 },
  safetyCard: { borderWidth: 1, borderRadius: 20, padding: 18, gap: 10 },
  safetyTitle: { fontSize: 13, lineHeight: 19, fontWeight: "800" },
  safetyCopy: { fontSize: 13, lineHeight: 20 },
  badges: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  actions: { gap: 10 },
  footerNote: { paddingVertical: 2 },
  footerText: { fontSize: 12, lineHeight: 19 }
});
