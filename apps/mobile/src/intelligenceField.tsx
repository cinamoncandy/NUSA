import React, { memo, useEffect, useMemo, useRef, useState } from "react";
import { fieldFonts } from "./fieldFonts";
import { AccessibilityInfo, Animated, Easing, StyleSheet, Text, View, type LayoutChangeEvent } from "react-native";
import { buildHomeFieldFacts, buildIntelligenceField, fieldPose, type FieldSubsystem, type FieldTone, type IntelligenceFieldInput } from "./intelligenceFieldModel";
import { fieldMotion, fieldPalette } from "./designSystem";

/**
 * NUSA Intelligence Field: one central core inside a nebula of five subsystem arms.
 * Presentation only -- it renders buildIntelligenceField() and moves only when that state changes.
 */
const SUBSYSTEMS: readonly { readonly id: FieldSubsystem; readonly label: string; readonly color: string; readonly angle: number }[] = [
  { id: "market", label: "MARKET", color: fieldPalette.market, angle: -2.35 },
  { id: "axiom", label: "AXIOM", color: fieldPalette.axiom, angle: -0.75 },
  { id: "paper", label: "PAPER", color: fieldPalette.paper, angle: 0.25 },
  { id: "governance", label: "GOVERNANCE", color: fieldPalette.governance, angle: 1.45 },
  { id: "risk", label: "RISK", color: fieldPalette.risk, angle: 2.6 },
];
const FOCUS_COLOR = fieldPalette.accent;
const TONE_COLOR: Record<FieldTone, string> = { dim: fieldPalette.dim, amber: fieldPalette.focus, blue: fieldPalette.market, green: fieldPalette.paper, red: fieldPalette.halt };
const FIELD_HEIGHT = 340;
const DOTS_PER_ARM = 84;
const ARM_TWIST = 0.55;

interface Dot { readonly x: number; readonly y: number; readonly size: number; readonly opacity: number }

