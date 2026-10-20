import React, { useEffect, useRef, useState } from "react";
import { Animated, Easing, Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from "react-native";
import { calmColors } from "./uiKitModel";
import { readableFont } from "./designSystem";
import { fieldFonts } from "./fieldFonts";
import type { RiskGateModel } from "./riskGateModel";
import type { DecisionTerrainModel } from "./decisionTerrainModel";
import { DecisionTerrain } from "./decisionTerrain";
import { Heartbeat, Odometer, Panel, SectionLabel, instrumentType, useReducedMotion } from "./instrumentKit";

// Now-screen block while the consecutive-loss limit holds new buys (redesign 2026-10-20, owner-chosen 계기판 design): a big
// "새 매수 멈춤", today's decisions rolling up over a heartbeat, a schematic rail where signals run to the risk gate and stop (the
// order side stays dashed and empty), a tap-to-explain ledger and the streak cells. Presentation of server counters only; an
// unknown counter is left out, never drawn as 0. Every loop stops when the OS reduce-motion setting is on.
const RAIL_HEIGHT = 118;
const NODES = [0.04, 0.37, 0.71, 0.96] as const;
const PULSES = 6;
const CYCLE_MS = 1100;

export function RiskGateFlow({ gate, lossText = null, windowNote = null, terrain = null, decisionCount = null }: {
  readonly gate: RiskGateModel;
  /** The main motion graphic: today's decision terrain with the amber gate at the stop time. Without it the heartbeat trace stands in. */
  readonly terrain?: DecisionTerrainModel | null;
  /** Today's decision count, so new decisions drop needles on the terrain. */
  readonly decisionCount?: number | null;
  /** The server's loss-limit sentence (buildLossLimitLine). */
  readonly lossText?: string | null;
  /** Shown when the buy counters started after a mid-day server restart (partialWindowNote). */
  readonly windowNote?: string | null;
}) {
  const reducedMotion = useReducedMotion();
  const [width, setWidth] = useState(0);
  const fmt = (n: number) => n.toLocaleString("en-US");
  const rows = [
    { key: "판단", value: gate.decisions, ratio: 1, amber: false, note: "시장을 보고 사고팔지 따져 본 횟수예요. 멈춘 날에도 계속 돌아요." },
    gate.signals == null ? null : { key: "매수 신호", value: gate.signals, ratio: gate.signals / gate.decisions, amber: false, note: "조건이 맞아서 사려고 했던 횟수예요." },
    gate.waiting == null ? null : { key: "대기", value: gate.waiting, ratio: gate.waiting / gate.decisions, amber: true, note: "신호는 났지만 연속 손실 한도 때문에 사지 않고 기다린 횟수예요." },
    { key: "새 주문", value: 0, ratio: 0, amber: false, note: "오늘 새로 낸 연습 주문이에요. 실제 돈은 쓰지 않아요." },
  ].filter((r): r is NonNullable<typeof r> => r != null);

  return <View style={styles.wrap} testID="now-risk-gate" onLayout={(e: LayoutChangeEvent) => setWidth(Math.round(e.nativeEvent.layout.width) - 40)}>
    <Text style={[fieldFonts.mono, instrumentType.index]}>01 / 지금</Text>
    <View accessible accessibilityRole="header" accessibilityLabel={`새 매수 멈춤. ${lossText ?? gate.detail}`} style={styles.hero}>
      <Text style={instrumentType.heroLine}>새 매수</Text>
      <Text style={[instrumentType.heroLine, { color: calmColors.attention }]}>멈춤</Text>
    </View>
    <Text style={instrumentType.sub} accessibilityElementsHidden importantForAccessibility="no">{lossText ?? gate.detail}</Text>

    <View style={styles.section}>
      <SectionLabel left="판단 · 도는 중" right="오늘" />
      {terrain == null ? <Heartbeat width={width} reducedMotion={reducedMotion} /> : width > 0 ? <DecisionTerrain model={terrain} tone="limit" decisionCount={decisionCount} width={width} reducedMotion={reducedMotion} /> : null}
      <Odometer value={gate.decisions} size={84} reducedMotion={reducedMotion} />
    </View>

    <View style={styles.section}>
      <SectionLabel left="판단 → 신호 → 위험 → 주문" right="어디서 멈췄나" />
      <Panel style={styles.railPanel}>
        <View accessible accessibilityRole="summary" accessibilityLabel={`판단 ${fmt(gate.decisions)}${gate.signals == null ? "" : `, 매수 신호 ${fmt(gate.signals)}`}, 위험 단계에서 ${gate.waiting == null ? "멈춤" : `${fmt(gate.waiting)} 대기`}, 새 주문 0`}>
          <Rail width={Math.max(0, width - 2)} gate={gate} reducedMotion={reducedMotion} />
        </View>
      </Panel>
    </View>

    {gate.day == null ? null : <View style={styles.section} testID="now-risk-gate-day">
      <SectionLabel left="오늘 24시간" right={`${hhmm(gate.day.stop)}에 멈춤`} />
      <Panel><DayRuler day={gate.day} width={Math.max(0, width - 30)} reducedMotion={reducedMotion} /></Panel>
    </View>}

    <View style={styles.section}>
      <SectionLabel left="오늘의 숫자" right="눌러서 뜻 보기" />
      {rows.map((r, i) => <LedgerRow key={r.key} label={r.key} value={fmt(r.value)} ratio={r.ratio} amber={r.amber} note={r.note} last={i === rows.length - 1} reducedMotion={reducedMotion} />)}
      {windowNote ? <Text style={styles.note} testID="now-risk-gate-window">{windowNote}</Text> : null}
    </View>

    {gate.streak == null ? null : <View style={styles.section} testID="now-risk-gate-streak">
      <SectionLabel left="연속 손실" right="한도 도달" />
      <Panel>
        <View style={styles.cells}>{Array.from({ length: gate.streak.max }, (_, i) => <StreakCell key={i} index={i} filled={i < gate.streak!.count} reducedMotion={reducedMotion} />)}</View>
        <View style={styles.streakRow}>
          <Text style={styles.streakText}>{`${gate.streak.count} / ${gate.streak.max} · 자정에 초기화`}</Text>
          <Text style={[fieldFonts.monoMedium, styles.hold]}>HOLD</Text>
        </View>
      </Panel>
    </View>}
  </View>;
}

function Rail({ width, gate, reducedMotion }: { readonly width: number; readonly gate: RiskGateModel; readonly reducedMotion: boolean | null }) {
  const pulses = useRef(Array.from({ length: PULSES }, () => new Animated.Value(0))).current;
  const beat = useRef(new Animated.Value(0)).current;
  const [x0, x1, xg, x3] = NODES.map((f) => f * width) as unknown as [number, number, number, number];
  const run = Math.max(0, xg - x0 - 16);

  useEffect(() => {
    if (reducedMotion !== false || width <= 0) return undefined;
    // The stagger is applied once, outside the loop, so every pulse keeps the same period and the stream stays even.
    const loops = pulses.map((v, i) => Animated.sequence([
      Animated.delay((CYCLE_MS / PULSES) * i),
      Animated.loop(Animated.timing(v, { toValue: 1, duration: CYCLE_MS, easing: Easing.linear, useNativeDriver: true })),
    ]));
    const gateLoop = Animated.loop(Animated.timing(beat, { toValue: 1, duration: (CYCLE_MS / PULSES) * 2, easing: Easing.out(Easing.quad), useNativeDriver: true }));
    loops.forEach((l) => l.start()); gateLoop.start();
    return () => { loops.forEach((l) => l.stop()); gateLoop.stop(); };
  }, [reducedMotion, width, pulses, beat]);

  if (width <= 0) return <View style={{ height: RAIL_HEIGHT }} />;
  const dashes = Math.max(0, Math.floor((x3 - xg - 8) / 7));
  const num = (n: number | null) => (n == null ? "—" : n.toLocaleString("en-US"));
  const waitLabel = gate.waiting == null ? "멈춤" : `${num(gate.waiting)} 대기`;
  return <View style={{ height: RAIL_HEIGHT }} pointerEvents="none" importantForAccessibility="no-hide-descendants">
    <View style={[styles.line, { left: x0, width: Math.max(0, xg - x0 - 3) }]} />
    {Array.from({ length: dashes }, (_, i) => <View key={i} style={[styles.dash, { left: xg + 6 + i * 7 }]} />)}
    {reducedMotion !== false ? null : pulses.map((v, i) => <Animated.View key={i} style={[styles.pulse, { left: x0, opacity: v.interpolate({ inputRange: [0, 0.12, 0.86, 1], outputRange: [0, 1, 1, 0] }), transform: [{ translateX: v.interpolate({ inputRange: [0, 1], outputRange: [0, run] }) }] }]} />)}
    <View style={[styles.node, { left: x0 - 4 }]} />
    <View style={[styles.node, styles.hollow, { left: x1 - 4 }]} />
    <View style={[styles.node, styles.hollow, styles.off, { left: x3 - 4 }]} />
    <Animated.View style={[styles.halo, { left: xg - 9, opacity: reducedMotion !== false ? 0.3 : beat.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.2, 0.5, 0.2] }) }]} />
    <View style={[styles.gate, { left: xg - 2.5 }]} />
    {reducedMotion !== false ? null : <Animated.View style={[styles.ring, { left: xg - 14, opacity: beat.interpolate({ inputRange: [0, 0.2, 1], outputRange: [0.9, 0.6, 0] }), transform: [{ scale: beat.interpolate({ inputRange: [0, 1], outputRange: [0.4, 2.2] }) }] }]} />}
    <Text style={[fieldFonts.mono, styles.cap, { left: x0 }]}>판단</Text>
    <Text style={[fieldFonts.mono, styles.cap, styles.center, { left: x1 - 50 }]}>매수 신호</Text>
    <Text style={[fieldFonts.mono, styles.cap, styles.center, styles.amber, { left: xg - 50, top: 10 }]}>위험 단계</Text>
    <Text style={[fieldFonts.mono, styles.cap, styles.right, { left: x3 - 100 }]}>주문</Text>
    <Text style={[fieldFonts.displayStrong, styles.val, { left: x0 }]}>{num(gate.decisions)}</Text>
    <Text style={[fieldFonts.displayStrong, styles.val, styles.center, { left: x1 - 50 }]}>{num(gate.signals)}</Text>
    <Text style={[fieldFonts.displayStrong, styles.val, styles.center, styles.amber, { left: xg - 50 }, waitLabel.length > 7 ? styles.valSmall : null]} numberOfLines={1}>{waitLabel}</Text>
    <Text style={[fieldFonts.displayStrong, styles.val, styles.right, styles.muted, { left: x3 - 100 }]}>0</Text>
  </View>;
}

