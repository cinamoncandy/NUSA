import React from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { DataRow, NusaCard, StatusChip } from "./components";
import { InlineNotice, ScreenHeader } from "./uxPrimitives";
import { useTheme } from "./ThemeProvider";
import type { SettingsRepository } from "./settings";
import { MobileNotificationCenter } from "./notificationCenter";

export function NotificationView({ repository }: Readonly<{ repository: SettingsRepository }>) {
  const { theme } = useTheme();
  void repository;

  return <ScrollView contentContainerStyle={styles.content} testID="notifications-screen">
    <ScreenHeader eyebrow="LOCAL NOTIFICATIONS" title="알림" description="실제로 연결된 이벤트만 표시하며, 아직 없는 기능을 있는 것처럼 만들지 않습니다." statusLabel="미연결" statusTone="neutral" />
    <InlineNotice title="알림 이벤트 수집이 아직 연결되지 않았습니다" detail="현재 빌드는 알림 목록·배지·푸시 동작을 제공하지 않습니다. 실제 이벤트 런타임이 연결되기 전까지는 비어 있는 상태를 그대로 표시합니다." tone="info" />
    <NusaCard testID="notifications-paper" raised><View style={styles.header}><View><Text style={[styles.eyebrow, { color: theme.colors.textMuted }]}>CAPABILITY</Text><Text style={[styles.cardTitle, { color: theme.colors.text }]}>현재 알림 범위</Text></View><StatusChip label="READ ONLY" tone="info" /></View><DataRow label="운영 모드" value="PAPER" emphasis /><DataRow label="이벤트 수집" value="미연결" /><DataRow label="푸시 권한 요청" value="사용 안 함" /><DataRow label="가짜 알림" value="생성 금지" tone="success" /></NusaCard>
  </ScrollView>;
}

const styles = StyleSheet.create({ content: { paddingHorizontal: 20, paddingTop: 20, gap: 16, paddingBottom: 36, width: "100%", maxWidth: 1080, alignSelf: "center" }, header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 10 }, eyebrow: { fontSize: 10, fontWeight: "800", letterSpacing: 1.1, marginBottom: 4 }, cardTitle: { fontSize: 18, fontWeight: "700" } });

export { MobileNotificationCenter };
