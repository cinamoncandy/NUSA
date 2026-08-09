import React from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { DataRow, NusaCard, SectionHeading, StatusChip } from "./components";
import { useTheme } from "./ThemeProvider";
import type { SettingsRepository } from "./settings";
import { MobileNotificationCenter } from "./notificationCenter";

export function NotificationView({ repository }: Readonly<{ repository: SettingsRepository }>) {
  const { theme } = useTheme();
  void repository;

  return <ScrollView contentContainerStyle={styles.content} testID="notifications-screen">
    <SectionHeading eyebrow="LOCAL NOTIFICATIONS" title="알림" description="현재 모바일 빌드의 알림 런타임 연결 상태를 표시합니다." />
    <NusaCard testID="notifications-paper" raised>
      <View style={styles.header}><Text style={[styles.cardTitle, { color: theme.colors.text }]}>알림 상태</Text><StatusChip label="미연결" tone="neutral" /></View>
      <DataRow label="운영 모드" value="PAPER" emphasis />
      <DataRow label="권한" value="읽기 전용" />
      <DataRow label="현재 상태" value="이벤트 수집 미연결" />
      <Text style={[styles.message, { color: theme.colors.textMuted }]}>이 빌드에서는 알림 이벤트 수집·표시 런타임이 앱에 연결되어 있지 않습니다. 실제 이벤트가 연결되기 전에는 알림 목록이나 동작하지 않는 알림 설정을 제공하지 않습니다.</Text>
    </NusaCard>
  </ScrollView>;
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingTop: 18, gap: 14, paddingBottom: 32, width: "100%", maxWidth: 1080, alignSelf: "center" },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 10 },
  cardTitle: { fontSize: 18, fontWeight: "700" },
  message: { marginTop: 10, fontSize: 13, lineHeight: 20 },
});

export { MobileNotificationCenter };
