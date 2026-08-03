import React, { useState } from "react";
import { View } from "react-native";
import { NusaButton } from "./components";
import { OrderHistoryView } from "./orderHistoryView";
import { SettingsView } from "./settingsView";
import type { SettingsRepository } from "./settings";

interface MoreViewProps { readonly rawOrders: readonly unknown[] | null; readonly error: string | null; readonly refreshing: boolean; readonly onRefresh: () => void; readonly settingsRepository: SettingsRepository; }

export function MoreView({ rawOrders, error, refreshing, onRefresh, settingsRepository }: MoreViewProps) {
  const [panel, setPanel] = useState<"HISTORY" | "SETTINGS">("HISTORY");
  return <View style={{ flex: 1 }} testID="more-workspace"><View style={{ flexDirection: "row", gap: 8, paddingHorizontal: 20, paddingTop: 8 }} testID="more-panels"><NusaButton label="History" onPress={() => setPanel("HISTORY")} tone={panel === "HISTORY" ? "primary" : "neutral"} testID="more-history-tab" /><NusaButton label="Settings" onPress={() => setPanel("SETTINGS")} tone={panel === "SETTINGS" ? "primary" : "neutral"} testID="more-settings-tab" /></View>{panel === "HISTORY" ? <OrderHistoryView error={error} onRefresh={onRefresh} rawOrders={rawOrders} refreshing={refreshing} /> : <SettingsView repository={settingsRepository} />}</View>;
}
