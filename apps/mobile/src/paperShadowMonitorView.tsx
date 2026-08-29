import React, { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTheme } from "./ThemeProvider";
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
import type { LiveReadinessObservabilitySnapshot } from "../../../packages/contracts/src/liveReadinessObservability";

/**
 * Unified read-only cockpit. PAPER trading learning and SYSTEM evolution learning remain
 * separate evidence domains and are never merged into a combined score or conclusion.
 */
export type MonitorMode = "PAPER" | "SYSTEM" | "SHADOW" | "REAL" | "LIVE_READY";

const MODES: readonly MonitorMode[] = ["PAPER", "SYSTEM", "SHADOW", "REAL", "LIVE_READY"];
const modeLabel = (mode: MonitorMode): string => mode === "REAL" ? "REAL_READ_ONLY" : mode === "SYSTEM" ? "SYSTEM LEARNING" : mode;

export function PaperShadowMonitorView({ paper, shadow, shadowReason, real, realReason, live, liveReason, refreshing, onRefresh, onClose }: Readonly<{ paper: PaperLearningScreenState; shadow: ShadowObservabilitySnapshot | null; shadowReason?: string; real?: RealReadOnlyObservabilitySnapshot | null; realReason?: string; live?: LiveReadinessObservabilitySnapshot | null; liveReason?: string; refreshing: boolean; onRefresh: () => void | Promise<void>; onClose: () => void }>) {
  const { theme } = useTheme();
  const [mode, setMode] = useState<MonitorMode>("PAPER");
  const credentialSession = useMemo(() => new InMemoryDashboardCredentialSession(), []);
  const supervisorEndpoint = getConfiguredPaperEndpoint() ?? "";
  return <View style={styles.wrapper}>
    <View style={[styles.switcher, { backgroundColor: theme.colors.surface, borderBottomColor: theme.colors.border }]} accessibilityRole="tablist" testID="paper-shadow-monitor-switcher">
      {MODES.map((item) => <Pressable key={item} accessibilityLabel={`${modeLabel(item)} read only monitor`} accessibilityRole="tab" accessibilityState={{ selected: mode === item }} onPress={() => setMode(item)} style={[styles.switch, { borderColor: mode === item ? theme.colors.primary : theme.colors.border, backgroundColor: mode === item ? theme.colors.primarySoft : theme.colors.surfaceSunken }]} testID={`monitor-mode-${item.toLowerCase().replace("_", "-")}`}><Text style={[styles.switchText, { color: mode === item ? theme.colors.primary : theme.colors.textMuted }]}>{modeLabel(item)} · READ ONLY</Text></Pressable>)}
    </View>
    {mode === "PAPER" ? <PaperLearningMonitorView state={paper} refreshing={refreshing} onRefresh={onRefresh} onClose={onClose} />
      : mode === "SYSTEM" ? <SystemLearningSupervisorView baseUrl={supervisorEndpoint} credentialProvider={credentialSession.credentialProvider} onClose={onClose} />
      : mode === "SHADOW" ? <ShadowObservabilityMonitorView snapshot={shadow} unavailableReason={shadowReason} refreshing={refreshing} onRefresh={onRefresh} onClose={onClose} />
      : mode === "REAL" ? <RealReadOnlyMonitorView snapshot={real ?? null} unavailableReason={realReason} refreshing={refreshing} onRefresh={onRefresh} onClose={onClose} />
      : <LiveReadinessMonitorView snapshot={live ?? null} unavailableReason={liveReason} refreshing={refreshing} onRefresh={onRefresh} onClose={onClose} />}
  </View>;
}

const styles = StyleSheet.create({
  wrapper: { flex: 1 },
  switcher: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingHorizontal: 20, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  switch: { flexGrow: 1, minWidth: 112, minHeight: 40, borderWidth: 1, borderRadius: 10, alignItems: "center", justifyContent: "center", paddingHorizontal: 8 },
  switchText: { fontSize: 10, fontWeight: "800", letterSpacing: 0.6, textAlign: "center" }
});