import React, { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { NusaButton, NusaTextField, StatusChip } from "./components";
import { InlineNotice } from "./uxPrimitives";
import { useTheme } from "./ThemeProvider";
import { UPBIT_LIVE_BASE_URL } from "./upbitLiveClient";
import { connectUpbitReadOnlyAccount, resetUpbitReadOnlyState, type UpbitReadOnlyMonitorStatus } from "./upbitReadOnlyAccount";

type ConnectionState =
  | Readonly<{ status: "DISCONNECTED"; detail: string }>
  | Readonly<{ status: "CONNECTING"; detail: string }>
  | Readonly<{ status: "MONITORING"; monitorStatus: UpbitReadOnlyMonitorStatus; detail: string; fetchedAt: number | null }>
  | Readonly<{ status: "ERROR"; monitorStatus: UpbitReadOnlyMonitorStatus; detail: string }>;

export function UpbitConnectionPanel() {
  const { theme } = useTheme();
  const [endpointDraft, setEndpointDraft] = useState(UPBIT_LIVE_BASE_URL);
  const [tokenDraft, setTokenDraft] = useState("");
  const [state, setState] = useState<ConnectionState>({ status: "DISCONNECTED", detail: "Upbit bridge credential is not configured." });

  const busy = state.status === "CONNECTING";
  const monitoring = state.status === "MONITORING";
  const monitorStatus = state.status === "MONITORING" || state.status === "ERROR" ? state.monitorStatus : null;
  const tone = busy ? "info" : monitorStatus === "CONNECTED" ? "success" : monitorStatus === "AUTH_ERROR" || monitorStatus === "RELAY_ERROR" ? "danger" : "warning";
  const label = busy ? "확인 중" : monitorStatus ?? (state.status === "ERROR" ? "OFFLINE" : "연결 필요");

  const connect = async (): Promise<void> => {
    if (busy) return;
    setState({ status: "CONNECTING", detail: "HTTPS read-only 계정 연결을 확인하고 있습니다." });
    const result = await connectUpbitReadOnlyAccount(tokenDraft, endpointDraft);
    if ((result.status === "READY" || result.status === "STALE") && result.snapshot) {
      setTokenDraft("");
      setState({
        status: "MONITORING",
        monitorStatus: result.monitorStatus,
        detail: `READ ONLY · ${result.snapshot.assets.length + 1} assets · 30초 자동 갱신`,
        fetchedAt: result.lastSuccessAt,
      });
      return;
    }
    setState({ status: "ERROR", monitorStatus: result.monitorStatus, detail: result.error ?? "Upbit bridge connection failed." });
  };

  const disconnect = (): void => {
    if (busy) return;
    resetUpbitReadOnlyState();
    setTokenDraft("");
    setState({ status: "DISCONNECTED", detail: "Upbit bridge credential cleared from process memory." });
  };

  return <View style={styles.sectionBlock} testID="settings-upbit-connection">
    <View style={styles.sectionHeader}>
      <View>
        <Text style={[styles.eyebrow, { color: theme.colors.textMuted }]}>02 · UPBIT CONNECTION</Text>
        <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>UPBIT LIVE</Text>
      </View>
      <StatusChip label="READ ONLY" tone="info" />
    </View>
    <InlineNotice title={label} detail={state.detail} tone={tone} testID="settings-upbit-connection-summary" />
    <NusaTextField autoCapitalize="none" autoCorrect={false} editable={!busy} keyboardType="url" label="Upbit bridge endpoint" value={endpointDraft} onChangeText={setEndpointDraft} placeholder="https://..." returnKeyType="done" testID="settings-upbit-endpoint" />
    <NusaTextField autoCapitalize="none" autoCorrect={false} editable={!busy} label="Bridge token" value={tokenDraft} onChangeText={setTokenDraft} placeholder="프로세스 메모리에만 유지" returnKeyType="done" secureTextEntry testID="settings-upbit-token" />
    <Text style={[styles.hint, { color: theme.colors.textMuted }]}>토큰은 저장하지 않고 현재 앱 프로세스 메모리에만 유지합니다. 연결 후 계좌 상태는 30초마다 자동 갱신됩니다. 이 연결은 계정 조회 전용이며 주문·출금 권한을 제공하지 않습니다.</Text>
    {state.status === "MONITORING" && state.fetchedAt != null ? <Text style={[styles.hint, { color: theme.colors.textMuted }]} testID="settings-upbit-last-success">마지막 성공 조회: {new Date(state.fetchedAt).toLocaleString("ko-KR")}</Text> : null}
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