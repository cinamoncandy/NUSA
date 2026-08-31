import React, { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { DataRow, NusaButton, NusaCard, NusaTextField, StatusChip } from "./components";
import { InlineNotice, ScreenHeader, SegmentedControl } from "./uxPrimitives";
import { useTheme, type ThemePreference } from "./ThemeProvider";
import { DEFAULT_SETTINGS, normalizeInvestmentPercent, normalizeSettings, type AppSettings, type SettingsRepository, type ThemeSetting } from "./settings";
import { createCashInvestmentEnvelope } from "./capitalAllocationGuard";
import { InMemoryDashboardCredentialSession } from "./dashboardCredentialSession";
import { loadPersonalPaperOperations, type PersonalPaperOperationsLoadResult } from "./personalPaperOperationsClient";
import { clearPaperConnectionVerification, getConfiguredPaperEndpoint, isPaperConnectionVerified, markPaperConnectionVerified, setConfiguredPaperEndpoint } from "./paperConnectionSession";
import { changeOperatorUserStatus, loadOperatorUsers, type OperatorUserAction, type OperatorUserRecord } from "./operatorUserAccessClient";
import { UpbitConnectionPanel } from "./upbitConnectionPanel";
import { resetUpbitReadOnlyState } from "./upbitReadOnlyAccount";
import { getOrCreateInstallationId } from "./installationIdentity";

interface SettingsViewProps { readonly repository: SettingsRepository; readonly onSignOut?: () => void; readonly exchangeCash?: number; readonly onCloudInvestmentPercentSave?: (investmentPercent: number) => Promise<void>; readonly onInvestmentPercentChanged?: (investmentPercent: number) => void; readonly credentialSession?: InMemoryDashboardCredentialSession; readonly canonicalEndpoint?: string | null; }
const themeItems = Object.freeze([{ key: "SYSTEM", label: "시스템" }, { key: "LIGHT", label: "라이트" }, { key: "DARK", label: "다크" }]);
const allocationPresets = Object.freeze([{ key: "25", label: "25%" }, { key: "50", label: "50%" }, { key: "75", label: "75%" }, { key: "100", label: "100%" }]);
const LOCAL_PAPER_INITIAL_CASH = 10_000_000;
const themePreference = (value: ThemeSetting): ThemePreference => value === "SYSTEM" ? "system" : value === "LIGHT" ? "light" : "dark";
const money = (value: number): string => `₩${Math.round(value).toLocaleString("ko-KR")}`;
const actionFor = (user: OperatorUserRecord): readonly OperatorUserAction[] => user.status === "PENDING" ? ["APPROVE", "REJECT"] : user.status === "ACTIVE" ? ["SUSPEND"] : ["RESTORE"];
const actionLabel: Readonly<Record<OperatorUserAction, string>> = { APPROVE: "승인", REJECT: "거절", SUSPEND: "정지", RESTORE: "복구" };

export function SettingsView({ repository, onSignOut, exchangeCash = 0, onCloudInvestmentPercentSave, onInvestmentPercentChanged, credentialSession: sharedCredentialSession, canonicalEndpoint }: SettingsViewProps) {
  const { theme, setMode } = useTheme();
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [endpointDraft, setEndpointDraft] = useState("");
  const [tokenDraft, setTokenDraft] = useState("");
  const [investmentPercentDraft, setInvestmentPercentDraft] = useState(String(DEFAULT_SETTINGS.capitalAllocation.investmentPercent));
  const [connection, setConnection] = useState<PersonalPaperOperationsLoadResult>({ status: "NOT_CONFIGURED", reason: "Cloud PAPER connection is not configured." });
  const [operatorToken, setOperatorToken] = useState("");
  const [operatorUsers, setOperatorUsers] = useState<readonly OperatorUserRecord[]>([]);
  const [operatorError, setOperatorError] = useState<string | null>(null);
  const [operatorBusy, setOperatorBusy] = useState(false);
  const [installationId, setInstallationId] = useState<string | null>(null);
  const localCredentialSession = useMemo(() => new InMemoryDashboardCredentialSession(), []);
  const credentialSession = sharedCredentialSession ?? localCredentialSession;
  const savingRef = useRef(false);
  const connectionInFlightRef = useRef(false);

  useEffect(() => {
    let active = true;
    void repository.load().then(async (loaded) => {
      if (!active) return;
      const loadedSettings = normalizeSettings(loaded ?? DEFAULT_SETTINGS);
      const next = loadedSettings.paperEndpoint || !canonicalEndpoint ? loadedSettings : normalizeSettings({ ...loadedSettings, paperEndpoint: canonicalEndpoint });
      setConfiguredPaperEndpoint(next.paperEndpoint); setSettings(next); setEndpointDraft(next.paperEndpoint); setInvestmentPercentDraft(String(next.capitalAllocation.investmentPercent)); setMode(themePreference(next.theme)); onInvestmentPercentChanged?.(next.capitalAllocation.investmentPercent);
      if (!next.paperEndpoint || !credentialSession.isConfigured() || !isPaperConnectionVerified(next.paperEndpoint)) return;
      const result = await loadPersonalPaperOperations({ baseUrl: next.paperEndpoint, credentialProvider: credentialSession.credentialProvider });
      if (!active) return;
      if (result.status !== "READY") { credentialSession.clear(); clearPaperConnectionVerification(); }
      setConnection(result);
    }).catch((loadError) => { if (active) setError(loadError instanceof Error ? loadError.message : "Settings are unavailable."); });
    return () => { active = false; };
  }, [canonicalEndpoint, credentialSession, onInvestmentPercentChanged, repository, setMode]);

  useEffect(() => { let active = true; void getOrCreateInstallationId(AsyncStorage).then((value) => { if (active) setInstallationId(value); }).catch(() => { if (active) setInstallationId(null); }); return () => { active = false; }; }, []);

  const persist = async (next: AppSettings): Promise<boolean> => {
    if (savingRef.current) return false;
    savingRef.current = true; setSaving(true);
    try {
      const normalized = normalizeSettings(next);
      const allocationChanged = normalized.capitalAllocation.investmentPercent !== settings?.capitalAllocation.investmentPercent;
      if (allocationChanged && onCloudInvestmentPercentSave && connection.status === "READY") await onCloudInvestmentPercentSave(normalized.capitalAllocation.investmentPercent);
      await repository.save(normalized);
      setConfiguredPaperEndpoint(normalized.paperEndpoint); setSettings(normalized); setEndpointDraft(normalized.paperEndpoint); setInvestmentPercentDraft(String(normalized.capitalAllocation.investmentPercent)); setError(null);
      if (allocationChanged) onInvestmentPercentChanged?.(normalized.capitalAllocation.investmentPercent);
      return true;
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : "Settings could not be saved."); return false; }
    finally { savingRef.current = false; setSaving(false); }
  };
  const isBusyNow = () => savingRef.current || connectionInFlightRef.current || operatorBusy;
  const updateTheme = (next: ThemeSetting) => { if (!settings || isBusyNow()) return; const previousTheme = settings.theme; setMode(themePreference(next)); void persist({ ...settings, theme: next }).then((saved) => { if (!saved) setMode(themePreference(previousTheme)); }); };
  const saveInvestmentPercent = async (raw = investmentPercentDraft) => { if (!settings || isBusyNow()) return; try { const value = normalizeInvestmentPercent(Number(raw)); setInvestmentPercentDraft(String(value)); await persist({ ...settings, capitalAllocation: { investmentPercent: value } }); } catch (allocationError) { setError(allocationError instanceof Error ? allocationError.message : "Investment allocation is invalid."); } };
  const testConnection = async () => {
    if (settings == null || isBusyNow()) return;
    connectionInFlightRef.current = true; setConnecting(true); setError(null);
    try {
      if (!await persist({ ...settings, paperEndpoint: endpointDraft })) return;
      const configuredEndpoint = getConfiguredPaperEndpoint();
      if (!configuredEndpoint) { credentialSession.clear(); clearPaperConnectionVerification(); setConnection({ status: "NOT_CONFIGURED", reason: "Cloud PAPER endpoint is not configured." }); return; }
      credentialSession.clear(); clearPaperConnectionVerification(); setConnection({ status: "NOT_CONFIGURED", reason: "Cloud PAPER connection verification is in progress." }); credentialSession.connect(tokenDraft);
      if (!tokenDraft.startsWith("legacy-bootstrap:")) {
        if (installationId == null) throw new Error("Secure installation identity is unavailable.");
        credentialSession.clear();
        await credentialSession.enroll(tokenDraft, installationId);
      }
      const result = await loadPersonalPaperOperations({ baseUrl: configuredEndpoint, credentialProvider: credentialSession.credentialProvider, allowUnverifiedEndpoint: true });
      if (result.status === "READY") { markPaperConnectionVerified(configuredEndpoint); setTokenDraft(""); } else { credentialSession.clear(); clearPaperConnectionVerification(); }
      setConnection(result);
    } catch (connectionError) { credentialSession.clear(); clearPaperConnectionVerification(); setConnection({ status: "NOT_CONFIGURED", reason: connectionError instanceof Error ? connectionError.message : "Cloud PAPER 최초 인증 또는 보안 세션이 유효하지 않습니다." }); }
    finally { connectionInFlightRef.current = false; setConnecting(false); }
  };
  const disconnect = () => { if (isBusyNow()) return; credentialSession.clear(); clearPaperConnectionVerification(); setTokenDraft(""); setConnection({ status: "NOT_CONFIGURED", reason: "Cloud PAPER 보안 세션을 해제했습니다. LOCAL PAPER는 계속 사용할 수 있습니다." }); };
  const refreshOperatorUsers = async (): Promise<void> => {
    const baseUrl = getConfiguredPaperEndpoint() ?? endpointDraft.trim();
    if (!baseUrl) { setOperatorError("운영자 기능을 쓰려면 Cloud endpoint를 먼저 설정하세요."); return; }
    setOperatorBusy(true);
    try { const snapshot = await loadOperatorUsers(baseUrl, operatorToken); setOperatorUsers(snapshot.users); setOperatorError(null); }
    catch (loadError) { setOperatorUsers([]); setOperatorError(loadError instanceof Error ? loadError.message : "사용자 목록을 불러올 수 없습니다."); }
    finally { setOperatorBusy(false); }
  };
  const applyOperatorAction = async (user: OperatorUserRecord, action: OperatorUserAction): Promise<void> => {
    const baseUrl = getConfiguredPaperEndpoint() ?? endpointDraft.trim();
    if (!baseUrl) { setOperatorError("운영자 기능을 쓰려면 Cloud endpoint를 먼저 설정하세요."); return; }
    setOperatorBusy(true);
    try { await changeOperatorUserStatus(baseUrl, operatorToken, user.id, action); const snapshot = await loadOperatorUsers(baseUrl, operatorToken); setOperatorUsers(snapshot.users); setOperatorError(null); }
    catch (actionError) { setOperatorError(actionError instanceof Error ? actionError.message : "사용자 상태를 변경할 수 없습니다."); }
    finally { setOperatorBusy(false); }
  };
  const resetSettings = () => { if (!settings || isBusyNow()) return; const previousTheme = settings.theme; credentialSession.clear(); clearPaperConnectionVerification(); resetUpbitReadOnlyState(); setTokenDraft(""); setOperatorToken(""); setOperatorUsers([]); setOperatorError(null); setMode("system"); void persist(DEFAULT_SETTINGS).then((saved) => { if (!saved) setMode(themePreference(previousTheme)); else setConnection({ status: "NOT_CONFIGURED", reason: "Cloud PAPER는 선택 사항입니다." }); }); };
  const signOutLocal = () => { if (!isBusyNow()) { setOperatorToken(""); onSignOut?.(); } };

  if (error && settings === null) return <View style={styles.state} testID="settings-error"><InlineNotice title="설정을 불러올 수 없습니다" detail={error} tone="danger" /></View>;
  if (settings === null) return <View style={styles.state} testID="settings-loading"><ActivityIndicator color={theme.colors.primary} /><Text style={[styles.title, { color: theme.colors.text }]}>설정을 불러오는 중</Text></View>;
  const busy = saving || connecting || operatorBusy;
  const cloudConnectionTone = connecting ? "info" : connection.status === "READY" ? "success" : connection.status === "UNAVAILABLE" ? "danger" : "neutral";
  const cloudConnectionLabel = connecting ? "확인 중" : connection.status === "READY" ? "연결됨" : "선택 사항";
  const cloudConnectionDetail = connecting ? "저장된 endpoint와 승인된 보안 세션을 검증하고 있습니다." : connection.status === "READY" ? `${connection.snapshot.operations.runtimeState} · ${connection.snapshot.operations.transport}` : "Cloud 연결 없이 LOCAL PAPER를 바로 사용할 수 있습니다. Cloud PAPER 동기화가 필요할 때만 아래 항목을 연결하세요.";
  const allocationCash = exchangeCash > 0 ? exchangeCash : LOCAL_PAPER_INITIAL_CASH;
  const allocation = createCashInvestmentEnvelope(allocationCash, settings.capitalAllocation.investmentPercent);
  const selectedPreset = allocationPresets.some((item) => item.key === String(settings.capitalAllocation.investmentPercent)) ? String(settings.capitalAllocation.investmentPercent) : "";
  const allocationWidth = `${allocation.investmentPercent}%` as `${number}%`;
  const pendingUsers = operatorUsers.filter((user) => user.status === "PENDING").length;
  const activeUsers = operatorUsers.filter((user) => user.status === "ACTIVE").length;

  return <ScrollView contentContainerStyle={styles.content} testID="settings-screen">
    <ScreenHeader eyebrow="APPLICATION" title="설정" description="LOCAL PAPER는 연결 없이 즉시 사용할 수 있습니다. Cloud 기능은 선택 사항입니다." statusLabel="LOCAL 준비됨" statusTone="success" />
    {error ? <InlineNotice title="설정 저장 오류" detail={error} tone="danger" /> : null}

    <View style={styles.sectionBlock} testID="settings-local-paper"><View style={styles.sectionHeader}><View><Text style={[styles.eyebrow, { color: theme.colors.textMuted }]}>01 · LOCAL PAPER</Text><Text style={[styles.sectionTitle, { color: theme.colors.text }]}>즉시 사용</Text></View><StatusChip label="준비됨" tone="success" /></View><InlineNotice title="연결 없이 PAPER 가능" detail={`Upbit 공개 시세와 가상자금 ${money(LOCAL_PAPER_INITIAL_CASH)}으로 PAPER 탭에서 바로 매수·매도할 수 있습니다. bootstrap token과 Cloud endpoint는 필요하지 않습니다.`} tone="success" testID="settings-local-paper-ready" /></View>

    <View style={[styles.divider, { backgroundColor: theme.colors.border }]} />
    <View style={styles.sectionBlock} testID="settings-paper-connection"><View style={styles.sectionHeader}><View><Text style={[styles.eyebrow, { color: theme.colors.textMuted }]}>02 · CLOUD PAPER</Text><Text style={[styles.sectionTitle, { color: theme.colors.text }]}>Cloud PAPER 동기화</Text></View><StatusChip label={cloudConnectionLabel} tone={cloudConnectionTone} /></View><InlineNotice title={connection.status === "READY" ? "Cloud 연결 정상" : "최초 인증 필요"} detail={canonicalEndpoint ? cloudConnectionDetail : "이 release에는 canonical Cloud HTTPS origin이 아직 주입되지 않았습니다."} tone={connection.status === "READY" ? "success" : connection.status === "UNAVAILABLE" ? "warning" : "info"} testID="settings-connection-summary" /><NusaTextField autoCapitalize="none" autoCorrect={false} editable={!busy && !canonicalEndpoint} keyboardType="url" label="Cloud endpoint (선택)" value={endpointDraft} onChangeText={setEndpointDraft} placeholder="https://..." returnKeyType="done" testID="settings-paper-endpoint" /><NusaTextField autoCapitalize="none" autoCorrect={false} editable={!busy} label="1회용 연결 토큰 (선택)" value={tokenDraft} onChangeText={setTokenDraft} placeholder="Cloud를 사용할 때만 입력" returnKeyType="done" secureTextEntry testID="settings-paper-token" /><Text style={[styles.hint, { color: theme.colors.textMuted }]}>최초 인증 토큰은 이 요청에서만 사용되고 저장되지 않습니다. bootstrap token은 저장하지 않고 한 번만 세션으로 교환합니다. LOCAL PAPER 거래에는 사용하지 않습니다. 인증 후에는 Android Secure Storage의 회전 refresh 세션으로 endpoint/token 입력 없이 자동 복구합니다. endpoint 직접 입력과 legacy bootstrap token은 개발 진단 경로입니다.</Text><View style={styles.row}><NusaButton disabled={busy} label={connecting ? "연결 확인 중..." : "Cloud 연결"} onPress={() => void testConnection()} testID="settings-paper-connect" /><NusaButton disabled={busy || connection.status !== "READY"} label="Cloud 연결 해제" onPress={disconnect} tone="neutral" testID="settings-paper-disconnect" /></View></View>

    <View style={[styles.divider, { backgroundColor: theme.colors.border }]} />
    <UpbitConnectionPanel />

    <View style={[styles.divider, { backgroundColor: theme.colors.border }]} />
    <View style={styles.sectionBlock} testID="settings-capital-allocation"><View style={styles.sectionHeader}><View><Text style={[styles.eyebrow, { color: theme.colors.textMuted }]}>03 · CASH ALLOCATION</Text><Text style={[styles.sectionTitle, { color: theme.colors.text }]}>현금 투자 비중</Text></View><Text style={[styles.allocationPercent, { color: theme.colors.primary }]}>{allocation.investmentPercent}%</Text></View><Text style={[styles.hint, { color: theme.colors.textMuted }]}>LOCAL PAPER 가상 현금 중 신규 매수에 사용할 최대 비중입니다. Cloud 계좌가 연결된 경우에는 해당 PAPER 현금을 사용합니다.</Text><View style={[styles.allocationTrack, { backgroundColor: theme.colors.border }]}><View style={[styles.allocationFill, { width: allocationWidth, backgroundColor: theme.colors.primary }]} /></View><View style={styles.allocationAmounts}><View><Text style={[styles.amountLabel, { color: theme.colors.textMuted }]}>투자 가능 금액</Text><Text style={[styles.amountValue, { color: theme.colors.text }]}>{money(allocation.investableCash)}</Text></View><View style={styles.amountRight}><Text style={[styles.amountLabel, { color: theme.colors.textMuted }]}>보호 현금</Text><Text style={[styles.amountValue, { color: theme.colors.text }]}>{money(allocation.reservedCash)}</Text></View></View><SegmentedControl disabled={busy} items={allocationPresets} selectedKey={selectedPreset} onChange={(key) => { setInvestmentPercentDraft(key); void saveInvestmentPercent(key); }} testID="settings-investment-allocation-presets" /><NusaTextField autoCorrect={false} editable={!busy} keyboardType="decimal-pad" label="직접 입력 (%)" value={investmentPercentDraft} onChangeText={setInvestmentPercentDraft} placeholder="0 - 100" returnKeyType="done" testID="settings-investment-percent" /><NusaButton disabled={busy} label={saving ? "저장 중..." : "투자 비중 저장"} onPress={() => void saveInvestmentPercent()} testID="settings-investment-percent-save" /><Text style={[styles.hint, { color: theme.colors.textMuted }]}>0%는 신규 매수를 막고 전액을 보호합니다. 매도·청산에는 이 한도를 적용하지 않습니다.</Text></View>

    <View style={[styles.divider, { backgroundColor: theme.colors.border }]} />
    <View style={styles.sectionBlock} testID="settings-theme"><Text style={[styles.eyebrow, { color: theme.colors.textMuted }]}>04 · APPEARANCE</Text><Text style={[styles.sectionTitle, { color: theme.colors.text }]}>화면 테마</Text><SegmentedControl disabled={busy} items={themeItems} selectedKey={settings.theme} onChange={(key) => updateTheme(key as ThemeSetting)} testID="settings-theme-segmented-control" /></View>

    <View style={[styles.divider, { backgroundColor: theme.colors.border }]} />
    <View style={styles.sectionBlock} testID="settings-safety"><View style={styles.sectionHeader}><View><Text style={[styles.eyebrow, { color: theme.colors.textMuted }]}>05 · SAFETY & AUTHORITY</Text><Text style={[styles.sectionTitle, { color: theme.colors.text }]}>안전 상태</Text></View><StatusChip label="PAPER ONLY" tone="info" /></View><NusaCard><DataRow label="기본 운영 모드" value="LOCAL PAPER" emphasis /><DataRow label="Cloud 연결" value="선택" /><DataRow label="LIVE 주문" value="금지" /><DataRow label="Production mutation" value="금지" /><Text style={[styles.hint, { color: theme.colors.textMuted }]}>LOCAL PAPER는 연결 없이 동작하며 LIVE·출금·이체 권한은 이 화면에서 활성화할 수 없습니다.</Text></NusaCard></View>

    <View style={[styles.divider, { backgroundColor: theme.colors.border }]} />
    <View style={styles.sectionBlock} testID="settings-mode"><Text style={[styles.eyebrow, { color: theme.colors.textMuted }]}>06 · LOCAL & PERSONAL</Text><Text style={[styles.sectionTitle, { color: theme.colors.text }]}>로컬과 개인 모드 관리</Text><NusaCard testID="settings-about"><DataRow label="클라이언트" value="NUSA Mobile 0.1.0" /><DataRow label="용도" value="LOCAL PAPER / Read Only" /></NusaCard><View style={styles.row} testID="settings-reset"><NusaButton label={busy ? "작업 중..." : "설정 초기화"} disabled={busy} onPress={resetSettings} tone="danger" /></View>{onSignOut ? <View testID="settings-session"><NusaButton disabled={busy} label="개인 모드 종료" onPress={signOutLocal} tone="neutral" testID="settings-sign-out" /></View> : null}</View>

    <View style={[styles.divider, { backgroundColor: theme.colors.border }]} />
    <View style={styles.sectionBlock} testID="settings-operator-users"><View style={styles.sectionHeader}><View><Text style={[styles.eyebrow, { color: theme.colors.textMuted }]}>07 · USER ACCESS</Text><Text style={[styles.sectionTitle, { color: theme.colors.text }]}>운영자 사용자 승인</Text></View><StatusChip label="CLOUD ONLY" tone="neutral" /></View><Text style={[styles.hint, { color: theme.colors.textMuted }]}>이 기능만 Cloud 연결이 필요합니다. LOCAL PAPER 거래와는 무관합니다.</Text><NusaTextField autoCapitalize="none" autoCorrect={false} editable={!busy} label="운영자 토큰" value={operatorToken} onChangeText={setOperatorToken} placeholder="메모리에만 유지" secureTextEntry testID="operator-user-token" /><View style={styles.row}><NusaButton disabled={busy} label={operatorBusy ? "불러오는 중..." : "사용자 목록 불러오기"} onPress={() => void refreshOperatorUsers()} testID="operator-user-refresh" /><NusaButton disabled={busy && !operatorToken} label="토큰 지우기" tone="neutral" onPress={() => { setOperatorToken(""); setOperatorUsers([]); setOperatorError(null); }} /></View>{operatorError ? <InlineNotice title="사용자 관리 오류" detail={operatorError} tone="danger" testID="operator-user-error" /> : null}{operatorUsers.length > 0 ? <><DataRow label="전체 사용자" value={String(operatorUsers.length)} emphasis /><DataRow label="승인 대기" value={String(pendingUsers)} /><DataRow label="활성" value={String(activeUsers)} />{operatorUsers.map((user) => <NusaCard key={user.id} testID={`operator-user-${user.id}`}><View style={styles.sectionHeader}><View><Text style={[styles.userName, { color: theme.colors.text }]}>{user.displayName || user.email}</Text><Text style={[styles.hint, { color: theme.colors.textMuted }]}>{user.email} · {user.role}</Text></View><StatusChip label={user.status} tone={user.status === "ACTIVE" ? "success" : user.status === "PENDING" ? "warning" : "danger"} /></View>{user.lastSeenAt ? <Text style={[styles.hint, { color: theme.colors.textMuted }]}>최근 활동: {new Date(user.lastSeenAt).toLocaleString("ko-KR")}</Text> : null}{user.role !== "OWNER" ? <View style={styles.row}>{actionFor(user).map((action) => <NusaButton key={action} disabled={busy} label={actionLabel[action]} onPress={() => void applyOperatorAction(user, action)} tone={action === "REJECT" || action === "SUSPEND" ? "danger" : "primary"} testID={`operator-user-${user.id}-${action.toLowerCase()}`} />)}</View> : null}</NusaCard>)}</> : null}</View>
  </ScrollView>;
}

