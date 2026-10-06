import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { ScreenFrame, ScreenTitle, Surface } from "./screenFrame";
import { useTheme } from "./ThemeProvider";
import { visualSystem } from "./visualSystem";
import { fieldFonts } from "./fieldFonts";
import type { PerformanceScreen } from "./performanceModel";
import { fieldRadii } from "./designSystem";

/** More → 성과: read-only PAPER performance rows, or one honest line when no server record is connected. */
export function PerformanceView({ screen, onClose }: Readonly<{ screen: PerformanceScreen; onClose: () => void }>) {
  const { theme } = useTheme();
  const visual = visualSystem(theme);
  return <ScreenFrame testID="more-detail-Performance">
    <ScreenTitle title="성과" detail="PAPER · 읽기 전용" />
    <Surface>
      <Text style={[styles.headline, { color: visual.color.text }]} testID="performance-headline">{screen.headline}</Text>
      {screen.rows.map((row, index) => <View key={row.label} style={[styles.row, index > 0 ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: visual.color.border } : null]} testID={`performance-row-${index}`}>
        <Text style={[styles.label, { color: visual.color.textMuted }]}>{row.label}</Text>
        <Text style={[fieldFonts.mono, styles.value, { color: row.tone === "pos" ? theme.colors.success : row.tone === "neg" ? theme.colors.danger : visual.color.text }]}>{row.value}</Text>
      </View>)}
      <Pressable accessibilityRole="button" accessibilityLabel="더보기로 돌아가기" onPress={onClose} style={[styles.button, { borderColor: visual.color.border, minHeight: visual.touchTarget }]}>
        <Text style={[styles.buttonText, { color: visual.color.text }]}>돌아가기</Text>
      </Pressable>
    </Surface>
  </ScreenFrame>;
}

const styles = StyleSheet.create({
  headline: { fontSize: 15, lineHeight: 22, marginBottom: 6 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 12, gap: 12 },
  label: { fontSize: 14 },
  value: { fontSize: 14, fontVariant: ["tabular-nums"] },
  button: { alignItems: "center", justifyContent: "center", borderWidth: 1, borderRadius: fieldRadii.md, paddingHorizontal: 16, marginTop: 10 },
  buttonText: { fontSize: 14, fontWeight: "700" },
});
