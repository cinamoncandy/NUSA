import React, { useMemo } from "react";
import { Canvas, Group, LinearGradient, Path, Skia, vec } from "@shopify/react-native-skia";
import { ISLAND_MARK_GRADIENT, islandMarkStrokes } from "./islandMarkModel";

/** Draws the island mark (islandMarkModel.ts) at `size` px; `opacity` dims it for card decoration. Presentation only. */
export function IslandMark({ size = 22, opacity = 1, contours = 3 }: { readonly size?: number; readonly opacity?: number; readonly contours?: number }) {
  const strokes = useMemo(() => islandMarkStrokes(contours).map((s) => ({ ...s, path: Skia.Path.MakeFromSVGString(s.d) })), [contours]);
  return <Canvas style={{ width: size, height: size }} pointerEvents="none">
    <Group transform={[{ scale: size / 24 }]} opacity={opacity}>
      {strokes.map((s, i) => s.path == null ? null : <Path key={i} path={s.path} style="stroke" strokeWidth={s.width} strokeCap="round" strokeJoin="round" opacity={s.opacity}>
        <LinearGradient start={vec(2, 0)} end={vec(22, 0)} colors={[...ISLAND_MARK_GRADIENT]} />
      </Path>)}
    </Group>
  </Canvas>;
}
