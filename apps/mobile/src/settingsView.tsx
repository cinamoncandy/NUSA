import React, { useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { DataRow, NusaButton, NusaCard, SectionHeading, StatusChip } from "./components";
import { useTheme } from "./ThemeProvider";
import { DEFAULT_SETTINGS, normalizeSettings, type AppSettings, type LocaleSetting, type SettingsRepository, type ThemeSetting } from "./settings";

interface SettingsViewProps { readonly repository: SettingsRepository; }
const themes: readonly ThemeSetting[] = ["SYSTEM", "LIGHT", "DARK"];
const locales: readonly LocaleSetting[] = ["ko-KR", "en-US"];
const themeLabels: Readonly<Record<ThemeSetting, string>> = { SYSTEM: "시스템", LIGHT: "라이트", DARK: "다크" };
const localeLabels: Readonly<Record<LocaleSetting, string>> = { "ko-KR": "한국어", "en-US": "English" };

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

  if (error && settings === null) return <View style={styles.state} testID="settings-error"><NusaCard><Text style={[styles.title, { color: theme.colors.danger }]}>설정을 불러올 수 없습니다</Text><Text style={[styles.message, { color: theme.colors.textMuted }]}>{error}</Text><NusaButton label="다시 시도" onPress={() => { setError(null); void repository.load().then((loaded) => setSettings(loaded ?? DEFAULT_SETTINGS)).catch((loadError) => setError(loadError instanceof Error ? loadError.message : "Settings are unavailable.")); }} /></NusaCard></View>;
  if (settings === null) return <View style={styles.state} testID="settings-loading"><ActivityIndicator color={theme.colors.primary} /><Text style={[styles.title, { color: theme.colors.text }]}>설정을 불러오는 중</Text></View>;

  return <ScrollView contentContainerStyle={styles.content} testID="settings-screen">
    <View style={styles.header}><SectionHeading eyebrow="APPLICATION" title="설정" description="화면과 로컬 알림 설정을 관리합니다." /><StatusChip label="PAPER" tone="primary" /></View>
    {error ? <View style={[styles.error, { backgroundColor: theme.colors.surfaceSunken, borderColor: theme.colors.danger }]} testID="settings-save-error"><Text style={{ color: theme.colors.danger }}>{error}</Text></View> : null}
    <NusaCard testID="settings-theme"><Text style={[styles.section, { color: theme.colors.text }]}>화면 테마</Text><View style={styles.row}>{themes.map((value) => <NusaButton key={value} label={themeLabels[value]} onPress={() => updateTheme(value)} tone={settings.theme === value ? "primary" : "neutral"} testID={`settings-theme-${value}`} />)}</View></NusaCard>
    <NusaCard testID="settings-locale"><Text style={[styles.section, { color: theme.colors.text }]}>언어</Text><View style={styles.row}>{locales.map((value) => <NusaButton key={value} label={localeLabels[value]} onPress={() => updateLocale(value)} tone={settings.locale === value ? "primary" : "neutral"} testID={`settings-locale-${value}`} />)}</View><Text style={[styles.hint, { color: theme.colors.textMuted }]}>UIUX-001 기본 IA는 한국어 우선입니다. 저장된 locale 값은 기존 계약을 유지합니다.</Text></NusaCard>
    <NusaCard testID="settings-notifications"><Text style={[styles.section, { color: theme.colors.text }]}>알림</Text><View style={styles.settingRow}><Text style={[styles.message, { color: theme.colors.text }]}>전체 알림</Text><NusaButton label={settings.notifications.enabled ? "켜짐" : "꺼짐"} onPress={() => updateNotification("enabled")} tone={settings.notifications.enabled ? "primary" : "neutral"} testID="settings-notifications-enabled" /></View><View style={styles.settingRow}><Text style={[styles.message, { color: theme.colors.text }]}>리스크 알림</Text><NusaButton label={settings.notifications.riskAlerts ? "켜짐" : "꺼짐"} onPress={() => updateNotification("riskAlerts")} tone={settings.notifications.riskAlerts ? "primary" : "neutral"} testID="settings-notifications-risk" /></View><View style={styles.settingRow}><Text style={[styles.message, { color: theme.colors.text }]}>주문 상태 업데이트</Text><NusaButton label={settings.notifications.orderUpdates ? "켜짐" : "꺼짐"} onPress={() => updateNotification("orderUpdates")} tone={settings.notifications.orderUpdates ? "primary" : "neutral"} testID="settings-notifications-orders" /></View></NusaCard>
    <NusaCard testID="settings-mode" raised><View style={styles.modeHeader}><Text style={[styles.section, { color: theme.colors.text, marginBottom: 0 }]}>거래 권한</Text><StatusChip label="READ ONLY" tone="info" /></View><DataRow label="운영 모드" value="PAPER" emphasis /><DataRow label="LIVE 주문" value="금지" tone="success" /><Text style={[styles.hint, { color: theme.colors.textMuted }]}>LIVE trading은 정책상 비활성입니다. 이 설정 화면에서 권한을 승격할 수 없습니다.</Text></NusaCard>
    <NusaCard testID="settings-about"><Text style={[styles.section, { color: theme.colors.text }]}>앱 정보</Text><DataRow label="클라이언트" value="NUSA Mobile 0.1.0" /><DataRow label="용도" value="PAPER / Read Only" /></NusaCard>
    <NusaCard testID="settings-reset"><Text style={[styles.section, { color: theme.colors.text }]}>로컬 설정 초기화</Text><Text style={[styles.hint, { color: theme.colors.textMuted }]}>앱 설정만 기본값으로 되돌립니다.</Text><NusaButton label={saving ? "저장 중..." : "설정 초기화"} disabled={saving} onPress={() => void persist(DEFAULT_SETTINGS)} tone="danger" testID="settings-reset-button" /></NusaCard>
  </ScrollView>;
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingTop: 18, gap: 14, paddingBottom: 32 },
  state: { flex: 1, justifyContent: "center", padding: 20, gap: 14 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 12 },
  title: { fontSize: 18, fontWeight: "700" },
  section: { fontSize: 18, fontWeight: "700", marginBottom: 12, letterSpacing: -0.4 },
  message: { lineHeight: 21 },
  hint: { lineHeight: 20, fontSize: 13, marginTop: 10 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  settingRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 10, gap: 12 },
  modeHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 10 },
  error: { padding: 12, borderRadius: 10, borderWidth: 1 },
});
