import React, { useEffect, useState } from "react";
import { Linking, StyleSheet, Text, View } from "react-native";
import { NusaButton } from "./components";
import { useTheme } from "./ThemeProvider";
import { OrderHistoryView } from "./orderHistoryView";
import { SettingsView } from "./settingsView";
import type { SettingsRepository } from "./settings";
import { NotificationView } from "./notificationView";
import { BUILD_SOURCE_SHA } from "./generatedBuildConfig";

interface MoreViewProps { readonly rawOrders: readonly unknown[] | null; readonly error: string | null; readonly refreshing: boolean; readonly onRefresh: () => void; readonly settingsRepository: SettingsRepository; }
type BuildFreshness = "CURRENT" | "STALE" | "UNKNOWN";

const stableReleaseApi = "https://api.github.com/repos/cinamoncandy/NUSA/releases/tags/nusa-android";
const stableApkUrl = "https://github.com/cinamoncandy/NUSA/releases/download/nusa-android/NUSA-Android.apk";
const validBuildSha = /^[0-9a-f]{40}$/i.test(BUILD_SOURCE_SHA);
const buildLabel = validBuildSha ? BUILD_SOURCE_SHA.slice(0, 8) : "dev";

export function MoreView({ rawOrders, error, refreshing, onRefresh, settingsRepository }: MoreViewProps) {
  const { theme, preset } = useTheme();
  const [panel, setPanel] = useState<"HISTORY" | "NOTIFICATIONS" | "SETTINGS">("HISTORY");
  const [freshness, setFreshness] = useState<BuildFreshness>("UNKNOWN");

  useEffect(() => {
    if (!validBuildSha) return;
    let active = true;
    void fetch(stableReleaseApi, { headers: { Accept: "application/vnd.github+json" } })
      .then(async (response) => {
        if (!response.ok) throw new Error(`stable release lookup failed: ${response.status}`);
        const payload = await response.json() as { target_commitish?: unknown };
        const target = typeof payload.target_commitish === "string" ? payload.target_commitish : "";
        if (!/^[0-9a-f]{40}$/i.test(target)) throw new Error("stable release target is invalid");
        if (active) setFreshness(target.toLowerCase() === BUILD_SOURCE_SHA.toLowerCase() ? "CURRENT" : "STALE");
      })
      .catch(() => { if (active) setFreshness("UNKNOWN"); });
    return () => { active = false; };
  }, []);

  return <View style={[styles.workspace, { backgroundColor: theme.colors.background }]} testID="more-workspace">
    <View style={[styles.panels, { borderBottomColor: theme.colors.border }]} testID="more-panels">
      <NusaButton label="주문 이력" onPress={() => setPanel("HISTORY")} tone={panel === "HISTORY" ? "primary" : "neutral"} testID="more-history-tab" />
      <NusaButton label="알림" onPress={() => setPanel("NOTIFICATIONS")} tone={panel === "NOTIFICATIONS" ? "primary" : "neutral"} testID="more-notifications-tab" />
      <NusaButton label="설정" onPress={() => setPanel("SETTINGS")} tone={panel === "SETTINGS" ? "primary" : "neutral"} testID="more-settings-tab" />
      <Text style={[styles.build, { color: freshness === "STALE" ? theme.colors.danger : theme.colors.textMuted }]} testID="mobile-build-source">빌드 {buildLabel} · UI {preset.toUpperCase()}{freshness === "STALE" ? " · 업데이트 필요" : freshness === "CURRENT" ? " · 최신" : ""}</Text>
      {freshness === "STALE" ? <NusaButton label="업데이트" tone="primary" onPress={() => { void Linking.openURL(stableApkUrl); }} testID="mobile-update-action" /> : null}
    </View>
    {panel === "HISTORY" ? <OrderHistoryView error={error} onRefresh={onRefresh} rawOrders={rawOrders} refreshing={refreshing} /> : panel === "NOTIFICATIONS" ? <NotificationView repository={settingsRepository} /> : <SettingsView repository={settingsRepository} />}
  </View>;
}

const styles = StyleSheet.create({
  workspace: { flex: 1 },
  panels: { flexDirection: "row", gap: 8, paddingHorizontal: 20, paddingVertical: 10, borderBottomWidth: 1, alignItems: "center", flexWrap: "wrap" },
  build: { marginLeft: "auto", fontSize: 11, lineHeight: 16, fontWeight: "700", fontVariant: ["tabular-nums"] },
});
