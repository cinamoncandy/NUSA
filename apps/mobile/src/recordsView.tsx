import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { MoreDestination } from "./navigationContract";
import { RECORDS_GROUPS } from "./recordsScreenModel";
import { CalmTitle } from "./uiKit";
import { calmColors } from "./uiKitModel";
import { labelFont, readableFont } from "./designSystem";

/** "기록" — calm redesign of the More menu. Same `onOpen` contract as MoreMenuView. */
export function RecordsView({ onOpen }: Readonly<{ onOpen: (destination: MoreDestination) => void }>) {
  return <ScrollView style={styles.screen} contentContainerStyle={styles.content} testID="records-view">
    <CalmTitle text="기록" />
    {RECORDS_GROUPS.map((group) => <View key={group.title} style={styles.group}>
      <Text style={styles.groupTitle}>{group.title}</Text>
      {group.items.map((item) => <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${item.title}, ${item.hint}`}
        key={item.destination}
        onPress={() => onOpen(item.destination)}
        style={({ pressed }) => [styles.row, { opacity: pressed ? 0.6 : 1 }]}
        testID={`more-${item.destination}`}
      >
        <View style={styles.rowMain}>
          <Text style={styles.rowTitle}>{item.title}</Text>
          <Text style={styles.hint}>{item.hint}</Text>
        </View>
        <Text style={styles.chevron}>›</Text>
      </Pressable>)}
    </View>)}
    <Text style={styles.footer}>모의투자 전용 · 실거래 잠김 · AI는 의견만</Text>
  </ScrollView>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: calmColors.ground },
  content: { paddingBottom: 40, width: "100%", maxWidth: 720, alignSelf: "center" },
  group: { paddingHorizontal: 20, marginTop: 14 },
  groupTitle: { color: calmColors.muted, fontSize: labelFont(12), marginBottom: 4 },
  row: { flexDirection: "row", alignItems: "center", minHeight: 60, paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: calmColors.line, gap: 12 },
  rowMain: { flex: 1, gap: 2 },
  rowTitle: { color: calmColors.text, fontSize: readableFont(16) },
  hint: { color: calmColors.muted, fontSize: readableFont(12) },
  chevron: { color: calmColors.muted, fontSize: 20 },
  footer: { color: calmColors.muted, fontSize: readableFont(12), paddingHorizontal: 20, marginTop: 24 },
});
