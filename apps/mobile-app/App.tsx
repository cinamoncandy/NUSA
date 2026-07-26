import { useState } from "react";
import { Pressable, SafeAreaView, StatusBar, StyleSheet, Text, View } from "react-native";
import { ControlScreen } from "./src/screens/ControlScreen";
import { DashboardScreen } from "./src/screens/DashboardScreen";
import { PortfolioScreen } from "./src/screens/PortfolioScreen";
import { SettingsScreen } from "./src/screens/SettingsScreen";
import { colors } from "./src/theme/colors";

type Tab = "dashboard" | "portfolio" | "control" | "settings";

const TABS: ReadonlyArray<{ readonly key: Tab; readonly label: string }> = [
  { key: "dashboard", label: "대시보드" },
  { key: "portfolio", label: "포트폴리오" },
  { key: "control", label: "제어" },
  { key: "settings", label: "설정" }
];

export default function App() {
  const [tab, setTab] = useState<Tab>("dashboard");

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={colors.bg} />
      <View style={styles.header}>
        <Text style={styles.headerTitle}>DOKKAEBI</Text>
      </View>

      <View style={styles.screen}>
        {tab === "dashboard" && <DashboardScreen />}
        {tab === "portfolio" && <PortfolioScreen />}
        {tab === "control" && <ControlScreen />}
        {tab === "settings" && <SettingsScreen />}
      </View>

      <View style={styles.tabBar}>
        {TABS.map((item) => (
          <Pressable key={item.key} style={styles.tabButton} onPress={() => setTab(item.key)}>
            <Text style={[styles.tabLabel, tab === item.key && styles.tabLabelActive]}>{item.label}</Text>
          </Pressable>
        ))}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border
  },
  headerTitle: { color: colors.fg, fontSize: 18, fontWeight: "800", letterSpacing: 1 },
  screen: { flex: 1 },
  tabBar: {
    flexDirection: "row",
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface
  },
  tabButton: { flex: 1, paddingVertical: 12, alignItems: "center", minHeight: 48, justifyContent: "center" },
  tabLabel: { color: colors.muted, fontSize: 12, fontWeight: "600" },
  tabLabelActive: { color: colors.primary }
});
