import React, { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { PaperLearningMonitorView } from "./paperLearningMonitorView";
import { ShadowObservabilityMonitorView } from "./shadowObservabilityMonitorView";
import { RealReadOnlyMonitorView } from "./realReadOnlyMonitorView";
import { SystemLearningSupervisorView } from "./systemLearningSupervisorView";
import { InMemoryDashboardCredentialSession } from "./dashboardCredentialSession";
import { getConfiguredPaperEndpoint } from "./paperConnectionSession";
import type { PaperLearningScreenState } from "./paperLearningScreen";
import type { ShadowObservabilitySnapshot } from "../../../packages/contracts/src/shadowObservabilityReadOnly";
import type { RealReadOnlyObservabilitySnapshot } from "../../../packages/contracts/src/realReadOnlyObservability";
import { fieldPalette, readableFont } from "./designSystem";

/**
 * Unified read-only cockpit. PAPER trading learning and SYSTEM evolution learning remain
 * separate evidence domains and are never merged into a combined score or conclusion.
 */
// LIVE readiness lives in the primary LIVE tab; it is not duplicated here.
export type MonitorMode = "PAPER" | "SYSTEM" | "SHADOW" | "REAL";

const BASE_MODES = ["PAPER", "SHADOW", "REAL"] as const;
const MODES: readonly MonitorMode[] = [BASE_MODES[0], "SYSTEM", BASE_MODES[1], BASE_MODES[2]];
/** Accessible names keep the full canonical mode; the visible tab stays short so one thin row fits. */
const modeLabel = (mode: MonitorMode): string => mode === "REAL" ? "REAL_READ_ONLY" : mode === "SYSTEM" ? "SYSTEM LEARNING" : mode;
const SHORT: Readonly<Record<MonitorMode, string>> = Object.freeze({ PAPER: "운영", SYSTEM: "학습", SHADOW: "재현", REAL: "실계좌" });
const shortLabel = (mode: MonitorMode): string => SHORT[mode];
/** One plain sentence per mode so the owner knows what each tab answers before reading it. */
const HINT: Readonly<Record<MonitorMode, string>> = Object.freeze({
  PAPER: "모의 매매가 지금 무엇을 하고 있는지",
  SYSTEM: "시스템이 스스로 무엇을 배우고 있는지",
  SHADOW: "같은 시장 기록으로 판단을 다시 해 본 결과",
  REAL: "실제 계좌를 읽기만 한 결과 · 주문 없음",
});

export function PaperShadowMonitorView({ paper, shadow, shadowReason, real, realReason, refreshing, onRefresh, onClose }: Readonly<{ paper: PaperLearningScreenState; shadow: ShadowObservabilitySnapshot | null; shadowReason?: string; real?: RealReadOnlyObservabilitySnapshot | null; realReason?: string; refreshing: boolean; onRefresh: () => void | Promise<void>; onClose: () => void }>) {
  const [mode, setMode] = useState<MonitorMode>("PAPER");
  const credentialSession = useMemo(() => new InMemoryDashboardCredentialSession(), []);
  const supervisorEndpoint = getConfiguredPaperEndpoint() ?? "";
  return <View style={styles.wrapper}>
    <View style={styles.switcher} accessibilityRole="tablist" testID="paper-shadow-monitor-switcher">
      {MODES.map((item) => <Pressable key={item} accessibilityLabel={`${modeLabel(item)} read only monitor`} accessibilityRole="tab" accessibilityState={{ selected: mode === item }} hitSlop={{ top: 6, bottom: 6 }} onPress={() => setMode(item)} style={[styles.switch, { borderBottomColor: mode === item ? fieldPalette.accent : "transparent" }]} testID={`monitor-mode-${item.toLowerCase()}`}><Text style={[styles.switchText, { color: mode === item ? fieldPalette.text : fieldPalette.muted }]}>{shortLabel(item)}</Text></Pressable>)}
      <Text style={styles.readOnly} accessibilityLabel="READ ONLY">읽기 전용</Text>
    </View>
    <Text style={styles.hint} testID="paper-shadow-monitor-hint">{HINT[mode]}</Text>
    {mode === "PAPER" ? <PaperLearningMonitorView state={paper} refreshing={refreshing} onRefresh={onRefresh} onClose={onClose} />
      : mode === "SYSTEM" ? <SystemLearningSupervisorView baseUrl={supervisorEndpoint} credentialProvider={credentialSession.credentialProvider} onClose={onClose} />
      : mode === "SHADOW" ? <ShadowObservabilityMonitorView snapshot={shadow} unavailableReason={shadowReason} refreshing={refreshing} onRefresh={onRefresh} onClose={onClose} />
      : <RealReadOnlyMonitorView snapshot={real ?? null} unavailableReason={realReason} refreshing={refreshing} onRefresh={onRefresh} onClose={onClose} />}
  </View>;
}

const styles = StyleSheet.create({
  wrapper: { flex: 1 },
  // One thin row: short labels, underline emphasis, read-only tag inline instead of an extra band.
  switcher: { flexDirection: "row", alignItems: "stretch", paddingHorizontal: 12, backgroundColor: fieldPalette.void, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: fieldPalette.dim },
  switch: { minHeight: 44, borderBottomWidth: 2, alignItems: "center", justifyContent: "center", paddingHorizontal: 12 },
  readOnly: { marginLeft: "auto", alignSelf: "center", color: fieldPalette.muted, fontSize: readableFont(10), letterSpacing: 0.4 },
  hint: { color: fieldPalette.muted, fontSize: 12, paddingHorizontal: 24, paddingTop: 8, paddingBottom: 2, backgroundColor: fieldPalette.void },
  switchText: { fontSize: 13, fontWeight: "600", textAlign: "center" }
});