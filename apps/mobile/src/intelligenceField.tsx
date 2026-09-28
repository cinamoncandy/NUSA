import React, { useEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing, StyleSheet, Text, View, type LayoutChangeEvent } from "react-native";
import { buildIntelligenceField, type FieldSubsystem, type FieldTone, type IntelligenceFieldInput } from "./intelligenceFieldModel";

/**
 * NUSA Intelligence Field: one central core, five subsystem hubs connected by fiber strands.
 * Presentation only -- it renders buildIntelligenceField() and moves only when that state changes.
 */
const SUBSYSTEMS: readonly { readonly id: FieldSubsystem; readonly label: string; readonly color: string; readonly angle: number }[] = [
  { id: "market", label: "MARKET", color: "#4FC3F7", angle: -2.35 },
  { id: "axiom", label: "AXIOM", color: "#9B7BFF", angle: -0.75 },
  { id: "paper", label: "PAPER", color: "#3DDC97", angle: 0.25 },
  { id: "governance", label: "GOVERNANCE", color: "#7C8CFF", angle: 1.45 },
  { id: "risk", label: "RISK", color: "#FFA94D", angle: 2.6 },
];
const FOCUS_COLOR = "#FFB547";
const TONE_COLOR: Record<FieldTone, string> = { dim: "#5B6670", amber: "#FFB547", blue: "#4FC3F7", green: "#3DDC97", red: "#FF5C5C" };
const FIELD_HEIGHT = 340;
const DOTS_PER_STRAND = 46;
const DOTS_PER_HUB = 22;

interface Dot { readonly x: number; readonly y: number; readonly size: number; readonly opacity: number }

