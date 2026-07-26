import { useCallback, useEffect, useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { api, ApiError, NotConfiguredError } from "../api/client";
import { Card } from "../components/Card";
import type { Account, MarketSnapshot } from "../api/types";
import { colors } from "../theme/colors";

const won = new Intl.NumberFormat("ko-KR", { style: "currency", currency: "KRW", maximumFractionDigits: 0 });

export function DashboardScreen() {
  const [market, setMarket] = useState<MarketSnapshot | undefined>();
  const [account, setAccount] = useState<Account | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [marketResult, accountResult] = await Promise.all([api.market(), api.account()]);
      setMarket(marketResult);
      setAccount(accountResult);
      setError(undefined);
    } catch (caught) {
      if (caught instanceof NotConfiguredError) setError("설정 탭에서 서버 주소를 먼저 입력해 주세요.");
      else if (caught instanceof ApiError) setError(caught.message);
      else setError("알 수 없는 오류가 발생했습니다.");
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 5_000);
    return () => clearInterval(timer);
  }, [load]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={colors.fg} />}
    >
      {error && (
        <Card>
          <Text style={styles.error}>{error}</Text>
        </Card>
      )}

      <Card title="시세">
        <View style={styles.row}>
          <Text style={styles.label}>KRW-BTC</Text>
          <Text style={styles.value}>{market?.price ? won.format(market.price) : "-"}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>연결 상태</Text>
          <Text style={[styles.value, market?.status === "CONNECTED" ? styles.ok : styles.warn]}>
            {market?.status === "CONNECTED" ? "실시간 연결됨" : market?.status === "CONNECTING" ? "연결 중..." : market?.status ?? "-"}
          </Text>
        </View>
      </Card>

      <Card title="자산 요약">
        <View style={styles.row}>
          <Text style={styles.label}>평가 자산</Text>
          <Text style={styles.value}>{account ? won.format(account.equity) : "-"}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>현금</Text>
          <Text style={styles.value}>{account ? won.format(account.cash) : "-"}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>미실현 손익</Text>
          <Text style={[styles.value, (account?.unrealizedPnl ?? 0) >= 0 ? styles.ok : styles.danger]}>
            {account ? won.format(account.unrealizedPnl) : "-"}
          </Text>
        </View>
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16 },
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 6 },
  label: { color: colors.muted, fontSize: 14 },
  value: { color: colors.fg, fontSize: 15, fontWeight: "600" },
  ok: { color: colors.success },
  warn: { color: colors.warning },
  danger: { color: colors.danger },
  error: { color: colors.danger }
});
