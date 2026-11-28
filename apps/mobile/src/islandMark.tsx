import React from "react";
import { View } from "react-native";
import { LatticeSphere } from "./latticeSphere";

/**
 * The NUSA mark. Since UI v8 (owner 2026-11-27: the sphere replaced the island and the ridge) it is a tiny still lattice sphere at
 * `size` px; `opacity` dims it for card decoration. The island stroke model (islandMarkModel.ts) is kept for the launcher icon only.
 * Presentation only: never turns, lights nothing, hidden from screen readers.
 */
export function IslandMark({ size = 22, opacity = 1 }: { readonly size?: number; readonly opacity?: number; readonly contours?: number }) {
  return <View style={{ width: size, height: size, opacity }} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
    <LatticeSphere decisionCount={null} orderCount={null} live still width={size} reducedMotion testID="nusa-mark" />
  </View>;
}
