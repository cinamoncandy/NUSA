import React, { useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { NusaCard } from "./components";
import { DEFAULT_SETTINGS, type SettingsRepository } from "./settings";
import { MobileNotificationCenter } from "./notificationCenter";

export function NotificationView({ repository }: Readonly<{ repository: SettingsRepository }>) {
  const [ready, setReady] = useState(false);
  const [enabled, setEnabled] = useState(DEFAULT_SETTINGS.notifications.enabled);
  useEffect(() => { void repository.load().then((value) => { setEnabled(value?.notifications.enabled ?? true); setReady(true); }).catch(() => setReady(true)); }, [repository]);
  if (!ready) return <View testID="notifications-loading"><ActivityIndicator /><Text>Loading notifications...</Text></View>;
  return <ScrollView testID="notifications-screen"><NusaCard testID="notifications-paper"><Text>Notifications</Text><Text>{enabled ? "Enabled" : "Disabled"}</Text><Text>Paper / Read Only</Text><Text>Price, fill, order status, and system events are deduplicated.</Text></NusaCard></ScrollView>;
}

export { MobileNotificationCenter };
