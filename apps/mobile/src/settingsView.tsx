import React, { useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { NusaButton, NusaCard } from "./components";
import { useTheme } from "./ThemeProvider";
import { DEFAULT_SETTINGS, normalizeSettings, type AppSettings, type LocaleSetting, type SettingsRepository, type ThemeSetting } from "./settings";

interface SettingsViewProps { readonly repository: SettingsRepository; }
const themes: readonly ThemeSetting[] = ["SYSTEM", "LIGHT", "DARK"];
const locales: readonly LocaleSetting[] = ["ko-KR", "en-US"];

export function SettingsView({ repository }: SettingsViewProps) {
  const { theme, setMode } = useTheme();
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    void repository.load().then((loaded) => { if (active) setSettings(loaded ?? DEFAULT_SETTINGS); }).catch((loadError) => { if (active) setError(loadError instanceof Error ? loadError.message : "Settings are unavailable."); });
    return () => { active = false; };
  }, [repository]);

  const persist = async (next: AppSettings): Promise<void> => {
    setSaving(true);
    try { const normalized = normalizeSettings(next); await repository.save(normalized); setSettings(normalized); setError(null); } catch (saveError) { setError(saveError instanceof Error ? saveError.message : "Settings could not be saved."); } finally { setSaving(false); }
  };
  const updateTheme = (next: ThemeSetting) => { setMode(next === "LIGHT" ? "light" : "dark"); if (settings) void persist({ ...settings, theme: next }); };
  const updateLocale = (locale: LocaleSetting) => { if (settings) void persist({ ...settings, locale }); };
  const updateNotification = (field: "enabled" | "riskAlerts" | "orderUpdates") => { if (settings) void persist({ ...settings, notifications: { ...settings.notifications, [field]: !settings.notifications[field] } }); };

  if (error && settings === null) return <View style={styles.state} testID="settings-error"><NusaCard><Text style={[styles.title, { color: theme.colors.danger }]}>Settings unavailable</Text><Text style={[styles.message, { color: theme.colors.textMuted }]}>{error}</Text><NusaButton label="Retry" onPress={() => { setError(null); void repository.load().then((loaded) => setSettings(loaded ?? DEFAULT_SETTINGS)).catch((loadError) => setError(loadError instanceof Error ? loadError.message : "Settings are unavailable.")); }} /></NusaCard></View>;
  if (settings === null) return <View style={styles.state} testID="settings-loading"><ActivityIndicator color={theme.colors.primary} /><Text style={[styles.title, { color: theme.colors.text }]}>Loading settings...</Text></View>;

  return <ScrollView contentContainerStyle={styles.content} testID="settings-screen"><View style={styles.header}><View><Text style={[styles.heading, { color: theme.colors.text }]}>Settings</Text><Text style={[styles.message, { color: theme.colors.textMuted }]}>NUSA application configuration</Text></View><Text style={[styles.mode, { color: theme.colors.success }]}>PAPER</Text></View>{error ? <Text style={[styles.error, { color: theme.colors.danger }]} testID="settings-save-error">{error}</Text> : null}<NusaCard testID="settings-theme"><Text style={[styles.section, { color: theme.colors.text }]}>Theme</Text><View style={styles.row}>{themes.map((value) => <NusaButton key={value} label={value} onPress={() => updateTheme(value)} tone={settings.theme === value ? "primary" : "neutral"} testID={`settings-theme-${value}`} />)}</View></NusaCard><NusaCard testID="settings-locale"><Text style={[styles.section, { color: theme.colors.text }]}>Language</Text><View style={styles.row}>{locales.map((value) => <NusaButton key={value} label={value} onPress={() => updateLocale(value)} tone={settings.locale === value ? "primary" : "neutral"} testID={`settings-locale-${value}`} />)}</View></NusaCard><NusaCard testID="settings-notifications"><Text style={[styles.section, { color: theme.colors.text }]}>Notifications</Text><View style={styles.settingRow}><Text style={[styles.message, { color: theme.colors.text }]}>Notifications</Text><NusaButton label={settings.notifications.enabled ? "On" : "Off"} onPress={() => updateNotification("enabled")} tone={settings.notifications.enabled ? "primary" : "neutral"} testID="settings-notifications-enabled" /></View><View style={styles.settingRow}><Text style={[styles.message, { color: theme.colors.text }]}>Risk alerts</Text><NusaButton label={settings.notifications.riskAlerts ? "On" : "Off"} onPress={() => updateNotification("riskAlerts")} tone={settings.notifications.riskAlerts ? "primary" : "neutral"} testID="settings-notifications-risk" /></View><View style={styles.settingRow}><Text style={[styles.message, { color: theme.colors.text }]}>Order updates</Text><NusaButton label={settings.notifications.orderUpdates ? "On" : "Off"} onPress={() => updateNotification("orderUpdates")} tone={settings.notifications.orderUpdates ? "primary" : "neutral"} testID="settings-notifications-orders" /></View></NusaCard><NusaCard testID="settings-mode"><Text style={[styles.section, { color: theme.colors.text }]}>Trading Mode</Text><Text style={[styles.modeValue, { color: theme.colors.success }]}>PAPER</Text><Text style={[styles.message, { color: theme.colors.textMuted }]}>Live trading is disabled by policy.</Text></NusaCard><NusaCard testID="settings-about"><Text style={[styles.section, { color: theme.colors.text }]}>About</Text><Text style={[styles.message, { color: theme.colors.textMuted }]}>NUSA Mobile 0.1.0</Text><Text style={[styles.message, { color: theme.colors.textMuted }]}>Paper Trading client</Text></NusaCard><NusaCard testID="settings-reset"><Text style={[styles.section, { color: theme.colors.text }]}>Data</Text><Text style={[styles.message, { color: theme.colors.textMuted }]}>Reset application settings to defaults.</Text><NusaButton label={saving ? "Saving..." : "Reset Settings"} disabled={saving} onPress={() => void persist(DEFAULT_SETTINGS)} tone="danger" testID="settings-reset-button" /></NusaCard></ScrollView>;
}

const styles = StyleSheet.create({ content: { padding: 20, gap: 14, paddingBottom: 28 }, state: { flex: 1, justifyContent: "center", padding: 20, gap: 14 }, heading: { fontSize: 28, fontWeight: "800" }, title: { fontSize: 18, fontWeight: "700" }, section: { fontSize: 18, fontWeight: "700", marginBottom: 12 }, message: { lineHeight: 22 }, header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" }, row: { flexDirection: "row", flexWrap: "wrap", gap: 8 }, settingRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 10 }, mode: { fontSize: 16, fontWeight: "800" }, modeValue: { fontSize: 24, fontWeight: "800", marginBottom: 4 }, error: { padding: 12, backgroundColor: "#450a0a", borderRadius: 8 } });
