import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { NusaButton, StatusChip } from "./components";
import { InlineNotice } from "./uxPrimitives";
import { useTheme } from "./ThemeProvider";
import { UPBIT_LIVE_BASE_URL } from "./upbitLiveClient";
import { connectUpbitReadOnlyAccount, resetUpbitReadOnlyState, useUpbitReadOnlyState } from "./upbitReadOnlyAccount";

export function UpbitConnectionPanel() {
  const { theme } = useTheme();
  const state = useUpbitReadOnlyState();

  const busy = state.status === "LOADING";
  const monitoring = state.status === "READY" || state.status === "STALE";
  const monitorStatus = state.status === "DISCONNECTED" ? null : state.monitorStatus;
  const tone = busy ? "info" : monitorStatus === "CONNECTED" ? "success" : monitorStatus === "AUTH_ERROR" || monitorStatus === "RELAY_ERROR" ? "danger" : "warning";
  const label = busy ? "확인 중" : monitorStatus ?? (state.status === "ERROR" ? "OFFLINE" : "연결 필요");
  const detail = busy
    ? "HTTPS read-only 계정 연결을 확인하고 있습니다."
    : monitoring && state.snapshot
      ? `READ ONLY · ${state.snapshot.assets.length + 1} assets · 30초 자동 갱신`
      : state.status === "ERROR"
        ? state.error ?? "Upbit bridge connection failed."
        : "Upbit 조회 전용 bridge가 아직 연결되지 않았습니다.";

  const connect = async (): Promise<void> => {
    if (busy) return;
    await connectUpbitReadOnlyAccount(UPBIT_LIVE_BASE_URL);
  };

  const disconnect = (): void => {
    if (busy) return;
    resetUpbitReadOnlyState();
  };

  return <View style={styles.sectionBlock} testID="settings-upbit-connection">
    <View style={styles.sectionHeader}>
      <View>
        <Text style={[styles.eyebrow, { color: theme.colors.textMuted }]}>02 · UPBIT CONNECTION</Text>
        <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>UPBIT READ ONLY</Text>
      </View>
      <StatusChip label="READ ONLY" tone="info" />
    </View>
    <InlineNotice title={label} detail={detail} tone={tone} testID="settings-upbit-connection-summary" />
    <Text style={[styles.hint, { color: theme.colors.textMuted }]}>별도 토큰 없이 인증된 PAPER 보안 세션을 사용해 자동 연결합니다. 계좌 상태는 30초마다 갱신되며 주문 생성·취소·출금·이체 권한은 없습니다.</Text>
    {monitoring && state.lastSuccessAt != null ? <Text style={[styles.hint, { color: theme.colors.textMuted }]} testID="settings-upbit-last-success">마지막 성공 조회: {new Date(state.lastSuccessAt).toLocaleString("ko-KR")}</Text> : null}
    <View style={styles.row}>
      <NusaButton disabled={busy} label={busy ? "연결 확인 중..." : "PAPER 세션으로 다시 시도"} onPress={() => void connect()} testID="settings-upbit-connect" />
      <NusaButton disabled={busy || !monitoring} label="연결 해제" onPress={disconnect} tone="neutral" testID="settings-upbit-disconnect" />
    </View>
  </View>;
}

const styles = StyleSheet.create({
  sectionBlock: { gap: 12 },
  sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 12 },
  eyebrow: { fontSize: 10, lineHeight: 15, fontWeight: "800", letterSpacing: 1.1 },
  sectionTitle: { marginTop: 4, fontSize: 21, lineHeight: 27, fontWeight: "800", letterSpacing: -0.5 },
  hint: { fontSize: 13, lineHeight: 20 },
  row: { flexDirection: "row", gap: 10, flexWrap: "wrap" },
});
