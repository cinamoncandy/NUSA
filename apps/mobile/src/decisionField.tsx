import React, { useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { BlurMask, Canvas, Points } from "@shopify/react-native-skia";
import { auraPalette, readableFont } from "./designSystem";
import { GrainCard, useEntrance } from "./auraKit";
import { litIndices } from "./dotMatrix";
import { revealedCount } from "./auraMotion";
import { FIELD_COLUMNS, FIELD_ROWS, buildDecisionField, sweepColumns } from "./decisionFieldModel";

const SWEEP_PERIOD_MS = 5200;
const SWEEP_TICK_MS = 80;

type Pt = { x: number; y: number };
const nonEmpty = (points: readonly Pt[]): boolean => points.length > 0;

/** Phase 0..1 of the live sweep. It only runs while `active` (live data, motion allowed) and stops at once otherwise. */
function useSweep(active: boolean): number {
  const [phase, setPhase] = useState(0);
  useEffect(() => {
    if (!active) { setPhase(0); return undefined; }
    const started = Date.now();
    const timer = setInterval(() => setPhase(((Date.now() - started) % SWEEP_PERIOD_MS) / SWEEP_PERIOD_MS), SWEEP_TICK_MS);
    return () => clearInterval(timer);
  }, [active]);
  return phase;
}

/**
 * Today's decisions as a dot field (aura style). Lit dots = the real count at the stated scale; bright white dots = real orders.
 * While the data is live and reduce-motion is off, a soft highlight sweeps across; otherwise the field is still. Display only.
 */
export function DecisionField({ decisionCount, orderCount, live, reducedMotion }: {
  readonly decisionCount: number | null;
  readonly orderCount: number | null;
  readonly live: boolean;
  readonly reducedMotion: boolean | null;
}) {
  const { width } = useWindowDimensions();
  const model = useMemo(() => buildDecisionField({ decisionCount, orderCount }), [decisionCount, orderCount]);
  const inner = Math.max(120, width - 32 - 36);
  const pitch = Math.floor((inner / FIELD_COLUMNS) * 2) / 2;
  const fieldWidth = pitch * FIELD_COLUMNS;
  const fieldHeight = pitch * FIELD_ROWS;
  const fill = useEntrance(1100, 350);
  const sweep = useSweep(live && reducedMotion === false && model.known);
  const geometry = useMemo(() => {
    const lit = new Set(litIndices(FIELD_COLUMNS * FIELD_ROWS, model.litDots));
    const litOrdered = Array.from(lit).sort((a, b) => a - b);
    const orders = new Set(litIndices(litOrdered.length, model.orderDots).map((k) => litOrdered[k]));
    const dim: Pt[] = [];
    const on: Pt[] = [];
    const order: Pt[] = [];
    for (let i = 0; i < FIELD_COLUMNS * FIELD_ROWS; i += 1) {
      const col = i % FIELD_COLUMNS;
      const point = { x: (col + 0.5) * pitch, y: (Math.floor(i / FIELD_COLUMNS) + 0.5) * pitch, col } as Pt & { col: number };
      (orders.has(i) ? order : lit.has(i) ? on : dim).push(point);
    }
    return { dim, on, order };
  }, [model.litDots, model.orderDots, pitch]);
  const shownOn = fill >= 1 ? geometry.on : geometry.on.slice(0, revealedCount(geometry.on.length, fill));
  const shownOrder = fill >= 1 ? geometry.order : geometry.order.slice(0, revealedCount(geometry.order.length, fill));
  const waiting = fill >= 1 ? geometry.dim : geometry.dim.concat(geometry.on.slice(shownOn.length), geometry.order.slice(shownOrder.length));
  const columns = sweepColumns(sweep, FIELD_COLUMNS);
  const swept = live && reducedMotion === false ? shownOn.filter((p) => columns.includes((p as Pt & { col: number }).col)) : [];
  const r = Math.max(1, pitch * 0.2);
  return <GrainCard tone="DARK" style={styles.card} testID="now-decision-field" accessibilityLabel={model.caption}>
    <View style={styles.chip}><Text style={styles.chipText}>{live ? "판단 · 오늘 · LIVE" : "판단 · 오늘"}</Text></View>
    <Canvas style={{ width: fieldWidth, height: fieldHeight }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {nonEmpty(waiting) ? <Points points={waiting} mode="points" color={auraPalette.unlit} style="stroke" strokeWidth={r * 2} strokeCap="round" /> : null}
      {nonEmpty(shownOn) ? <Points points={shownOn} mode="points" color={auraPalette.bright} style="stroke" strokeWidth={r * 2.6} strokeCap="round" /> : null}
      {nonEmpty(swept) ? <Points points={swept} mode="points" color={auraPalette.neon} style="stroke" strokeWidth={r * 4.4} strokeCap="round"><BlurMask blur={r * 2} style="normal" /></Points> : null}
      {nonEmpty(shownOrder) ? <Points points={shownOrder} mode="points" color={auraPalette.neon} style="stroke" strokeWidth={r * 5} strokeCap="round"><BlurMask blur={r * 2.4} style="normal" /></Points> : null}
      {nonEmpty(shownOrder) ? <Points points={shownOrder} mode="points" color={auraPalette.text} style="stroke" strokeWidth={r * 2.8} strokeCap="round" /> : null}
    </Canvas>
    <Text style={styles.caption}>{model.caption}</Text>
  </GrainCard>;
}

const styles = StyleSheet.create({
  card: { marginHorizontal: 16, marginTop: 14, gap: 12, padding: 18 },
  chip: { alignSelf: "flex-start", backgroundColor: auraPalette.scrim, borderRadius: 999, paddingHorizontal: 11, paddingVertical: 5 },
  chipText: { color: auraPalette.text, fontSize: readableFont(12), fontWeight: "600" },
  caption: { color: auraPalette.muted, fontSize: readableFont(12), lineHeight: 18 },
});
