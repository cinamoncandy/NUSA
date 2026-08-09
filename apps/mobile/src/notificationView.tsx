import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { DataRow, NusaButton, NusaCard, SectionHeading, StatusChip } from "./components";
import { useTheme } from "./ThemeProvider";
import { DEFAULT_SETTINGS, type SettingsRepository } from "./settings";
import { MobileNotificationCenter } from "./notificationCenter";

export function NotificationView({ repository }: Readonly<{ repository: SettingsRepository }>) {
  const { theme } = useTheme();
  const [ready, setReady] = useState(false);
  const [enabled, setEnabled] = useState(DEFAULT_SETTINGS.notifications.enabled);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setReady(false);
    setError(null);
    void repository.load().then((value) => { setEnabled(value?.notifications.enabled ?? true); setReady(true); }).catch((loadError) => { setError(loadError instanceof Error ? loadError.message : "알림 설정을 불러올 수 없습니다."); setReady(true); });
  }, [repository]);

  useEffect(() => { load(); }, [load]);
  if (!ready) return <View style={styles.state} testID="notifications-loading"><ActivityIndicator color={theme.colors.primary} /><Text style={[styles.title, { color: theme.colors.text }]}>알림 설정을 불러오는 중</Text></View>;
  if (error) return <View style={styles.state} testID="notifications-error"><NusaCard><Text style={[styles.title, { color: theme.colors.danger }]}>알림 설정을 표시할 수 없습니다</Text><Text style={[styles.message, { color: theme.colors.textMuted }]}>{error}</Text><NusaButton label="다시 시도" onPress={load} /></NusaCard></View>;

  return <ScrollView contentContainerStyle={styles.content} testID="notifications-screen">
    <SectionHeading eyebrow="LOCAL NOTIFICATIONS" title="알림" description="PAPER 운영과 시스템 이벤트를 로컬 설정에 따라 정리합니다." />
    <NusaCard testID="notifications-paper" raised>
      <View style={styles.header}><Text style={[styles.cardTitle, { color: theme.colors.text }]}>알림 상태</Text><StatusChip label={enabled ? "켜짐" : "꺼짐"} tone={enabled ? "success" : "neutral"} /></View>
      <DataRow label="운영 모드" value="PAPER" emphasis />
      <DataRow label="권한" value="읽기 전용" />
      <Text style={[styles.message, { color: theme.colors.textMuted }]}>가격·체결·주문 상태·시스템 이벤트는 중복 제거 후 표시됩니다. 이 알림 화면은 주문을 생성하거나 수정하지 않습니다.</Text>
    </NusaCard>
  </ScrollView>;
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingTop: 18, gap: 14, paddingBottom: 32 },
  state: { flex: 1, justifyContent: "center", alignItems: "center", gap: 10, padding: 20 },
  title: { fontSize: 18, fontWeight: "700" },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 10 },
  cardTitle: { fontSize: 18, fontWeight: "700" },
  message: { marginTop: 10, fontSize: 13, lineHeight: 20 },
});

export { MobileNotificationCenter };
