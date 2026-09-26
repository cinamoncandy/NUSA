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

const DESCRIPTIONS: Readonly<Record<PrimaryDestination, string>> = Object.freeze({
  Home: "현재 NUSA 상태",
  Paper: "PAPER 실행, 증거와 학습",
  Live: "LIVE 준비도와 안전 게이트",
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
    <View style={[styles.navigation, { backgroundColor: theme.colors.navSurface, borderColor: ui.color.border }]}>
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
              { backgroundColor: "transparent", opacity: pressed ? 0.62 : active ? 1 : 0.72 },
            ]}
            testID={`tab-${destination}`}
          >
            <View style={[styles.indicator, { backgroundColor: active ? theme.colors.aiSignalEnd : ui.color.border, opacity: active ? 1 : 0.3 }]} />
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
  frame: { paddingHorizontal: 0, paddingTop: 0, paddingBottom: 0, alignItems: "center" },
  navigation: { width: "100%", maxWidth: 720, borderTopWidth: StyleSheet.hairlineWidth, alignItems: "center" },
  inner: { width: "100%", flexDirection: "row" },
  item: { flex: 1, minHeight: 50, alignItems: "center", justifyContent: "center", gap: 4, paddingHorizontal: 2 },
  indicator: { height: 2, width: 28, borderRadius: 1 },
  label: { fontSize: 10, fontWeight: "700" },
  activeLabel: { fontWeight: "900" },
});
