import React, { useEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing, StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from "react-native";
import { Canvas, Path, Skia } from "@shopify/react-native-skia";
import { calmColors } from "./uiKitModel";
import { fieldFonts } from "./fieldFonts";
import { readableFont } from "./designSystem";

/**
 * Instrument kit (redesign 2026-10-20, owner-chosen "계기판" direction): hairline panels with corner ticks, mono section labels,
 * a rolling odometer and a scrolling heartbeat trace. Presentation only. Every loop runs on the native driver and stops entirely
 * when the OS reduce-motion setting is on.
 */
/** null until the OS answers: nothing loops and no entrance plays before then, so a reduce-motion user never sees motion. */
export function useReducedMotion(): boolean | null {
  const [reduced, setReduced] = useState<boolean | null>(null);
  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then((v) => { if (mounted) setReduced(v); }).catch(() => { if (mounted) setReduced(false); });
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduced);
    return () => { mounted = false; sub.remove(); };
  }, []);
  return reduced;
}

export function SectionLabel({ left, right = null }: { readonly left: string; readonly right?: string | null }) {
  return <View style={styles.label}>
    <Text style={[fieldFonts.mono, styles.labelLeft]}>{left}</Text>
    {right == null ? null : <Text style={[fieldFonts.mono, styles.labelRight]}>{right}</Text>}
  </View>;
}

export function Panel({ children, style, scan = false }: { readonly children: React.ReactNode; readonly style?: StyleProp<ViewStyle>; /** One bright scan line sweeps across the panel on entry (not under reduce-motion). */ readonly scan?: boolean }) {
  const reduced = useReducedMotion();
  const [panelWidth, setPanelWidth] = useState(0);
  const sweep = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!scan || reduced !== false || panelWidth <= 0) return undefined;
    sweep.setValue(0);
    const anim = Animated.timing(sweep, { toValue: 1, duration: 700, delay: 250, easing: Easing.inOut(Easing.cubic), useNativeDriver: true });
    anim.start();
    return () => anim.stop();
  }, [scan, reduced, panelWidth, sweep]);
  const k = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduced === null) return undefined;
    if (reduced) { k.setValue(1); return undefined; }
    const anim = Animated.spring(k, { toValue: 1, speed: 24, bounciness: 14, delay: 120, useNativeDriver: true });
    anim.start();
    return () => anim.stop();
  }, [reduced, k]);
  const grow = { opacity: k, transform: [{ scale: k.interpolate({ inputRange: [0, 1], outputRange: [3, 1] }) }] };
  return <View style={[styles.panel, style]} onLayout={scan ? (e) => setPanelWidth(Math.round(e.nativeEvent.layout.width)) : undefined}>
    {children}
    {scan && reduced === false && panelWidth > 0 ? <Animated.View pointerEvents="none" style={[styles.scan, { opacity: sweep.interpolate({ inputRange: [0, 0.1, 0.9, 1], outputRange: [0, 1, 1, 0] }), transform: [{ translateX: sweep.interpolate({ inputRange: [0, 1], outputRange: [0, panelWidth] }) }] }]} /> : null}
    <Animated.View pointerEvents="none" style={[styles.tick, styles.tickTopLeft, grow]} />
    <Animated.View pointerEvents="none" style={[styles.tick, styles.tickBottomRight, grow]} />
  </View>;
}

const DECODE_GLYPHS = "▮▯░▒▓01/\\<>+=";
/** Decodes a statement left to right in about 0.6 s: unresolved characters flicker through mono glyphs, then lock. Settled text under reduce-motion. */
function useDecoded(text: string, reduced: boolean | null): string {
  const [shown, setShown] = useState(text);
  useEffect(() => {
    if (reduced !== false) { setShown(text); return undefined; }
    const total = text.length;
    const started = Date.now();
    const tick = () => {
      const locked = Math.min(total, Math.floor(((Date.now() - started) / 600) * total));
      setShown(text.split("").map((ch, i) => (i < locked || /\s/.test(ch) ? ch : DECODE_GLYPHS[Math.floor(Math.random() * DECODE_GLYPHS.length)])).join(""));
      if (locked >= total) clearInterval(timer);
    };
    const timer = setInterval(tick, 40);
    tick();
    return () => clearInterval(timer);
  }, [text, reduced]);
  return shown;
}

