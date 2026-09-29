import React from "react";
import { Text, View } from "react-native";
import { ScreenFrame, ScreenTitle, Surface } from "./screenFrame";
import { useTheme } from "./ThemeProvider";
import { visualSystem } from "./visualSystem";

export interface StrategyPresentation {
  readonly champion: string | null;
  readonly challenger: string | null;
  readonly evidenceStatus: "AVAILABLE" | "UNAVAILABLE";
}

export function StrategiesView({ presentation }: Readonly<{ presentation: StrategyPresentation }>) {
  const { theme } = useTheme();
  const ui = visualSystem(theme);
  return <ScreenFrame testID="strategies-view">
    <ScreenTitle title="전략" detail="전략 관리에서 확인된 상태만 표시합니다." />
    <Surface testID="strategy-champion">
      <Text style={{ color: ui.color.textMuted, fontSize: 11 }}>대표 전략</Text>
      <Text style={{ color: ui.color.text, fontSize: 20, fontWeight: "700", marginTop: 6 }}>{presentation.champion ?? "—"}</Text>
    </Surface>
    <Surface testID="strategy-challenger">
      <Text style={{ color: ui.color.textMuted, fontSize: 11 }}>도전자 전략</Text>
      <Text style={{ color: ui.color.text, fontSize: 20, fontWeight: "700", marginTop: 6 }}>{presentation.challenger ?? "—"}</Text>
    </Surface>
    <View>
      <Text style={{ color: ui.color.textMuted, fontSize: 12 }}>
        {presentation.evidenceStatus === "AVAILABLE" ? "검증 가능한 성과 확인 기록이 연결되어 있습니다." : "성과 확인 기록을 사용할 수 없습니다. 값을 추정하지 않습니다."}
      </Text>
    </View>
  </ScreenFrame>;
}
