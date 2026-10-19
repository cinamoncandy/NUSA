import React, { useEffect, useMemo, useState } from "react";
import { AccessibilityInfo, StyleSheet, Text, View, type LayoutChangeEvent } from "react-native";
import { BlendMode, Canvas, PaintStyle, Picture, PointMode, Skia, StrokeCap, createPicture, type SkPicture, type SkPoint } from "@shopify/react-native-skia";
import { calmColors } from "./uiKitModel";
import { readableFont } from "./designSystem";
import type { RiskGateModel } from "./riskGateModel";
import { GATE_STREAMLINES, createGateField, gateParticlePoint, gateStreamline, gateY, settledLight, stepGateField, warmGateField, type GateGeometry } from "./riskGateParticles";

// Now-screen hero while the consecutive-loss limit holds new buys (redesign 2026-10-19, step 4): a few thousand decision particles
// stream toward the risk gate, narrow, and pile up in front of it; the channel after the gate stays dotted and empty because no order
// went out. Presentation only (riskGateParticles.ts draws no server value). Motion stops entirely when the OS reduce-motion setting is
// on: one settled still frame is drawn instead.
const SCENE_HEIGHT = 250;
const PARTICLES = 1100;
const FRAME_MS = 33;
const ALPHA_LEVELS = [0.2, 0.4, 0.65, 0.9] as const;

