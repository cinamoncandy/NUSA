import React, { useMemo, useState } from "react";
import { StyleSheet, Text, View, type LayoutChangeEvent } from "react-native";
import { Canvas, Circle, Path, Skia } from "@shopify/react-native-skia";
import { useTheme } from "./ThemeProvider";
import { fieldFonts } from "./fieldFonts";
import type { EquityPoint } from "./performanceModel";

const HEIGHT = 110;

/** PAPER equity over the last 7 days from server events; hidden until there are two points. */
export function EquityChart({ points }: Readonly<{ points: readonly EquityPoint[] }>) {
  const { theme } = useTheme();
  const [width, setWidth] = useState(0);
  const path = useMemo(() => {
    if (width === 0 || points.length < 2) return null;
    const min = Math.min(...points.map((p) => p.equity)), max = Math.max(...points.map((p) => p.equity));
    const span = max - min || 1, t0 = points[0].at, t1 = points[points.length - 1].at, tspan = t1 - t0 || 1;
    const x = (at: number) => 6 + ((at - t0) / tspan) * (width - 12);
    const y = (eq: number) => HEIGHT - 12 - ((eq - min) / span) * (HEIGHT - 24);
    const line = Skia.Path.Make();
    points.forEach((p, i) => (i === 0 ? line.moveTo(x(p.at), y(p.equity)) : line.lineTo(x(p.at), y(p.equity))));
    const last = points[points.length - 1];
    return { line, endX: x(last.at), endY: y(last.equity) };
  }, [points, width]);
  if (points.length < 2) return null;
  const up = points[points.length - 1].equity >= points[0].equity;
  const color = up ? theme.colors.success : theme.colors.danger;
  return <View style={styles.wrap} testID="paper-equity-chart" accessibilityLabel={`최근 7일 PAPER 자산 ${up ? "상승" : "하락"}`}>
    <Text style={[fieldFonts.mono, styles.caption, { color: theme.colors.textMuted }]}>최근 7일 자산</Text>
    <View style={{ height: HEIGHT }} onLayout={(event: LayoutChangeEvent) => setWidth(Math.round(event.nativeEvent.layout.width))}>
      {path ? <Canvas style={{ width, height: HEIGHT }}>
        <Path path={path.line} style="stroke" strokeWidth={1.8} color={color} />
        <Circle cx={path.endX} cy={path.endY} r={3.5} color={color} />
      </Canvas> : null}
    </View>
  </View>;
}

const styles = StyleSheet.create({ wrap: { gap: 6, marginTop: 4 }, caption: { fontSize: 11 } });