const styles = StyleSheet.create({ content: { paddingHorizontal: 20, paddingTop: 20, gap: 18, paddingBottom: 40, width: "100%", maxWidth: 820, alignSelf: "center" }, state: { flex: 1, justifyContent: "center", padding: 20, gap: 14 }, title: { fontSize: 18, fontWeight: "700" }, sectionBlock: { gap: 12 }, sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }, eyebrow: { fontSize: 10, lineHeight: 15, fontWeight: "800", letterSpacing: 1.1 }, sectionTitle: { marginTop: 4, fontSize: 21, lineHeight: 27, fontWeight: "800", letterSpacing: -0.5 }, hint: { fontSize: 13, lineHeight: 20 }, userName: { fontSize: 15, lineHeight: 21, fontWeight: "700" }, row: { flexDirection: "row", gap: 10, flexWrap: "wrap" }, settingRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12 }, divider: { height: StyleSheet.hairlineWidth }, allocationPercent: { fontSize: 22, lineHeight: 28, fontWeight: "800", fontVariant: ["tabular-nums"] }, allocationTrack: { height: 8, borderRadius: 999, overflow: "hidden" }, allocationFill: { height: "100%", borderRadius: 999 }, allocationAmounts: { flexDirection: "row", justifyContent: "space-between", gap: 18 }, amountRight: { alignItems: "flex-end" }, amountLabel: { fontSize: 11, lineHeight: 16, fontWeight: "700" }, amountValue: { marginTop: 3, fontSize: 18, lineHeight: 24, fontWeight: "800", fontVariant: ["tabular-nums"] } });