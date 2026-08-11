import React, { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { DataRow, NusaButton, NusaCard, NusaTextField, StatusChip } from "./components";
import { InlineNotice, ScreenHeader, SegmentedControl } from "./uxPrimitives";
import { useTheme, type ThemePreference } from "./ThemeProvider";
import { DEFAULT_SETTINGS, normalizeSettings, type AppSettings, type SettingsRepository, type ThemeSetting } from "./settings";
import { InMemoryDashboardCredentialSession } from "./dashboardCredentialSession";
import { loadPersonalPaperOperations, type PersonalPaperOperationsLoadResult } from "./personalPaperOperationsClient";
import { clearPaperConnectionVerification, getConfiguredPaperEndpoint, isPaperConnectionVerified, markPaperConnectionVerified, setConfiguredPaperEndpoint } from "./paperConnectionSession";

interface SettingsViewProps { readonly repository: SettingsRepository; readonly onSignOut?: () => void; }
const themes: readonly ThemeSetting[] = ["SYSTEM", "LIGHT", "DARK"];
const themeItems = Object.freeze([{ key: "SYSTEM", label: "시스템" }, { key: "LIGHT", label: "라이트" }, { key: "DARK", label: "다크" }]);
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
      setConfiguredPaperEndpoint(next.paperEndpoint); setSettings(next); setEndpointDraft(next.paperEndpoint); setMode(themePreference(next.theme));
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
    savingRef.current = true; setSaving(true);
    try {
      const normalized = normalizeSettings(next); await repository.save(normalized); setConfiguredPaperEndpoint(normalized.paperEndpoint); setSettings(normalized); setEndpointDraft(normalized.paperEndpoint); setError(null); return true;
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : "Settings could not be saved."); return false; }
    finally { savingRef.current = false; setSaving(false); }
  };
  const isBusyNow = () => savingRef.current || connectionInFlightRef.current;
  const updateTheme = (next: ThemeSetting) => { if (!settings || isBusyNow()) return; const previousTheme = settings.theme; setMode(themePreference(next)); void persist({ ...settings, theme: next }).then((saved) => { if (!saved) setMode(themePreference(previousTheme)); }); };
  const testConnection = async () => {
    if (settings == null || isBusyNow()) return;
    connectionInFlightRef.current = true; setConnecting(true); setError(null);
    try {
      if (!await persist({ ...settings, paperEndpoint: endpointDraft })) return;
      const configuredEndpoint = getConfiguredPaperEndpoint();
      if (!configuredEndpoint) { credentialSession.clear(); clearPaperConnectionVerification(); setConnection({ status: "NOT_CONFIGURED", reason: "PAPER endpoint is not configured." }); return; }
      credentialSession.clear(); clearPaperConnectionVerification(); setConnection({ status: "NOT_CONFIGURED", reason: "PAPER connection verification is in progress." }); credentialSession.connect(tokenDraft);
      const result = await loadPersonalPaperOperations({ baseUrl: configuredEndpoint, credentialProvider: credentialSession.credentialProvider, allowUnverifiedEndpoint: true });
      if (result.status === "READY") { markPaperConnectionVerified(configuredEndpoint); setTokenDraft(""); } else { credentialSession.clear(); clearPaperConnectionVerification(); }
      setConnection(result);
    } catch (connectionError) { credentialSession.clear(); clearPaperConnectionVerification(); setConnection({ status: "NOT_CONFIGURED", reason: connectionError instanceof Error ? connectionError.message : "PAPER credential is invalid." }); }
    finally { connectionInFlightRef.current = false; setConnecting(false); }
  };
  const disconnect = () => { if (isBusyNow()) return; credentialSession.clear(); clearPaperConnectionVerification(); setTokenDraft(""); setConnection({ status: "NOT_CONFIGURED", reason: "PAPER credential cleared from memory." }); };
  const resetSettings = () => { if (!settings || isBusyNow()) return; const previousTheme = settings.theme; credentialSession.clear(); clearPaperConnectionVerification(); setTokenDraft(""); setMode("system"); void persist(DEFAULT_SETTINGS).then((saved) => { if (!saved) setMode(themePreference(previousTheme)); else setConnection({ status: "NOT_CONFIGURED", reason: "PAPER endpoint is not configured." }); }); };
  const signOutLocal = () => { if (!isBusyNow()) onSignOut?.(); };

  if (error && settings === null) return <View style={styles.state} testID="settings-error"><InlineNotice title="설정을 불러올 수 없습니다" detail={error} tone="danger" /></View>;
  if (settings === null) return <View style={styles.state} testID="settings-loading"><ActivityIndicator color={theme.colors.primary} /><Text style={[styles.title, { color: theme.colors.text }]}>설정을 불러오는 중</Text></View>;
  const busy = saving || connecting;
  const connectionTone = connecting ? "info" : connection.status === "READY" ? "success" : connection.status === "UNAVAILABLE" ? "danger" : "warning";
  const connectionLabel = connecting ? "확인 중" : connection.status === "READY" ? "연결됨" : "연결 필요";
  const connectionDetail = connecting ? "저장된 endpoint와 메모리 전용 세션을 검증하고 있습니다." : connection.status === "READY" ? `${connection.snapshot.operations.runtimeState} · ${connection.snapshot.operations.transport}` : connection.reason;

  return <ScrollView contentContainerStyle={styles.content} testID="settings-screen">
    <ScreenHeader eyebrow="APPLICATION" title="설정" description="PAPER 연결과 화면 환경, 로컬 앱 상태를 관리합니다." statusLabel={connectionLabel} statusTone={connectionTone} />
    {error ? <InlineNotice title="설정 저장 오류" detail={error} tone="danger" /> : null}
    <InlineNotice title={connection.status === "READY" ? "PAPER 서버 연결 정상" : "PAPER 서버 연결이 필요합니다"} detail={connectionDetail} tone={connection.status === "READY" ? "success" : connection.status === "UNAVAILABLE" ? "danger" : "warning"} testID="settings-connection-summary" />

    <NusaCard testID="settings-paper-connection" raised>
      <View style={styles.cardHeader}><View><Text style={[styles.cardEyebrow, { color: theme.colors.primary }]}>CONNECTION</Text><Text style={[styles.section, { color: theme.colors.text }]}>PAPER 서버</Text></View><StatusChip label={connectionLabel} tone={connectionTone} /></View>
      <NusaTextField autoCapitalize="none" autoCorrect={false} editable={!busy} keyboardType="url" label="Cloud endpoint" value={endpointDraft} onChangeText={setEndpointDraft} placeholder="https://..." returnKeyType="done" testID="settings-paper-endpoint" />
      <NusaTextField autoCapitalize="none" autoCorrect={false} editable={!busy} label="세션 토큰" value={tokenDraft} onChangeText={setTokenDraft} placeholder="기기에 저장하지 않음" returnKeyType="done" secureTextEntry testID="settings-paper-token" />
      <Text style={[styles.hint, { color: theme.colors.textMuted }]}>Endpoint만 로컬 설정에 저장합니다. 토큰은 현재 앱 프로세스 메모리에만 존재합니다.</Text>
      <View style={styles.row}><NusaButton disabled={busy} label={connecting ? "연결 확인 중..." : "저장하고 연결 확인"} onPress={() => void testConnection()} testID="settings-paper-connect" /><NusaButton disabled={busy || connection.status !== "READY"} label="연결 해제" onPress={disconnect} tone="neutral" testID="settings-paper-disconnect" /></View>
    </NusaCard>

    <NusaCard><View style={styles.cardHeader}><View><Text style={[styles.cardEyebrow, { color: theme.colors.textMuted }]}>APPEARANCE</Text><Text style={[styles.section, { color: theme.colors.text }]}>화면 테마</Text></View></View><SegmentedControl disabled={busy} items={themeItems} selectedKey={settings.theme} onChange={(key) => updateTheme(key as ThemeSetting)} testID="settings-theme-segmented-control" /></NusaCard>

    <NusaCard raised><View style={styles.cardHeader}><View><Text style={[styles.cardEyebrow, { color: theme.colors.info }]}>SAFETY</Text><Text style={[styles.section, { color: theme.colors.text }]}>거래 권한</Text></View><StatusChip label="PAPER ONLY" tone="info" /></View><DataRow label="운영 모드" value="PAPER" emphasis /><DataRow label="LIVE 주문" value="금지" tone="success" /><DataRow label="Production mutation" value="금지" tone="success" /><Text style={[styles.hint, { color: theme.colors.textMuted }]}>LIVE·출금·이체 권한을 이 화면에서 활성화할 수 없습니다.</Text></NusaCard>

    <View style={styles.managementGrid}><View style={styles.managementCell}><NusaCard><Text style={[styles.cardEyebrow, { color: theme.colors.textMuted }]}>ABOUT</Text><Text style={[styles.section, { color: theme.colors.text }]}>앱 정보</Text><DataRow label="클라이언트" value="NUSA Mobile" /><DataRow label="용도" value="PAPER / Personal" /></NusaCard></View><View style={styles.managementCell}><NusaCard><Text style={[styles.cardEyebrow, { color: theme.colors.textMuted }]}>LOCAL DATA</Text><Text style={[styles.section, { color: theme.colors.text }]}>로컬 관리</Text><View style={styles.stack}><NusaButton label={busy ? "작업 중..." : "설정 초기화"} disabled={busy} onPress={resetSettings} tone="danger" />{onSignOut ? <NusaButton disabled={busy} label="개인 모드 종료" onPress={signOutLocal} tone="neutral" testID="settings-sign-out" /> : null}</View></NusaCard></View></View>
  </ScrollView>;
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingTop: 20, gap: 16, paddingBottom: 36, width: "100%", maxWidth: 1080, alignSelf: "center" }, state: { flex: 1, justifyContent: "center", padding: 20, gap: 14 }, title: { fontSize: 18, fontWeight: "700" },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 12 }, cardEyebrow: { fontSize: 10, fontWeight: "800", letterSpacing: 1.1, marginBottom: 4 }, section: { fontSize: 18, lineHeight: 23, fontWeight: "700", letterSpacing: -0.4 },
  hint: { lineHeight: 20, fontSize: 13, marginTop: 10 }, row: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 }, stack: { gap: 8, marginTop: 10 }, managementGrid: { flexDirection: "row", flexWrap: "wrap", gap: 14 }, managementCell: { flexGrow: 1, flexBasis: 360 },
});