function seeded(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

/** Deterministic fiber geometry: quadratic strands from core to hub plus a small hub cluster. */
export function buildFieldGeometry(width: number, height: number): Readonly<Record<FieldSubsystem, readonly Dot[]>> {
  const cx = width / 2;
  const cy = height / 2;
  const ring = Math.min(width, height) * 0.38;
  const out = {} as Record<FieldSubsystem, Dot[]>;
  SUBSYSTEMS.forEach((subsystem, index) => {
    const random = seeded(97 + index * 131);
    const hx = cx + Math.cos(subsystem.angle) * ring;
    const hy = cy + Math.sin(subsystem.angle) * ring * 0.82;
    const bend = subsystem.angle + 0.55;
    const qx = cx + Math.cos(bend) * ring * 0.55;
    const qy = cy + Math.sin(bend) * ring * 0.45;
    const dots: Dot[] = [];
    for (let i = 0; i < DOTS_PER_STRAND; i += 1) {
      const t = 0.12 + (i / DOTS_PER_STRAND) * 0.88;
      const u = 1 - t;
      const jitter = (random() - 0.5) * 7 * t;
      dots.push({
        x: u * u * cx + 2 * u * t * qx + t * t * hx + jitter,
        y: u * u * cy + 2 * u * t * qy + t * t * hy + (random() - 0.5) * 7 * t,
        size: random() > 0.85 ? 2.4 : 1.4,
        opacity: 0.25 + random() * 0.55,
      });
    }
    for (let i = 0; i < DOTS_PER_HUB; i += 1) {
      const a = random() * Math.PI * 2;
      const r = Math.sqrt(random()) * 14;
      dots.push({ x: hx + Math.cos(a) * r, y: hy + Math.sin(a) * r, size: random() > 0.7 ? 2.6 : 1.6, opacity: 0.4 + random() * 0.6 });
    }
    out[subsystem.id] = dots;
  });
  return out;
}

export function IntelligenceField({ input }: Readonly<{ input: IntelligenceFieldInput }>) {
  const model = buildIntelligenceField(input);
  const [width, setWidth] = useState(0);
  const [reducedMotion, setReducedMotion] = useState(false);
  const geometry = useMemo(() => (width > 0 ? buildFieldGeometry(width, FIELD_HEIGHT) : null), [width]);
  const levels = useRef(Object.fromEntries(SUBSYSTEMS.map((s) => [s.id, new Animated.Value(0.12)])) as Record<FieldSubsystem, Animated.Value>).current;
  const core = useRef(new Animated.Value(model.coreLevel)).current;
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then((enabled) => { if (mounted) setReducedMotion(enabled); }).catch(() => undefined);
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setReducedMotion);
    return () => { mounted = false; subscription.remove(); };
  }, []);

  const litKey = model.lit.join(",");
  useEffect(() => {
    const targets = SUBSYSTEMS.map((s) => {
      const lit = model.lit.includes(s.id);
      const target = model.focus == null ? (lit ? 1 : 0.14) : s.id === model.focus ? 1 : lit ? 0.32 : 0.1;
      return { value: levels[s.id], target };
    });
    if (reducedMotion) {
      targets.forEach(({ value, target }) => value.setValue(target));
      core.setValue(model.coreLevel);
      pulse.setValue(0);
      return undefined;
    }
    // Motion only on a state change: settle each group, then one core pulse. No idle loop.
    pulse.setValue(0);
    const animation = Animated.parallel([
      ...targets.map(({ value, target }, i) => Animated.timing(value, { toValue: target, duration: 900, delay: i * 90, easing: Easing.out(Easing.cubic), useNativeDriver: true })),
      Animated.timing(core, { toValue: model.coreLevel, duration: 900, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 260, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 900, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      ]),
    ]);
    animation.start();
    return () => animation.stop();
  }, [model.phase, model.focus, litKey, model.coreLevel, reducedMotion, core, levels, pulse]);

  const toneColor = TONE_COLOR[model.tone];
  const coreScale = core.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] });
  const ringScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1.9] });
  const onLayout = (event: LayoutChangeEvent) => setWidth(Math.round(event.nativeEvent.layout.width));
  const cx = width / 2;
  const cy = FIELD_HEIGHT / 2;
  const ring = Math.min(width, FIELD_HEIGHT) * 0.38;

  return <View style={styles.shell} testID="home-intelligence-field" accessibilityRole="summary" accessibilityLabel={`${model.statusWord}. ${model.headline.replace("\n", " ")}. ${model.detail}`}>
    <View style={styles.statusRow}>
      <View style={[styles.statusDot, { backgroundColor: toneColor }]} />
      <Text style={[styles.statusWord, { color: toneColor }]} testID="intelligence-field-status">{model.statusWord}</Text>
      <Text style={styles.phase}>{model.phase}</Text>
    </View>
    <View style={styles.field} onLayout={onLayout}>
      {geometry == null ? null : SUBSYSTEMS.map((s) => {
        const focused = model.focus === s.id;
        const color = focused ? FOCUS_COLOR : s.color;
        return <Animated.View key={s.id} pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity: levels[s.id] }]}>
          {geometry[s.id].map((dot, i) => <View key={i} style={{ position: "absolute", left: dot.x - dot.size / 2, top: dot.y - dot.size / 2, width: dot.size, height: dot.size, borderRadius: dot.size / 2, backgroundColor: color, opacity: dot.opacity }} />)}
        </Animated.View>;
      })}
      {width > 0 ? <>
        <Animated.View pointerEvents="none" style={[styles.pulseRing, { left: cx - 40, top: cy - 40, borderColor: toneColor, opacity: pulse, transform: [{ scale: ringScale }] }]} />
        <Animated.View pointerEvents="none" style={[styles.coreWrap, { left: cx - 36, top: cy - 36, opacity: core, transform: [{ scale: coreScale }] }]}>
          <View style={[styles.coreGlow, { backgroundColor: toneColor }]} />
          <View style={[styles.coreDiamond, { borderColor: toneColor }]} />
          <View style={styles.coreHeart} />
        </Animated.View>
        {SUBSYSTEMS.map((s) => {
          const hx = cx + Math.cos(s.angle) * ring;
          const hy = cy + Math.sin(s.angle) * ring * 0.82;
          const focused = model.focus === s.id;
          const state = model.states[s.id];
          return <View key={s.id} pointerEvents="none" style={[styles.hubLabel, { left: Math.max(4, Math.min(width - 104, hx - 50)), top: hy + 16 }]}>
            <Text style={[styles.hubName, { color: focused ? FOCUS_COLOR : "#8A96A0" }]}>{s.label}</Text>
            {state == null ? null : <Text style={[styles.hubState, { color: focused ? FOCUS_COLOR : "#C9D2D8" }]}>{state}</Text>}
          </View>;
        })}
      </> : null}
    </View>
    <Text style={styles.headline} testID="intelligence-field-headline">{model.headline}</Text>
    <Text style={styles.detail}>{model.detail}</Text>
  </View>;
}

const styles = StyleSheet.create({
  shell: { backgroundColor: "#010204", paddingHorizontal: 20, paddingTop: 14, paddingBottom: 22, marginHorizontal: -20 },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusWord: { fontSize: 11, letterSpacing: 2, fontWeight: "600" },
  phase: { marginLeft: "auto", fontSize: 10, letterSpacing: 2, color: "#5B6670" },
  field: { height: FIELD_HEIGHT, overflow: "hidden" },
  pulseRing: { position: "absolute", width: 80, height: 80, borderRadius: 40, borderWidth: 1 },
  coreWrap: { position: "absolute", width: 72, height: 72, alignItems: "center", justifyContent: "center" },
  coreGlow: { position: "absolute", width: 72, height: 72, borderRadius: 36, opacity: 0.16 },
  coreDiamond: { width: 30, height: 30, borderWidth: 1.2, transform: [{ rotate: "45deg" }], backgroundColor: "rgba(255,255,255,0.06)" },
  coreHeart: { position: "absolute", width: 6, height: 6, borderRadius: 3, backgroundColor: "#F4F8FA" },
  hubLabel: { position: "absolute", width: 100, alignItems: "center" },
  hubName: { fontSize: 9, letterSpacing: 1.6 },
  hubState: { fontSize: 10, letterSpacing: 1, marginTop: 2, fontWeight: "600" },
  headline: { color: "#EEF3F6", fontSize: 26, lineHeight: 34, fontWeight: "300", letterSpacing: -0.3 },
  detail: { color: "#8A96A0", fontSize: 13, lineHeight: 20, marginTop: 6 },
});
