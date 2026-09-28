import React, { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { PaperLearningMonitorView } from "./paperLearningMonitorView";
import { ShadowObservabilityMonitorView } from "./shadowObservabilityMonitorView";
import { RealReadOnlyMonitorView } from "./realReadOnlyMonitorView";
import { LiveReadinessMonitorView } from "./liveReadinessMonitorView";
import { SystemLearningSupervisorView } from "./systemLearningSupervisorView";
import { InMemoryDashboardCredentialSession } from "./dashboardCredentialSession";
import { getConfiguredPaperEndpoint } from "./paperConnectionSession";
import type { PaperLearningScreenState } from "./paperLearningScreen";
import type { ShadowObservabilitySnapshot } from "../../../packages/contracts/src/shadowObservabilityReadOnly";
import type { RealReadOnlyObservabilitySnapshot } from "../../../packages/contracts/src/realReadOnlyObservability";
import { fieldPalette } from "./designSystem";
import type { LiveReadinessObservabilitySnapshot } from "../../../packages/contracts/src/liveReadinessObservability";

/**
 * Unified read-only cockpit. PAPER trading learning and SYSTEM evolution learning remain
 * separate evidence domains and are never merged into a combined score or conclusion.
 */
export type MonitorMode = "PAPER" | "SYSTEM" | "SHADOW" | "REAL" | "LIVE_READY";

const BASE_MODES = ["PAPER", "SHADOW", "REAL"] as const;
const MODES: readonly MonitorMode[] = [BASE_MODES[0], "SYSTEM", BASE_MODES[1], BASE_MODES[2], "LIVE_READY"];
const modeLabel = (mode: MonitorMode): string => mode === "REAL" ? "REAL_READ_ONLY" : mode === "SYSTEM" ? "SYSTEM LEARNING" : mode;

export function PaperShadowMonitorView({ paper, shadow, shadowReason, real, realReason, live, liveReason, refreshing, onRefresh, onClose }: Readonly<{ paper: PaperLearningScreenState; shadow: ShadowObservabilitySnapshot | null; shadowReason?: string; real?: RealReadOnlyObservabilitySnapshot | null; realReason?: string; live?: LiveReadinessObservabilitySnapshot | null; liveReason?: string; refreshing: boolean; onRefresh: () => void | Promise<void>; onClose: () => void }>) {
  const [mode, setMode] = useState<MonitorMode>("PAPER");
  const credentialSession = useMemo(() => new InMemoryDashboardCredentialSession(), []);
  const supervisorEndpoint = getConfiguredPaperEndpoint() ?? "";
  return <View style={styles.wrapper}>
    <View style={styles.switcher} accessibilityRole="tablist" testID="paper-shadow-monitor-switcher">
      {MODES.map((item) => <Pressable key={item} accessibilityLabel={`${modeLabel(item)} read only monitor`} accessibilityRole="tab" accessibilityState={{ selected: mode === item }} onPress={() => setMode(item)} style={[styles.switch, { borderBottomColor: mode === item ? fieldPalette.focus : "transparent" }]} testID={`monitor-mode-${item.toLowerCase()}`}><Text style={[styles.switchText, { color: mode === item ? fieldPalette.text : fieldPalette.muted }]}>{modeLabel(item)}</Text></Pressable>)}
    </View>
    <Text style={styles.readOnly}>READ ONLY · 모든 모니터는 읽기 전용입니다</Text>
    {mode === "PAPER" ? <PaperLearningMonitorView state={paper} refreshing={refreshing} onRefresh={onRefresh} onClose={onClose} />
      : mode === "SYSTEM" ? <SystemLearningSupervisorView baseUrl={supervisorEndpoint} credentialProvider={credentialSession.credentialProvider} onClose={onClose} />
      : mode === "SHADOW" ? <ShadowObservabilityMonitorView snapshot={shadow} unavailableReason={shadowReason} refreshing={refreshing} onRefresh={onRefresh} onClose={onClose} />
      : mode === "REAL" ? <RealReadOnlyMonitorView snapshot={real ?? null} unavailableReason={realReason} refreshing={refreshing} onRefresh={onRefresh} onClose={onClose} />
      : <LiveReadinessMonitorView snapshot={live ?? null} unavailableReason={liveReason} refreshing={refreshing} onRefresh={onRefresh} onClose={onClose} />}
  </View>;
}

const styles = StyleSheet.create({
  wrapper: { flex: 1 },
  // Thin underline tabs: state is shown by emphasis, not by filled buttons.
  switcher: { flexDirection: "row", flexWrap: "wrap", paddingHorizontal: 12, backgroundColor: fieldPalette.void, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: fieldPalette.dim },
  switch: { flexGrow: 1, minHeight: 44, borderBottomWidth: 2, alignItems: "center", justifyContent: "center", paddingHorizontal: 8 },
  readOnly: { backgroundColor: fieldPalette.void, color: fieldPalette.dim, fontSize: 9, letterSpacing: 1.4, paddingHorizontal: 20, paddingVertical: 6 },
  switchText: { fontSize: 10, fontWeight: "600", letterSpacing: 1.4, textAlign: "center" }
});