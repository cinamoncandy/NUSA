import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  PRIMARY_DESTINATIONS,
  primaryDestinationDisplayLabels,
  primaryDestinationLabels,
  type PrimaryDestination,
} from "./navigationContract";
import { useTheme } from "./ThemeProvider";
import { visualSystem } from "./visualSystem";
import { aiIslandPalette, readableFont } from "./designSystem";
import { TabIcon } from "./tabIcons";

const DESCRIPTIONS: Readonly<Record<PrimaryDestination, string>> = Object.freeze({
  Home: "현재 NUSA 상태",
  Paper: "PAPER 실행, 증거와 학습",
  Live: "LIVE 준비도와 안전 게이트",
  Futures: "모의 선물 상태와 한도",
  More: "전략, 위험, 성과와 설정",
});

export function PrimaryNavigation({
  activeDestination,
  obscured = false,
  onNavigate,
}: Readonly<{
  activeDestination: PrimaryDestination;
  obscured?: boolean;
  onNavigate: (destination: PrimaryDestination) => void;
}>) {
  const { theme } = useTheme();
  const ui = visualSystem(theme);
  return <View style={styles.frame} pointerEvents="box-none">
    <View style={[styles.navigation, { backgroundColor: aiIslandPalette.navGlass, borderColor: aiIslandPalette.glassEdge }]}>
      <View accessibilityRole="tablist" style={styles.inner} testID="primary-navigation">
        {PRIMARY_DESTINATIONS.map((destination) => {
          const active = !obscured && activeDestination === destination;
          return <Pressable
            accessibilityHint={DESCRIPTIONS[destination]}
            accessibilityLabel={primaryDestinationLabels[destination]}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            key={destination}
            onPress={() => onNavigate(destination)}
            style={({ pressed }) => [
              styles.item,
              { backgroundColor: active ? theme.colors.primarySoft : "transparent", opacity: pressed ? 0.72 : active ? 1 : 0.82 },
            ]}
            testID={`tab-${destination}`}
          >
            <View style={[styles.indicator, { backgroundColor: active ? theme.colors.aiSignalEnd : ui.color.border, opacity: active ? 1 : 0 }]} />
            <TabIcon destination={destination} active={active} muted={ui.color.textMuted} />
            <Text numberOfLines={1} style={[styles.label, { color: active ? ui.color.text : ui.color.textMuted }, active && styles.activeLabel]}>
              {primaryDestinationDisplayLabels[destination]}
            </Text>
          </Pressable>;
        })}
      </View>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  // A floating glass pill (AI island look, 2026-10-29); the selected tab is a rounded lit cell inside it.
  frame: { paddingHorizontal: 14, paddingTop: 6, paddingBottom: 10, alignItems: "center", backgroundColor: aiIslandPalette.ground },
  navigation: { width: "100%", maxWidth: 720, borderWidth: StyleSheet.hairlineWidth, borderRadius: 32, alignItems: "center", paddingHorizontal: 6, paddingVertical: 6 },
  inner: { width: "100%", flexDirection: "row" },
  item: { flex: 1, minHeight: 52, alignItems: "center", justifyContent: "center", gap: 3, paddingHorizontal: 2, borderRadius: 24 },
  indicator: { height: 2, width: 14, borderRadius: 999 },
  label: { fontSize: readableFont(10), fontWeight: "700" },
  activeLabel: { fontWeight: "600" },
});
