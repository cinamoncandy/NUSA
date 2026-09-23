import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { masterReferenceColors, wealthProductColors } from "./designSystem";
import { MasterHeroImage } from "./masterHeroImage";

const CANVAS = masterReferenceColors.canvas;
const ACCENT_SOFT = masterReferenceColors.accentSoft;
const TEXT = wealthProductColors.c06;
const MUTED = wealthProductColors.c04;
const BORDER = wealthProductColors.c03;
const PANEL = wealthProductColors.c02;

/** Destinations the concept board's More screen leads to, beyond the five primary tabs. */
export type MoreDestination = "PORTFOLIO" | "RISK" | "PERFORMANCE" | "PAPER" | "HISTORY" | "NOTIFICATIONS" | "SETTINGS" | "HELP";
export type MorePrimaryDestination = "Signals" | "Strategies";

interface MoreMenuViewProps {
  readonly onSelect: (destination: MoreDestination) => void;
  readonly onNavigatePrimary: (destination: MorePrimaryDestination) => void;
  readonly buildLabel: string;
}

const ITEMS = [
  { key: "AI_ANALYSIS", title: "AI Analysis", detail: "Evidence-based insights", kind: "PRIMARY", destination: "Signals" },
  { key: "RESEARCH", title: "Research", detail: "Backtest & Validate", kind: "PRIMARY", destination: "Strategies" },
  { key: "NOTIFICATIONS", title: "System Status", detail: "Runtime health and alerts", kind: "UTILITY", destination: "NOTIFICATIONS" },
  { key: "SETTINGS", title: "Settings", detail: "Preferences", kind: "UTILITY", destination: "SETTINGS" },
  { key: "HELP", title: "Help", detail: "Documentation", kind: "UTILITY", destination: "HELP" },
] as const;

const INSIGHTS = [
  { key: "PORTFOLIO", title: "Portfolio" },
  { key: "RISK", title: "Risk" },
  { key: "PERFORMANCE", title: "Performance" },
] as const;

const OPERATIONS = [
  { key: "PAPER", title: "PAPER Report" },
  { key: "HISTORY", title: "Order History" },
] as const;

/**
 * The concept board's More screen: an identity card, a list of deeper destinations, and an explicit
 * authority footer. Decorative landscape imagery carries no market or authority semantics.
 */
