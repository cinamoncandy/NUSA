import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { DataRow, NusaButton, NusaCard, NusaTextField, SectionHeading, StatusChip } from "./components";
import { useTheme, type ThemePreference } from "./ThemeProvider";
import { DEFAULT_SETTINGS, normalizeSettings, type AppSettings, type SettingsRepository, type ThemeSetting } from "./settings";
import { InMemoryDashboardCredentialSession } from "./dashboardCredentialSession";
import { loadPersonalPaperOperations } from "./personalPaperOperationsClient";
import {
  clearPaperConnectionSession,
  getConfiguredPaperEndpoint,
  getPaperConnectionState,
  markPaperConnectionReady,
  markPaperConnectionUnavailable,
  setConfiguredPaperEndpoint,
  type PaperConnectionState
} from "./paperConnectionSession";

interface SettingsViewProps {
  readonly repository: SettingsRepository;
  readonly onSignOut?: () => void;
  readonly onConnectionChanged?: () => void;
}

const themes: readonly ThemeSetting[] = ["SYSTEM", "LIGHT", "DARK"];
const themeLabels: Readonly<Record<ThemeSetting, string>> = { SYSTEM: "시스템", LIGHT: "라이트", DARK: "다크" };
const themePreference = (value: ThemeSetting): ThemePreference => value === "SYSTEM" ? "system" : value === "LIGHT" ? "light" : "dark";

