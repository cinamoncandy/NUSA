import React, { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { NusaButton } from "./components";
import { useTheme } from "./ThemeProvider";
import { OrderHistoryView } from "./orderHistoryView";
import { SettingsView } from "./settingsView";
import type { SettingsRepository } from "./settings";
import { NotificationView } from "./notificationView";
import { BUILD_SOURCE_SHA } from "./generatedBuildConfig";

interface MoreViewProps { readonly rawOrders: readonly unknown[] | null; readonly error: string | null; readonly refreshing: boolean; readonly onRefresh: () => void; readonly settingsRepository: SettingsRepository; }

const buildLabel = /^[0-9a-f]{40}$/i.test(BUILD_SOURCE_SHA) ? BUILD_SOURCE_SHA.slice(0, 8) : "dev";

export function MoreView({ rawOrders, error, refreshing, onRefresh, settingsRepository }: MoreViewProps) {
  const { theme } = useTheme();
  const [panel, setPanel] = useState<"HISTORY" | "NOTIFICATIONS" | "SETTINGS">("HISTORY");
  return <View style={[styles.workspace, { backgroundColor: theme.colors.background }]} testID="more-workspace">
    <View style={[styles.panels, { borderBottomColor: theme.colors.border }]} testID="more-panels">
      <NusaButton label="주문 이력" onPress={() => setPanel("HISTORY")} tone={panel === "HISTORY" ? "primary" : "neutral"} testID="more-history-tab" />
      <NusaButton label="알림" onPress={() => setPanel("NOTIFICATIONS")} tone={panel === "NOTIFICATIONS" ? "primary" : "neutral"} testID="more-notifications-tab" />
      <NusaButton label="설정" onPress={() => setPanel("SETTINGS")} tone={panel === "SETTINGS" ? "primary" : "neutral"} testID="more-settings-tab" />
      <Text style={[styles.build, { color: theme.colors.textMuted }]} testID="mobile-build-source">빌드 {buildLabel}</Text>
    </View>
    {panel === "HISTORY" ? <OrderHistoryView error={error} onRefresh={onRefresh} rawOrders={rawOrders} refreshing={refreshing} /> : panel === "NOTIFICATIONS" ? <NotificationView repository={settingsRepository} /> : <SettingsView repository={settingsRepository} />}
  </View>;
}

const styles = StyleSheet.create({
  workspace: { flex: 1 },
  panels: { flexDirection: "row", gap: 8, paddingHorizontal: 20, paddingVertical: 10, borderBottomWidth: 1, alignItems: "center", flexWrap: "wrap" },
  build: { marginLeft: "auto", fontSize: 11, lineHeight: 16, fontWeight: "700", fontVariant: ["tabular-nums"] },
});