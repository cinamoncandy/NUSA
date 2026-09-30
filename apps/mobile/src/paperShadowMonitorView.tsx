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
import { fieldPalette } from "./designSystem";

/**
 * Unified read-only cockpit. PAPER trading learning and SYSTEM evolution learning remain
 * separate evidence domains and are never merged into a combined score or conclusion.
 */
// LIVE readiness lives in the primary LIVE tab; it is not duplicated here.
export type MonitorMode = "PAPER" | "SYSTEM" | "SHADOW" | "REAL";

const BASE_MODES = ["PAPER", "SHADOW", "REAL"] as const;
const MODES: readonly MonitorMode[] = [BASE_MODES[0], "SYSTEM", BASE_MODES[1], BASE_MODES[2]];
/** Accessible names keep the full canonical mode; the visible tab stays short so one thin row fits. */
const modeLabel = (mode: MonitorMode): string => mode === "PAPER" ? "모의투자" : mode === "SYSTEM" ? "시스템 학습" : mode === "SHADOW" ? "가상 검증" : "실계좌 보기";
const shortLabel = modeLabel;

export function PaperShadowMonitorView({ paper, shadow, shadowReason, real, realReason, refreshing, onRefresh, onClose }: Readonly<{ paper: PaperLearningScreenState; shadow: ShadowObservabilitySnapshot | null; shadowReason?: string; real?: RealReadOnlyObservabilitySnapshot | null; realReason?: string; refreshing: boolean; onRefresh: () => void | Promise<void>; onClose: () => void }>) {
  const [mode, setMode] = useState<MonitorMode>("PAPER");
  const credentialSession = useMemo(() => new InMemoryDashboardCredentialSession(), []);
  const supervisorEndpoint = getConfiguredPaperEndpoint() ?? "";
  return <View style={styles.wrapper}>
    <View style={styles.switcher} accessibilityRole="tablist" testID="paper-shadow-monitor-switcher">
      {MODES.map((item) => <Pressable key={item} accessibilityLabel={`${modeLabel(item)} 보기 전용 상태`} accessibilityRole="tab" accessibilityState={{ selected: mode === item }} hitSlop={{ top: 6, bottom: 6 }} onPress={() => setMode(item)} style={[styles.switch, { borderBottomColor: mode === item ? fieldPalette.focus : "transparent" }]} testID={`monitor-mode-${item.toLowerCase()}`}><Text style={[styles.switchText, { color: mode === item ? fieldPalette.text : fieldPalette.muted }]}>{shortLabel(item)}</Text></Pressable>)}
    </View>
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
  switch: { flex: 1, minHeight: 44, borderBottomWidth: 2, alignItems: "center", justifyContent: "center", paddingHorizontal: 4 },
  switchText: { fontSize: 10, fontWeight: "700", letterSpacing: 0.25, textAlign: "center" }
});