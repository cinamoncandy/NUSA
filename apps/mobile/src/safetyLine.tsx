import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { useTheme } from "./ThemeProvider";
import { fieldFonts } from "./fieldFonts";
import type { SafetyLine as SafetyLineModel } from "./safetyLineModel";
import { readableFont } from "./designSystem";

/** One quiet line at the top of every tab: the safety state, then the fixed PAPER/LIVE boundary. */
export function SafetyLine({ line }: Readonly<{ line: SafetyLineModel }>) {
  const { theme } = useTheme();
  const color = line.tone === "ok" ? theme.colors.success : line.tone === "halt" ? theme.colors.danger : theme.colors.warning;
  return <View style={[styles.row, { borderBottomColor: theme.colors.border }]} testID="safety-line" accessibilityRole="summary" accessibilityLabel={`${line.word}. ${line.detail}`}>
    <View style={[styles.dot, { backgroundColor: color }]} />
    <Text style={[fieldFonts.monoMedium, styles.word, { color: line.tone === "ok" ? theme.colors.text : color }]} testID="safety-line-word">{line.word}</Text>
    <Text style={[fieldFonts.mono, styles.detail, { color: theme.colors.textMuted }]} numberOfLines={1}>· {line.detail}</Text>
  </View>;
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 20, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  dot: { width: 7, height: 7, borderRadius: 4 },
  word: { fontSize: 12 },
  detail: { fontSize: readableFont(11), flexShrink: 1 },
});