function seeded(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

/**
 * Deterministic nebula geometry: each subsystem is a spiral arm of particles around the core.
 * Circular (not squashed) so the whole field can turn and collapse around the core as one body.
 */
export function buildFieldGeometry(width: number, height: number, density = 1): Readonly<Record<FieldSubsystem, readonly Dot[]>> {
  const cx = width / 2;
  const cy = height / 2;
  const radius = Math.min(width, height) * 0.4;
  const count = Math.max(12, Math.round(DOTS_PER_ARM * density));
  const out = {} as Record<FieldSubsystem, Dot[]>;
  SUBSYSTEMS.forEach((subsystem, index) => {
    const random = seeded(97 + index * 131);
    const dots: Dot[] = [];
    for (let i = 0; i < count; i += 1) {
      const t = Math.pow(random(), 0.7);
      const angle = subsystem.angle + (random() - 0.5) * 0.9 * (1 - t * 0.4) + t * ARM_TWIST;
      const r = radius * (0.26 + t * 0.78) + (random() - 0.5) * radius * 0.12;
      const depth = random();
      dots.push({ x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r, size: random() > 0.86 ? 2.2 : 1.2, opacity: 0.28 + depth * 0.6 });
    }
    out[subsystem.id] = dots;
  });
  return out;
}

/** Sampled spine of each arm (core -> rim) that travelling signals follow. */
export function buildStrandPaths(width: number, height: number, samples = 12): Readonly<Record<FieldSubsystem, { readonly xs: readonly number[]; readonly ys: readonly number[] }>> {
  const cx = width / 2;
  const cy = height / 2;
  const radius = Math.min(width, height) * 0.4;
  const out = {} as Record<FieldSubsystem, { xs: number[]; ys: number[] }>;
  for (const subsystem of SUBSYSTEMS) {
    const xs: number[] = [];
    const ys: number[] = [];
    for (let i = 0; i < samples; i += 1) {
      const t = i / (samples - 1);
      const angle = subsystem.angle + t * ARM_TWIST;
      const r = radius * (0.12 + t * 0.9);
      xs.push(cx + Math.cos(angle) * r);
      ys.push(cy + Math.sin(angle) * r);
    }
    out[subsystem.id] = { xs, ys };
  }
  return out;
}

/** A bright head with a short trail riding one strand; `progress` 0..1 maps along the path. */
export function Signal({ path, progress, color, inward }: Readonly<{ path: { readonly xs: readonly number[]; readonly ys: readonly number[] }; progress: Animated.Value; color: string; inward: boolean }>) {
  const n = path.xs.length;
  const inputRange = path.xs.map((_, i) => i / (n - 1));
  const xs = inward ? [...path.xs].reverse() : [...path.xs];
  const ys = inward ? [...path.ys].reverse() : [...path.ys];
  const opacity = progress.interpolate({ inputRange: [0, 0.08, 0.85, 1], outputRange: [0, 1, 1, 0] });
  return <>{[0, 0.045, 0.09].map((lag, i) => {
    const shifted = progress.interpolate({ inputRange: [0, 1], outputRange: [-lag, 1 - lag], extrapolate: "clamp" });
    const translateX = shifted.interpolate({ inputRange, outputRange: xs, extrapolate: "clamp" });
    const translateY = shifted.interpolate({ inputRange, outputRange: ys, extrapolate: "clamp" });
    const size = i === 0 ? 5 : i === 1 ? 3.5 : 2.5;
    return <Animated.View key={i} pointerEvents="none" style={{ position: "absolute", left: -size / 2, top: -size / 2, width: size, height: size, borderRadius: size / 2, backgroundColor: color, opacity: Animated.multiply(opacity, i === 0 ? 1 : i === 1 ? 0.55 : 0.3), transform: [{ translateX }, { translateY }] }} />;
  })}</>;
}

/** Particles only re-render when geometry or colour changes, not on every live ticker update. */
const ParticleLayer = memo(function ParticleLayer({ dots, color }: Readonly<{ dots: readonly Dot[]; color: string }>) {
  return <>{dots.map((dot, i) => <View key={i} style={{ position: "absolute", left: dot.x - dot.size / 2, top: dot.y - dot.size / 2, width: dot.size, height: dot.size, borderRadius: dot.size / 2, backgroundColor: color, opacity: dot.opacity }} />)}</>;
});

export function IntelligenceField({ input }: Readonly<{ input: IntelligenceFieldInput }>) {
  const model = buildIntelligenceField(input);
  const [width, setWidth] = useState(0);
  const [reducedMotion, setReducedMotion] = useState<boolean | null>(null);
  const geometry = useMemo(() => (width > 0 ? buildFieldGeometry(width, FIELD_HEIGHT) : null), [width]);
  const levels = useRef(Object.fromEntries(SUBSYSTEMS.map((s) => [s.id, new Animated.Value(0.12)])) as Record<FieldSubsystem, Animated.Value>).current;
  const core = useRef(new Animated.Value(model.coreLevel)).current;
  const pulse = useRef(new Animated.Value(0)).current;
  const signals = useRef(Object.fromEntries(SUBSYSTEMS.map((s) => [s.id, new Animated.Value(0)])) as Record<FieldSubsystem, Animated.Value>).current;
  const flare = useRef(new Animated.Value(0)).current;
  const turn = useRef(new Animated.Value(0)).current;
  const pose = fieldPose(model.phase);
  const spread = useRef(new Animated.Value(pose.spread)).current;
  const presence = useRef(new Animated.Value(pose.presence)).current;
  const orbit = useRef(new Animated.Value(0)).current;
  const orbitStep = useRef(0);
  const paths = useMemo(() => (width > 0 ? buildStrandPaths(width, FIELD_HEIGHT) : null), [width]);
  const previousKey = useRef<string | null>(null);
  const [inward, setInward] = useState(false);

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then((enabled) => { if (mounted) setReducedMotion(enabled); }).catch(() => { if (mounted) setReducedMotion(false); });
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
    const key = `${model.phase}:${model.focus ?? ""}:${litKey}:${model.tone}`;
    const changed = previousKey.current != null && previousKey.current !== key;
    previousKey.current = key;
    // Mount, an unresolved preference, or reduced motion: settle without animating.
    if (reducedMotion !== false || !changed) {
      targets.forEach(({ value, target }) => value.setValue(target));
      core.setValue(model.coreLevel);
      spread.setValue(pose.spread);
      presence.setValue(pose.presence);
      pulse.setValue(0);
      flare.setValue(0);
      SUBSYSTEMS.forEach((sub) => signals[sub.id].setValue(0));
      return undefined;
    }
    // Problems travel inward (subsystem -> core); recovery and progress propagate outward.
    setInward(model.tone === "amber" || model.tone === "red");
    pulse.setValue(0);
    flare.setValue(0);
    SUBSYSTEMS.forEach((sub) => signals[sub.id].setValue(0));
    const travelling = SUBSYSTEMS.filter((sub) => model.lit.includes(sub.id));
    // The nebula turns one step per semantic change and settles into the new phase's pose.
    orbitStep.current += 1;
    const animation = Animated.parallel([
      Animated.timing(orbit, { toValue: orbitStep.current, duration: fieldMotion.poseMs, easing: Easing.inOut(Easing.cubic), useNativeDriver: true }),
      Animated.timing(spread, { toValue: pose.spread, duration: fieldMotion.poseMs, easing: Easing.inOut(Easing.cubic), useNativeDriver: true }),
      Animated.timing(presence, { toValue: pose.presence, duration: fieldMotion.poseMs, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      ...targets.map(({ value, target }, i) => Animated.timing(value, { toValue: target, duration: fieldMotion.settleMs, delay: i * fieldMotion.settleStaggerMs, easing: Easing.out(Easing.cubic), useNativeDriver: true })),
      Animated.timing(core, { toValue: model.coreLevel, duration: fieldMotion.settleMs, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(turn, { toValue: 1, duration: fieldMotion.coreTurnMs, easing: Easing.inOut(Easing.cubic), useNativeDriver: true }),
      Animated.stagger(fieldMotion.signalStaggerMs, travelling.map((sub) => Animated.timing(signals[sub.id], { toValue: 1, duration: fieldMotion.signalMs, easing: Easing.inOut(Easing.quad), useNativeDriver: true }))),
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: fieldMotion.pulseInMs, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: fieldMotion.pulseOutMs, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      ]),
      Animated.sequence([
        Animated.delay(fieldMotion.flareDelayMs),
        Animated.timing(flare, { toValue: 1, duration: fieldMotion.flareMs, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      ]),
    ]);
    turn.setValue(0);
    animation.start();
    return () => animation.stop();
  }, [model.phase, model.focus, litKey, model.coreLevel, model.tone, reducedMotion, core, levels, pulse, signals, flare, turn, spread, presence, orbit, pose.spread, pose.presence]);

  const toneColor = TONE_COLOR[model.tone];
  const coreScale = core.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] });
  const ringScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1.9] });
  const coreRotate = turn.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "90deg"] });
  const flareScale = flare.interpolate({ inputRange: [0, 1], outputRange: [0.4, 2.2] });
  const flareOpacity = flare.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0, 0.9, 0] });
  const onLayout = (event: LayoutChangeEvent) => setWidth(Math.round(event.nativeEvent.layout.width));
  const cx = width / 2;
  const cy = FIELD_HEIGHT / 2;
  const orbitRotate = orbit.interpolate({ inputRange: [0, 1], outputRange: ["0deg", `${fieldMotion.orbitStepDeg}deg`] });

  return <View style={styles.shell} testID="home-intelligence-field" accessibilityRole="summary" accessibilityLabel={`${model.statusWord}. ${model.headline.replace("\n", " ")}. ${model.detail}`}>
    <View style={styles.statusRow}>
      <View style={[styles.statusDot, { backgroundColor: toneColor }]} />
      <Text style={[styles.statusWord, { color: toneColor }]} testID="intelligence-field-status">{model.statusWord}</Text>
      <Text style={styles.phase}>{model.phase}</Text>
    </View>
    <View style={styles.field} onLayout={onLayout}>
      {width > 0 ? <>
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity: presence, transform: [{ rotate: orbitRotate }, { scale: spread }] }]}>
          {geometry == null ? null : SUBSYSTEMS.map((s) => <Animated.View key={s.id} style={[StyleSheet.absoluteFill, { opacity: levels[s.id] }]}>
            <ParticleLayer dots={geometry[s.id]} color={model.focus === s.id ? FOCUS_COLOR : model.phase === "HALTED" ? TONE_COLOR.red : s.color} />
          </Animated.View>)}
          {paths == null ? null : SUBSYSTEMS.filter((sub) => model.lit.includes(sub.id)).map((sub) => <Signal key={sub.id} path={paths[sub.id]} progress={signals[sub.id]} color={model.focus === sub.id ? FOCUS_COLOR : inward ? toneColor : sub.color} inward={inward} />)}
          {model.focus == null || paths == null ? null : <Animated.View style={[styles.flare, { left: paths[model.focus].xs[paths[model.focus].xs.length - 1] - 16, top: paths[model.focus].ys[paths[model.focus].ys.length - 1] - 16, borderColor: FOCUS_COLOR, opacity: flareOpacity, transform: [{ scale: flareScale }] }]} />}
        </Animated.View>
        <Animated.View pointerEvents="none" style={[styles.pulseRing, { left: cx - 40, top: cy - 40, borderColor: toneColor, opacity: pulse, transform: [{ scale: ringScale }] }]} />
        <Animated.View pointerEvents="none" style={[styles.coreWrap, { left: cx - 36, top: cy - 36, opacity: core, transform: [{ scale: coreScale }] }]}>
          <View style={[styles.coreGlow, { backgroundColor: toneColor }]} />
          <Animated.View style={[styles.coreDiamond, { borderColor: toneColor, transform: [{ rotate: "45deg" }, { rotate: coreRotate }] }]} />
          <View style={styles.coreHeart} />
        </Animated.View>
      </> : null}
    </View>
    <View style={styles.legend}>
      {SUBSYSTEMS.map((s) => {
        const focused = model.focus === s.id;
        const state = model.states[s.id];
        return <View key={s.id} style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: focused ? FOCUS_COLOR : s.color, opacity: model.lit.includes(s.id) ? 1 : 0.3 }]} />
          <Text style={[styles.hubName, { color: focused ? FOCUS_COLOR : fieldPalette.muted }]}>{s.label}</Text>
          {state == null ? null : <Text style={[styles.hubState, { color: focused ? FOCUS_COLOR : fieldPalette.label }]}>{state}</Text>}
        </View>;
      })}
    </View>
    <Text style={styles.headline} testID="intelligence-field-headline">{model.headline}</Text>
    <Text style={styles.detail}>{model.detail}</Text>
    <View style={styles.facts} testID="intelligence-field-facts">
      {buildHomeFieldFacts(input).map((fact) => <View key={fact.label} style={styles.fact}><Text style={styles.factLabel}>{fact.label}</Text><Text style={styles.factValue} numberOfLines={1}>{fact.value}</Text></View>)}
    </View>
  </View>;
}

