import React from "react";
import { Pressable, Text, View } from "react-native";
import { MORE_DESTINATIONS, type MoreDestination } from "./navigationContract";
import { ScreenFrame, ScreenTitle, Surface } from "./screenFrame";
import { useTheme } from "./ThemeProvider";
import { visualSystem } from "./visualSystem";

const LABELS: Readonly<Record<MoreDestination, string>> = Object.freeze({
  Strategies: "Strategies",
  Portfolio: "Portfolio",
  Risk: "Risk",
  Performance: "Performance",
  PaperEvidence: "PAPER Evidence",
  OrderHistory: "Order History",
  SystemStatus: "System Status",
  Notifications: "Notifications",
  Settings: "Settings",
  Help: "Help",
});

export function MoreMenuView({ onOpen }: Readonly<{ onOpen: (destination: MoreDestination) => void }>) {
  const { theme } = useTheme();
  const ui = visualSystem(theme);
  return <ScreenFrame testID="more-view">
    <ScreenTitle title="More" detail="전략, 증거, 위험 및 설정" />
    <Surface>
      <View style={{ gap: ui.space.compact }}>
        {MORE_DESTINATIONS.map((destination) => <Pressable
          accessibilityRole="button"
          key={destination}
          onPress={() => onOpen(destination)}
          style={({ pressed }) => ({
            minHeight: ui.touchTarget,
            justifyContent: "center",
            borderBottomWidth: destination === MORE_DESTINATIONS[MORE_DESTINATIONS.length - 1] ? 0 : 1,
            borderBottomColor: ui.color.border,
            opacity: pressed ? 0.7 : 1,
          })}
          testID={`more-${destination}`}
        >
          <Text style={{ color: ui.color.text, fontSize: 16 }}>{LABELS[destination]}</Text>
        </Pressable>)}
      </View>
    </Surface>
    <Text style={{ color: ui.color.textMuted, fontSize: 11 }}>PAPER_ONLY · LIVE AUTHORITY NONE · AI ZERO AUTHORITY</Text>
  </ScreenFrame>;
}
