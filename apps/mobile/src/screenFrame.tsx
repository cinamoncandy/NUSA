import React from "react";
import { ScrollView, StyleSheet, Text, View, type ScrollViewProps } from "react-native";
import { useTheme } from "./ThemeProvider";
import { visualSystem } from "./visualSystem";

export function ScreenFrame({ children, testID, refreshControl }: Readonly<{
  children: React.ReactNode;
  testID: string;
  refreshControl?: ScrollViewProps["refreshControl"];
}>) {
  const { theme } = useTheme();
  const ui = visualSystem(theme);
  return <ScrollView
    style={{ backgroundColor: ui.color.canvas }}
    contentContainerStyle={[styles.screen, { paddingHorizontal: ui.space.screenX, gap: ui.space.section }]}
    refreshControl={refreshControl}
    testID={testID}
  >{children}</ScrollView>;
}

export function ScreenTitle({ title, detail }: Readonly<{ title: string; detail?: string }>) {
  const { theme } = useTheme();
  const ui = visualSystem(theme);
  return <View style={styles.titleBlock}>
    <Text style={[styles.title, { color: ui.color.text }]}>{title}</Text>
    {detail ? <Text style={[styles.detail, { color: ui.color.textMuted }]}>{detail}</Text> : null}
  </View>;
}

export function Surface({ children, testID }: Readonly<{ children: React.ReactNode; testID?: string }>) {
  const { theme } = useTheme();
  const ui = visualSystem(theme);
  return <View testID={testID} style={[styles.surface, {
    backgroundColor: ui.color.panel,
    borderColor: ui.color.border,
    borderRadius: ui.radius.card,
    padding: ui.space.card,
  }]}>{children}</View>;
}

const styles = StyleSheet.create({
  screen: { paddingTop: 16, paddingBottom: 120 },
  titleBlock: { gap: 3 },
  title: { fontSize: 30, lineHeight: 38, fontWeight: "700", letterSpacing: -0.6 },
  detail: { fontSize: 11, lineHeight: 16 },
  surface: { borderWidth: 1 },
});
