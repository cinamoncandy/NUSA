import React, { useEffect, useMemo, useState } from "react";
import { AccessibilityInfo, StyleSheet, Text, View, type LayoutChangeEvent } from "react-native";
import { BlendMode, Canvas, PaintStyle, Picture, PointMode, Skia, StrokeCap, createPicture, type SkPicture, type SkPoint } from "@shopify/react-native-skia";
import { calmColors } from "./uiKitModel";
import { readableFont } from "./designSystem";
import type { LearningFunnelModel } from "./learningFunnelModel";
import { FUNNEL_GATE_Y, FUNNEL_SIEVE_Y, createFunnelField, funnelCounts, funnelHalfWidth, funnelParticlePoint, stepFunnelField, warmFunnelField, type FunnelGeometry, type FunnelTone } from "./learningFunnelParticles";

// 학습 hero (redesign 2026-10-19, step 5): one particle per tested strategy falls through a funnel. Only the discovery passers get
// through the first sieve and only the holdout passers through the last gate, so with 0 passers nothing ever crosses it. The counts
// are the server's integers (scaled down for drawing); presentation only. Motion stops entirely when the OS reduce-motion setting
// is on: one still frame is drawn instead.
const SCENE_HEIGHT = 300;
const FRAME_MS = 42;
const LEVELS = [0.3, 0.6, 0.9] as const;

