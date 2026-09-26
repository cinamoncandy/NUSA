import React from "react";
import { Pressable, StyleSheet, Text } from "react-native";
import { ScreenFrame, ScreenTitle, Surface } from "./screenFrame";
import { useTheme } from "./ThemeProvider";
import { visualSystem } from "./visualSystem";

const copy: Readonly<Record<"Risk" | "Performance" | "SystemStatus" | "Help", { title: string; detail: string }>> = {
  Risk: { title: "Risk", detail: "검증된 Risk evidence가 이 화면 계약에 연결되기 전에는 값을 추정하거나 합성하지 않습니다." },
  Performance: { title: "Performance", detail: "검증된 PAPER Performance evidence가 연결되기 전에는 수익률·PnL·성과 지표를 표시하지 않습니다." },
  SystemStatus: { title: "System Status", detail: "검증된 runtime health projection이 연결되기 전에는 정상 상태를 추정하지 않습니다." },
  Help: { title: "Help", detail: "검증된 도움말 콘텐츠가 아직 이 화면에 연결되지 않았습니다." },
};

export type TruthfulMoreDetail = keyof typeof copy;

export function MoreDetailView({ destination, onClose }: Readonly<{ destination: TruthfulMoreDetail; onClose: () => void }>) {
  const { theme } = useTheme();
  const visual = visualSystem(theme);
  const item = copy[destination];
  return <ScreenFrame testID={`more-detail-${destination}`}>
    <ScreenTitle title={item.title} detail="MORE · Read-only presentation boundary" />
    <Surface>
      <Text style={[styles.status, { color: visual.color.warning }]}>UNAVAILABLE</Text>
      <Text style={[styles.detail, { color: visual.color.textMuted }]}>{item.detail}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="More로 돌아가기" onPress={onClose} style={[styles.button, { borderColor: visual.color.border, minHeight: visual.touchTarget }]}>
        <Text style={[styles.buttonText, { color: visual.color.text }]}>돌아가기</Text>
      </Pressable>
    </Surface>
  </ScreenFrame>;
}

const styles = StyleSheet.create({
  status: { fontSize: 12, fontWeight: "800", letterSpacing: 0.8 },
  detail: { fontSize: 14, lineHeight: 21 },
  button: { alignItems: "center", justifyContent: "center", borderWidth: 1, borderRadius: 12, paddingHorizontal: 16 },
  buttonText: { fontSize: 14, fontWeight: "700" },
});