function HeroLine({ text, style, reduced }: { readonly text: string; readonly style: StyleProp<TextStyle>; readonly reduced: boolean | null }) {
  const shown = useDecoded(text, reduced);
  // The real text reserves the layout (no rewrap while glyphs flicker); the decoded copy is drawn over it and stays hidden until the OS answers.
  return <View>
    <Text style={[style, { opacity: 0 }]}>{text}</Text>
    <Text style={[style, StyleSheet.absoluteFill, reduced === null ? { opacity: 0 } : null]}>{shown}</Text>
  </View>;
}

/** Each digit is a 0-9 column that rolls to its value, ones place first. A changed value rolls again. */
export function Odometer({ value, size, color = calmColors.text, reducedMotion }: { readonly value: number; readonly size: number; readonly color?: string; readonly reducedMotion: boolean | null }) {
  const chars = value.toLocaleString("en-US").split("");
  return <View style={styles.odo} accessible accessibilityLabel={value.toLocaleString("en-US")}>
    {chars.map((ch, i) => /\d/.test(ch)
      ? <OdometerDigit key={`${value}-${i}`} digit={Number(ch)} size={size} color={color} delay={(chars.length - 1 - i) * 70} reducedMotion={reducedMotion} />
      : <Text key={`${value}-${i}`} style={[fieldFonts.displayStrong, { fontSize: size, lineHeight: size * 1.08, height: size * 1.08, color }]}>{ch}</Text>)}
  </View>;
}

function OdometerDigit({ digit, size, color, delay, reducedMotion }: { readonly digit: number; readonly size: number; readonly color: string; readonly delay: number; readonly reducedMotion: boolean | null }) {
  const h = size * 1.08;
  const y = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reducedMotion === null) return undefined;
    if (reducedMotion) { y.setValue(-digit * h); return undefined; }
    y.setValue(0);
    const anim = Animated.timing(y, { toValue: -digit * h, duration: 800, delay, easing: Easing.out(Easing.exp), useNativeDriver: true });
    anim.start();
    return () => anim.stop();
  }, [digit, h, delay, reducedMotion, y]);
  return <View style={{ height: h, overflow: "hidden" }} importantForAccessibility="no-hide-descendants">
    <Animated.View style={{ transform: [{ translateY: y }] }}>
      {Array.from({ length: 10 }, (_, k) => <Text key={k} style={[fieldFonts.displayStrong, { fontSize: size, lineHeight: h, height: h, color, fontVariant: ["tabular-nums"] }]}>{k}</Text>)}
    </Animated.View>
  </View>;
}

// One heartbeat period in a 200-wide box, 44 tall: flat, a small bump, the spike, a recovery bump, flat.
const BEAT: readonly (readonly [number, number])[] = [[0, 24], [30, 24], [34, 21], [38, 24], [62, 24], [66, 28], [71, 8], [77, 38], [82, 24], [110, 24], [115, 20], [121, 24], [200, 24]];
export const HEARTBEAT_HEIGHT = 44;

