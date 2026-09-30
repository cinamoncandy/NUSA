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
const modeLabel = (mode: MonitorMode): string => mode === "REAL" ? "REAL_READ_ONLY" : mode === "SYSTEM" ? "SYSTEM LEARNING" : mode;
const shortLabel = (mode: MonitorMode): string => mode === "SYSTEM" ? "학습" : mode;

export function PaperShadowMonitorView({ paper, shadow, shadowReason, real, realReason, refreshing, onRefresh, onClose }: Readonly<{ paper: PaperLearningScreenState; shadow: ShadowObservabilitySnapshot | null; shadowReason?: string; real?: RealReadOnlyObservabilitySnapshot | null; realReason?: string; refreshing: boolean; onRefresh: () => void | Promise<void>; onClose: () => void }>) {
  const [mode, setMode] = useState<MonitorMode>("PAPER");
  const credentialSession = useMemo(() => new InMemoryDashboardCredentialSession(), []);
  const supervisorEndpoint = getConfiguredPaperEndpoint() ?? "";
  return <View style={styles.wrapper}>
    <View style={styles.switcher} accessibilityRole="tablist" testID="paper-shadow-monitor-switcher">
      {MODES.map((item) => <Pressable key={item} accessibilityLabel={`${modeLabel(item)} read only monitor`} accessibilityRole="tab" accessibilityState={{ selected: mode === item }} hitSlop={{ top: 6, bottom: 6 }} onPress={() => setMode(item)} style={[styles.switch, { borderBottomColor: mode === item ? fieldPalette.accent : "transparent" }]} testID={`monitor-mode-${item.toLowerCase()}`}><Text style={[styles.switchText, { color: mode === item ? fieldPalette.text : fieldPalette.muted }]}>{shortLabel(item)}</Text></Pressable>)}
      <Text style={styles.readOnly}>READ ONLY</Text>
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
  switch: { minHeight: 36, borderBottomWidth: 2, alignItems: "center", justifyContent: "center", paddingHorizontal: 12 },
  readOnly: { marginLeft: "auto", alignSelf: "center", color: fieldPalette.dim, fontSize: 9, letterSpacing: 1.4 },
  switchText: { fontSize: 11, fontWeight: "600", letterSpacing: 1.2, textAlign: "center" }
});