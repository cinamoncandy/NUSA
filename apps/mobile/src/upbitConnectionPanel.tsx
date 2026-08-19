import React, { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { NusaButton, StatusChip } from "./components";
import { InlineNotice } from "./uxPrimitives";
import { useTheme } from "./ThemeProvider";
import { loadUpbitLiveAccounts, UPBIT_LIVE_BASE_URL } from "./upbitLiveClient";
import { normalizeUpbitReadOnlySnapshot } from "./upbitReadOnlyAccountModel";
import { getUpbitReadOnlyState, setUpbitReadOnlyState, resetUpbitReadOnlyState } from "./upbitReadOnlyAccount";
import { mobileApprovedSession } from "./mobileApprovedSessionBoundary";
import { subscribePaperConnection } from "./paperConnectionSession";

type ConnectionState =
  | Readonly<{ status: "DISCONNECTED"; detail: string }>
  | Readonly<{ status: "CONNECTING"; detail: string }>
  | Readonly<{ status: "READY"; detail: string; fetchedAt: number }>
  | Readonly<{ status: "ERROR"; detail: string }>;

export function UpbitConnectionPanel() {
  const { theme } = useTheme();
  const [state, setState] = useState<ConnectionState>({ status: "DISCONNECTED", detail: "PAPER 세션이 연결되면 canonical Cloud read-only relay를 자동 확인합니다." });
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  const connected = state.status === "READY";
  const tone = busy ? "info" : connected ? "success" : state.status === "ERROR" ? "danger" : "warning";
  const label = busy ? "확인 중" : connected ? "연결됨" : state.status === "ERROR" ? "연결 실패" : "연결 필요";

  const connect = async (): Promise<void> => {
    if (busyRef.current) return;
    if (!mobileApprovedSession().hasMemoryAccess()) return;
    busyRef.current = true;
    setBusy(true);
    setUpbitReadOnlyState({ status: "LOADING", snapshot: getUpbitReadOnlyState().snapshot, error: null });
    setState({ status: "CONNECTING", detail: "HTTPS read-only 계정 연결을 확인하고 있습니다." });
    try {
      const snapshot = await loadUpbitLiveAccounts({ credentialProvider: mobileApprovedSession().credentialProvider, baseUrl: UPBIT_LIVE_BASE_URL });
      setUpbitReadOnlyState({ status: "READY", snapshot: normalizeUpbitReadOnlySnapshot(snapshot), error: null });
      setState({ status: "READY", detail: `READ ONLY · ${snapshot.accounts.length} assets`, fetchedAt: snapshot.fetchedAt });
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Upbit bridge connection failed.";
      const previous = getUpbitReadOnlyState().snapshot;
      setUpbitReadOnlyState({ status: previous ? "STALE" : "ERROR", snapshot: previous, error: detail });
      setState({ status: "ERROR", detail });
    } finally { busyRef.current = false; setBusy(false); }
  };

  const disconnect = (): void => {
    if (busy) return;
    resetUpbitReadOnlyState();
    setState({ status: "DISCONNECTED", detail: "Upbit read-only 표시를 해제했습니다." });
  };

  useEffect(() => {
    const tryConnect = (): void => { if (mobileApprovedSession().hasMemoryAccess()) void connect(); };
    const unsubscribe = subscribePaperConnection(tryConnect);
    tryConnect();
    return () => { unsubscribe(); };
  }, []);

  return <View style={styles.sectionBlock} testID="settings-upbit-connection">
    <View style={styles.sectionHeader}>
      <View>
        <Text style={[styles.eyebrow, { color: theme.colors.textMuted }]}>02 · UPBIT CONNECTION</Text>
        <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>UPBIT READ ONLY</Text>
      </View>
      <StatusChip label="READ ONLY" tone="info" />
    </View>
    <InlineNotice title={label} detail={state.detail} tone={tone} testID="settings-upbit-connection-summary" />
    <Text style={[styles.hint, { color: theme.colors.textMuted }]}>PAPER 세션의 인증 상태로 canonical Cloud read-only relay를 조회합니다. Upbit 인증정보는 앱에서 입력하거나 저장하지 않습니다.</Text>
    {state.status === "READY" ? <Text style={[styles.hint, { color: theme.colors.textMuted }]} testID="settings-upbit-last-success">마지막 성공 조회: {new Date(state.fetchedAt).toLocaleString("ko-KR")}</Text> : null}
    <View style={styles.row}>
      {!connected ? <NusaButton disabled={busy} label={busy ? "연결 확인 중..." : "다시 확인"} onPress={() => void connect()} testID="settings-upbit-connect" /> : null}
      <NusaButton disabled={busy || !connected} label="연결 해제" onPress={disconnect} tone="neutral" testID="settings-upbit-disconnect" />
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
