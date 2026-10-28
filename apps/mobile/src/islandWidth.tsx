import React, { useState } from "react";
import { View } from "react-native";

/** Measures the available width once laid out and renders the island at that width (nothing until measured). Presentation only. */
export function IslandWidth({ children }: { readonly children: (width: number) => React.ReactNode }) {
  const [width, setWidth] = useState(0);
  return <View onLayout={(e) => setWidth(Math.max(0, Math.round(e.nativeEvent.layout.width)))} style={{ width: "100%", alignItems: "center" }}>
    {width > 0 ? children(width) : null}
  </View>;
}
