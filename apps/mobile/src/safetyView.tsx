import React, { useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import type { LiveReadinessMonitorViewProps } from "./liveReadinessMonitorView";
import { buildLiveGates } from "./liveGateModel";
import { liveUnavailableMessage } from "./fieldScreensModel";
import { buildSafetyScreen } from "./safetyScreenModel";
import { CalmRow, CalmTitle } from "./uiKit";
import { calmColors } from "./uiKitModel";
import { readableFont } from "./designSystem";

/** "안전" — calm redesign of the LIVE tab. Read-only: it has no action that enables LIVE or mutates anything. */
export function SafetyView({ snapshot, unavailableReason, unavailableKind = "FAILED", refreshing, onRefresh }: LiveReadinessMonitorViewProps) {
  const [open, setOpen] = useState(false);
  const model = buildSafetyScreen(buildLiveGates(snapshot), snapshot?.blockers ?? []);
  return <ScrollView style={styles.screen} contentContainerStyle={styles.content} refreshControl={<RefreshControl tintColor={calmColors.text} refreshing={refreshing} onRefresh={() => { void onRefresh(); }} />} testID="safety-view">
    <CalmTitle text="안전" />
    <View style={styles.list}>
      {model.rows.map((row) => <CalmRow key={row.label} label={row.label} hint={row.hint} value={row.value} tone={row.tone} />)}
      {snapshot == null ? <CalmRow label="실거래 준비 정보" hint={liveUnavailableMessage(unavailableKind)} value="받지 못함" tone="ATTENTION" /> : null}
    </View>
    <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => setOpen((value) => !value)} style={styles.fold} testID="safety-advanced-toggle">
      <Text style={styles.foldText}>고급 진단 (영문 원문·코드)</Text><Text style={styles.foldText}>{open ? "접기" : "펼치기"}</Text>
    </Pressable>
    {open ? <View style={styles.advanced} testID="safety-advanced">
      {model.advanced.map((line) => <Text key={line} style={styles.code}>{line}</Text>)}
      {unavailableReason ? <Text style={styles.code}>reason: {unavailableReason}</Text> : null}
      <Text style={styles.code}>liveAuthority=NONE · productionMutationAllowed=false · AI=ZERO_AUTHORITY</Text>
    </View> : null}
    <Text style={styles.footer}>이 화면은 읽기만 해요. 실거래를 켜는 버튼은 없어요.</Text>
  </ScrollView>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: calmColors.ground },
  content: { paddingBottom: 40, width: "100%", maxWidth: 720, alignSelf: "center" },
  list: { paddingHorizontal: 20 },
  fold: { marginHorizontal: 20, minHeight: 48, flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: calmColors.line },
  foldText: { color: calmColors.muted, fontSize: readableFont(13) },
  advanced: { marginHorizontal: 20, gap: 6, paddingBottom: 8 },
  code: { color: calmColors.muted, fontSize: readableFont(12), fontFamily: "monospace" },
  footer: { color: calmColors.muted, fontSize: readableFont(12), paddingHorizontal: 20, marginTop: 20 },
});
