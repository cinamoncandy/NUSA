import React, { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { NusaButton, NusaTextField, StatusChip } from "./components";
import { InlineNotice } from "./uxPrimitives";
import { useTheme } from "./ThemeProvider";
import { UPBIT_LIVE_BASE_URL } from "./upbitLiveClient";
import { connectUpbitReadOnlyAccount, resetUpbitReadOnlyState, useUpbitReadOnlyState } from "./upbitReadOnlyAccount";

export function UpbitConnectionPanel() {
  const { theme } = useTheme();
  const [endpointDraft, setEndpointDraft] = useState(UPBIT_LIVE_BASE_URL);
  const [tokenDraft, setTokenDraft] = useState("");
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
        : "Upbit bridge credential is not configured.";

  const connect = async (): Promise<void> => {
    if (busy) return;
    const result = await connectUpbitReadOnlyAccount(tokenDraft, endpointDraft);
    if (result.status === "READY" || result.status === "STALE") setTokenDraft("");
  };

  const disconnect = (): void => {
    if (busy) return;
    resetUpbitReadOnlyState();
    setTokenDraft("");
  };

  return <View style={styles.sectionBlock} testID="settings-upbit-connection">
    <View style={styles.sectionHeader}>
      <View>
        <Text style={[styles.eyebrow, { color: theme.colors.textMuted }]}>02 · UPBIT CONNECTION</Text>
        <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>UPBIT LIVE</Text>
      </View>
      <StatusChip label="READ ONLY" tone="info" />
    </View>
    <InlineNotice title={label} detail={detail} tone={tone} testID="settings-upbit-connection-summary" />
    <NusaTextField autoCapitalize="none" autoCorrect={false} editable={!busy} keyboardType="url" label="Upbit bridge endpoint" value={endpointDraft} onChangeText={setEndpointDraft} placeholder="https://..." returnKeyType="done" testID="settings-upbit-endpoint" />
    <NusaTextField autoCapitalize="none" autoCorrect={false} editable={!busy} label="Bridge token" value={tokenDraft} onChangeText={setTokenDraft} placeholder="프로세스 메모리에만 유지" returnKeyType="done" secureTextEntry testID="settings-upbit-token" />
    <Text style={[styles.hint, { color: theme.colors.textMuted }]}>토큰은 저장하지 않고 현재 앱 프로세스 메모리에만 유지합니다. 연결 후 계좌 상태는 30초마다 자동 갱신됩니다. 이 연결은 계정 조회 전용이며 주문·출금 권한을 제공하지 않습니다.</Text>
    {monitoring && state.lastSuccessAt != null ? <Text style={[styles.hint, { color: theme.colors.textMuted }]} testID="settings-upbit-last-success">마지막 성공 조회: {new Date(state.lastSuccessAt).toLocaleString("ko-KR")}</Text> : null}
    <View style={styles.row}>
      <NusaButton disabled={busy} label={busy ? "연결 확인 중..." : "연결 확인"} onPress={() => void connect()} testID="settings-upbit-connect" />
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