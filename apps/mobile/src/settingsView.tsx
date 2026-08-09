import React, { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { DataRow, NusaButton, NusaCard, NusaTextField, SectionHeading, StatusChip } from "./components";
import { useTheme, type ThemePreference } from "./ThemeProvider";
import { DEFAULT_SETTINGS, normalizeSettings, type AppSettings, type SettingsRepository, type ThemeSetting } from "./settings";
import { InMemoryDashboardCredentialSession } from "./dashboardCredentialSession";
import { loadPersonalPaperOperations, type PersonalPaperOperationsLoadResult } from "./personalPaperOperationsClient";
import { clearPaperConnectionVerification, getConfiguredPaperEndpoint, isPaperConnectionVerified, markPaperConnectionVerified, setConfiguredPaperEndpoint } from "./paperConnectionSession";

interface SettingsViewProps { readonly repository: SettingsRepository; readonly onSignOut?: () => void; }
const themes: readonly ThemeSetting[] = ["SYSTEM", "LIGHT", "DARK"];
const themeLabels: Readonly<Record<ThemeSetting, string>> = { SYSTEM: "시스템", LIGHT: "라이트", DARK: "다크" };
const themePreference = (value: ThemeSetting): ThemePreference => value === "SYSTEM" ? "system" : value === "LIGHT" ? "light" : "dark";

export function SettingsView({ repository, onSignOut }: SettingsViewProps) {
  const { theme, setMode } = useTheme();
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [endpointDraft, setEndpointDraft] = useState("");
  const [tokenDraft, setTokenDraft] = useState("");
  const [connection, setConnection] = useState<PersonalPaperOperationsLoadResult>({ status: "NOT_CONFIGURED", reason: "PAPER connection is not configured." });
  const credentialSession = useMemo(() => new InMemoryDashboardCredentialSession(), []);
  const savingRef = useRef(false);
  const connectionInFlightRef = useRef(false);

  useEffect(() => {
    let active = true;
    void repository.load().then(async (loaded) => {
      if (!active) return;
      const next = loaded ?? DEFAULT_SETTINGS;
      setConfiguredPaperEndpoint(next.paperEndpoint);
      setSettings(next);
      setEndpointDraft(next.paperEndpoint);
      setMode(themePreference(next.theme));
      if (!next.paperEndpoint || !credentialSession.isConfigured() || !isPaperConnectionVerified(next.paperEndpoint)) return;
      const result = await loadPersonalPaperOperations({ baseUrl: next.paperEndpoint, credentialProvider: credentialSession.credentialProvider });
      if (!active) return;
      if (result.status !== "READY") { credentialSession.clear(); clearPaperConnectionVerification(); }
      setConnection(result);
    }).catch((loadError) => { if (active) setError(loadError instanceof Error ? loadError.message : "Settings are unavailable."); });
    return () => { active = false; };
  }, [credentialSession, repository, setMode]);

  const persist = async (next: AppSettings): Promise<boolean> => {
    if (savingRef.current) return false;
    savingRef.current = true;
    setSaving(true);
    try {
      const normalized = normalizeSettings(next);
      await repository.save(normalized);
      setConfiguredPaperEndpoint(normalized.paperEndpoint);
      setSettings(normalized);
      setEndpointDraft(normalized.paperEndpoint);
      setError(null);
      return true;
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Settings could not be saved.");
      return false;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };
  const isBusyNow = () => savingRef.current || connectionInFlightRef.current;
  const updateTheme = (next: ThemeSetting) => {
    if (!settings || isBusyNow()) return;
    const previousTheme = settings.theme;
    setMode(themePreference(next));
    void persist({ ...settings, theme: next }).then((saved) => { if (!saved) setMode(themePreference(previousTheme)); });
  };
  const testConnection = async () => {
    if (settings == null || isBusyNow()) return;
    connectionInFlightRef.current = true;
    setConnecting(true);
    setError(null);
    try {
      if (!await persist({ ...settings, paperEndpoint: endpointDraft })) return;
      const configuredEndpoint = getConfiguredPaperEndpoint();
      if (!configuredEndpoint) {
        credentialSession.clear();
        clearPaperConnectionVerification();
        setConnection({ status: "NOT_CONFIGURED", reason: "PAPER endpoint is not configured." });
        return;
      }
      credentialSession.clear();
      clearPaperConnectionVerification();
      setConnection({ status: "NOT_CONFIGURED", reason: "PAPER connection verification is in progress." });
      credentialSession.connect(tokenDraft);
      const result = await loadPersonalPaperOperations({ baseUrl: configuredEndpoint, credentialProvider: credentialSession.credentialProvider, allowUnverifiedEndpoint: true });
      if (result.status === "READY") { markPaperConnectionVerified(configuredEndpoint); setTokenDraft(""); }
      else { credentialSession.clear(); clearPaperConnectionVerification(); }
      setConnection(result);
    } catch (connectionError) {
      credentialSession.clear();
      clearPaperConnectionVerification();
      setConnection({ status: "NOT_CONFIGURED", reason: connectionError instanceof Error ? connectionError.message : "PAPER credential is invalid." });
    } finally {
      connectionInFlightRef.current = false;
      setConnecting(false);
    }
  };
  const disconnect = () => {
    if (isBusyNow()) return;
    credentialSession.clear();
    clearPaperConnectionVerification();
    setTokenDraft("");
    setConnection({ status: "NOT_CONFIGURED", reason: "PAPER credential cleared from memory." });
  };
  const resetSettings = () => {
    if (!settings || isBusyNow()) return;
    const previousTheme = settings.theme;
    credentialSession.clear();
    clearPaperConnectionVerification();
    setTokenDraft("");
    setMode("system");
    void persist(DEFAULT_SETTINGS).then((saved) => { if (!saved) setMode(themePreference(previousTheme)); else setConnection({ status: "NOT_CONFIGURED", reason: "PAPER endpoint is not configured." }); });
  };
  const signOutLocal = () => { if (!isBusyNow()) onSignOut?.(); };

  if (error && settings === null) return <View style={styles.state} testID="settings-error"><NusaCard><Text style={[styles.title, { color: theme.colors.danger }]}>설정을 불러올 수 없습니다</Text><Text style={[styles.message, { color: theme.colors.textMuted }]}>{error}</Text></NusaCard></View>;
  if (settings === null) return <View style={styles.state} testID="settings-loading"><ActivityIndicator color={theme.colors.primary} /><Text style={[styles.title, { color: theme.colors.text }]}>설정을 불러오는 중</Text></View>;
  const busy = saving || connecting;
  const connectionTone = connecting ? "info" : connection.status === "READY" ? "success" : connection.status === "UNAVAILABLE" ? "danger" : "warning";
  const connectionLabel = connecting ? "확인 중" : connection.status === "READY" ? "연결됨" : "연결 필요";

  return <ScrollView contentContainerStyle={styles.content} testID="settings-screen">
    <View style={styles.header}><SectionHeading eyebrow="APPLICATION" title="설정" description="PAPER 서버 연결, 화면, 로컬 세션을 관리합니다." /><StatusChip label="PAPER" tone="primary" /></View>
    {error ? <View style={[styles.error, { backgroundColor: theme.colors.surfaceSunken, borderColor: theme.colors.danger }]}><Text style={{ color: theme.colors.danger }}>{error}</Text></View> : null}
    <NusaCard testID="settings-paper-connection" raised>
      <View style={styles.modeHeader}><Text style={[styles.section, { color: theme.colors.text, marginBottom: 0 }]}>PAPER 서버 연결</Text><StatusChip label={connectionLabel} tone={connectionTone} /></View>
      <NusaTextField autoCapitalize="none" autoCorrect={false} editable={!busy} keyboardType="url" label="Cloud endpoint" value={endpointDraft} onChangeText={setEndpointDraft} placeholder="https://... 또는 localhost" returnKeyType="done" testID="settings-paper-endpoint" />
      <NusaTextField autoCapitalize="none" autoCorrect={false} editable={!busy} label="세션 토큰" value={tokenDraft} onChangeText={setTokenDraft} placeholder="기기에 저장하지 않음" returnKeyType="done" secureTextEntry testID="settings-paper-token" />
      <Text style={[styles.hint, { color: theme.colors.textMuted }]}>Endpoint만 로컬 설정에 저장합니다. 토큰은 앱 메모리에만 유지되며 기본 localhost fallback은 사용하지 않습니다.</Text>
      <View style={styles.row}><NusaButton disabled={busy} label={connecting ? "연결 확인 중..." : "저장 + 연결 테스트"} onPress={() => void testConnection()} testID="settings-paper-connect" /><NusaButton disabled={busy} label="연결 해제" onPress={disconnect} tone="neutral" testID="settings-paper-disconnect" /></View>
      <DataRow label="연결 상태" value={connecting ? "CHECKING" : connection.status} tone={connectionTone} /><Text style={[styles.hint, { color: theme.colors.textMuted }]}>{connecting ? "저장된 endpoint와 메모리 전용 세션을 검증하고 있습니다." : connection.status === "READY" ? `${connection.snapshot.operations.runtimeState} · ${connection.snapshot.operations.transport}` : connection.reason}</Text>
    </NusaCard>
    <NusaCard><Text style={[styles.section, { color: theme.colors.text }]}>화면 테마</Text><View style={styles.row}>{themes.map((value) => <NusaButton key={value} disabled={busy} label={themeLabels[value]} onPress={() => updateTheme(value)} tone={settings.theme === value ? "primary" : "neutral"} />)}</View></NusaCard>
    <NusaCard raised><View style={styles.modeHeader}><Text style={[styles.section, { color: theme.colors.text, marginBottom: 0 }]}>거래 권한</Text><StatusChip label="PAPER ONLY" tone="info" /></View><DataRow label="운영 모드" value="PAPER" emphasis /><DataRow label="LIVE 주문" value="금지" tone="success" /><Text style={[styles.hint, { color: theme.colors.textMuted }]}>LIVE·출금·이체·production mutation 권한은 없습니다.</Text></NusaCard>
    <NusaCard><Text style={[styles.section, { color: theme.colors.text }]}>앱 정보</Text><DataRow label="클라이언트" value="NUSA Mobile 0.1.0" /><DataRow label="용도" value="PAPER / Personal" /></NusaCard>
    <NusaCard><Text style={[styles.section, { color: theme.colors.text }]}>로컬 설정 초기화</Text><NusaButton label={busy ? "작업 중..." : "설정 초기화"} disabled={busy} onPress={resetSettings} tone="danger" /></NusaCard>
    {onSignOut ? <NusaCard><Text style={[styles.section, { color: theme.colors.text }]}>로컬 세션</Text><NusaButton disabled={busy} label="개인 모드 종료" onPress={signOutLocal} tone="neutral" testID="settings-sign-out" /></NusaCard> : null}
  </ScrollView>;
}

const styles = StyleSheet.create({ content: { paddingHorizontal: 20, paddingTop: 18, gap: 14, paddingBottom: 32, width: "100%", maxWidth: 1080, alignSelf: "center" }, state: { flex: 1, justifyContent: "center", padding: 20, gap: 14 }, header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }, title: { fontSize: 18, fontWeight: "700" }, section: { fontSize: 18, fontWeight: "700", marginBottom: 12, letterSpacing: -0.4 }, message: { lineHeight: 21 }, hint: { lineHeight: 20, fontSize: 13, marginTop: 10 }, row: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 }, modeHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 10 }, error: { padding: 12, borderRadius: 10, borderWidth: 1 } });