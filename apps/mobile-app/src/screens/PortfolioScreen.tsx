import { useCallback, useEffect, useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { api, ApiError, NotConfiguredError } from "../api/client";
import { Card } from "../components/Card";
import type { Account } from "../api/types";
import { colors } from "../theme/colors";

const won = new Intl.NumberFormat("ko-KR", { style: "currency", currency: "KRW", maximumFractionDigits: 0 });
const qty = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 8 });

export function PortfolioScreen() {
  const [account, setAccount] = useState<Account | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setAccount(await api.account());
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

  const recentOrders = account ? [...account.orders].reverse().slice(0, 20) : [];

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

      <Card title="보유 포지션">
        <View style={styles.row}>
          <Text style={styles.label}>마켓</Text>
          <Text style={styles.value}>{account?.position.market ?? "-"}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>수량</Text>
          <Text style={styles.value}>{account ? qty.format(account.position.quantity) : "-"}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>평균 단가</Text>
          <Text style={styles.value}>{account ? won.format(account.position.averagePrice) : "-"}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>실현 손익</Text>
          <Text style={[styles.value, (account?.position.realizedPnl ?? 0) >= 0 ? styles.ok : styles.danger]}>
            {account ? won.format(account.position.realizedPnl) : "-"}
          </Text>
        </View>
      </Card>

      <Card title={`체결 기록 (최근 ${recentOrders.length}건)`}>
        {recentOrders.length === 0 ? (
          <Text style={styles.label}>체결 내역이 없습니다.</Text>
        ) : (
          recentOrders.map((order) => (
            <View key={order.id} style={styles.orderRow}>
              <View style={styles.orderHeader}>
                <Text style={[styles.side, order.side === "BUY" ? styles.ok : styles.danger]}>{order.side === "BUY" ? "매수" : "매도"}</Text>
                <Text style={styles.value}>{won.format(order.price)}</Text>
              </View>
              <View style={styles.row}>
                <Text style={styles.label}>{qty.format(order.quantity)} {order.market}</Text>
                <Text style={styles.label}>{new Date(order.filledAt).toLocaleString("ko-KR")}</Text>
              </View>
            </View>
          ))
        )}
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16 },
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 6 },
  label: { color: colors.muted, fontSize: 13 },
  value: { color: colors.fg, fontSize: 15, fontWeight: "600" },
  ok: { color: colors.success },
  danger: { color: colors.danger },
  error: { color: colors.danger },
  orderRow: { borderTopWidth: 1, borderTopColor: colors.border, paddingVertical: 10 },
  orderHeader: { flexDirection: "row", justifyContent: "space-between", marginBottom: 4 },
  side: { fontWeight: "700", fontSize: 14 }
});
