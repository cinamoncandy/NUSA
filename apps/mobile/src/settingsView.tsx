import React, { useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { DataRow, NusaButton, NusaCard, NusaTextField, SectionHeading, StatusChip } from "./components";
import { useTheme, type ThemePreference } from "./ThemeProvider";
import { cashReservePercent, DEFAULT_SETTINGS, normalizeInvestmentPercent, normalizeSettings, type AppSettings, type SettingsRepository, type ThemeSetting } from "./settings";

interface SettingsViewProps {
  readonly repository: SettingsRepository;
  readonly onSignOut?: () => void;
}

const themes: readonly ThemeSetting[] = ["SYSTEM", "LIGHT", "DARK"];
const themeLabels: Readonly<Record<ThemeSetting, string>> = { SYSTEM: "시스템", LIGHT: "라이트", DARK: "다크" };
const themePreference = (value: ThemeSetting): ThemePreference => value === "SYSTEM" ? "system" : value === "LIGHT" ? "light" : "dark";

export function SettingsView({ repository, onSignOut }: SettingsViewProps) {
  const { theme, setMode } = useTheme();
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [investmentPercentDraft, setInvestmentPercentDraft] = useState(String(DEFAULT_SETTINGS.capitalAllocation.investmentPercent));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    void repository.load().then((loaded) => {
      if (!active) return;
      const next = loaded ?? DEFAULT_SETTINGS;
      setSettings(next);
      setInvestmentPercentDraft(String(next.capitalAllocation.investmentPercent));
      setMode(themePreference(next.theme));
    }).catch((loadError) => { if (active) setError(loadError instanceof Error ? loadError.message : "Settings are unavailable."); });
    return () => { active = false; };
  }, [repository, setMode]);

  const persist = async (next: AppSettings): Promise<boolean> => {
    setSaving(true);
    try {
      const normalized = normalizeSettings(next);
      await repository.save(normalized);
      setSettings(normalized);
      setInvestmentPercentDraft(String(normalized.capitalAllocation.investmentPercent));
      setError(null);
      return true;
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Settings could not be saved.");
      return false;
    } finally {
      setSaving(false);
    }
  };
  const updateTheme = (next: ThemeSetting) => {
    if (!settings) return;
    const previousTheme = settings.theme;
    setMode(themePreference(next));
    void persist({ ...settings, theme: next }).then((saved) => { if (!saved) setMode(themePreference(previousTheme)); });
  };
  const updateNotification = (field: "enabled" | "riskAlerts" | "orderUpdates") => { if (settings) void persist({ ...settings, notifications: { ...settings.notifications, [field]: !settings.notifications[field] } }); };
  const saveCapitalAllocation = () => {
    if (!settings) return;
    const parsed = Number(investmentPercentDraft.trim());
    try {
      const investmentPercent = normalizeInvestmentPercent(parsed);
      void persist({ ...settings, capitalAllocation: { investmentPercent } });
    } catch (allocationError) {
      setError(allocationError instanceof Error ? allocationError.message : "Investment allocation is invalid.");
    }
  };
  const resetSettings = () => {
    if (!settings) return;
    const previousTheme = settings.theme;
    setMode("system");
    void persist(DEFAULT_SETTINGS).then((saved) => { if (!saved) setMode(themePreference(previousTheme)); });
  };

  if (error && settings === null) return <View style={styles.state} testID="settings-error"><NusaCard><Text style={[styles.title, { color: theme.colors.danger }]}>설정을 불러올 수 없습니다</Text><Text style={[styles.message, { color: theme.colors.textMuted }]}>{error}</Text><NusaButton label="다시 시도" onPress={() => { setError(null); void repository.load().then((loaded) => { const next = loaded ?? DEFAULT_SETTINGS; setSettings(next); setInvestmentPercentDraft(String(next.capitalAllocation.investmentPercent)); setMode(themePreference(next.theme)); }).catch((loadError) => setError(loadError instanceof Error ? loadError.message : "Settings are unavailable.")); }} /></NusaCard></View>;
  if (settings === null) return <View style={styles.state} testID="settings-loading"><ActivityIndicator color={theme.colors.primary} /><Text style={[styles.title, { color: theme.colors.text }]}>설정을 불러오는 중</Text></View>;

  const reservePercent = cashReservePercent(settings.capitalAllocation.investmentPercent);

  return <ScrollView contentContainerStyle={styles.content} testID="settings-screen">
    <View style={styles.header}><SectionHeading eyebrow="APPLICATION" title="설정" description="화면, 투자 자본, 로컬 알림, 로컬 세션을 관리합니다." /><StatusChip label="PAPER" tone="primary" /></View>
    {error ? <View style={[styles.error, { backgroundColor: theme.colors.surfaceSunken, borderColor: theme.colors.danger }]} testID="settings-save-error"><Text style={{ color: theme.colors.danger }}>{error}</Text></View> : null}
    <NusaCard testID="settings-capital-allocation" raised>
      <Text style={[styles.section, { color: theme.colors.text }]}>현금 투자 비중</Text>
      <DataRow label="투자" value={`${settings.capitalAllocation.investmentPercent}%`} emphasis />
      <DataRow label="현금 보유" value={`${reservePercent}%`} emphasis />
      <NusaTextField accessibilityLabel="투자 비중 퍼센트" label="투자할 현금 비중 (0~100%)" onChangeText={setInvestmentPercentDraft} placeholder="예: 60" testID="settings-investment-percent" value={investmentPercentDraft} />
      <View style={styles.allocationActions}><NusaButton disabled={saving} label={saving ? "저장 중..." : "비중 저장"} onPress={saveCapitalAllocation} testID="settings-investment-percent-save" /></View>
      <Text style={[styles.hint, { color: theme.colors.textMuted }]}>거래소에 있는 현금 중 이 비율만 신규 투자에 사용할 수 있습니다. 나머지는 현금으로 보호하며, 현금 보유 비중은 자동으로 100%에서 투자 비중을 뺀 값이 됩니다.</Text>
    </NusaCard>
    <NusaCard testID="settings-theme"><Text style={[styles.section, { color: theme.colors.text }]}>화면 테마</Text><View style={styles.row}>{themes.map((value) => <NusaButton key={value} disabled={saving} label={themeLabels[value]} onPress={() => updateTheme(value)} tone={settings.theme === value ? "primary" : "neutral"} testID={`settings-theme-${value}`} />)}</View><Text style={[styles.hint, { color: theme.colors.textMuted }]}>시스템을 선택하면 기기의 라이트·다크 설정을 그대로 따릅니다.</Text></NusaCard>
    <NusaCard testID="settings-notifications"><Text style={[styles.section, { color: theme.colors.text }]}>알림</Text><View style={styles.settingRow}><Text style={[styles.message, { color: theme.colors.text }]}>전체 알림</Text><NusaButton disabled={saving} label={settings.notifications.enabled ? "켜짐" : "꺼짐"} onPress={() => updateNotification("enabled")} tone={settings.notifications.enabled ? "primary" : "neutral"} testID="settings-notifications-enabled" /></View><View style={styles.settingRow}><Text style={[styles.message, { color: theme.colors.text }]}>리스크 알림</Text><NusaButton disabled={saving} label={settings.notifications.riskAlerts ? "켜짐" : "꺼짐"} onPress={() => updateNotification("riskAlerts")} tone={settings.notifications.riskAlerts ? "primary" : "neutral"} testID="settings-notifications-risk" /></View><View style={styles.settingRow}><Text style={[styles.message, { color: theme.colors.text }]}>주문 상태 업데이트</Text><NusaButton disabled={saving} label={settings.notifications.orderUpdates ? "켜짐" : "꺼짐"} onPress={() => updateNotification("orderUpdates")} tone={settings.notifications.orderUpdates ? "primary" : "neutral"} testID="settings-notifications-orders" /></View></NusaCard>
    <NusaCard testID="settings-mode" raised><View style={styles.modeHeader}><Text style={[styles.section, { color: theme.colors.text, marginBottom: 0 }]}>거래 권한</Text><StatusChip label="READ ONLY" tone="info" /></View><DataRow label="운영 모드" value="PAPER" emphasis /><DataRow label="LIVE 주문" value="금지" tone="success" /><Text style={[styles.hint, { color: theme.colors.textMuted }]}>LIVE trading은 정책상 비활성입니다. 이 설정 화면에서 권한을 승격할 수 없습니다.</Text></NusaCard>
    <NusaCard testID="settings-about"><Text style={[styles.section, { color: theme.colors.text }]}>앱 정보</Text><DataRow label="클라이언트" value="NUSA Mobile 0.1.0" /><DataRow label="용도" value="PAPER / Read Only" /></NusaCard>
    <NusaCard testID="settings-reset"><Text style={[styles.section, { color: theme.colors.text }]}>로컬 설정 초기화</Text><Text style={[styles.hint, { color: theme.colors.textMuted }]}>앱 설정만 기본값으로 되돌립니다.</Text><NusaButton label={saving ? "저장 중..." : "설정 초기화"} disabled={saving} onPress={resetSettings} tone="danger" testID="settings-reset-button" /></NusaCard>
    {onSignOut ? <NusaCard testID="settings-session"><Text style={[styles.section, { color: theme.colors.text }]}>로컬 세션</Text><Text style={[styles.hint, { color: theme.colors.textMuted }]}>로그아웃하면 로컬 화면 세션을 종료하고 메모리에 있는 읽기 전용 대시보드 자격 증명도 지웁니다.</Text><NusaButton label="로그아웃" onPress={onSignOut} tone="neutral" testID="settings-sign-out" /></NusaCard> : null}
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
  allocationActions: { marginTop: 10, alignItems: "flex-start" },
  settingRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 10, gap: 12 },
  modeHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 10 },
  error: { padding: 12, borderRadius: 10, borderWidth: 1 },
});
