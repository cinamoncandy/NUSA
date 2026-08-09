import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { DataRow, NusaButton, NusaCard, NusaTextField, SectionHeading, StatusChip } from "./components";
import { useTheme, type ThemePreference } from "./ThemeProvider";
import { DEFAULT_SETTINGS, normalizePaperEndpoint, normalizeSettings, type AppSettings, type SettingsRepository, type ThemeSetting } from "./settings";
import { InMemoryDashboardCredentialSession } from "./dashboardCredentialSession";
import { loadPersonalPaperOperations, type PersonalPaperOperationsLoadResult } from "./personalPaperOperationsClient";

interface SettingsViewProps { readonly repository: SettingsRepository; }
const themes: readonly ThemeSetting[] = ["SYSTEM", "LIGHT", "DARK"];
const themeLabels: Readonly<Record<ThemeSetting, string>> = { SYSTEM: "시스템", LIGHT: "라이트", DARK: "다크" };
const themePreference = (value: ThemeSetting): ThemePreference => value === "SYSTEM" ? "system" : value === "LIGHT" ? "light" : "dark";
const disconnected = (reason: string): PersonalPaperOperationsLoadResult => ({ status: "NOT_CONFIGURED", reason });

export function SettingsView({ repository }: SettingsViewProps) {
  const { theme, setMode } = useTheme();
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [endpointDraft, setEndpointDraft] = useState("");
  const [tokenDraft, setTokenDraft] = useState("");
  const [connection, setConnection] = useState<PersonalPaperOperationsLoadResult>(disconnected("PAPER connection is not configured."));
  const credentialSession = useMemo(() => new InMemoryDashboardCredentialSession(), []);

  useEffect(() => {
    let active = true;
    void repository.load().then(async (loaded) => {
      if (!active) return;
      const next = loaded ?? DEFAULT_SETTINGS;
      setSettings(next);
      setEndpointDraft(next.paperEndpoint);
      setMode(themePreference(next.theme));
      if (!next.paperEndpoint || !credentialSession.isVerifiedFor(next.paperEndpoint)) {
        setConnection(disconnected(next.paperEndpoint ? "PAPER credential verification is required." : "PAPER endpoint is not configured."));
        return;
      }
      const result = await loadPersonalPaperOperations({ baseUrl: next.paperEndpoint, credentialProvider: credentialSession.credentialProviderFor(next.paperEndpoint) });
      if (!active) return;
      if (result.status === "READY") setConnection(result);
      else { credentialSession.clear(); setConnection(result.status === "NOT_CONFIGURED" ? result : disconnected(result.reason)); }
    }).catch((loadError) => { if (active) { credentialSession.clear(); setError(loadError instanceof Error ? loadError.message : "Settings are unavailable."); } });
    return () => { active = false; };
  }, [credentialSession, repository, setMode]);

  const persist = async (next: AppSettings): Promise<boolean> => {
    setSaving(true);
    try {
      const normalized = normalizeSettings(next);
      const verifiedEndpoint = credentialSession.verifiedEndpoint();
      if (verifiedEndpoint !== null && verifiedEndpoint !== normalized.paperEndpoint) {
        credentialSession.clear();
        setConnection(disconnected("PAPER endpoint changed. Credential verification is required again."));
      }
      await repository.save(normalized);
      setSettings(normalized);
      setEndpointDraft(normalized.paperEndpoint);
      setError(null);
      return true;
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Settings could not be saved.");
      return false;
    } finally { setSaving(false); }
  };

  const updateTheme = (next: ThemeSetting) => { if (!settings) return; const previousTheme = settings.theme; setMode(themePreference(next)); void persist({ ...settings, theme: next }).then((saved) => { if (!saved) setMode(themePreference(previousTheme)); }); };
  const updateNotification = (field: "enabled" | "riskAlerts" | "orderUpdates") => { if (settings) void persist({ ...settings, notifications: { ...settings.notifications, [field]: !settings.notifications[field] } }); };
  const handleEndpointDraft = (value: string) => {
    setEndpointDraft(value);
    const verifiedEndpoint = credentialSession.verifiedEndpoint();
    if (verifiedEndpoint === null) return;
    let normalized = "";
    try { normalized = normalizePaperEndpoint(value); } catch { /* invalid draft invalidates the verified binding */ }
    if (normalized !== verifiedEndpoint) {
      credentialSession.clear();
      setConnection(disconnected("PAPER endpoint changed. Credential verification is required again."));
    }
  };

  const testConnection = async () => {
    if (settings == null) return;
    let endpoint: string;
    try { endpoint = normalizePaperEndpoint(endpointDraft); if (!endpoint) throw new Error("PAPER endpoint is not configured."); }
    catch (endpointError) { credentialSession.clear(); setTokenDraft(""); setConnection(disconnected(endpointError instanceof Error ? endpointError.message : "PAPER endpoint is invalid.")); return; }
    if (!await persist({ ...settings, paperEndpoint: endpoint })) return;
    let staged = false;
    try {
      if (tokenDraft.trim()) {
        credentialSession.beginVerification(tokenDraft, endpoint);
        staged = true;
      } else if (!credentialSession.isVerifiedFor(endpoint)) {
        throw new Error("PAPER credential is required.");
      }
      setTokenDraft("");
      const provider = staged ? credentialSession.verificationCredentialProvider : credentialSession.credentialProviderFor(endpoint);
      const result = await loadPersonalPaperOperations({ baseUrl: endpoint, credentialProvider: provider });
      if (result.status !== "READY") {
        credentialSession.clear();
        setConnection(result.status === "NOT_CONFIGURED" ? result : disconnected(result.reason));
        return;
      }
      if (staged) credentialSession.markVerified(endpoint);
      if (!credentialSession.isVerifiedFor(endpoint)) throw new Error("PAPER credential verification did not bind to the saved endpoint.");
      setConnection(result);
    } catch (connectionError) {
      credentialSession.clear();
      setTokenDraft("");
      setConnection(disconnected(connectionError instanceof Error ? connectionError.message : "PAPER credential is invalid."));
    }
  };

  const disconnect = () => { credentialSession.clear(); setTokenDraft(""); setConnection(disconnected("PAPER credential cleared from memory.")); };
  const resetSettings = () => {
    if (!settings) return;
    const previousTheme = settings.theme;
    credentialSession.clear();
    setTokenDraft("");
    setConnection(disconnected("PAPER endpoint is not configured."));
    setMode("system");
    void persist(DEFAULT_SETTINGS).then((saved) => { if (!saved) setMode(themePreference(previousTheme)); });
  };

  if (error && settings === null) return <View style={styles.state} testID="settings-error"><NusaCard><Text style={[styles.title, { color: theme.colors.danger }]}>설정을 불러올 수 없습니다</Text><Text style={[styles.message, { color: theme.colors.textMuted }]}>{error}</Text></NusaCard></View>;
  if (settings === null) return <View style={styles.state} testID="settings-loading"><ActivityIndicator color={theme.colors.primary} /><Text style={[styles.title, { color: theme.colors.text }]}>설정을 불러오는 중</Text></View>;
  const connectionTone = connection.status === "READY" ? "success" : connection.status === "UNAVAILABLE" ? "danger" : "warning";

  return <ScrollView contentContainerStyle={styles.content} testID="settings-screen">
    <View style={styles.header}><SectionHeading eyebrow="APPLICATION" title="설정" description="PAPER 서버 연결, 화면, 알림을 관리합니다." /><StatusChip label="PAPER" tone="primary" /></View>
    {error ? <View style={[styles.error, { backgroundColor: theme.colors.surfaceSunken, borderColor: theme.colors.danger }]}><Text style={{ color: theme.colors.danger }}>{error}</Text></View> : null}
    <NusaCard testID="settings-paper-connection" raised>
      <View style={styles.modeHeader}><Text style={[styles.section, { color: theme.colors.text, marginBottom: 0 }]}>PAPER 서버 연결</Text><StatusChip label={connection.status === "READY" ? "검증 연결됨" : "검증 필요"} tone={connectionTone} /></View>
      <NusaTextField label="Cloud endpoint" value={endpointDraft} onChangeText={handleEndpointDraft} placeholder="https://... 또는 localhost" testID="settings-paper-endpoint" />
      <NusaTextField label="세션 토큰" value={tokenDraft} onChangeText={setTokenDraft} placeholder={credentialSession.isVerifiedFor(endpointDraft) ? "현재 endpoint 검증됨 · 재입력 선택" : "기기에 저장하지 않음"} secureTextEntry testID="settings-paper-token" />
      <Text style={[styles.hint, { color: theme.colors.textMuted }]}>Endpoint만 로컬 설정에 저장합니다. 토큰은 앱 메모리에만 유지되고, 저장된 endpoint에 실제 연결 테스트가 성공한 세션만 PAPER 조회·주문에 사용할 수 있습니다.</Text>
      <View style={styles.row}><NusaButton disabled={saving} label="저장 + 연결 검증" onPress={() => void testConnection()} testID="settings-paper-connect" /><NusaButton label="연결 해제" onPress={disconnect} tone="neutral" testID="settings-paper-disconnect" /></View>
      <DataRow label="연결 상태" value={connection.status} tone={connectionTone} /><Text style={[styles.hint, { color: theme.colors.textMuted }]}>{connection.status === "READY" ? `${connection.snapshot.operations.runtimeState} · ${connection.snapshot.operations.transport}` : connection.reason}</Text>
    </NusaCard>
    <NusaCard><Text style={[styles.section, { color: theme.colors.text }]}>화면 테마</Text><View style={styles.row}>{themes.map((value) => <NusaButton key={value} disabled={saving} label={themeLabels[value]} onPress={() => updateTheme(value)} tone={settings.theme === value ? "primary" : "neutral"} />)}</View></NusaCard>
    <NusaCard><Text style={[styles.section, { color: theme.colors.text }]}>알림</Text>{(["enabled", "riskAlerts", "orderUpdates"] as const).map((field) => <View key={field} style={styles.settingRow}><Text style={[styles.message, { color: theme.colors.text }]}>{field === "enabled" ? "전체 알림" : field === "riskAlerts" ? "리스크 알림" : "주문 상태 업데이트"}</Text><NusaButton disabled={saving} label={settings.notifications[field] ? "켜짐" : "꺼짐"} onPress={() => updateNotification(field)} tone={settings.notifications[field] ? "primary" : "neutral"} /></View>)}</NusaCard>
    <NusaCard raised><View style={styles.modeHeader}><Text style={[styles.section, { color: theme.colors.text, marginBottom: 0 }]}>거래 권한</Text><StatusChip label="PAPER ONLY" tone="info" /></View><DataRow label="운영 모드" value="PAPER" emphasis /><DataRow label="LIVE 주문" value="금지" tone="success" /><Text style={[styles.hint, { color: theme.colors.textMuted }]}>LIVE·출금·이체·production mutation 권한은 없습니다.</Text></NusaCard>
    <NusaCard><Text style={[styles.section, { color: theme.colors.text }]}>앱 정보</Text><DataRow label="클라이언트" value="NUSA Mobile 0.1.0" /><DataRow label="용도" value="PAPER / Personal" /></NusaCard>
    <NusaCard><Text style={[styles.section, { color: theme.colors.text }]}>로컬 설정 초기화</Text><NusaButton label={saving ? "저장 중..." : "설정 초기화"} disabled={saving} onPress={resetSettings} tone="danger" /></NusaCard>
  </ScrollView>;
}

const styles = StyleSheet.create({ content: { paddingHorizontal: 20, paddingTop: 18, gap: 14, paddingBottom: 32, width: "100%", maxWidth: 920, alignSelf: "center" }, state: { flex: 1, justifyContent: "center", padding: 20, gap: 14 }, header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }, title: { fontSize: 18, fontWeight: "700" }, section: { fontSize: 18, fontWeight: "700", marginBottom: 12, letterSpacing: -0.4 }, message: { lineHeight: 21 }, hint: { lineHeight: 20, fontSize: 13, marginTop: 10 }, row: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 }, settingRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 10, gap: 12 }, modeHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 10 }, error: { padding: 12, borderRadius: 10, borderWidth: 1 } });