const KST_MS = 9 * 3_600_000;
const DAY_MS = 86_400_000;
const hhmm = (ms: number) => { const d = new Date(ms + KST_MS); return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`; };

/** Today's KST day as a ruler: buyable until the limit-reaching loss, held from there to now, the rest of the day still ahead. */
function DayRuler({ day, width, reducedMotion }: { readonly day: NonNullable<RiskGateModel["day"]>; readonly width: number; readonly reducedMotion: boolean | null }) {
  const grow = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reducedMotion === null || width <= 0) return undefined;
    if (reducedMotion) { grow.setValue(1); return undefined; }
    grow.setValue(0);
    const a = Animated.timing(grow, { toValue: 1, duration: 900, easing: Easing.out(Easing.exp), useNativeDriver: true });
    a.start();
    return () => a.stop();
  }, [reducedMotion, width, grow]);
  if (width <= 0) return <View style={{ height: 74 }} />;
  const x = (t: number) => Math.max(0, Math.min(width, ((t - day.start) / DAY_MS) * width));
  const xs = x(day.stop), xn = x(day.now);
  const dashes = Math.max(0, Math.floor((width - xn - 4) / 6));
  const nowBelow = Math.abs(xn - xs) < 120;
  const stopLabelLeft = Math.min(Math.max(0, xs + 4), width - 86);
  return <View style={{ height: 74 }} accessible accessibilityRole="image" accessibilityLabel={`오늘 ${hhmm(day.start)}부터 ${hhmm(day.stop)}까지 매수 가능, 그 뒤 지금 ${hhmm(day.now)}까지 새 매수 멈춤`}>
    <View style={[styles.rBase, { width }]} />
    {Array.from({ length: 25 }, (_, h) => <View key={h} style={[styles.rTick, { left: Math.min(width - 1, (h / 24) * width), height: h % 6 === 0 ? 7 : 4, top: h % 6 === 0 ? 37 : 40 }]} />)}
    <Animated.View style={[styles.rSeg, { left: 0, width: Math.max(1, xs), backgroundColor: calmColors.text, transformOrigin: "left", transform: [{ scaleX: grow }] }]} />
    <Animated.View style={[styles.rSeg, { left: xs, width: Math.max(1, xn - xs), backgroundColor: calmColors.attention, transformOrigin: "left", transform: [{ scaleX: grow }] }]} />
    {Array.from({ length: dashes }, (_, i) => <View key={i} style={[styles.rDash, { left: xn + 4 + i * 6 }]} />)}
    <View style={[styles.rFlag, { left: xs }]} />
    <Text style={[fieldFonts.mono, styles.rFlagText, { left: stopLabelLeft }]}>{`${hhmm(day.stop)} 한도`}</Text>
    <View style={[styles.rNow, { left: xn - 5, top: nowBelow ? 50 : 26, transform: [{ rotate: nowBelow ? "225deg" : "45deg" }] }]} />
    <Text style={[fieldFonts.mono, styles.rNowText, { left: Math.min(Math.max(0, xn - 30), width - 60), top: nowBelow ? 58 : 10 }]}>지금</Text>
    {[0, 6, 12, 18, 24].filter((h) => !nowBelow || Math.abs((h / 24) * width - xn) > 34).map((h) => <Text key={h} style={[fieldFonts.mono, styles.rHour, { left: Math.min(width - 16, Math.max(0, (h / 24) * width - 7)) }]}>{String(h).padStart(2, "0")}</Text>)}
  </View>;
}

function LedgerRow({ label, value, ratio, amber, note, last, reducedMotion }: { readonly label: string; readonly value: string; readonly ratio: number; readonly amber: boolean; readonly note: string; readonly last: boolean; readonly reducedMotion: boolean | null }) {
  const [open, setOpen] = useState(false);
  const fill = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reducedMotion === null) return undefined;
    if (reducedMotion) { fill.setValue(1); return undefined; }
    const a = Animated.timing(fill, { toValue: 1, duration: 900, easing: Easing.out(Easing.exp), useNativeDriver: true });
    a.start();
    return () => a.stop();
  }, [reducedMotion, fill]);
  const color = amber ? calmColors.attention : calmColors.text;
  const w = Math.max(0, Math.min(1, ratio));
  return <View style={[styles.row, last ? styles.rowLast : null]}>
    <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} accessibilityLabel={`${label} ${value}`} accessibilityHint="뜻 보기" onPress={() => setOpen((v) => !v)} style={styles.rowPress}>
      <View style={styles.rowTop}>
        <Text style={styles.rowKey}>{label}</Text>
        <Text style={[fieldFonts.displayStrong, styles.rowVal, { color }]}>{value}</Text>
      </View>
      <View style={styles.track}>
        <Animated.View style={[styles.fill, { backgroundColor: color, width: `${w * 100}%`, transformOrigin: "left", transform: [{ scaleX: fill }] }]} />
      </View>
    </Pressable>
    {open ? <Text style={styles.rowNote}>{note}</Text> : null}
  </View>;
}

function StreakCell({ index, filled, reducedMotion }: { readonly index: number; readonly filled: boolean; readonly reducedMotion: boolean | null }) {
  const s = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reducedMotion === null) return undefined;
    if (reducedMotion) { s.setValue(1); return undefined; }
    const a = Animated.timing(s, { toValue: 1, duration: 350, delay: index * 120, easing: Easing.out(Easing.back(1.2)), useNativeDriver: true });
    a.start();
    return () => a.stop();
  }, [reducedMotion, s, index]);
  return <Animated.View style={[styles.cell, filled ? styles.cellOn : null, { transformOrigin: "bottom", transform: [{ scaleY: s }] }]} />;
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 20, paddingTop: 12 },
  hero: { marginTop: 14 },
  section: { marginTop: 26 },
  railPanel: { paddingHorizontal: 0, paddingVertical: 0 },
  line: { position: "absolute", top: 57, height: 1.5, backgroundColor: calmColors.muted, opacity: 0.45 },
  dash: { position: "absolute", top: 57, width: 2, height: 1.5, backgroundColor: calmColors.attention, opacity: 0.6 },
  pulse: { position: "absolute", top: 56.5, width: 12, height: 3, backgroundColor: calmColors.text },
  node: { position: "absolute", top: 54, width: 8, height: 8, borderRadius: 4, backgroundColor: calmColors.text },
  hollow: { backgroundColor: calmColors.ground, borderWidth: 1.5, borderColor: calmColors.text },
  off: { borderColor: calmColors.muted },
  halo: { position: "absolute", top: 28, width: 18, height: 60, borderRadius: 9, backgroundColor: calmColors.attention },
  gate: { position: "absolute", top: 34, width: 5, height: 48, backgroundColor: calmColors.attention },
  ring: { position: "absolute", top: 44, width: 28, height: 28, borderRadius: 14, borderWidth: 1.5, borderColor: calmColors.attention },
  cap: { position: "absolute", top: 14, color: calmColors.muted, fontSize: readableFont(11), letterSpacing: 0.5 },
  val: { position: "absolute", top: 80, color: calmColors.text, fontSize: 22, lineHeight: 28 },
  valSmall: { fontSize: 16, top: 84 },
  center: { width: 100, textAlign: "center" },
  right: { width: 100, textAlign: "right" },
  amber: { color: calmColors.attention },
  muted: { color: calmColors.muted },
  row: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: calmColors.line },
  rowLast: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: calmColors.line },
  rowPress: { paddingVertical: 12, minHeight: 48 },
  rowTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
  rowKey: { color: calmColors.text, fontSize: readableFont(14) },
  rowVal: { fontSize: 22, fontVariant: ["tabular-nums"] },
  track: { height: 3, marginTop: 8, backgroundColor: calmColors.line, overflow: "hidden" },
  fill: { height: 3 },
  rowNote: { color: calmColors.muted, fontSize: readableFont(13), lineHeight: 19, paddingBottom: 12 },
  note: { color: calmColors.muted, fontSize: readableFont(12), marginTop: 8 },
  rBase: { position: "absolute", left: 0, top: 43, height: 1, backgroundColor: calmColors.line },
  rTick: { position: "absolute", width: 1, backgroundColor: calmColors.line },
  rSeg: { position: "absolute", top: 40, height: 7 },
  rDash: { position: "absolute", top: 43, width: 2, height: 1.5, backgroundColor: calmColors.muted },
  rFlag: { position: "absolute", top: 14, width: 1, height: 26, backgroundColor: calmColors.text },
  rFlagText: { position: "absolute", top: 8, width: 86, color: calmColors.text, fontSize: readableFont(11) },
  rNow: { position: "absolute", width: 8, height: 8, borderRightWidth: 2, borderBottomWidth: 2, borderColor: calmColors.attention },
  rNowText: { position: "absolute", width: 60, textAlign: "center", color: calmColors.attention, fontSize: readableFont(11) },
  rHour: { position: "absolute", top: 54, color: calmColors.muted, fontSize: readableFont(11) },
  cells: { flexDirection: "row", gap: 6 },
  cell: { flex: 1, height: 34, borderWidth: 1, borderColor: calmColors.attention },
  cellOn: { backgroundColor: calmColors.attention },
  streakRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", marginTop: 10 },
  streakText: { color: calmColors.muted, fontSize: readableFont(13) },
  hold: { color: calmColors.attention, fontSize: readableFont(12), letterSpacing: 1 },
});
