import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { describeAge, freshnessProgress, freshnessStage, lampLevels, type FreshnessStage, type LampId, type LampLevel, type RefusalDescriptor } from "./instrumentState";
import { useTheme } from "./ThemeProvider";
import type { Theme } from "./designSystem";

const LAMP_ORDER: readonly LampId[] = Object.freeze(["DATA", "LINK", "GATE"]);
const LAMP_MEANING: Readonly<Record<LampId, string>> = Object.freeze({ DATA: "시세", LINK: "세션", GATE: "리스크" });

function lampColor(theme: Theme, level: LampLevel): string {
  return level === "DANGER" ? theme.colors.danger : level === "WARNING" ? theme.colors.warning : theme.colors.textMuted;
}

/**
 * The authority spine. Fixed to the top of every screen, never dismissible, identical
 * everywhere.
 *
 * Two zones. The left states what this build may do and is the same on every run: it is not
 * a warning, so it carries no color and reads as background the operator can still resolve.
 * The right is annunciator lamps under the aviation "dark cockpit" rule -- dark is nominal,
 * and a lit lamp is itself the information.
 *
 * Off lamps are NOT dimmed with opacity. A 9px label behind 35% opacity is unreadable, and
 * the on/off distinction is already carried by color, fill and weight without borrowing
 * contrast to say it.
 */
