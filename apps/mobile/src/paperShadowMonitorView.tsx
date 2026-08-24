import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTheme } from "./ThemeProvider";
import { PaperLearningMonitorView } from "./paperLearningMonitorView";
import { ShadowObservabilityMonitorView } from "./shadowObservabilityMonitorView";
import { RealReadOnlyMonitorView } from "./realReadOnlyMonitorView";
import type { PaperLearningScreenState } from "./paperLearningScreen";
import type { ShadowObservabilitySnapshot } from "../../../packages/contracts/src/shadowObservabilityReadOnly";
import type { RealReadOnlyObservabilitySnapshot } from "../../../packages/contracts/src/realReadOnlyObservability";

/**
 * Unified read-only cockpit: PAPER, SHADOW and REAL_READ_ONLY.
 *
 * The three modes are rendered by three separate views over three separate snapshots and are
 * never merged into a combined figure. This switcher aggregates *visibility* only -- there is
 * deliberately no cross-mode total anywhere, because summing a simulated PAPER ledger with an
 * observed real balance would produce a number that is true of no account that exists.
 */
export type MonitorMode = "PAPER" | "SHADOW" | "REAL";

const MODES: readonly MonitorMode[] = ["PAPER", "SHADOW", "REAL"];

export function PaperShadowMonitorView({ paper, shadow, shadowReason, real, realReason, refreshing, onRefresh, onClose }: Readonly<{ paper: PaperLearningScreenState; shadow: ShadowObservabilitySnapshot | null; shadowReason?: string; real?: RealReadOnlyObservabilitySnapshot | null; realReason?: string; refreshing: boolean; onRefresh: () => void | Promise<void>; onClose: () => void }>) {
  const { theme } = useTheme();
  const [mode, setMode] = useState<MonitorMode>("PAPER");
  return <View style={styles.wrapper}>
    <View style={[styles.switcher, { backgroundColor: theme.colors.surface, borderBottomColor: theme.colors.border }]} testID="paper-shadow-monitor-switcher">
      {MODES.map((item) => <Pressable key={item} accessibilityRole="tab" accessibilityState={{ selected: mode === item }} onPress={() => setMode(item)} style={[styles.switch, { borderColor: mode === item ? theme.colors.primary : theme.colors.border, backgroundColor: mode === item ? theme.colors.primarySoft : theme.colors.surfaceSunken }]} testID={`monitor-mode-${item.toLowerCase()}`}><Text style={[styles.switchText, { color: mode === item ? theme.colors.primary : theme.colors.textMuted }]}>{item} · READ ONLY</Text></Pressable>)}
    </View>
    {mode === "PAPER" ? <PaperLearningMonitorView state={paper} refreshing={refreshing} onRefresh={onRefresh} onClose={onClose} />
      : mode === "SHADOW" ? <ShadowObservabilityMonitorView snapshot={shadow} unavailableReason={shadowReason} refreshing={refreshing} onRefresh={onRefresh} onClose={onClose} />
      : <RealReadOnlyMonitorView snapshot={real ?? null} unavailableReason={realReason} refreshing={refreshing} onRefresh={onRefresh} onClose={onClose} />}
  </View>;
}

const styles = StyleSheet.create({ wrapper: { flex: 1 }, switcher: { flexDirection: "row", gap: 8, paddingHorizontal: 20, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth }, switch: { flex: 1, minHeight: 40, borderWidth: 1, borderRadius: 10, alignItems: "center", justifyContent: "center" }, switchText: { fontSize: 10, fontWeight: "800", letterSpacing: 0.6 } });
