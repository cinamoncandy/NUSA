import React, { useMemo } from "react";
import { Canvas, Group, LinearGradient, Path, Skia, vec } from "@shopify/react-native-skia";
import type { PrimaryDestination } from "./navigationContract";
import { TAB_ICON_ACTIVE, TAB_ICON_PATHS } from "./tabIconsModel";

/** Draws one island-style tab icon (paths in tabIconsModel.ts). Presentation only. */
export function TabIcon({ destination, active, muted, size = 24 }: { readonly destination: PrimaryDestination; readonly active: boolean; readonly muted: string; readonly size?: number }) {
  const paths = useMemo(() => TAB_ICON_PATHS[destination].map(([d, opacity]) => ({ path: Skia.Path.MakeFromSVGString(d), opacity })), [destination]);
  const k = size / 24;
  return <Canvas style={{ width: size, height: size }} pointerEvents="none">
    <Group transform={[{ scale: k }]}>
      {paths.map(({ path, opacity }, i) => path == null ? null : <Path key={i} path={path} style="stroke" strokeWidth={1.6} strokeCap="round" strokeJoin="round" opacity={opacity} color={active ? undefined : muted}>
        {active ? <LinearGradient start={vec(3, 3)} end={vec(21, 21)} colors={[...TAB_ICON_ACTIVE]} /> : null}
      </Path>)}
    </Group>
  </Canvas>;
}