export function MoreMenuView({ onSelect, onNavigatePrimary, buildLabel }: MoreMenuViewProps) {
  return <ScrollView style={{ backgroundColor: CANVAS }} contentContainerStyle={styles.content} testID="more-screen">
    <Text style={styles.title}>More</Text>

    <View style={styles.identity} testID="more-identity">
      <View style={styles.identityLead}>
        <Text style={styles.identityName}>NUSA</Text>
        <Text style={styles.identityKicker}>Intelligence OS</Text>
        <Text style={styles.identityTag}>Markets. Signals. Evidence.</Text>
      </View>
      <View style={styles.modeChip}><Text style={styles.modeChipText}>PAPER MODE</Text></View>
    </View>

    <View style={styles.list} testID="more-destinations">
      {ITEMS.map((item, index) => <Pressable
        key={item.key}
        accessibilityRole="button"
        accessibilityLabel={item.title}
        accessibilityHint={item.detail}
        onPress={() => item.kind === "PRIMARY" ? onNavigatePrimary(item.destination) : onSelect(item.destination)}
        style={({ pressed }) => [styles.item, index === ITEMS.length - 1 ? styles.itemLast : null, { opacity: pressed ? 0.7 : 1 }]}
        testID={`more-${item.key.toLowerCase()}`}
      >
        <View style={styles.itemGlyph}><Text style={styles.itemGlyphText}>{item.title.slice(0,1)}</Text></View>
        <View style={styles.itemLead}><Text style={styles.itemTitle}>{item.title}</Text><Text style={styles.itemDetail} numberOfLines={1}>{item.detail}</Text></View>
        <Text style={styles.itemChevron}>›</Text>
      </Pressable>)}
    </View>

    <View style={styles.insightRail} testID="more-insight-rail">
      {INSIGHTS.map((item)=><Pressable key={item.key} onPress={()=>onSelect(item.key)} style={styles.insightCard} testID={`more-${item.key.toLowerCase()}`}><Text style={styles.insightTitle}>{item.title}</Text><Text style={styles.insightMeta}>Verified PAPER insight</Text></Pressable>)}
    </View>

    <View style={styles.operationsRail} testID="more-operations-rail">
      {OPERATIONS.map((item)=><Pressable key={item.key} onPress={()=>onSelect(item.key)} style={styles.operationChip} testID={`more-${item.key.toLowerCase()}`}><Text style={styles.operationText}>{item.title}</Text></Pressable>)}
    </View>

    <MasterHeroImage asset="moreLandscape" style={styles.authorityLandscape} imageStyle={styles.authorityLandscapeImage} scrimOpacity={0.38} testID="more-master-landscape">
      <View style={styles.authority} testID="more-authority">
        <Text style={styles.authorityLine}>PAPER ONLY</Text>
        <Text style={styles.authorityLine}>AI ZERO AUTHORITY</Text>
        <Text style={styles.authorityLine}>REAL DATA ONLY</Text>
      </View>
    </MasterHeroImage>

    <Text style={styles.build} testID="more-build-source">빌드 {buildLabel}</Text>
  </ScrollView>;
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 120, gap: 16 },
  title: { color: TEXT, fontSize: 30, lineHeight: 38, fontWeight: "700", letterSpacing: -0.6 },
  identity: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 12, borderWidth: 1, borderColor: BORDER, borderRadius: 14, backgroundColor: PANEL, padding: 16 },
  identityLead: { flex: 1, minWidth: 180 },
  identityName: { color: TEXT, fontSize: 20, lineHeight: 26, fontWeight: "800", letterSpacing: 1.5 },
  identityKicker: { color: MUTED, fontSize: 11, lineHeight: 16, fontWeight: "700" },
  identityTag: { color: MUTED, fontSize: 10, lineHeight: 15, marginTop: 2 },
  modeChip: { flexShrink: 0, minHeight: 26, borderWidth: 1, borderColor: ACCENT_SOFT, borderRadius: 999, paddingHorizontal: 10, justifyContent: "center" },
  modeChipText: { color: ACCENT_SOFT, fontSize: 9, fontWeight: "900", letterSpacing: 0.7, paddingRight: 1 },
  list: { borderWidth: 1, borderColor: BORDER, borderRadius: 14, backgroundColor: PANEL, overflow: "hidden" },
  item: { minHeight: 58, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: BORDER },
  itemGlyph: { width: 30, height: 30, borderRadius: 9, borderWidth: 1, borderColor: BORDER, backgroundColor: wealthProductColors.c71, alignItems: "center", justifyContent: "center" },
  itemGlyphText: { color: ACCENT_SOFT, fontSize: 10, fontWeight: "900" },
  itemLast: { borderBottomWidth: 0 },
  itemLead: { flex: 1, minWidth: 0 },
  itemTitle: { color: TEXT, fontSize: 14, lineHeight: 20, fontWeight: "700" },
  itemDetail: { color: MUTED, fontSize: 11, lineHeight: 16 },
  itemChevron: { color: MUTED, fontSize: 20, fontWeight: "300" },
  insightRail: { flexDirection: "row", gap: 8 },
  insightCard: { flex: 1, minHeight: 64, borderWidth: 1, borderColor: BORDER, borderRadius: 12, backgroundColor: PANEL, padding: 12, justifyContent: "center" },
  insightTitle: { color: TEXT, fontSize: 12, fontWeight: "800" }, insightMeta: { color: MUTED, fontSize: 8, marginTop: 3 },
  operationsRail: { flexDirection: "row", gap: 8 },
  operationChip: { flex: 1, minHeight: 38, borderWidth: 1, borderColor: BORDER, borderRadius: 10, backgroundColor: wealthProductColors.c72, alignItems: "center", justifyContent: "center" },
  operationText: { color: MUTED, fontSize: 8, fontWeight: "800", letterSpacing: 0.3 },
  authorityLandscape: { minHeight: 136, borderWidth: 1, borderColor: BORDER, borderRadius: 14, justifyContent: "flex-end" },
  authorityLandscapeImage: { borderRadius: 14 },
  authority: { paddingVertical: 16, paddingHorizontal: 16, gap: 4, alignItems: "flex-start" },
  authorityLine: { color: wealthProductColors.c118, fontSize: 10, lineHeight: 16, fontWeight: "800", letterSpacing: 1.6 },
  build: { color: MUTED, fontSize: 10, textAlign: "center", fontVariant: ["tabular-nums"] },
});