export function RiskGateFlow({ gate, windowNote = null }: { readonly gate: RiskGateModel; /** Shown when the buy counters started after a mid-day server restart (partialWindowNote). */ readonly windowNote?: string | null }) {
  const [reducedMotion, setReducedMotion] = useState(true);
  const [width, setWidth] = useState(0);
  const [picture, setPicture] = useState<SkPicture | null>(null);

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
    return { dot, hair, fill, flow: Skia.Color(calmColors.text), gate: Skia.Color(calmColors.attention), line: Skia.Color(calmColors.muted), clear: Skia.Color("transparent") };
  }, []);

  useEffect(() => {
    if (width <= 0) return undefined;
    const g: GateGeometry = { width, height: SCENE_HEIGHT };
    const field = createGateField(PARTICLES, 7, width);
    const gy = gateY(g), cx = width / 2;
    const scale = width / 390;

    const render = () => {
      setPicture(createPicture((canvas) => {
        paints.hair.setColor(paints.flow); paints.hair.setAlphaf(0.07);
        const streams = Skia.Path.Make();
        for (let i = 0; i < GATE_STREAMLINES; i += 1) gateStreamline(i, g).forEach((p, k) => { if (k === 0) streams.moveTo(p.x, p.y); else streams.lineTo(p.x, p.y); });
        canvas.drawPath(streams, paints.hair);

        const flowing: SkPoint[][] = ALPHA_LEVELS.map(() => []);
        for (let i = 0; i < field.count; i += 1) {
          const p = gateParticlePoint(field, i, g);
          const a = field.alpha[i]! * Math.min(1, p.u * 6) * (1 - 0.2 * p.u);
          flowing[Math.min(ALPHA_LEVELS.length - 1, Math.floor(a * 4.99))]!.push({ x: p.x, y: p.y });
        }
        const settled: SkPoint[][] = [[], [], []];
        for (let s = 0; s < field.settledX.length; s += 1) {
          const light = settledLight(field, s);
          if (light > 0.02) settled[Math.min(2, Math.floor(light * 2.99))]!.push({ x: field.settledX[s]!, y: field.settledY[s]! });
        }
        paints.dot.setColor(paints.flow);
        paints.dot.setStrokeWidth(1.6 * scale + 0.4);
        flowing.forEach((pts, level) => { if (pts.length > 0) { paints.dot.setAlphaf(ALPHA_LEVELS[level]!); canvas.drawPoints(PointMode.Points, pts, paints.dot); } });
        paints.dot.setStrokeWidth(2.2);
        settled.forEach((pts, level) => { if (pts.length > 0) { paints.dot.setAlphaf([0.25, 0.55, 0.9][level]!); canvas.drawPoints(PointMode.Points, pts, paints.dot); } });

        // The gate: a hairline that fades to both sides, with a soft glow above it that brightens as particles arrive.
        paints.fill.setShader(Skia.Shader.MakeLinearGradient({ x: 0, y: 0 }, { x: width, y: 0 }, [paints.clear, paints.gate, paints.clear], [0, 0.5, 1], 0));
        paints.fill.setAlphaf(0.85 + field.glow * 0.15);
        canvas.drawRect({ x: 0, y: gy, width, height: 2 }, paints.fill);
        paints.fill.setShader(null);
        paints.fill.setColor(paints.gate); paints.fill.setAlphaf(0.07 + field.glow * 0.25);
        canvas.drawRect({ x: width * 0.12, y: gy - 26, width: width * 0.76, height: 26 }, paints.fill);

        // After the gate: nothing went out, so the channel stays a dotted, empty line.
        paints.hair.setColor(paints.gate); paints.hair.setAlphaf(0.5);
        for (let y = gy + 10; y < SCENE_HEIGHT - 4; y += 7) canvas.drawLine(cx, y, cx, y + 2, paints.hair);
      }, { width, height: SCENE_HEIGHT }));
    };

    if (reducedMotion) { warmGateField(field, 12, g); render(); return undefined; }
    let alive = true, last = 0, frame = 0;
    const loop = (t: number) => {
      if (!alive) return;
      if (t - last >= FRAME_MS) {
        const dt = last === 0 ? FRAME_MS / 1000 : (t - last) / 1000;
        last = t;
        stepGateField(field, dt, g);
        render();
      }
      frame = requestAnimationFrame(loop);
    };
    warmGateField(field, 6, g);
    frame = requestAnimationFrame(loop);
    return () => { alive = false; cancelAnimationFrame(frame); };
  }, [width, reducedMotion, paints]);

  const waiting = gate.waiting == null || gate.waiting === 0 ? null : gate.waiting.toLocaleString("en-US");
  return <View style={styles.card} testID="now-risk-gate" accessibilityRole="summary" accessibilityLabel={`${gate.headline.replace("\n", ". ")}. ${gate.detail}`}>
    <Text style={styles.caption}>신호 → 위험 → 주문</Text>
    <View style={styles.stage} onLayout={(e: LayoutChangeEvent) => setWidth(Math.round(e.nativeEvent.layout.width))} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" pointerEvents="none" testID="now-risk-gate-scene">
      {width > 0 ? <Canvas style={{ width, height: SCENE_HEIGHT }}>{picture ? <Picture picture={picture} /> : null}</Canvas> : null}
    </View>
    <View style={styles.labels}>
      <Text style={styles.label}>{gate.signals == null ? "매수 신호" : `매수 신호 ${gate.signals.toLocaleString("en-US")}`}</Text>
      <Text style={[styles.label, styles.gateLabel]}>{waiting == null ? "위험 — 멈춤" : `${waiting} 대기`}</Text>
      <Text style={[styles.label, styles.muted]}>주문 0</Text>
    </View>
    <Text style={styles.detail}>{gate.detail}</Text>
    {windowNote ? <Text style={styles.detail} testID="now-risk-gate-window">{windowNote}</Text> : null}
  </View>;
}

const styles = StyleSheet.create({
  card: { marginHorizontal: 20, marginTop: 16, padding: 16, borderRadius: 22, backgroundColor: calmColors.ground, borderWidth: StyleSheet.hairlineWidth, borderColor: calmColors.line },
  caption: { color: calmColors.muted, fontSize: readableFont(11), letterSpacing: 1, marginBottom: 8 },
  stage: { height: SCENE_HEIGHT, marginHorizontal: -8, overflow: "hidden" },
  labels: { flexDirection: "row", justifyContent: "space-between", marginTop: 6 },
  label: { color: calmColors.text, fontSize: readableFont(12) },
  gateLabel: { color: calmColors.attention, fontWeight: "600" },
  muted: { color: calmColors.muted },
  detail: { color: calmColors.muted, fontSize: readableFont(12), marginTop: 6 },
});
