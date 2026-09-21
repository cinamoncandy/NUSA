import React, { useEffect, useState } from "react";
import { Linking, StyleSheet, Text, View } from "react-native";
import { NusaButton } from "./components";
import { useTheme } from "./ThemeProvider";
import { BUILD_SOURCE_SHA } from "./generatedBuildConfig";

type BuildFreshness = "CURRENT" | "STALE" | "UNKNOWN";

const stableReleaseApi = "https://api.github.com/repos/cinamoncandy/NUSA/releases/tags/nusa-android";
const stableApkUrl = "https://github.com/cinamoncandy/NUSA/releases/download/nusa-android/NUSA-Android.apk";
const validBuildSha = /^[0-9a-f]{40}$/i.test(BUILD_SOURCE_SHA);
const buildLabel = validBuildSha ? BUILD_SOURCE_SHA.slice(0, 8) : "dev";

/**
 * Which build is installed, and whether a newer stable APK exists. This is read-only: it reads a
 * public GitHub release and can open a download URL. It carries no credential and grants no trading
 * or account authority of any kind.
 *
 * Freshness fails closed. A failed or malformed lookup stays UNKNOWN and claims nothing; only an
 * exact 40-hex mismatch against the release target reports 업데이트 필요.
 */
export function BuildSourceNotice() {
  const { theme } = useTheme();
  const [freshness, setFreshness] = useState<BuildFreshness>("UNKNOWN");

  useEffect(() => {
    if (!validBuildSha) return;
    let active = true;
    void fetch(stableReleaseApi, { headers: { Accept: "application/vnd.github+json" } })
      .then(async (response) => {
        if (!response.ok) throw new Error(`stable release lookup failed: ${response.status}`);
        const payload = await response.json() as { target_commitish?: unknown };
        const target = typeof payload.target_commitish === "string" ? payload.target_commitish : "";
        if (!/^[0-9a-f]{40}$/i.test(target)) throw new Error("stable release target is invalid");
        if (active) setFreshness(target.toLowerCase() === BUILD_SOURCE_SHA.toLowerCase() ? "CURRENT" : "STALE");
      })
      .catch(() => { if (active) setFreshness("UNKNOWN"); });
    return () => { active = false; };
  }, []);

  return <View style={[styles.row, { borderTopColor: theme.colors.border }]} testID="build-source-notice">
    <Text style={[styles.build, { color: freshness === "STALE" ? theme.colors.danger : theme.colors.textMuted }]} testID="mobile-build-source">빌드 {buildLabel}{freshness === "STALE" ? " · 업데이트 필요" : freshness === "CURRENT" ? " · 최신" : ""}</Text>
    {freshness === "STALE" ? <NusaButton label="업데이트" tone="primary" onPress={() => { void Linking.openURL(stableApkUrl); }} testID="mobile-update-action" /> : null}
  </View>;
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 48, paddingHorizontal: 20, paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth, flexWrap: "wrap" },
  build: { fontSize: 11, lineHeight: 16, fontWeight: "700", fontVariant: ["tabular-nums"] },
});
