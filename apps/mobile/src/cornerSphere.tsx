import React from "react";
import { StyleSheet, View } from "react-native";
import { LatticeSphere } from "./latticeSphere";
import { useReducedMotion } from "./instrumentKit";

/** A small still lattice sphere for the top-right corner of a screen head. It never turns, lights nothing (no health signal of its own), ignores touch and is hidden from screen readers. */
export const CORNER_SPHERE_SIZE = 76;
/** Free space a head must keep on the right of its text so the sphere never sits on a letter. */
export const CORNER_SPHERE_RESERVE = CORNER_SPHERE_SIZE + 8;

export function CornerSphere({ testID }: Readonly<{ testID: string }>) {
  const reduced = useReducedMotion();
  return <View style={styles.corner} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" testID={testID}>
    <LatticeSphere decisionCount={null} orderCount={null} live={false} still width={CORNER_SPHERE_SIZE} reducedMotion={reduced} testID={`${testID}-graphic`} />
  </View>;
}

const styles = StyleSheet.create({ corner: { position: "absolute", right: 0, top: 0, width: CORNER_SPHERE_SIZE, height: CORNER_SPHERE_SIZE } });