export function SettingsView({ repository, onSignOut, onConnectionChanged }: SettingsViewProps) {
  const { theme, setMode } = useTheme();
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [endpointDraft, setEndpointDraft] = useState("");
  const [tokenDraft, setTokenDraft] = useState("");
  const [connection, setConnection] = useState<PaperConnectionState>(() => getPaperConnectionState());
  const credentialSession = useMemo(() => new InMemoryDashboardCredentialSession(), []);

  const syncConnection = () => setConnection(getPaperConnectionState());

  useEffect(() => {
    let active = true;
    void repository.load().then((loaded) => {
      if (!active) return;
      const next = loaded ?? DEFAULT_SETTINGS;
      setSettings(next);
      setEndpointDraft(next.paperEndpoint);
      setMode(themePreference(next.theme));
      setConfiguredPaperEndpoint(next.paperEndpoint);
      setConnection(getPaperConnectionState());
    }).catch((loadError) => {
      if (active) setError(loadError instanceof Error ? loadError.message : "Settings are unavailable.");
    });
    return () => { active = false; };
  }, [repository, setMode]);

  const persist = async (next: AppSettings): Promise<AppSettings | null> => {
    setSaving(true);
    try {
      const normalized = normalizeSettings(next);
      const previousEndpoint = getConfiguredPaperEndpoint();
      await repository.save(normalized);
      setSettings(normalized);
      setEndpointDraft(normalized.paperEndpoint);
      setError(null);
      if (previousEndpoint !== (normalized.paperEndpoint || null)) {
        credentialSession.clear();
        setConfiguredPaperEndpoint(normalized.paperEndpoint);
        syncConnection();
        onConnectionChanged?.();
      }
      return normalized;
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Settings could not be saved.");
      return null;
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

  const updateNotification = (field: "enabled" | "riskAlerts" | "orderUpdates") => {
    if (settings) void persist({ ...settings, notifications: { ...settings.notifications, [field]: !settings.notifications[field] } });
  };

  const testConnection = async () => {
    if (settings == null) return;
    const saved = await persist({ ...settings, paperEndpoint: endpointDraft });
    if (saved == null) return;
    const endpoint = saved.paperEndpoint;
    if (!endpoint) {
      credentialSession.clear();
      clearPaperConnectionSession();
      syncConnection();
      setError("PAPER endpoint를 먼저 입력해 주세요.");
      onConnectionChanged?.();
      return;
    }

    try {
      if (tokenDraft.trim()) credentialSession.connect(tokenDraft);
      if (!credentialSession.isConfigured()) throw new Error("세션 토큰을 입력해 주세요.");
      setTokenDraft("");
      const result = await loadPersonalPaperOperations({ baseUrl: endpoint, credentialProvider: credentialSession.credentialProvider });
      if (result.status !== "READY") {
        credentialSession.clear();
        if (result.status === "UNAVAILABLE") markPaperConnectionUnavailable(endpoint, result.reason);
        else clearPaperConnectionSession(endpoint);
        syncConnection();
        setError(result.reason);
        onConnectionChanged?.();
        return;
      }
      markPaperConnectionReady(endpoint);
      syncConnection();
      setError(null);
      onConnectionChanged?.();
    } catch (connectionError) {
      credentialSession.clear();
      setTokenDraft("");
      markPaperConnectionUnavailable(endpoint, connectionError instanceof Error ? connectionError.message : "PAPER credential is invalid.");
      syncConnection();
      setError(connectionError instanceof Error ? connectionError.message : "PAPER credential is invalid.");
      onConnectionChanged?.();
    }
  };

  const disconnect = () => {
    credentialSession.clear();
    setTokenDraft("");
    clearPaperConnectionSession(settings?.paperEndpoint ?? "");
    syncConnection();
    setError(null);
    onConnectionChanged?.();
  };

  const resetSettings = () => {
    if (!settings) return;
    const previousTheme = settings.theme;
    credentialSession.clear();
    setTokenDraft("");
    setMode("system");
    void persist(DEFAULT_SETTINGS).then((saved) => {
      if (!saved) {
        setMode(themePreference(previousTheme));
        return;
      }
      clearPaperConnectionSession();
      syncConnection();
      onConnectionChanged?.();
    });
  };

  if (error && settings === null) return <View style={styles.state} testID="settings-error"><NusaCard><Text style={[styles.title, { color: theme.colors.danger }]}>설정을 불러올 수 없습니다</Text><Text style={[styles.message, { color: theme.colors.textMuted }]}>{error}</Text></NusaCard></View>;
  if (settings === null) return <View style={styles.state} testID="settings-loading"><ActivityIndicator color={theme.colors.primary} /><Text style={[styles.title, { color: theme.colors.text }]}>설정을 불러오는 중</Text></View>;

  const connectionTone = connection.status === "READY" ? "success" : connection.status === "UNAVAILABLE" ? "danger" : "warning";
  const verifiedAt = connection.verifiedAt == null ? "-" : new Date(connection.verifiedAt).toLocaleString("ko-KR");

  return <ScrollView contentContainerStyle={styles.content} testID="settings-screen">
    <View style={styles.header}><SectionHeading eyebrow="APPLICATION" title="설정" description="PAPER 서버 연결, 화면, 알림, 로컬 세션을 관리합니다." /><StatusChip label="PAPER ONLY" tone="primary" /></View>
    {error ? <View style={[styles.error, { backgroundColor: theme.colors.surfaceSunken, borderColor: theme.colors.danger }]} testID="settings-save-error"><Text style={{ color: theme.colors.danger }}>{error}</Text></View> : null}

    <NusaCard testID="settings-paper-connection" raised>
      <View style={styles.modeHeader}><Text style={[styles.section, { color: theme.colors.text, marginBottom: 0 }]}>PAPER 서버 연결</Text><StatusChip label={connection.status === "READY" ? "검증됨" : connection.status === "UNAVAILABLE" ? "연결 실패" : "검증 필요"} tone={connectionTone} /></View>
      <NusaTextField label="Cloud endpoint" value={endpointDraft} onChangeText={setEndpointDraft} placeholder="https://... 또는 localhost" testID="settings-paper-endpoint" />
      <NusaTextField label="세션 토큰" value={tokenDraft} onChangeText={setTokenDraft} placeholder={credentialSession.isConfigured() ? "현재 메모리 토큰으로 재검증 가능" : "기기에 저장하지 않음"} secureTextEntry testID="settings-paper-token" />
      <Text style={[styles.hint, { color: theme.colors.textMuted }]}>Endpoint만 로컬 설정에 저장합니다. 토큰은 앱 메모리에만 유지되며, endpoint가 바뀌거나 검증이 실패하면 즉시 폐기됩니다.</Text>
      <View style={styles.row}><NusaButton disabled={saving} label={connection.status === "READY" ? "연결 재검증" : "저장 + 연결 테스트"} onPress={() => void testConnection()} testID="settings-paper-connect" /><NusaButton label="연결 해제" onPress={disconnect} tone="neutral" testID="settings-paper-disconnect" /></View>
      <DataRow label="검증 상태" value={connection.status} tone={connectionTone} />
      <DataRow label="검증 endpoint" value={connection.endpoint ?? "-"} />
      <DataRow label="마지막 검증" value={verifiedAt} />
      <Text style={[styles.hint, { color: theme.colors.textMuted }]}>{connection.reason}</Text>
    </NusaCard>

    <NusaCard testID="settings-theme"><Text style={[styles.section, { color: theme.colors.text }]}>화면 테마</Text><View style={styles.row}>{themes.map((value) => <NusaButton key={value} disabled={saving} label={themeLabels[value]} onPress={() => updateTheme(value)} tone={settings.theme === value ? "primary" : "neutral"} testID={`settings-theme-${value}`} />)}</View><Text style={[styles.hint, { color: theme.colors.textMuted }]}>시스템을 선택하면 기기의 라이트·다크 설정을 그대로 따릅니다.</Text></NusaCard>

    <NusaCard testID="settings-notifications"><Text style={[styles.section, { color: theme.colors.text }]}>알림</Text>{(["enabled", "riskAlerts", "orderUpdates"] as const).map((field) => <View key={field} style={styles.settingRow}><Text style={[styles.message, { color: theme.colors.text }]}>{field === "enabled" ? "전체 알림" : field === "riskAlerts" ? "리스크 알림" : "주문 상태 업데이트"}</Text><NusaButton disabled={saving} label={settings.notifications[field] ? "켜짐" : "꺼짐"} onPress={() => updateNotification(field)} tone={settings.notifications[field] ? "primary" : "neutral"} testID={`settings-notifications-${field}`} /></View>)}</NusaCard>

    <NusaCard testID="settings-mode" raised><View style={styles.modeHeader}><Text style={[styles.section, { color: theme.colors.text, marginBottom: 0 }]}>거래 권한</Text><StatusChip label="PAPER ONLY" tone="info" /></View><DataRow label="PAPER 가상 주문" value="허용" emphasis /><DataRow label="LIVE 주문" value="금지" tone="success" /><DataRow label="Production mutation" value="금지" tone="success" /><Text style={[styles.hint, { color: theme.colors.textMuted }]}>LIVE·출금·이체·production mutation 권한은 이 앱에서 승격할 수 없습니다.</Text></NusaCard>

    <NusaCard testID="settings-about"><Text style={[styles.section, { color: theme.colors.text }]}>앱 정보</Text><DataRow label="클라이언트" value="NUSA Mobile 0.1.0" /><DataRow label="용도" value="Personal PAPER" /></NusaCard>

    <NusaCard testID="settings-reset"><Text style={[styles.section, { color: theme.colors.text }]}>로컬 설정 초기화</Text><Text style={[styles.hint, { color: theme.colors.textMuted }]}>endpoint와 메모리 세션을 지우고 앱 설정을 기본값으로 되돌립니다.</Text><NusaButton label={saving ? "저장 중..." : "설정 초기화"} disabled={saving} onPress={resetSettings} tone="danger" testID="settings-reset-button" /></NusaCard>

    {onSignOut ? <NusaCard testID="settings-session"><Text style={[styles.section, { color: theme.colors.text }]}>로컬 화면 세션</Text><Text style={[styles.hint, { color: theme.colors.textMuted }]}>종료하면 화면 세션과 메모리 PAPER 자격 증명을 함께 지웁니다.</Text><NusaButton label="로컬 세션 종료" onPress={onSignOut} tone="neutral" testID="settings-sign-out" /></NusaCard> : null}
  </ScrollView>;
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingTop: 18, gap: 14, paddingBottom: 32, width: "100%", maxWidth: 920, alignSelf: "center" },
  state: { flex: 1, justifyContent: "center", padding: 20, gap: 14 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 12 },
  title: { fontSize: 18, fontWeight: "700" },
  section: { fontSize: 18, fontWeight: "700", marginBottom: 12, letterSpacing: -0.4 },
  message: { lineHeight: 21 },
  hint: { lineHeight: 20, fontSize: 13, marginTop: 10 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 },
  settingRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 10, gap: 12 },
  modeHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 10 },
  error: { padding: 12, borderRadius: 10, borderWidth: 1 }
});
