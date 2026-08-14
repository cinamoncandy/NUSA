import React, { useCallback, useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { DataRow, NusaButton, NusaCard, StatusChip } from "./components";
import { InlineNotice } from "./uxPrimitives";
import { useTheme } from "./ThemeProvider";
import { InMemoryUpbitCredentialSession } from "./upbitCredentialSession";
import { loadUpbitLiveAccounts, UPBIT_LIVE_BASE_URL, type UpbitAccount, type UpbitLiveSnapshot } from "./upbitLiveClient";
import { getUpbitReadOnlyState, rememberUpbitReadOnlyState } from "./upbitReadOnlySession";

type UpbitPortfolioState =
  | Readonly<{ status: "DISCONNECTED"; detail: string }>
  | Readonly<{ status: "LOADING"; detail: string }>
  | Readonly<{ status: "READY"; detail: string; snapshot: UpbitLiveSnapshot }>
  | Readonly<{ status: "STALE"; detail: string; snapshot: UpbitLiveSnapshot }>
  | Readonly<{ status: "ERROR"; detail: string }>;

function decimal(value: number): string {
  return value.toLocaleString("ko-KR", { maximumFractionDigits: 8 });
}

function accountValue(account: UpbitAccount, value: number): string {
  return account.unitCurrency === "KRW" && account.currency !== "KRW"
    ? `₩${Math.round(value).toLocaleString("ko-KR")}`
    : decimal(value);
}

export function UpbitPortfolioPanel() {
  const { theme } = useTheme();
  const credentialSession = useMemo(() => new InMemoryUpbitCredentialSession(), []);
  const [state, setState] = useState<UpbitPortfolioState>(() => {
    const remembered = getUpbitReadOnlyState();
    if (!credentialSession.isConfigured()) {
      return { status: "DISCONNECTED", detail: "Settings에서 Upbit READ ONLY 연결을 먼저 확인하세요." };
    }
    if (remembered.snapshot) {
      return { status: "READY", detail: "최근 READ ONLY 계정 조회 결과입니다.", snapshot: remembered.snapshot };
    }
    return { status: "LOADING", detail: "Upbit READ ONLY 자산을 불러오고 있습니다." };
  });

  const refresh = useCallback(async (): Promise<void> => {
    if (!credentialSession.isConfigured()) {
      setState({ status: "DISCONNECTED", detail: "Settings에서 Upbit READ ONLY 연결을 먼저 확인하세요." });
      return;
    }

    const remembered = getUpbitReadOnlyState();
    setState({ status: "LOADING", detail: "Upbit READ ONLY 자산을 불러오고 있습니다." });
    try {
      const endpoint = remembered.endpoint ?? UPBIT_LIVE_BASE_URL;
      const snapshot = await loadUpbitLiveAccounts({ credentialProvider: credentialSession.credentialProvider, baseUrl: endpoint });
      rememberUpbitReadOnlyState(endpoint, snapshot);
      setState({ status: "READY", detail: `실제 Upbit 계정 ${snapshot.accounts.length}개 항목을 조회했습니다.`, snapshot });
    } catch (error) {
      const cached = getUpbitReadOnlyState().snapshot ?? remembered.snapshot;
      const detail = error instanceof Error ? error.message : "Upbit READ ONLY account refresh failed.";
      if (cached) {
        setState({ status: "STALE", detail: `새 조회에 실패했습니다. 마지막 성공 데이터를 표시합니다. ${detail}`, snapshot: cached });
      } else {
        setState({ status: "ERROR", detail });
      }
    }
  }, [credentialSession]);

  useEffect(() => {
    if (credentialSession.isConfigured()) void refresh();
  }, [credentialSession, refresh]);

  const snapshot = state.status === "READY" || state.status === "STALE" ? state.snapshot : null;
  const krw = snapshot?.accounts.find((item) => item.currency === "KRW") ?? null;
  const assets = snapshot?.accounts.filter((item) => item.currency !== "KRW") ?? [];
  const tone = state.status === "READY" ? "success" : state.status === "LOADING" ? "info" : state.status === "STALE" ? "warning" : state.status === "ERROR" ? "danger" : "warning";
  const label = state.status === "READY" ? "연결됨" : state.status === "LOADING" ? "조회 중" : state.status === "STALE" ? "이전 데이터" : state.status === "ERROR" ? "조회 실패" : "연결 필요";

  return <View style={styles.container} testID="portfolio-upbit-readonly">
    <View style={styles.header}>
      <View>
        <Text style={[styles.eyebrow, { color: theme.colors.textMuted }]}>UPBIT · LIVE DATA</Text>
        <Text style={[styles.title, { color: theme.colors.text }]}>실제 Upbit 자산</Text>
      </View>
      <StatusChip label="READ ONLY" tone="info" />
    </View>

    <InlineNotice title={label} detail={state.detail} tone={tone} testID={`portfolio-upbit-${state.status.toLowerCase()}`} />

    {snapshot ? <>
      <NusaCard testID="portfolio-upbit-krw">
        <DataRow label="KRW 사용 가능" value={`₩${Math.floor(krw?.balance ?? 0).toLocaleString("ko-KR")}`} emphasis />
        <DataRow label="KRW 잠금" value={`₩${Math.floor(krw?.locked ?? 0).toLocaleString("ko-KR")}`} />
        <DataRow label="마지막 성공" value={new Date(snapshot.fetchedAt).toLocaleString("ko-KR")} />
      </NusaCard>

      <View style={styles.assetHeader}>
        <Text style={[styles.assetTitle, { color: theme.colors.text }]}>실제 보유 자산</Text>
        <Text style={[styles.assetCount, { color: theme.colors.textMuted }]}>{assets.length}개</Text>
      </View>

      {assets.length === 0 ? <InlineNotice title="코인 자산 없음" detail="현재 Upbit 계정에는 KRW 외 표시할 자산이 없습니다." tone="info" testID="portfolio-upbit-empty" /> : assets.map((asset) => <NusaCard key={asset.currency} testID={`portfolio-upbit-asset-${asset.currency}`}>
        <View style={styles.assetHeader}>
          <Text style={[styles.assetSymbol, { color: theme.colors.text }]}>{asset.currency}</Text>
          <Text style={[styles.assetUnit, { color: theme.colors.info }]}>{asset.unitCurrency}</Text>
        </View>
        <DataRow label="사용 가능" value={decimal(asset.balance)} emphasis />
        <DataRow label="잠금" value={decimal(asset.locked)} />
        <DataRow label="평균매수가" value={accountValue(asset, asset.avgBuyPrice)} />
        <DataRow label="기준 통화" value={asset.unitCurrency} />
      </NusaCard>)}
    </> : null}

    <NusaButton disabled={state.status === "LOADING"} label={state.status === "LOADING" ? "조회 중..." : "READ ONLY 새로고침"} onPress={() => void refresh()} tone="neutral" testID="portfolio-upbit-refresh" />
    <InlineNotice title="PAPER와 완전 분리" detail="이 실제 계정 데이터는 PAPER 자산과 합산하지 않습니다. 주문·취소·출금·이체 기능도 제공하지 않습니다." tone="info" testID="portfolio-upbit-safety" />
  </View>;
}

const styles = StyleSheet.create({
  container: { gap: 14 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 12 },
  eyebrow: { fontSize: 10, lineHeight: 15, fontWeight: "800", letterSpacing: 1.1 },
  title: { marginTop: 4, fontSize: 21, lineHeight: 27, fontWeight: "800", letterSpacing: -0.5 },
  assetHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12 },
  assetTitle: { fontSize: 16, lineHeight: 22, fontWeight: "800" },
  assetCount: { fontSize: 12, fontWeight: "700" },
  assetSymbol: { fontSize: 18, lineHeight: 24, fontWeight: "800" },
  assetUnit: { fontSize: 12, fontWeight: "800" },
});
