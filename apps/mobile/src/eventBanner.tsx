import React, { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTheme } from "./ThemeProvider";
import { fieldFonts } from "./fieldFonts";
import { buildJournal, type JournalEventInput } from "./journalModel";
import { bannerBaseline, pickBanner, type Banner } from "./eventBannerModel";

const SHOW_MS = 6000;

/** A short banner under the safety line on every tab when a new PAPER fill or halt arrives. Tap to dismiss. */
export function EventBanner({ events }: Readonly<{ events: readonly JournalEventInput[] }>) {
  const { theme } = useTheme();
  const entries = useMemo(() => buildJournal(events, 20), [events]);
  const [since, setSince] = useState<number | null>(null);
  const [banner, setBanner] = useState<Banner | null>(null);

  useEffect(() => {
    if (entries.length === 0) return;
    if (since == null) { setSince(bannerBaseline(entries)); return; }
    const next = pickBanner(entries, since);
    if (next == null) return;
    setBanner(next);
    setSince(bannerBaseline(entries));
  }, [entries, since]);

  useEffect(() => {
    if (banner == null) return;
    const timer = setTimeout(() => setBanner(null), SHOW_MS);
    return () => clearTimeout(timer);
  }, [banner]);

  if (banner == null) return null;
  const color = banner.tone === "halt" ? theme.colors.danger : theme.colors.success;
  return <Pressable onPress={() => setBanner(null)} accessibilityRole="alert" accessibilityLabel={`${banner.title}. ${banner.detail}`} testID="event-banner" style={[styles.row, { backgroundColor: theme.colors.surface, borderColor: color }]}>
    <View style={[styles.bar, { backgroundColor: color }]} />
    <View style={styles.text}>
      <Text style={[fieldFonts.monoMedium, styles.title, { color: theme.colors.text }]} numberOfLines={1}>{banner.title}</Text>
      <Text style={[fieldFonts.mono, styles.detail, { color: theme.colors.textMuted }]} numberOfLines={1}>{banner.detail} · PAPER</Text>
    </View>
  </Pressable>;
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 10, marginHorizontal: 16, marginTop: 8, paddingVertical: 10, paddingRight: 12, borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, overflow: "hidden" },
  bar: { width: 4, alignSelf: "stretch" },
  text: { flex: 1, gap: 2 },
  title: { fontSize: 13 },
  detail: { fontSize: 11 },
});
