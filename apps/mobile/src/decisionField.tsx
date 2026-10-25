import React, { useEffect, useState } from "react";
import { StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { BlurMask, Canvas, LinearGradient, RoundedRect, vec } from "@shopify/react-native-skia";
import { auraPalette, readableFont } from "./designSystem";
import { GrainCard, useEntrance } from "./auraKit";
import { buildDecisionBand } from "./decisionFieldModel";

const SWEEP_PERIOD_MS = 4800;
const SWEEP_TICK_MS = 66;
const BAND_HEIGHT = 44;

/** Phase 0..1 of the live glow. It only runs while `active` (live data, motion allowed) and stops at once otherwise. */
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
 * Today's decisions as one smooth glowing band (aura style, no dots). The brighter part at the left is the real share that became
 * orders. While the data is live and reduce-motion is off, a soft light glides across; otherwise the band is still. Display only.
 */
export function DecisionField({ decisionCount, orderCount, live, reducedMotion }: {
  readonly decisionCount: number | null;
  readonly orderCount: number | null;
  readonly live: boolean;
  readonly reducedMotion: boolean | null;
}) {
  const { width } = useWindowDimensions();
  const model = buildDecisionBand({ decisionCount, orderCount });
  const w = Math.max(120, Math.floor(width - 32 - 36));
  const fill = useEntrance(1000, 350);
  const sweep = useSweep(live && reducedMotion === false && model.known);
  const glowing = live && reducedMotion === false && model.known;
  const orderWidth = Math.round(w * model.orderShare * fill);
  const glowX = -60 + sweep * (w + 120);
  return <GrainCard tone="DARK" style={styles.card} testID="now-decision-field" accessibilityLabel={model.caption}>
    <View style={styles.chip}><Text style={styles.chipText}>{live ? "판단 · 오늘 · LIVE" : "판단 · 오늘"}</Text></View>
    <Canvas style={{ width: w, height: BAND_HEIGHT }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <RoundedRect x={0} y={0} width={w} height={BAND_HEIGHT} r={BAND_HEIGHT / 2} color={auraPalette.unlit} />
      {model.known ? <RoundedRect x={0} y={0} width={Math.round(w * fill)} height={BAND_HEIGHT} r={BAND_HEIGHT / 2}>
        <LinearGradient start={vec(0, 0)} end={vec(w, 0)} colors={[auraPalette.deep, auraPalette.mid, auraPalette.bright]} />
      </RoundedRect> : null}
      {orderWidth >= BAND_HEIGHT ? <RoundedRect x={0} y={0} width={orderWidth} height={BAND_HEIGHT} r={BAND_HEIGHT / 2} color={auraPalette.neon}>
        <BlurMask blur={8} style="solid" />
      </RoundedRect> : null}
      {orderWidth >= BAND_HEIGHT ? <RoundedRect x={0} y={0} width={orderWidth} height={BAND_HEIGHT} r={BAND_HEIGHT / 2} color={auraPalette.neon} /> : null}
      {glowing ? <RoundedRect x={glowX} y={4} width={60} height={BAND_HEIGHT - 8} r={(BAND_HEIGHT - 8) / 2} color={auraPalette.text} opacity={0.35}>
        <BlurMask blur={14} style="normal" />
      </RoundedRect> : null}
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
