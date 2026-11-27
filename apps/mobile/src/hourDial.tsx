import React, { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Canvas, Circle } from "@shopify/react-native-skia";
import type { DecisionTerrainModel } from "./decisionTerrainModel";
import { buildHourDial, hourDialRowAt } from "./hourDialModel";
import { LatticeSphere } from "./latticeSphere";
import { calmColors } from "./uiKitModel";
import { latticePalette, wavePalette, readableFont } from "./designSystem";
import { fieldFonts } from "./fieldFonts";

/**
 * Today's hours as a ring of light around a still lattice sphere (UI v8; replaces the ridgeline). Brighter = more real decisions in
 * that hour; pink dot = a PAPER order; amber = after the loss-limit stop; a hollow socket = no usable count. Tapping a node picks the
 * hour when `onSelectRow` is given. Presentation only; it reads no data of its own.
 */
export function HourDial({ model, size, live, reducedMotion, selectedRow = null, onSelectRow, testID = "hour-dial" }: {
  readonly model: DecisionTerrainModel;
  readonly size: number;
  readonly live: boolean;
  readonly reducedMotion: boolean | null;
  readonly selectedRow?: number | null;
  readonly onSelectRow?: (row: number) => void;
  readonly testID?: string;
}) {
  const nodes = useMemo(() => buildHourDial(model, size, selectedRow), [model, size, selectedRow]);
  const sphere = Math.round(size * 0.5);
  const touch = onSelectRow == null ? undefined : (e: { nativeEvent: { locationX: number; locationY: number } }) => {
    const row = hourDialRowAt(nodes, size, e.nativeEvent.locationX, e.nativeEvent.locationY);
    if (row != null) onSelectRow(row);
  };
  return <View style={{ width: size, height: size, alignSelf: "center" }} testID={testID} onTouchEnd={touch}>
    <View style={[styles.center, { left: (size - sphere) / 2, top: (size - sphere) / 2, width: sphere, height: sphere }]} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <LatticeSphere decisionCount={null} orderCount={null} live={live} still width={sphere} reducedMotion={reducedMotion} testID={`${testID}-sphere`} />
    </View>
    <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
      <Circle cx={size / 2} cy={size / 2} r={size * 0.40} style="stroke" strokeWidth={0.6} color={wavePalette.idle} opacity={0.35} />
      {nodes.map((n) => {
        const color = n.limit ? calmColors.attention : latticePalette.ice;
        return <React.Fragment key={n.row}>
          {n.level == null
            ? <Circle cx={n.x} cy={n.y} r={3} style="stroke" strokeWidth={1} color={wavePalette.idle} opacity={0.6} />
            : <Circle cx={n.x} cy={n.y} r={2.5 + 4.5 * n.level} color={color} opacity={live ? 0.35 + 0.65 * n.level : 0.3} />}
          {n.order ? <Circle cx={n.x} cy={n.y} r={2} color={wavePalette.pink} /> : null}
          {n.selected || (n.current && selectedRow == null) ? <Circle cx={n.x} cy={n.y} r={11} style="stroke" strokeWidth={1.2} color={latticePalette.white} opacity={0.8} /> : null}
        </React.Fragment>;
      })}
    </Canvas>
    {[0, 6, 12, 18].map((h) => {
      const a = (h / 24) * 2 * Math.PI, r = size * 0.5 - 8;
      return <Text key={h} pointerEvents="none" style={[fieldFonts.mono, styles.tick, { left: size / 2 + r * Math.sin(a) - 10, top: size / 2 - r * Math.cos(a) - 7 }]}>{String(h).padStart(2, "0")}</Text>;
    })}
  </View>;
}

const styles = StyleSheet.create({
  center: { position: "absolute" },
  tick: { position: "absolute", width: 20, textAlign: "center", color: calmColors.muted, fontSize: readableFont(9) },
});
