import React, { useEffect, useRef, useState } from "react";
import { Animated, Easing, StyleSheet, Text, View, type LayoutChangeEvent } from "react-native";
import { calmColors } from "./uiKitModel";
import { readableFont } from "./designSystem";
import { fieldFonts } from "./fieldFonts";
import { Panel, SectionLabel, useReducedMotion } from "./instrumentKit";

// 안전 hero (redesign 2026-10-20, owner-chosen 계기판 design): the three fixed locks of this build (PAPER only, LIVE locked, AI no
// authority) drawn as a circuit into an AND gate whose output is "실제 주문 불가". Current flows along the wires on the native driver.
// The locks are build facts, never server values, so nothing a response says can make this look unlocked. Motion stops entirely
// when the OS reduce-motion setting is on.
const HEIGHT = 200;
const ROWS = [
  { y: 24, name: "PAPER 전용", state: "켜짐" },
  { y: 96, name: "LIVE 거래", state: "잠김" },
  { y: 168, name: "AI 권한", state: "0" },
] as const;
const DASH = 12;

export function SafetyCircuit() {
  const reducedMotion = useReducedMotion();
  const [w, setW] = useState(0);
  const flow = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reducedMotion !== false || w <= 0) return undefined;
    const loop = Animated.loop(Animated.timing(flow, { toValue: 1, duration: 500, easing: Easing.linear, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [reducedMotion, w, flow]);

  const wireStart = w * 0.42, bus = w * 0.64, gateX = w * 0.7, gateW = 46, out = gateX + gateW, lockX = w - 26;
  const mid = ROWS[1].y;
  const moving = reducedMotion === false;
  return <View style={styles.wrap} testID="safety-circuit">
    <SectionLabel left="잠금 회로" right="모두 정상" />
    <Panel>
      <View style={{ height: HEIGHT }} onLayout={(e: LayoutChangeEvent) => setW(Math.round(e.nativeEvent.layout.width))}
        accessible accessibilityRole="image" accessibilityLabel="PAPER 전용 켜짐, LIVE 거래 잠김, AI 권한 0. 세 조건이 모두 맞아서 실제 주문은 나갈 수 없어요.">
        {w <= 0 ? null : <>
          {ROWS.map((r) => <React.Fragment key={r.name}>
            <View style={[styles.led, { top: r.y - 4 }]} />
            <Text style={[styles.name, { top: r.y - 12 }]}>{r.name}</Text>
            <Text style={[fieldFonts.mono, styles.state, { top: r.y + 8 }]}>{r.state}</Text>
            <Wire x={wireStart} y={r.y} length={bus - wireStart} flow={flow} moving={moving} />
          </React.Fragment>)}
          <Wire x={bus} y={ROWS[0].y} length={ROWS[2].y - ROWS[0].y} vertical flow={flow} moving={moving} />
          <Wire x={bus} y={mid} length={gateX - bus} flow={flow} moving={moving} />
          <View style={[styles.gate, { left: gateX, top: mid - 24, width: gateW }]}><Text style={[fieldFonts.mono, styles.and]}>AND</Text></View>
          <Wire x={out} y={mid} length={lockX - out - 10} flow={flow} moving={moving} />
          <View style={[styles.lockBody, { left: lockX - 10, top: mid - 8 }]} />
          <View style={[styles.lockShackle, { left: lockX - 5, top: mid - 18 }]} />
          <Text style={[styles.result, { top: mid + 28 }]}>실제 주문 불가</Text>
        </>}
      </View>
    </Panel>
  </View>;
}

/** A hairline wire with a dashed current running along it (native-driver translate). */
function Wire({ x, y, length, vertical = false, flow, moving }: { readonly x: number; readonly y: number; readonly length: number; readonly vertical?: boolean; readonly flow: Animated.Value; readonly moving: boolean }) {
  if (length <= 0) return null;
  const n = Math.ceil(length / DASH) + 2;
  const shift = flow.interpolate({ inputRange: [0, 1], outputRange: [-DASH, 0] });
  return <View pointerEvents="none" style={[styles.wire, vertical ? { left: x - 0.75, top: y, width: 1.5, height: length } : { left: x, top: y - 0.75, width: length, height: 1.5 }]}>
    {moving ? <Animated.View style={[vertical ? styles.dashCol : styles.dashRow, { transform: [vertical ? { translateY: shift } : { translateX: shift }] }]}>
      {Array.from({ length: n }, (_, i) => <View key={i} style={vertical ? styles.dashV : styles.dashH} />)}
    </Animated.View> : null}
  </View>;
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 20, marginTop: 24 },
  led: { position: "absolute", left: 0, width: 8, height: 8, borderRadius: 4, backgroundColor: calmColors.text },
  name: { position: "absolute", left: 18, color: calmColors.text, fontSize: readableFont(13) },
  state: { position: "absolute", left: 18, color: calmColors.muted, fontSize: readableFont(11) },
  wire: { position: "absolute", backgroundColor: calmColors.line, overflow: "hidden" },
  dashRow: { flexDirection: "row", height: 1.5 },
  dashCol: { flexDirection: "column", width: 1.5 },
  dashH: { width: DASH / 2, height: 1.5, marginRight: DASH / 2, backgroundColor: calmColors.text },
  dashV: { width: 1.5, height: DASH / 2, marginBottom: DASH / 2, backgroundColor: calmColors.text },
  gate: { position: "absolute", height: 48, borderWidth: 1.5, borderColor: calmColors.text, borderTopRightRadius: 24, borderBottomRightRadius: 24, backgroundColor: calmColors.ground, alignItems: "center", justifyContent: "center" },
  and: { color: calmColors.text, fontSize: readableFont(11) },
  lockBody: { position: "absolute", width: 20, height: 16, borderWidth: 1.5, borderColor: calmColors.text },
  lockShackle: { position: "absolute", width: 10, height: 12, borderWidth: 1.5, borderBottomWidth: 0, borderColor: calmColors.text, borderTopLeftRadius: 5, borderTopRightRadius: 5 },
  result: { position: "absolute", right: 0, color: calmColors.text, fontSize: readableFont(12) },
});