/** Builds two heartbeat periods across 2 * width so a translateX of -width loops seamlessly. */
export function heartbeatPath(width: number): string {
  const sx = width / 200;
  const pts = [0, 1].flatMap((k) => BEAT.map(([x, y]) => [(x + k * 200) * sx, y] as const));
  return pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y}`).join(" ");
}

/** A heartbeat trace that scrolls while the runtime is deciding: it says "alive", not a measured signal. */
export function Heartbeat({ width, reducedMotion }: { readonly width: number; readonly reducedMotion: boolean | null }) {
  const x = useRef(new Animated.Value(0)).current;
  const path = useMemo(() => (width > 0 ? Skia.Path.MakeFromSVGString(heartbeatPath(width)) : null), [width]);
  useEffect(() => {
    if (reducedMotion !== false || width <= 0) { x.setValue(0); return undefined; }
    const loop = Animated.loop(Animated.timing(x, { toValue: -width, duration: 1400, easing: Easing.linear, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [reducedMotion, width, x]);
  if (width <= 0 || path == null) return <View style={styles.beat} />;
  return <View style={styles.beat} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
    <Animated.View style={{ width: width * 2, height: HEARTBEAT_HEIGHT, transform: [{ translateX: x }] }}>
      <Canvas style={{ width: width * 2, height: HEARTBEAT_HEIGHT }}><Path path={path} style="stroke" strokeWidth={1.4} color={calmColors.text} /></Canvas>
    </Animated.View>
  </View>;
}

/** Fast entrance: fades up 10 px in 260 ms on the native driver, staggered by `index`. A reduce-motion user gets it settled at once. */
export function Reveal({ index = 0, reducedMotion, children, style }: { readonly index?: number; readonly reducedMotion: boolean | null; readonly children: React.ReactNode; readonly style?: StyleProp<ViewStyle> }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reducedMotion === null) return undefined;
    if (reducedMotion) { v.setValue(1); return undefined; }
    const anim = Animated.timing(v, { toValue: 1, duration: 260, delay: index * 55, easing: Easing.out(Easing.cubic), useNativeDriver: true });
    anim.start();
    return () => anim.stop();
  }, [index, reducedMotion, v]);
  return <Animated.View style={[style, { opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }] }]}>{children}</Animated.View>;
}

export const instrumentType = StyleSheet.create({
  index: { color: calmColors.muted, fontSize: readableFont(11), letterSpacing: 2 },
  heroLine: { color: calmColors.text, fontSize: 54, lineHeight: 58, fontWeight: "700", letterSpacing: -2 },
  sub: { color: calmColors.muted, fontSize: readableFont(14), lineHeight: 21, marginTop: 10, maxWidth: 320 },
});

const styles = StyleSheet.create({
  label: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 },
  labelLeft: { color: calmColors.muted, fontSize: readableFont(11), letterSpacing: 1.2 },
  labelRight: { color: calmColors.text, fontSize: readableFont(11), letterSpacing: 1.2 },
  panel: { borderWidth: StyleSheet.hairlineWidth, borderColor: calmColors.line, padding: 14 },
  scan: { position: "absolute", left: 0, top: 0, bottom: 0, width: 2, backgroundColor: calmColors.text, opacity: 0.9 },
  tick: { position: "absolute", width: 8, height: 8, borderColor: calmColors.text, opacity: 0.7 },
  tickTopLeft: { left: -1, top: -1, borderLeftWidth: 1, borderTopWidth: 1 },
  tickBottomRight: { right: -1, bottom: -1, borderRightWidth: 1, borderBottomWidth: 1 },
  odo: { flexDirection: "row", alignItems: "flex-start" },
  beat: { height: HEARTBEAT_HEIGHT, overflow: "hidden", marginTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: calmColors.line },
});

/** Screen opener of the instrument design: a mono index ("03 / 안전") over a large two-line statement. */
export function InstrumentHero({ index, lines, label }: { readonly index: string; readonly lines: readonly { readonly text: string; readonly amber?: boolean; readonly color?: string }[]; readonly label?: string }) {
  const reduced = useReducedMotion();
  return <View style={heroStyles.wrap}>
    <Text style={[fieldFonts.mono, instrumentType.index]}>{index}</Text>
    <View style={heroStyles.lines} accessible accessibilityRole="header" accessibilityLabel={label ?? lines.map((l) => l.text).join(" ")}>
      {lines.map((l) => <HeroLine key={l.text} text={l.text} reduced={reduced} style={[instrumentType.heroLine, l.amber ? { color: calmColors.attention } : l.color ? { color: l.color } : null]} />)}
    </View>
  </View>;
}

const heroStyles = StyleSheet.create({
  wrap: { paddingHorizontal: 20, paddingTop: 12 },
  lines: { marginTop: 14 },
});