export function AuthoritySpine({ refusals = [], onSelectGate, testID }: Readonly<{ refusals?: readonly RefusalDescriptor[]; onSelectGate?: (gate: LampId) => void; testID?: string }>) {
  const { theme } = useTheme();
  const levels = lampLevels(refusals);
  return (
    <View
      accessibilityRole="header"
      style={[styles.spine, { backgroundColor: theme.colors.surfaceSunken, borderBottomColor: theme.colors.border }]}
      testID={testID ?? "authority-spine"}
    >
      <View
        accessibilityLabel="PAPER 전용, 실거래 권한 없음, AI 권한 없음"
        style={[styles.spineAuthority, { borderRightColor: theme.colors.border }]}
      >
        <Text style={[styles.spineAuthorityLabel, { color: theme.colors.textMuted, fontFamily: theme.typography.monoFamily }]}>PAPER</Text>
        <View style={[styles.spineDivider, { backgroundColor: theme.colors.border }]} />
        <Text style={[styles.spineAuthorityLabel, { color: theme.colors.textMuted, fontFamily: theme.typography.monoFamily }]}>LIVE NONE</Text>
        <View style={[styles.spineDivider, { backgroundColor: theme.colors.border }]} />
        <Text style={[styles.spineAuthorityLabel, { color: theme.colors.textMuted, fontFamily: theme.typography.monoFamily }]}>AI ZERO</Text>
      </View>
      <View style={styles.spineLamps}>
        {LAMP_ORDER.map((lamp) => {
          const level = levels[lamp];
          const lit = level !== "OFF";
          const color = lampColor(theme, level);
          const state = level === "DANGER" ? "정지" : level === "WARNING" ? "경고" : "정상";
          return (
            <Pressable
              accessibilityHint={lit && onSelectGate != null ? "두 번 눌러 거부 기록 열기" : undefined}
              accessibilityLabel={`${lamp} ${LAMP_MEANING[lamp]} ${state}`}
              accessibilityRole="button"
              accessibilityState={{ disabled: !lit || onSelectGate == null }}
              disabled={!lit || onSelectGate == null}
              key={lamp}
              onPress={() => onSelectGate?.(lamp)}
              style={({ pressed }) => [styles.lamp, { borderColor: lit ? color : theme.colors.border, backgroundColor: lit ? theme.colors.surfaceRaised : "transparent", opacity: pressed ? 0.72 : 1 }]}
              testID={`authority-lamp-${lamp}`}
            >
              <View style={[styles.lampDot, { backgroundColor: color }]} />
              <Text style={[styles.lampLabel, { color, fontFamily: theme.typography.monoFamily }, lit && styles.lampLabelLit]}>{lamp}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/**
 * A refusal rendered as a record rather than a status. Four layers, none optional: the gate
 * that refused, one sentence of what is true, what happens next, and the machine evidence
 * left visible so it can be copied into a support request instead of retyped from memory.
 */
export function RefusalRecord({ refusal, occurredAtLabel, evidence, actionLabel, onAction, testID }: Readonly<{ refusal: RefusalDescriptor; occurredAtLabel?: string; evidence?: readonly string[]; actionLabel?: string; onAction?: () => void; testID?: string }>) {
  const { theme } = useTheme();
  const accent = refusal.severity === "HALT" ? theme.colors.danger : theme.colors.warning;
  return (
    <View
      accessibilityLabel={`${refusal.gateLabel} ${refusal.severity === "HALT" ? "봉쇄" : "거절"}. ${refusal.title}. ${refusal.action}`}
      accessibilityRole="alert"
      style={[styles.refusal, { backgroundColor: theme.colors.surface, borderColor: accent, borderRadius: theme.radii.md }]}
      testID={testID ?? "refusal-record"}
    >
      <View style={[styles.refusalHead, { borderBottomColor: theme.colors.border }]}>
        <Text style={[styles.refusalGate, { color: accent, fontFamily: theme.typography.monoFamily }]}>{refusal.gateLabel}</Text>
        <Text style={[styles.refusalSeverity, { color: accent, borderColor: accent, fontFamily: theme.typography.monoFamily }]}>{refusal.severity}</Text>
      </View>
      <View style={styles.refusalBody}>
        <Text style={[styles.refusalTitle, { color: theme.colors.text }]}>{refusal.title}</Text>
        <Text style={[styles.refusalDetail, { color: theme.colors.textMuted }]}>{refusal.detail}</Text>
        <View style={[styles.refusalRule, { backgroundColor: theme.colors.border }]} />
        <Text style={[styles.refusalActionLabel, { color: theme.colors.success, fontFamily: theme.typography.monoFamily }]}>다음 행동</Text>
        <Text style={[styles.refusalAction, { color: theme.colors.text }]}>{refusal.action}</Text>
        {actionLabel != null && onAction != null ? (
          <Pressable
            accessibilityLabel={actionLabel}
            accessibilityRole="button"
            onPress={onAction}
            style={({ pressed }) => [styles.refusalButton, { backgroundColor: theme.colors.primary, borderRadius: theme.radii.sm, opacity: pressed ? 0.72 : 1 }]}
            testID="refusal-record-action"
          >
            <Text style={[styles.refusalButtonLabel, { color: theme.colors.onPrimary }]}>{actionLabel}</Text>
          </Pressable>
        ) : null}
        <View style={[styles.refusalRule, { backgroundColor: theme.colors.border }]} />
        <Text style={[styles.refusalEvidenceLabel, { color: theme.colors.textMuted, fontFamily: theme.typography.monoFamily }]}>기계 근거</Text>
        <Text selectable style={[styles.refusalEvidence, { color: theme.colors.textMuted, fontFamily: theme.typography.monoFamily }]} testID="refusal-record-evidence">
          {[refusal.code, ...(occurredAtLabel == null ? [] : [occurredAtLabel]), ...(evidence ?? [])].join("\n")}
        </Text>
      </View>
    </View>
  );
}

const STAGE_OPACITY: Readonly<Record<FreshnessStage, number>> = Object.freeze({ FRESH: 1, AGING: 0.78, EXPIRING: 0.6, STALE: 0.55 });

/**
 * A number with its age attached. The two are one accessibility label, never two: read apart,
 * a screen-reader user hears a price and, separately, a duration with nothing binding them.
 *
 * Expiry is struck through rather than only recolored, so the state survives greyscale and
 * color-blind vision.
 */
export function FreshValue({ value, generatedAtMs, nowMs, source, unit, windowMs, testID }: Readonly<{ value: string; generatedAtMs: number; nowMs: number; source?: string; unit?: string; windowMs?: number; testID?: string }>) {
  const { theme } = useTheme();
  const stage = freshnessStage(generatedAtMs, nowMs, windowMs);
  const progress = freshnessProgress(generatedAtMs, nowMs, windowMs);
  const age = describeAge(generatedAtMs, nowMs);
  const stale = stage === "STALE";
  const tone = stale ? theme.colors.danger : stage === "EXPIRING" ? theme.colors.warning : stage === "AGING" ? theme.colors.info : theme.colors.success;
  return (
    <View
      accessibilityLabel={`${value}${unit == null ? "" : ` ${unit}`}, ${age}${stale ? ", 만료됨" : ""}`}
      accessibilityRole="text"
      style={styles.fresh}
      testID={testID ?? "fresh-value"}
    >
      <View style={styles.freshRow}>
        <Text style={[styles.freshValue, { color: stale ? theme.colors.textMuted : theme.colors.text, fontFamily: theme.typography.monoFamily, opacity: STAGE_OPACITY[stage] }, stale && styles.freshValueStale]}>{value}</Text>
        {unit == null ? null : <Text style={[styles.freshUnit, { color: theme.colors.textMuted }]}>{unit}</Text>}
      </View>
      <View style={styles.freshMeta}>
        <View style={[styles.freshDot, { backgroundColor: tone }]} />
        <Text style={[styles.freshAge, { color: tone, fontFamily: theme.typography.monoFamily }]}>{stale ? `${age} · 만료됨` : age}</Text>
      </View>
      <View style={[styles.freshTrack, { backgroundColor: theme.colors.surfaceSunken }]}>
        <View style={[styles.freshFill, { backgroundColor: tone, width: `${Math.round(progress * 100)}%` }]} />
      </View>
      {source == null ? null : <Text style={[styles.freshSource, { color: theme.colors.textMuted, fontFamily: theme.typography.monoFamily }]}>{source}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  spine: { flexDirection: "row", alignItems: "stretch", borderBottomWidth: 1 },
  spineAuthority: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 10, borderRightWidth: 1 },
  spineAuthorityLabel: { fontSize: 9, fontWeight: "700", letterSpacing: 0.8 },
  spineDivider: { width: 1, height: 9 },
  spineLamps: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 5, paddingHorizontal: 12, paddingVertical: 10 },
  lamp: { flexDirection: "row", alignItems: "center", gap: 4, borderWidth: 1, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 3, minHeight: 22 },
  lampDot: { width: 4, height: 4, borderRadius: 2 },
  lampLabel: { fontSize: 9, letterSpacing: 0.4 },
  lampLabelLit: { fontWeight: "700" },
  refusal: { borderWidth: 1, overflow: "hidden" },
  refusalHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, paddingHorizontal: 16, paddingVertical: 11, borderBottomWidth: 1 },
  refusalGate: { fontSize: 10, fontWeight: "700", letterSpacing: 1.1 },
  refusalSeverity: { fontSize: 9, borderWidth: 1, borderRadius: 3, paddingHorizontal: 6, paddingVertical: 2, overflow: "hidden" },
  refusalBody: { padding: 16, gap: 10 },
  refusalTitle: { fontSize: 16, fontWeight: "700", lineHeight: 22 },
  refusalDetail: { fontSize: 13, lineHeight: 21 },
  refusalRule: { height: 1 },
  refusalActionLabel: { fontSize: 10, letterSpacing: 1.1 },
  refusalAction: { fontSize: 13, lineHeight: 20 },
  refusalButton: { minHeight: 44, alignItems: "center", justifyContent: "center", paddingHorizontal: 16 },
  refusalButtonLabel: { fontSize: 14, fontWeight: "700" },
  refusalEvidenceLabel: { fontSize: 10, letterSpacing: 1.1 },
  refusalEvidence: { fontSize: 11, lineHeight: 18 },
  fresh: { gap: 6 },
  freshRow: { flexDirection: "row", alignItems: "baseline", gap: 6 },
  freshValue: { fontSize: 26, fontWeight: "700", letterSpacing: -0.4, fontVariant: ["tabular-nums"] },
  freshValueStale: { textDecorationLine: "line-through" },
  freshUnit: { fontSize: 14 },
  freshMeta: { flexDirection: "row", alignItems: "center", gap: 6 },
  freshDot: { width: 5, height: 5, borderRadius: 2.5 },
  freshAge: { fontSize: 10 },
  freshTrack: { height: 3, borderRadius: 2, overflow: "hidden" },
  freshFill: { height: 3, borderRadius: 2 },
  freshSource: { fontSize: 10, lineHeight: 16 }
});
