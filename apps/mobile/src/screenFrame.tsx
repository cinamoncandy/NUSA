import React from "react";
import { ScrollView, StyleSheet, Text, View, type ScrollViewProps } from "react-native";
import { useTheme } from "./ThemeProvider";
import { visualSystem } from "./visualSystem";
import { MotionReveal } from "./components";
import { AiShell } from "./aiKit";
import { plainScreenChip } from "./stageTraceModel";
import { InstrumentHero, useReducedMotion } from "./instrumentKit";
import { LatticeSphere } from "./latticeSphere";

export function ScreenFrame({ children, testID, refreshControl }: Readonly<{
  children: React.ReactNode;
  testID: string;
  refreshControl?: ScrollViewProps["refreshControl"];
}>) {
  const { theme } = useTheme();
  const ui = visualSystem(theme);
  return <AiShell chip={plainScreenChip("MORE")}><ScrollView
    style={{ backgroundColor: "transparent" }}
    contentContainerStyle={[styles.screen, { paddingHorizontal: ui.space.screenX, gap: ui.space.section }]}
    refreshControl={refreshControl}
    testID={testID}
  >{React.Children.toArray(children).map((child, index) => <MotionReveal key={React.isValidElement(child) && child.key != null ? child.key : index} index={index}>{child}</MotionReveal>)}</ScrollView></AiShell>;
}

/** Detail-screen head in the 기록 design language: a small index line, one big title and a still lattice sphere in the corner. The sphere never turns and lights nothing (a detail screen has no health signal of its own). */
const CORNER_SIZE = 104;
/** The sphere starts 118 px from the right edge: the title keeps clear of it (20 px gutter + 98). */
const CORNER_RESERVE = 98;
export function ScreenTitle({ title, detail }: Readonly<{ title: string; detail?: string }>) {
  const reduced = useReducedMotion();
  const ui = visualSystem(useTheme().theme);
  return <View style={[styles.titleBlock, { marginHorizontal: -ui.space.screenX }]} testID="screen-title-block">
    <InstrumentHero index={detail ?? "NUSA"} lines={[{ text: title }]} label={title} reserve={CORNER_RESERVE} />
    <View style={styles.corner} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" testID="screen-title-sphere"><LatticeSphere decisionCount={null} orderCount={null} live={false} still width={CORNER_SIZE} reducedMotion={reduced} testID="screen-title-sphere-graphic" /></View>
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
  titleBlock: { minHeight: 120 },
  corner: { position: "absolute", right: 14, top: 8, width: CORNER_SIZE, height: CORNER_SIZE },
  surface: { borderWidth: 1 },
});
