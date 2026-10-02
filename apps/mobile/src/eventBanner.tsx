import React, { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTheme } from "./ThemeProvider";
import { fieldFonts } from "./fieldFonts";
import { advanceBanner, type Banner, type BannerCursor, type BannerEvent } from "./eventBannerModel";

const SHOW_MS = 6000;

interface Props {
  /** Only a confirmed server snapshot advances the banner; a pending or failed load is ignored. */
  readonly ready: boolean;
  /** PAPER endpoint identity; a change re-baselines so another server's history never banners. */
  readonly sourceKey: string;
  readonly events: readonly BannerEvent[];
  readonly halted: boolean;
}

/** A short banner under the safety line on every tab when a new PAPER fill or halt arrives. Tap to dismiss. */
export function EventBanner({ ready, sourceKey, events, halted }: Readonly<Props>) {
  const { theme } = useTheme();
  const cursor = useRef<{ key: string; value: BannerCursor | null }>({ key: sourceKey, value: null });
  const [banner, setBanner] = useState<Banner | null>(null);

  useEffect(() => {
    if (cursor.current.key !== sourceKey) { cursor.current = { key: sourceKey, value: null }; setBanner(null); }
    if (!ready) return;
    const step = advanceBanner(cursor.current.value, events, halted);
    cursor.current = { key: sourceKey, value: step.cursor };
    if (step.banner != null) setBanner(step.banner);
  }, [ready, sourceKey, events, halted]);

  useEffect(() => {
    if (banner == null) return;
    const timer = setTimeout(() => setBanner(null), SHOW_MS);
    return () => clearTimeout(timer);
  }, [banner]);

  if (banner == null) return null;
  const color = banner.tone === "halt" ? theme.colors.danger : theme.colors.success;
  return <Pressable onPress={() => setBanner(null)} accessibilityRole="alert" accessibilityLiveRegion="assertive" accessibilityLabel={`PAPER. ${banner.title}. ${banner.detail}`} testID="event-banner" style={[styles.row, { backgroundColor: theme.colors.surface, borderColor: color }]}>
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
