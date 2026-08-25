import React, { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import mobilePackage from "../package.json";
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

interface SettingsViewProps { readonly repository: SettingsRepository; readonly onSignOut?: () => void; readonly exchangeCash?: number; readonly onCloudInvestmentPercentSave?: (investmentPercent: number) => Promise<void>; readonly onInvestmentPercentChanged?: (investmentPercent: number) => void; }
const themeItems = Object.freeze([{ key: "SYSTEM", label: "시스템" }, { key: "LIGHT", label: "라이트" }, { key: "DARK", label: "다크" }]);
const allocationPresets = Object.freeze([{ key: "25", label: "25%" }, { key: "50", label: "50%" }, { key: "75", label: "75%" }, { key: "100", label: "100%" }]);
const themePreference = (value: ThemeSetting): ThemePreference => value === "SYSTEM" ? "system" : value === "LIGHT" ? "light" : "dark";
const money = (value: number): string => `₩${Math.round(value).toLocaleString("ko-KR")}`;
const actionFor = (user: OperatorUserRecord): readonly OperatorUserAction[] => user.status === "PENDING" ? ["APPROVE", "REJECT"] : user.status === "ACTIVE" ? ["SUSPEND"] : ["RESTORE"];
const actionLabel: Readonly<Record<OperatorUserAction, string>> = { APPROVE: "승인", REJECT: "거절", SUSPEND: "정지", RESTORE: "복구" };

export function SettingsView({ repository, onSignOut, exchangeCash = 0, onCloudInvestmentPercentSave, onInvestmentPercentChanged }: SettingsViewProps) {
  const { theme, setMode } = useTheme();
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [endpointDraft, setEndpointDraft] = useState("");
  const [tokenDraft, setTokenDraft] = useState("");
  const [investmentPercentDraft, setInvestmentPercentDraft] = useState(String(DEFAULT_SETTINGS.capitalAllocation.investmentPercent));
  const [connection, setConnection] = useState<PersonalPaperOperationsLoadResult>({ status: "NOT_CONFIGURED", reason: "PAPER connection is not configured." });
  const [operatorToken, setOperatorToken] = useState("");
  const [operatorUsers, setOperatorUsers] = useState<readonly OperatorUserRecord[]>([]);
  const [operatorError, setOperatorError] = useState<string | null>(null);
  const [operatorBusy, setOperatorBusy] = useState(false);
  const credentialSession = useMemo(() => new InMemoryDashboardCredentialSession(), []);
  const savingRef = useRef(false);
  const connectionInFlightRef = useRef(false);

  useEffect(() => {
    let active = true;
    void repository.load().then(async (loaded) => {
      if (!active) return;
      const next = normalizeSettings(loaded ?? DEFAULT_SETTINGS);
      setConfiguredPaperEndpoint(next.paperEndpoint); setSettings(next); setEndpointDraft(next.paperEndpoint); setInvestmentPercentDraft(String(next.capitalAllocation.investmentPercent)); setMode(themePreference(next.theme)); onInvestmentPercentChanged?.(next.capitalAllocation.investmentPercent);
      if (!next.paperEndpoint || !credentialSession.isConfigured() || !isPaperConnectionVerified(next.paperEndpoint)) return;
      const result = await loadPersonalPaperOperations({ baseUrl: next.paperEndpoint, credentialProvider: credentialSession.credentialProvider });
      if (!active) return;
      if (result.status !== "READY") { credentialSession.clear(); clearPaperConnectionVerification(); }
      setConnection(result);
    }).catch((loadError) => { if (active) setError(loadError instanceof Error ? loadError.message : "Settings are unavailable."); });
    return () => { active = false; };
  }, [credentialSession, onInvestmentPercentChanged, repository, setMode]);

  const persist = async (next: AppSettings): Promise<boolean> => {
    if (savingRef.current) return false;
    savingRef.current = true; setSaving(true);
    try {
      const normalized = normalizeSettings(next);
      const allocationChanged = normalized.capitalAllocation.investmentPercent !== settings?.capitalAllocation.investmentPercent;
      if (allocationChanged && onCloudInvestmentPercentSave) await onCloudInvestmentPercentSave(normalized.capitalAllocation.investmentPercent);
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
      if (!configuredEndpoint) { credentialSession.clear(); clearPaperConnectionVerification(); setConnection({ status: "NOT_CONFIGURED", reason: "PAPER endpoint is not configured." }); return; }
      credentialSession.clear(); clearPaperConnectionVerification(); setConnection({ status: "NOT_CONFIGURED", reason: "PAPER connection verification is in progress." }); credentialSession.connect(tokenDraft);
      const result = await loadPersonalPaperOperations({ baseUrl: configuredEndpoint, credentialProvider: credentialSession.credentialProvider, allowUnverifiedEndpoint: true });
      if (result.status === "READY") { markPaperConnectionVerified(configuredEndpoint); setTokenDraft(""); } else { credentialSession.clear(); clearPaperConnectionVerification(); }
      setConnection(result);
    } catch (connectionError) { credentialSession.clear(); clearPaperConnectionVerification(); setConnection({ status: "NOT_CONFIGURED", reason: connectionError instanceof Error ? connectionError.message : "PAPER bootstrap token 또는 보안 세션이 유효하지 않습니다." }); }
    finally { connectionInFlightRef.current = false; setConnecting(false); }
  };
  const disconnect = () => { if (isBusyNow()) return; credentialSession.clear(); clearPaperConnectionVerification(); setTokenDraft(""); setConnection({ status: "NOT_CONFIGURED", reason: "PAPER 보안 세션을 해제했습니다." }); };
  const refreshOperatorUsers = async (): Promise<void> => {
    const baseUrl = getConfiguredPaperEndpoint() ?? endpointDraft.trim();
    if (!baseUrl) { setOperatorError("먼저 PAPER 서버 endpoint를 설정하세요."); return; }
    setOperatorBusy(true);
    try { const snapshot = await loadOperatorUsers(baseUrl, operatorToken); setOperatorUsers(snapshot.users); setOperatorError(null); }
    catch (loadError) { setOperatorUsers([]); setOperatorError(loadError instanceof Error ? loadError.message : "사용자 목록을 불러올 수 없습니다."); }
    finally { setOperatorBusy(false); }
  };
  const applyOperatorAction = async (user: OperatorUserRecord, action: OperatorUserAction): Promise<void> => {
    const baseUrl = getConfiguredPaperEndpoint() ?? endpointDraft.trim();
    if (!baseUrl) { setOperatorError("먼저 PAPER 서버 endpoint를 설정하세요."); return; }
    setOperatorBusy(true);
    try { await changeOperatorUserStatus(baseUrl, operatorToken, user.id, action); const snapshot = await loadOperatorUsers(baseUrl, operatorToken); setOperatorUsers(snapshot.users); setOperatorError(null); }
    catch (actionError) { setOperatorError(actionError instanceof Error ? actionError.message : "사용자 상태를 변경할 수 없습니다."); }
    finally { setOperatorBusy(false); }
  };
  const resetSettings = () => { if (!settings || isBusyNow()) return; const previousTheme = settings.theme; credentialSession.clear(); clearPaperConnectionVerification(); resetUpbitReadOnlyState(); setTokenDraft(""); setOperatorToken(""); setOperatorUsers([]); setOperatorError(null); setMode("system"); void persist(DEFAULT_SETTINGS).then((saved) => { if (!saved) setMode(themePreference(previousTheme)); else setConnection({ status: "NOT_CONFIGURED", reason: "PAPER endpoint is not configured." }); }); };
  const signOutLocal = () => { if (!isBusyNow()) { setOperatorToken(""); onSignOut?.(); } };

  if (error && settings === null) return <View style={styles.state} testID="settings-error"><InlineNotice title="설정을 불러올 수 없습니다" detail={error} tone="danger" /></View>;
  if (settings === null) return <View style={styles.state} testID="settings-loading"><ActivityIndicator color={theme.colors.primary} /><Text style={[styles.title, { color: theme.colors.text }]}>설정을 불러오는 중</Text></View>;
  const busy = saving || connecting || operatorBusy;
  const connectionTone = connecting ? "info" : connection.status === "READY" ? "success" : connection.status === "UNAVAILABLE" ? "danger" : "warning";
  const connectionLabel = connecting ? "확인 중" : connection.status === "READY" ? "연결됨" : "연결 필요";
  const connectionDetail = connecting ? "저장된 endpoint와 승인된 보안 세션을 검증하고 있습니다." : connection.status === "READY" ? `${connection.snapshot.operations.runtimeState} · ${connection.snapshot.operations.transport}` : connection.reason;
  const allocation = createCashInvestmentEnvelope(exchangeCash, settings.capitalAllocation.investmentPercent);
  const selectedPreset = allocationPresets.some((item) => item.key === String(settings.capitalAllocation.investmentPercent)) ? String(settings.capitalAllocation.investmentPercent) : "";
  const allocationWidth = `${allocation.investmentPercent}%` as `${number}%`;
  const pendingUsers = operatorUsers.filter((user) => user.status === "PENDING").length;
  const activeUsers = operatorUsers.filter((user) => user.status === "ACTIVE").length;

  return <ScrollView contentContainerStyle={styles.content} testID="settings-screen">
    <ScreenHeader eyebrow="APPLICATION" title="설정" description="연결, 투자 비중, 화면, 안전 상태와 로컬 데이터를 관리합니다." statusLabel={connectionLabel} statusTone={connectionTone} />
    {error ? <InlineNotice title="설정 저장 오류" detail={error} tone="danger" /> : null}

    {/* v5 (docs/NUSA_MOBILE_UIUX_V5_OBSIDIAN_FINANCE.md §10) order: connection -> cash
        allocation -> appearance -> safety/authority -> local/personal-mode management.
        Operator user access (owner-only, not one of the 5 canonical steps) moves after them. */}
    <View style={styles.sectionBlock} testID="settings-paper-connection"><View style={styles.sectionHeader}><View><Text style={[styles.eyebrow, { color: theme.colors.textMuted }]}>01 · CONNECTION</Text><Text style={[styles.sectionTitle, { color: theme.colors.text }]}>PAPER 서버</Text></View><StatusChip label={connectionLabel} tone={connectionTone} /></View><InlineNotice title={connection.status === "READY" ? "연결 정상" : "연결 필요"} detail={connectionDetail} tone={connection.status === "READY" ? "success" : connection.status === "UNAVAILABLE" ? "danger" : "warning"} testID="settings-connection-summary" /><NusaTextField autoCapitalize="none" autoCorrect={false} editable={!busy} keyboardType="url" label="Cloud endpoint" value={endpointDraft} onChangeText={setEndpointDraft} placeholder="https://..." returnKeyType="done" testID="settings-paper-endpoint" /><NusaTextField autoCapitalize="none" autoCorrect={false} editable={!busy} label="1회용 연결 토큰" value={tokenDraft} onChangeText={setTokenDraft} placeholder="OWNER가 발급한 bootstrap token" returnKeyType="done" secureTextEntry testID="settings-paper-token" /><Text style={[styles.hint, { color: theme.colors.textMuted }]}>입력한 bootstrap token은 저장하지 않고 한 번만 세션으로 교환합니다. Access token은 앱 메모리에만 유지하고, rotating refresh token은 Android Keystore로 암호화해 저장합니다. iOS 영구 세션 복원은 아직 활성화하지 않습니다.</Text><View style={styles.row}><NusaButton disabled={busy} label={connecting ? "연결 확인 중..." : "저장하고 연결 확인"} onPress={() => void testConnection()} testID="settings-paper-connect" /><NusaButton disabled={busy || connection.status !== "READY"} label="연결 해제" onPress={disconnect} tone="neutral" testID="settings-paper-disconnect" /></View></View>

    <View style={[styles.divider, { backgroundColor: theme.colors.border }]} />
    <UpbitConnectionPanel />

    <View style={[styles.divider, { backgroundColor: theme.colors.border }]} />
    <View style={styles.sectionBlock} testID="settings-capital-allocation"><View style={styles.sectionHeader}><View><Text style={[styles.eyebrow, { color: theme.colors.textMuted }]}>03 · CASH ALLOCATION</Text><Text style={[styles.sectionTitle, { color: theme.colors.text }]}>현금 투자 비중</Text></View><Text style={[styles.allocationPercent, { color: theme.colors.primary }]}>{allocation.investmentPercent}%</Text></View><Text style={[styles.hint, { color: theme.colors.textMuted }]}>거래소 PAPER 현금 중 신규 매수에 사용할 최대 비중입니다. 나머지는 자동으로 보호 현금으로 남깁니다.</Text><View style={[styles.allocationTrack, { backgroundColor: theme.colors.border }]}><View style={[styles.allocationFill, { width: allocationWidth, backgroundColor: theme.colors.primary }]} /></View><View style={styles.allocationAmounts}><View><Text style={[styles.amountLabel, { color: theme.colors.textMuted }]}>실제 투자 가능 금액</Text><Text style={[styles.amountValue, { color: theme.colors.text }]}>{money(allocation.investableCash)}</Text></View><View style={styles.amountRight}><Text style={[styles.amountLabel, { color: theme.colors.textMuted }]}>보호되는 현금 금액</Text><Text style={[styles.amountValue, { color: theme.colors.text }]}>{money(allocation.reservedCash)}</Text></View></View><SegmentedControl disabled={busy} items={allocationPresets} selectedKey={selectedPreset} onChange={(key) => { setInvestmentPercentDraft(key); void saveInvestmentPercent(key); }} testID="settings-investment-allocation-presets" /><NusaTextField autoCorrect={false} editable={!busy} keyboardType="decimal-pad" label="직접 입력 (%)" value={investmentPercentDraft} onChangeText={setInvestmentPercentDraft} placeholder="0 - 100" returnKeyType="done" testID="settings-investment-percent" /><NusaButton disabled={busy} label={saving ? "저장 중..." : "투자 비중 저장"} onPress={() => void saveInvestmentPercent()} testID="settings-investment-percent-save" /><Text style={[styles.hint, { color: theme.colors.textMuted }]}>0%는 신규 매수를 막고 전액을 보호합니다. 매도·청산에는 이 한도를 적용하지 않습니다.</Text></View>

    <View style={[styles.divider, { backgroundColor: theme.colors.border }]} />
    <View style={styles.sectionBlock} testID="settings-theme"><Text style={[styles.eyebrow, { color: theme.colors.textMuted }]}>04 · APPEARANCE</Text><Text style={[styles.sectionTitle, { color: theme.colors.text }]}>화면 테마</Text><SegmentedControl disabled={busy} items={themeItems} selectedKey={settings.theme} onChange={(key) => updateTheme(key as ThemeSetting)} testID="settings-theme-segmented-control" /></View>

    <View style={[styles.divider, { backgroundColor: theme.colors.border }]} />
    <View style={styles.sectionBlock} testID="settings-safety"><View style={styles.sectionHeader}><View><Text style={[styles.eyebrow, { color: theme.colors.textMuted }]}>05 · SAFETY & AUTHORITY</Text><Text style={[styles.sectionTitle, { color: theme.colors.text }]}>안전 상태</Text></View><StatusChip label="READ ONLY" tone="info" /></View><NusaCard><DataRow label="운영 모드" value="PAPER" emphasis /><DataRow label="LIVE 주문" value="금지" tone="success" /><DataRow label="Production mutation" value="금지" tone="success" /><Text style={[styles.hint, { color: theme.colors.textMuted }]}>LIVE·출금·이체 권한은 이 화면에서 활성화할 수 없습니다.</Text></NusaCard></View>

    <View style={[styles.divider, { backgroundColor: theme.colors.border }]} />
    <View style={styles.sectionBlock} testID="settings-mode"><Text style={[styles.eyebrow, { color: theme.colors.textMuted }]}>06 · LOCAL & PERSONAL</Text><Text style={[styles.sectionTitle, { color: theme.colors.text }]}>로컬과 개인 모드 관리</Text><NusaCard testID="settings-about"><DataRow label="클라이언트" value={`NUSA Mobile ${mobilePackage.version}`} /><DataRow label="용도" value="PAPER / Read Only" /></NusaCard><View style={styles.row} testID="settings-reset"><NusaButton label={busy ? "작업 중..." : "설정 초기화"} disabled={busy} onPress={resetSettings} tone="danger" /></View>{onSignOut ? <View testID="settings-session"><NusaButton disabled={busy} label="개인 모드 종료" onPress={signOutLocal} tone="neutral" testID="settings-sign-out" /></View> : null}</View>

    <View style={[styles.divider, { backgroundColor: theme.colors.border }]} />
    <View style={styles.sectionBlock} testID="settings-operator-users"><View style={styles.sectionHeader}><View><Text style={[styles.eyebrow, { color: theme.colors.textMuted }]}>07 · USER ACCESS</Text><Text style={[styles.sectionTitle, { color: theme.colors.text }]}>운영자 사용자 승인</Text></View><StatusChip label="OWNER ONLY" tone="warning" /></View><Text style={[styles.hint, { color: theme.colors.textMuted }]}>등록 사용자 조회와 승인·거절·정지·복구는 서버의 users:manage 권한으로만 실행됩니다. 운영자 토큰은 저장하지 않습니다.</Text><NusaTextField autoCapitalize="none" autoCorrect={false} editable={!busy} label="운영자 토큰" value={operatorToken} onChangeText={setOperatorToken} placeholder="메모리에만 유지" secureTextEntry testID="operator-user-token" /><View style={styles.row}><NusaButton disabled={busy} label={operatorBusy ? "불러오는 중..." : "사용자 목록 불러오기"} onPress={() => void refreshOperatorUsers()} testID="operator-user-refresh" /><NusaButton disabled={busy && !operatorToken} label="토큰 지우기" tone="neutral" onPress={() => { setOperatorToken(""); setOperatorUsers([]); setOperatorError(null); }} /></View>{operatorError ? <InlineNotice title="사용자 관리 오류" detail={operatorError} tone="danger" testID="operator-user-error" /> : null}{operatorUsers.length > 0 ? <><DataRow label="전체 사용자" value={String(operatorUsers.length)} emphasis /><DataRow label="승인 대기" value={String(pendingUsers)} /><DataRow label="활성" value={String(activeUsers)} />{operatorUsers.map((user) => <NusaCard key={user.id} testID={`operator-user-${user.id}`}><View style={styles.sectionHeader}><View><Text style={[styles.userName, { color: theme.colors.text }]}>{user.displayName || user.email}</Text><Text style={[styles.hint, { color: theme.colors.textMuted }]}>{user.email} · {user.role}</Text></View><StatusChip label={user.status} tone={user.status === "ACTIVE" ? "success" : user.status === "PENDING" ? "warning" : "danger"} /></View>{user.lastSeenAt ? <Text style={[styles.hint, { color: theme.colors.textMuted }]}>최근 활동: {new Date(user.lastSeenAt).toLocaleString("ko-KR")}</Text> : null}{user.role !== "OWNER" ? <View style={styles.row}>{actionFor(user).map((action) => <NusaButton key={action} disabled={busy} label={actionLabel[action]} onPress={() => void applyOperatorAction(user, action)} tone={action === "REJECT" || action === "SUSPEND" ? "danger" : "primary"} testID={`operator-user-${user.id}-${action.toLowerCase()}`} />)}</View> : null}</NusaCard>)}</> : null}</View>
  </ScrollView>;
}

const styles = StyleSheet.create({ content: { paddingHorizontal: 20, paddingTop: 20, gap: 18, paddingBottom: 40, width: "100%", maxWidth: 820, alignSelf: "center" }, state: { flex: 1, justifyContent: "center", padding: 20, gap: 14 }, title: { fontSize: 18, fontWeight: "700" }, sectionBlock: { gap: 12 }, sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }, eyebrow: { fontSize: 10, lineHeight: 15, fontWeight: "800", letterSpacing: 1.1 }, sectionTitle: { marginTop: 4, fontSize: 21, lineHeight: 27, fontWeight: "800", letterSpacing: -0.5 }, hint: { fontSize: 13, lineHeight: 20 }, userName: { fontSize: 15, lineHeight: 21, fontWeight: "700" }, row: { flexDirection: "row", gap: 10, flexWrap: "wrap" }, settingRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12 }, divider: { height: StyleSheet.hairlineWidth }, allocationPercent: { fontSize: 22, lineHeight: 28, fontWeight: "800", fontVariant: ["tabular-nums"] }, allocationTrack: { height: 8, borderRadius: 999, overflow: "hidden" }, allocationFill: { height: "100%", borderRadius: 999 }, allocationAmounts: { flexDirection: "row", justifyContent: "space-between", gap: 18 }, amountRight: { alignItems: "flex-end" }, amountLabel: { fontSize: 11, lineHeight: 16, fontWeight: "700" }, amountValue: { marginTop: 3, fontSize: 18, lineHeight: 24, fontWeight: "800", fontVariant: ["tabular-nums"] } });
