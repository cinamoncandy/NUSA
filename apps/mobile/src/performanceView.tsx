import React from "react";
import { Pressable, StyleSheet, Text } from "react-native";
import { ScreenFrame, ScreenTitle } from "./screenFrame";
import { CalmTiles } from "./uiKit";
import { useTheme } from "./ThemeProvider";
import { visualSystem } from "./visualSystem";
import type { PerformanceScreen } from "./performanceModel";
import { fieldRadii } from "./designSystem";

/** More → 성과: read-only PAPER performance rows, or one honest line when no server record is connected. */
export function PerformanceView({ screen, onClose }: Readonly<{ screen: PerformanceScreen; onClose: () => void }>) {
  const { theme } = useTheme();
  const visual = visualSystem(theme);
  // Same values and tones as before: a gain was already the plain text colour, only a real loss is red.
  const tiles = screen.rows.map((row) => ({ label: row.label, value: row.value, tone: row.tone === "neg" ? "LOSS" as const : "NORMAL" as const }));
  return <ScreenFrame testID="more-detail-Performance">
    <ScreenTitle title="성과" detail="PAPER · 읽기 전용" />
    <Text style={[styles.headline, { color: visual.color.text }]} testID="performance-headline">{screen.headline}</Text>
    {tiles.length > 0 ? <CalmTiles rows={tiles} testID="performance-tiles" /> : null}
    <Pressable accessibilityRole="button" accessibilityLabel="더보기로 돌아가기" onPress={onClose} style={[styles.button, { borderColor: visual.color.border, minHeight: visual.touchTarget }]}>
      <Text style={[styles.buttonText, { color: visual.color.text }]}>돌아가기</Text>
    </Pressable>
  </ScreenFrame>;
}

const styles = StyleSheet.create({
  headline: { fontSize: 15, lineHeight: 22 },
  button: { alignItems: "center", justifyContent: "center", borderWidth: 1, borderRadius: fieldRadii.md, paddingHorizontal: 16, marginTop: 10 },
  buttonText: { fontSize: 14, fontWeight: "700" },
});
