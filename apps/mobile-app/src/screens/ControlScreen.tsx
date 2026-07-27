import { useCallback, useEffect, useRef, useState } from "react";
import { ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { api, ApiError, NotConfiguredError } from "../api/client";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import type { ControlSnapshot } from "../api/types";
import { colors } from "../theme/colors";
import { ControlEventNotifier, requestNotificationPermission } from "../notifications/notifications";

export function ControlScreen() {
  const [control, setControl] = useState<ControlSnapshot | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [notificationsOn, setNotificationsOn] = useState(false);
  const notifierRef = useRef<ControlEventNotifier | undefined>(undefined);

  const load = useCallback(async () => {
    try {
      setControl(await api.control());
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

  useEffect(() => () => notifierRef.current?.stop(), []);

  const run = async (action: () => Promise<ControlSnapshot>) => {
    setBusy(true);
    try {
      setControl(await action());
      setError(undefined);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "알 수 없는 오류가 발생했습니다.");
    } finally {
      setBusy(false);
    }
  };

  const toggleNotifications = async (value: boolean) => {
    if (value) {
      const granted = await requestNotificationPermission();
      if (!granted) return;
      notifierRef.current = new ControlEventNotifier();
      notifierRef.current.start();
    } else {
      notifierRef.current?.stop();
      notifierRef.current = undefined;
    }
    setNotificationsOn(value);
  };

  const recentEvents = control ? [...control.events].slice(0, 10) : [];

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {error && (
        <Card>
          <Text style={styles.error}>{error}</Text>
        </Card>
      )}

      <Card title="전략 상태">
        <View style={styles.row}>
          <Text style={styles.label}>상태</Text>
          <Text style={[styles.value, control?.status === "RUNNING" ? styles.ok : styles.muted]}>
            {control?.status === "RUNNING" ? "실행 중" : "정지됨"}
          </Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>전략</Text>
          <Text style={styles.value}>{control?.activeStrategyId ?? control?.strategyId ?? "-"}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>자동매매</Text>
          <Switch
            value={control?.autoTradeEnabled ?? false}
            onValueChange={(value) => void run(() => api.setAutoTrade(value))}
            disabled={busy || !control}
          />
        </View>
      </Card>

      <Card title="실행 제어">
        <Button label="시작" onPress={() => void run(api.startStrategy)} loading={busy} disabled={control?.status === "RUNNING"} />
        <View style={{ height: 8 }} />
        <Button label="정지" variant="muted" onPress={() => void run(api.stopStrategy)} loading={busy} disabled={control?.status !== "RUNNING"} />
      </Card>

      <Card title="Kill Switch">
        <Text style={styles.hint}>모든 자동매매를 즉시 중단합니다. 확인 절차 없이 바로 실행됩니다.</Text>
        <View style={{ height: 8 }} />
        <Button label="킬 스위치 — 즉시 정지" variant="danger" onPress={() => void run(api.stopStrategy)} loading={busy} />
      </Card>

      <Card title="알림">
        <View style={styles.row}>
          <Text style={styles.label}>주문/리스크 알림 (앱 실행 중)</Text>
          <Switch value={notificationsOn} onValueChange={(value) => void toggleNotifications(value)} />
        </View>
        <Text style={styles.hint}>이 앱이 실행 중일 때 새 주문·리스크 이벤트를 기기 알림으로 표시합니다.</Text>
      </Card>

      <Card title="이벤트 로그">
        {recentEvents.length === 0 ? (
          <Text style={styles.label}>이벤트가 없습니다.</Text>
        ) : (
          recentEvents.map((event) => (
            <View key={event.id} style={styles.eventRow}>
              <Text style={styles.eventType}>{event.type}</Text>
              <Text style={styles.label}>{event.message}</Text>
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
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 6 },
  label: { color: colors.muted, fontSize: 14, flexShrink: 1 },
  value: { color: colors.fg, fontSize: 15, fontWeight: "600" },
  ok: { color: colors.success },
  muted: { color: colors.muted },
  error: { color: colors.danger },
  hint: { color: colors.muted, fontSize: 12 },
  eventRow: { borderTopWidth: 1, borderTopColor: colors.border, paddingVertical: 8 },
  eventType: { color: colors.primary, fontWeight: "700", fontSize: 12, marginBottom: 2 }
});