const styles = StyleSheet.create({
  shell: { backgroundColor: fieldPalette.void, paddingHorizontal: 20, paddingTop: 14, paddingBottom: 22, marginHorizontal: -20 },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusWord: { fontSize: 11, letterSpacing: 2, ...fieldFonts.monoMedium },
  phase: { marginLeft: "auto", fontSize: 10, letterSpacing: 2, color: fieldPalette.dim, ...fieldFonts.mono },
  field: { height: FIELD_HEIGHT, overflow: "hidden" },
  flare: { position: "absolute", width: 32, height: 32, borderRadius: 16, borderWidth: 1 },
  pulseRing: { position: "absolute", width: 80, height: 80, borderRadius: 40, borderWidth: 1 },
  coreWrap: { position: "absolute", width: 72, height: 72, alignItems: "center", justifyContent: "center" },
  coreGlow: { position: "absolute", width: 72, height: 72, borderRadius: 36, opacity: 0.16 },
  coreDiamond: { width: 30, height: 30, borderWidth: 1.2, backgroundColor: "rgba(255,255,255,0.06)" },
  coreHeart: { position: "absolute", width: 6, height: 6, borderRadius: 3, backgroundColor: fieldPalette.heart },
  legend: { flexDirection: "row", flexWrap: "wrap", columnGap: 14, rowGap: 6, marginBottom: 16 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  legendDot: { width: 5, height: 5, borderRadius: 2.5 },
  hubName: { fontSize: 9, letterSpacing: 1.4, ...fieldFonts.mono },
  hubState: { fontSize: 9, letterSpacing: 1, ...fieldFonts.monoMedium },
  headline: { color: fieldPalette.text, fontSize: 26, lineHeight: 34, letterSpacing: -0.3, ...fieldFonts.displayLight },
  detail: { color: fieldPalette.muted, fontSize: 13, lineHeight: 20, marginTop: 6 },
  facts: { flexDirection: "row", marginTop: 16, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: fieldPalette.dim, paddingTop: 10 },
  fact: { flex: 1, gap: 2 },
  factLabel: { color: fieldPalette.dim, fontSize: 9, letterSpacing: 1.6, ...fieldFonts.mono },
  factValue: { color: fieldPalette.label, fontSize: 13, fontVariant: ["tabular-nums"], ...fieldFonts.mono },
});
