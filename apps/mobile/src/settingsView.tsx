import React, { useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { DataRow, NusaButton, NusaCard, NusaTextField, SectionHeading, StatusChip } from "./components";
import { useTheme, type ThemePreference } from "./ThemeProvider";
import { cashReservePercent, DEFAULT_SETTINGS, normalizeInvestmentPercent, normalizeSettings, type AppSettings, type SettingsRepository, type ThemeSetting } from "./settings";
import { createCashInvestmentEnvelope } from "./capitalAllocationGuard";
import { changeOperatorUserStatus, loadOperatorUsers, type OperatorUserAction, type OperatorUserRecord } from "./operatorUserAccessClient";

interface SettingsViewProps {
  readonly repository: SettingsRepository;
  readonly onSignOut?: () => void;
  readonly exchangeCash?: number;
  readonly onCloudInvestmentPercentSave?: (investmentPercent: number) => Promise<void>;
}

const themes: readonly ThemeSetting[] = ["SYSTEM", "LIGHT", "DARK"];
const themeLabels: Readonly<Record<ThemeSetting, string>> = { SYSTEM: "시스템", LIGHT: "라이트", DARK: "다크" };
const themePreference = (value: ThemeSetting): ThemePreference => value === "SYSTEM" ? "system" : value === "LIGHT" ? "light" : "dark";
const operatorBaseUrl = process.env.EXPO_PUBLIC_NUSA_MONITOR_URL ?? "http://127.0.0.1:41731";
const actionFor = (user: OperatorUserRecord): readonly OperatorUserAction[] => user.status === "PENDING" ? ["APPROVE", "REJECT"] : user.status === "ACTIVE" ? ["SUSPEND"] : ["RESTORE"];
const actionLabel: Readonly<Record<OperatorUserAction, string>> = { APPROVE: "승인", REJECT: "거절", SUSPEND: "정지", RESTORE: "복구" };

export function SettingsView({ repository, onSignOut, exchangeCash = 0, onCloudInvestmentPercentSave }: SettingsViewProps) {
  const { theme, setMode } = useTheme();
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [investmentPercentDraft, setInvestmentPercentDraft] = useState(String(DEFAULT_SETTINGS.capitalAllocation.investmentPercent));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [operatorToken, setOperatorToken] = useState("");
  const [operatorUsers, setOperatorUsers] = useState<readonly OperatorUserRecord[]>([]);
  const [operatorError, setOperatorError] = useState<string | null>(null);
  const [operatorBusy, setOperatorBusy] = useState(false);

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

  const refreshOperatorUsers = async (): Promise<void> => {
    setOperatorBusy(true);
    try { const snapshot = await loadOperatorUsers(operatorBaseUrl, operatorToken); setOperatorUsers(snapshot.users); setOperatorError(null); }
    catch (loadError) { setOperatorUsers([]); setOperatorError(loadError instanceof Error ? loadError.message : "사용자 목록을 불러올 수 없습니다."); }
    finally { setOperatorBusy(false); }
  };
  const applyOperatorAction = async (user: OperatorUserRecord, action: OperatorUserAction): Promise<void> => {
    setOperatorBusy(true);
    try { await changeOperatorUserStatus(operatorBaseUrl, operatorToken, user.id, action); const snapshot = await loadOperatorUsers(operatorBaseUrl, operatorToken); setOperatorUsers(snapshot.users); setOperatorError(null); }
    catch (actionError) { setOperatorError(actionError instanceof Error ? actionError.message : "사용자 상태를 변경할 수 없습니다."); }
    finally { setOperatorBusy(false); }
  };

  const persist = async (next: AppSettings): Promise<boolean> => {
    setSaving(true);
    try {
      const normalized = normalizeSettings(next);
      if (normalized.capitalAllocation.investmentPercent !== settings?.capitalAllocation.investmentPercent && onCloudInvestmentPercentSave) await onCloudInvestmentPercentSave(normalized.capitalAllocation.investmentPercent);
      await repository.save(normalized); setSettings(normalized); setInvestmentPercentDraft(String(normalized.capitalAllocation.investmentPercent)); setError(null); return true;
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : "Settings could not be saved."); return false; }
    finally { setSaving(false); }
  };
  const updateTheme = (next: ThemeSetting) => { if (!settings) return; const previousTheme = settings.theme; setMode(themePreference(next)); void persist({ ...settings, theme: next }).then((saved) => { if (!saved) setMode(themePreference(previousTheme)); }); };
  const updateNotification = (field: "enabled" | "riskAlerts" | "orderUpdates") => { if (settings) void persist({ ...settings, notifications: { ...settings.notifications, [field]: !settings.notifications[field] } }); };
  const saveCapitalAllocation = () => { if (!settings) return; try { const investmentPercent = normalizeInvestmentPercent(Number(investmentPercentDraft.trim())); void persist({ ...settings, capitalAllocation: { investmentPercent } }); } catch (allocationError) { setError(allocationError instanceof Error ? allocationError.message : "Investment allocation is invalid."); } };
  const resetSettings = () => { if (!settings) return; const previousTheme = settings.theme; setMode("system"); void persist(DEFAULT_SETTINGS).then((saved) => { if (!saved) setMode(themePreference(previousTheme)); }); };

  if (error && settings === null) return <View style={styles.state} testID="settings-error"><NusaCard><Text style={[styles.title, { color: theme.colors.danger }]}>설정을 불러올 수 없습니다</Text><Text style={[styles.message, { color: theme.colors.textMuted }]}>{error}</Text></NusaCard></View>;
  if (settings === null) return <View style={styles.state} testID="settings-loading"><ActivityIndicator color={theme.colors.primary} /><Text style={[styles.title, { color: theme.colors.text }]}>설정을 불러오는 중</Text></View>;

  const reservePercent = cashReservePercent(settings.capitalAllocation.investmentPercent);
  const cashEnvelope = createCashInvestmentEnvelope(exchangeCash, settings.capitalAllocation.investmentPercent);
  const pending = operatorUsers.filter((user) => user.status === "PENDING").length;
  const active = operatorUsers.filter((user) => user.status === "ACTIVE").length;

  return <ScrollView contentContainerStyle={styles.content} testID="settings-screen">
    <View style={styles.header}><SectionHeading eyebrow="APPLICATION" title="설정" description="화면, 투자 자본, 로컬 알림, 로컬 세션을 관리합니다." /><StatusChip label="PAPER" tone="primary" /></View>
    {error ? <View style={[styles.error, { backgroundColor: theme.colors.surfaceSunken, borderColor: theme.colors.danger }]}><Text style={{ color: theme.colors.danger }}>{error}</Text></View> : null}

    <NusaCard testID="settings-operator-users" raised>
      <View style={styles.modeHeader}><Text style={[styles.section, { color: theme.colors.text, marginBottom: 0 }]}>운영자 사용자 관리</Text><StatusChip label="OWNER ONLY" tone="warning" /></View>
      <Text style={[styles.hint, { color: theme.colors.textMuted }]}>등록 사용자 목록 조회와 승인·거절·정지·복구는 서버의 users:manage 권한으로만 실행됩니다. 토큰은 저장하지 않습니다.</Text>
      <NusaTextField accessibilityLabel="운영자 토큰" label="운영자 토큰" onChangeText={setOperatorToken} placeholder="운영자 토큰 입력" secureTextEntry testID="operator-user-token" value={operatorToken} />
      <View style={styles.row}><NusaButton disabled={operatorBusy} label={operatorBusy ? "불러오는 중..." : "사용자 목록 불러오기"} onPress={() => { void refreshOperatorUsers(); }} testID="operator-user-refresh" /><NusaButton label="토큰 지우기" tone="neutral" onPress={() => { setOperatorToken(""); setOperatorUsers([]); setOperatorError(null); }} /></View>
      {operatorError ? <Text style={[styles.hint, { color: theme.colors.danger }]} testID="operator-user-error">{operatorError}</Text> : null}
      {operatorUsers.length > 0 ? <><DataRow label="전체 사용자" value={String(operatorUsers.length)} emphasis /><DataRow label="승인 대기" value={String(pending)} /><DataRow label="활성" value={String(active)} />{operatorUsers.map((user) => <View key={user.id} style={[styles.userCard, { borderColor: theme.colors.border }]} testID={`operator-user-${user.id}`}><View style={styles.modeHeader}><View><Text style={[styles.message, { color: theme.colors.text, fontWeight: "700" }]}>{user.displayName || user.email}</Text><Text style={[styles.hint, { color: theme.colors.textMuted, marginTop: 2 }]}>{user.email} · {user.role}</Text></View><StatusChip label={user.status} tone={user.status === "ACTIVE" ? "success" : user.status === "PENDING" ? "warning" : "danger"} /></View>{user.lastSeenAt ? <Text style={[styles.hint, { color: theme.colors.textMuted }]}>최근 활동: {new Date(user.lastSeenAt).toLocaleString("ko-KR")}</Text> : null}{user.role !== "OWNER" ? <View style={styles.row}>{actionFor(user).map((action) => <NusaButton key={action} disabled={operatorBusy} label={actionLabel[action]} onPress={() => { void applyOperatorAction(user, action); }} tone={action === "REJECT" || action === "SUSPEND" ? "danger" : "primary"} testID={`operator-user-${user.id}-${action.toLowerCase()}`} />)}</View> : null}</View>)}</> : null}
    </NusaCard>

    <NusaCard testID="settings-capital-allocation" raised><Text style={[styles.section, { color: theme.colors.text }]}>현금 투자 비중</Text><DataRow label="투자" value={`${settings.capitalAllocation.investmentPercent}%`} emphasis /><DataRow label="현금 보유" value={`${reservePercent}%`} emphasis /><DataRow label="실제 투자 가능 금액" value={`${Math.round(cashEnvelope.investableCash).toLocaleString("ko-KR")}원`} /><DataRow label="보호되는 현금 금액" value={`${Math.round(cashEnvelope.reservedCash).toLocaleString("ko-KR")}원`} /><NusaTextField accessibilityLabel="투자 비중 퍼센트" label="투자할 현금 비중 (0~100%)" onChangeText={setInvestmentPercentDraft} placeholder="예: 60" testID="settings-investment-percent" value={investmentPercentDraft} /><View style={styles.allocationActions}><NusaButton disabled={saving} label={saving ? "저장 중..." : "비중 저장"} onPress={saveCapitalAllocation} /></View></NusaCard>
    <NusaCard testID="settings-theme"><Text style={[styles.section, { color: theme.colors.text }]}>화면 테마</Text><View style={styles.row}>{themes.map((value) => <NusaButton key={value} disabled={saving} label={themeLabels[value]} onPress={() => updateTheme(value)} tone={settings.theme === value ? "primary" : "neutral"} />)}</View></NusaCard>
    <NusaCard testID="settings-notifications"><Text style={[styles.section, { color: theme.colors.text }]}>알림</Text><View style={styles.settingRow}><Text style={[styles.message, { color: theme.colors.text }]}>전체 알림</Text><NusaButton disabled={saving} label={settings.notifications.enabled ? "켜짐" : "꺼짐"} onPress={() => updateNotification("enabled")} tone={settings.notifications.enabled ? "primary" : "neutral"} /></View><View style={styles.settingRow}><Text style={[styles.message, { color: theme.colors.text }]}>리스크 알림</Text><NusaButton disabled={saving} label={settings.notifications.riskAlerts ? "켜짐" : "꺼짐"} onPress={() => updateNotification("riskAlerts")} tone={settings.notifications.riskAlerts ? "primary" : "neutral"} /></View><View style={styles.settingRow}><Text style={[styles.message, { color: theme.colors.text }]}>주문 상태 업데이트</Text><NusaButton disabled={saving} label={settings.notifications.orderUpdates ? "켜짐" : "꺼짐"} onPress={() => updateNotification("orderUpdates")} tone={settings.notifications.orderUpdates ? "primary" : "neutral"} /></View></NusaCard>
    <NusaCard testID="settings-mode" raised><View style={styles.modeHeader}><Text style={[styles.section, { color: theme.colors.text, marginBottom: 0 }]}>거래 권한</Text><StatusChip label="READ ONLY" tone="info" /></View><DataRow label="운영 모드" value="PAPER" emphasis /><DataRow label="LIVE 주문" value="금지" tone="success" /></NusaCard>
    <NusaCard testID="settings-about"><Text style={[styles.section, { color: theme.colors.text }]}>앱 정보</Text><DataRow label="클라이언트" value="NUSA Mobile 0.1.0" /><DataRow label="용도" value="PAPER / Read Only" /></NusaCard>
    <NusaCard testID="settings-reset"><Text style={[styles.section, { color: theme.colors.text }]}>로컬 설정 초기화</Text><NusaButton label={saving ? "저장 중..." : "설정 초기화"} disabled={saving} onPress={resetSettings} tone="danger" /></NusaCard>
    {onSignOut ? <NusaCard testID="settings-session"><Text style={[styles.section, { color: theme.colors.text }]}>로컬 세션</Text><NusaButton label="로그아웃" onPress={onSignOut} tone="neutral" testID="settings-sign-out" /></NusaCard> : null}
  </ScrollView>;
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingTop: 18, gap: 14, paddingBottom: 32 }, state: { flex: 1, justifyContent: "center", padding: 20, gap: 14 }, header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }, title: { fontSize: 18, fontWeight: "700" }, section: { fontSize: 18, fontWeight: "700", marginBottom: 12, letterSpacing: -0.4 }, message: { lineHeight: 21 }, hint: { lineHeight: 20, fontSize: 13, marginTop: 10 }, row: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 }, allocationActions: { marginTop: 10, alignItems: "flex-start" }, settingRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 10, gap: 12 }, modeHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 10 }, error: { padding: 12, borderRadius: 10, borderWidth: 1 }, userCard: { borderWidth: 1, borderRadius: 12, padding: 12, marginTop: 10 }
});