export function LearningFunnel({ model }: { readonly model: LearningFunnelModel }) {
  const [reducedMotion, setReducedMotion] = useState(true);
  const [width, setWidth] = useState(0);
  const [picture, setPicture] = useState<SkPicture | null>(null);
  const [tested, discovery, holdout] = model.stages.map((s) => s.value) as [number, number, number];

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then((v) => { if (mounted) setReducedMotion(v); }).catch(() => { if (mounted) setReducedMotion(false); });
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", setReducedMotion);
    return () => { mounted = false; sub.remove(); };
  }, []);

  const paints = useMemo(() => {
    const dot = Skia.Paint(); dot.setAntiAlias(true); dot.setStyle(PaintStyle.Stroke); dot.setStrokeCap(StrokeCap.Round); dot.setBlendMode(BlendMode.Plus);
    const hair = Skia.Paint(); hair.setAntiAlias(true); hair.setStyle(PaintStyle.Stroke); hair.setStrokeWidth(1);
    const fill = Skia.Paint(); fill.setAntiAlias(true);
    return { dot, hair, fill, flow: Skia.Color(calmColors.text), rejected: Skia.Color(calmColors.muted), gate: Skia.Color(calmColors.attention) };
  }, []);

  useEffect(() => {
    if (width <= 0) return undefined;
    const g: FunnelGeometry = { width, height: SCENE_HEIGHT };
    const field = createFunnelField(funnelCounts(tested, discovery, holdout), 11);
    const y1 = FUNNEL_SIEVE_Y * SCENE_HEIGHT, y2 = FUNNEL_GATE_Y * SCENE_HEIGHT, cx = width / 2;
    const outline = Skia.Path.Make();
    outline.moveTo(cx - funnelHalfWidth(0, g), 0); outline.lineTo(cx - funnelHalfWidth(SCENE_HEIGHT, g), SCENE_HEIGHT);
    outline.moveTo(cx + funnelHalfWidth(0, g), 0); outline.lineTo(cx + funnelHalfWidth(SCENE_HEIGHT, g), SCENE_HEIGHT);
    const pool: SkPoint[] = Array.from({ length: field.count }, () => ({ x: 0, y: 0 }));
    const tones: FunnelTone[] = ["FLOW", "REJECTED", "GATE"];
    const colorOf = { FLOW: paints.flow, REJECTED: paints.rejected, GATE: paints.gate };

    const render = () => {
      setPicture(createPicture((canvas) => {
        paints.hair.setColor(paints.rejected); paints.hair.setAlphaf(0.35);
        canvas.drawPath(outline, paints.hair);
        paints.hair.setColor(paints.flow); paints.hair.setAlphaf(0.5);
        canvas.drawLine(cx - funnelHalfWidth(y1, g), y1, cx + funnelHalfWidth(y1, g), y1, paints.hair);
        paints.fill.setColor(paints.gate); paints.fill.setAlphaf(0.14);
        canvas.drawRect({ x: cx - funnelHalfWidth(y2, g), y: y2 - 18, width: funnelHalfWidth(y2, g) * 2, height: 18 }, paints.fill);
        paints.fill.setAlphaf(0.95);
        canvas.drawRect({ x: cx - funnelHalfWidth(y2, g), y: y2, width: funnelHalfWidth(y2, g) * 2, height: 2 }, paints.fill);

        const groups: Record<FunnelTone, SkPoint[][]> = { FLOW: [[], [], []], REJECTED: [[], [], []], GATE: [[], [], []] };
        for (let i = 0; i < field.count; i += 1) {
          const p = funnelParticlePoint(field, i, g);
          if (p.alpha <= 0.02) continue;
          const point = pool[i]!; point.x = p.x; point.y = p.y;
          groups[p.tone][Math.min(2, Math.floor(p.alpha * 3.2))]!.push(point);
        }
        paints.dot.setStrokeWidth(2.8);
        for (const tone of tones) {
          paints.dot.setColor(colorOf[tone]);
          groups[tone].forEach((pts, level) => { if (pts.length > 0) { paints.dot.setAlphaf(LEVELS[level]!); canvas.drawPoints(PointMode.Points, pts, paints.dot); } });
        }
      }, { width, height: SCENE_HEIGHT }));
    };

    if (reducedMotion) { warmFunnelField(field, 6); render(); return undefined; }
    let alive = true, last = 0, frame = 0;
    const loop = (t: number) => {
      if (!alive) return;
      if (t - last >= FRAME_MS) {
        const dt = last === 0 ? FRAME_MS / 1000 : (t - last) / 1000;
        last = t;
        stepFunnelField(field, dt);
        render();
      }
      frame = requestAnimationFrame(loop);
    };
    warmFunnelField(field, 4);
    frame = requestAnimationFrame(loop);
    return () => { alive = false; cancelAnimationFrame(frame); };
  }, [width, reducedMotion, paints, tested, discovery, holdout]);

  const tiers = [{ top: 0.02 }, { top: FUNNEL_SIEVE_Y - 0.07 }, { top: FUNNEL_GATE_Y - 0.09 }];
  return <View style={styles.wrap} testID="learning-funnel" accessible accessibilityRole="summary"
    accessibilityLabel={model.stages.map((s) => `${s.label} ${s.value}`).join(", ")}
    onLayout={(e: LayoutChangeEvent) => setWidth(Math.round(e.nativeEvent.layout.width))}>
    <View style={styles.stage} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" testID="learning-funnel-scene">
      {width > 0 ? <Canvas style={{ width, height: SCENE_HEIGHT }}>{picture ? <Picture picture={picture} /> : null}</Canvas> : null}
      {model.stages.map((stage, i) => {
        const attention = stage.tone === "ATTENTION";
        return <View key={stage.label} style={[styles.tier, { top: tiers[i]!.top * SCENE_HEIGHT }]}>
          <Text style={[styles.value, attention ? styles.attention : null]}>{stage.value.toLocaleString("en-US")}</Text>
          <Text style={[styles.label, attention ? styles.attention : null]} numberOfLines={1}>{stage.label}</Text>
        </View>;
      })}
    </View>
  </View>;
}

const styles = StyleSheet.create({
  wrap: { marginHorizontal: 20, marginTop: 14, marginBottom: 8 },
  stage: { height: SCENE_HEIGHT, overflow: "hidden" },
  tier: { position: "absolute", right: 0, flexDirection: "row", alignItems: "baseline", gap: 8 },
  value: { color: calmColors.text, fontSize: readableFont(30), fontWeight: "700", textShadowColor: calmColors.ground, textShadowRadius: 10 },
  label: { color: calmColors.muted, fontSize: readableFont(12), textShadowColor: calmColors.ground, textShadowRadius: 8 },
  attention: { color: calmColors.attention },
});
