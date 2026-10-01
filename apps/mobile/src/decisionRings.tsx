import React, { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing, StyleSheet, Text, View } from "react-native";
import { useTheme } from "./ThemeProvider";
import { fieldFonts } from "./fieldFonts";
import { buildDecisionRings, type DecisionRingsInput } from "./decisionRingsModel";

const SIZE = 260;
const RADIUS = SIZE / 2 - 10;

// Home hero: every reported PAPER decision as a dot on a spiral. Motion is ambient and
// slow (one rotation per few minutes, one radar sweep, one ripple at the newest dot) and
// stops entirely when the OS reduce-motion setting is on.
export interface DecisionRingsStatus {
  readonly title: string;
  readonly detail: string;
  readonly tone: "warning" | "halt";
}

export function DecisionRings({ status = null, ...props }: DecisionRingsInput & { readonly status?: DecisionRingsStatus | null }) {
  const { theme } = useTheme();
  const model = buildDecisionRings(props);
  const [reducedMotion, setReducedMotion] = useState(true);
  const spin = useRef(new Animated.Value(0)).current;
  const sweep = useRef(new Animated.Value(0)).current;
  const ripple = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then((v) => { if (mounted) setReducedMotion(v); }).catch(() => { if (mounted) setReducedMotion(false); });
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", setReducedMotion);
    return () => { mounted = false; sub.remove(); };
  }, []);

  useEffect(() => {
    if (reducedMotion || model.dots.length === 0) return undefined;
    const loops = [
      Animated.loop(Animated.timing(spin, { toValue: 1, duration: 240000, easing: Easing.linear, useNativeDriver: true })),
      Animated.loop(Animated.timing(sweep, { toValue: 1, duration: 7000, easing: Easing.linear, useNativeDriver: true })),
      Animated.loop(Animated.sequence([
        Animated.timing(ripple, { toValue: 1, duration: 1400, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.delay(1800),
        Animated.timing(ripple, { toValue: 0, duration: 0, useNativeDriver: true }),
      ])),
    ];
    loops.forEach((loop) => loop.start());
    return () => loops.forEach((loop) => loop.stop());
  }, [reducedMotion, model.dots.length, spin, sweep, ripple]);

  const waitColor = theme.colors.warning;
  const orderColor = theme.colors.primary;
  const dotColor = model.state === "ORDERING" ? orderColor : waitColor;
  const newest = model.dots[model.dots.length - 1];
  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });
  const armRotate = sweep.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });

  return <View style={styles.wrap} testID="home-decision-rings" accessibilityLabel={`${model.headline}. ${model.detail}`}>
    {status ? <View style={[styles.status, { borderColor: status.tone === "halt" ? theme.colors.danger : theme.colors.warning }]} testID="home-decision-rings-status" accessibilityRole="alert">
      <Text style={[styles.statusTitle, { color: status.tone === "halt" ? theme.colors.danger : theme.colors.warning }]}>{status.title}</Text>
      <Text style={[styles.detail, { color: theme.colors.textMuted }]}>{status.detail}</Text>
    </View> : null}
    <Text style={[fieldFonts.monoMedium, styles.count, { color: theme.colors.text }]} testID="home-decision-rings-count">{model.headline}</Text>
    <Text style={[styles.detail, { color: theme.colors.textMuted }]}>{model.detail}</Text>
    <View style={styles.stage}>
      {[0.25, 0.5, 0.75, 1].map((k) => <View key={k} style={[styles.guide, { width: RADIUS * 2 * k, height: RADIUS * 2 * k, borderRadius: RADIUS * k, borderColor: theme.colors.border }]} />)}
      <Animated.View style={[styles.layer, { transform: [{ rotate }] }]}>
        {model.dots.map((dot, i) => {
          const size = 1.6 + dot.recency * 2.2;
          return <View key={i} style={{ position: "absolute", left: SIZE / 2 + dot.x * RADIUS - size / 2, top: SIZE / 2 + dot.y * RADIUS - size / 2, width: size, height: size, borderRadius: size / 2, backgroundColor: dotColor, opacity: 0.22 + dot.recency * 0.7 }} />;
        })}
        {newest && !reducedMotion ? <Animated.View pointerEvents="none" style={{ position: "absolute", left: SIZE / 2 + newest.x * RADIUS - 12, top: SIZE / 2 + newest.y * RADIUS - 12, width: 24, height: 24, borderRadius: 12, borderWidth: 1.5, borderColor: dotColor, opacity: ripple.interpolate({ inputRange: [0, 1], outputRange: [0.9, 0] }), transform: [{ scale: ripple.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1.8] }) }] }} /> : null}
      </Animated.View>
      {model.dots.length > 0 && !reducedMotion ? <Animated.View pointerEvents="none" style={[styles.layer, { transform: [{ rotate: armRotate }] }]}>
        <View style={[styles.arm, { backgroundColor: theme.colors.info }]} />
      </Animated.View> : null}
      <View style={[styles.core, { backgroundColor: theme.colors.background, borderColor: theme.colors.border }]}>
        <Text style={[fieldFonts.mono, styles.coreLabel, { color: theme.colors.textMuted }]}>첫 판단</Text>
      </View>
    </View>
    <View style={styles.legend}>
      <Text style={[fieldFonts.mono, styles.legendText, { color: waitColor }]}>● 대기 판단</Text>
      <Text style={[fieldFonts.mono, styles.legendText, { color: orderColor }]} testID="home-decision-rings-orders">● PAPER 주문 {model.paperOrderCount == null ? "—" : model.paperOrderCount.toLocaleString("ko-KR")}건</Text>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", paddingVertical: 8, gap: 6 },
  status: { alignSelf: "stretch", borderWidth: 1, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 14, gap: 4, marginBottom: 6 },
  statusTitle: { fontSize: 15, fontWeight: "600" },
  count: { fontSize: 34, fontWeight: "600", letterSpacing: -0.8 },
  detail: { fontSize: 13, textAlign: "center", maxWidth: 300, lineHeight: 19 },
  stage: { width: SIZE, height: SIZE, alignItems: "center", justifyContent: "center", marginTop: 6 },
  guide: { position: "absolute", borderWidth: StyleSheet.hairlineWidth, opacity: 0.5 },
  layer: { position: "absolute", left: 0, top: 0, width: SIZE, height: SIZE },
  arm: { position: "absolute", left: SIZE / 2, top: SIZE / 2 - 0.5, width: RADIUS + 6, height: 1, opacity: 0.55 },
  core: { width: 46, height: 46, borderRadius: 23, borderWidth: StyleSheet.hairlineWidth, alignItems: "center", justifyContent: "center" },
  coreLabel: { fontSize: 9 },
  legend: { flexDirection: "row", gap: 16 },
  legendText: { fontSize: 10.5 },
});
