import React from "react";
import { StyleSheet, Text, View } from "react-native";
import type { PersonalPaperOperationsSnapshot } from "../../../packages/contracts/src/personalPaperOperations";
import { DataRow, NusaButton, NusaCard, StatusChip } from "./components";
import { useTheme } from "./ThemeProvider";

interface HomeSnapshotContentProps {
  readonly snapshot: PersonalPaperOperationsSnapshot;
  readonly onOpenPortfolio: () => void;
  readonly onOpenAi: () => void;
  readonly onDisconnect: () => void;
}

function money(value: number): string {
  return `₩${Math.round(value).toLocaleString("ko-KR")}`;
}

function signedMoney(value: number): string {
  return `${value >= 0 ? "+" : "-"}${money(Math.abs(value))}`;
}

function healthTone(health: string): "success" | "warning" | "danger" {
  return health === "HEALTHY" || health === "READY" ? "success" : health === "FAIL_CLOSED" || health === "DOWN" || health === "HALTED" ? "danger" : "warning";
}

export function HomeSnapshotContent({ snapshot, onOpenPortfolio, onOpenAi, onDisconnect }: HomeSnapshotContentProps) {
  const { theme } = useTheme();
  const account = snapshot.portfolio?.account ?? null;
  const totalPnl = account == null ? null : (account.realizedPnl ?? account.position.realizedPnl) + account.unrealizedPnl;
  const ai = snapshot.ai;
  const aiAvailable = ai != null && ai.status !== "UNAVAILABLE";
  const aiConfidence = aiAvailable ? `${Math.round(ai.confidence * 100)}%` : "-";
  const aiEvidence = ai == null ? "-" : `${ai.evidenceReferences.length}개`;

  return <>
    <NusaCard testID="home-financial-card" raised>
      <View style={styles.cardHeader}>
        <View><Text style={[styles.eyebrow, { color: theme.colors.primary }]}>PAPER EQUITY</Text><Text style={[styles.heroValue, { color: theme.colors.text }]}>{account ? money(account.equity) : "포트폴리오 없음"}</Text></View>
        <StatusChip label={snapshot.readyForPaperOperations ? "PAPER READY" : "PAPER WAIT"} tone={snapshot.readyForPaperOperations ? "success" : "warning"} />
      </View>
      {totalPnl == null ? <Text style={[styles.supporting, { color: theme.colors.textMuted }]}>계좌 평가 정보가 아직 없습니다.</Text> : <Text style={[styles.pnl, { color: totalPnl >= 0 ? theme.colors.success : theme.colors.danger }]}>{signedMoney(totalPnl)} 계정 누적 손익</Text>}
      <View style={[styles.divider, { backgroundColor: theme.colors.border }]} />
      <DataRow label="현금" value={account ? money(account.cash) : "-"} />
      <DataRow label="전체 포지션 평가액" value={account?.assetValue == null ? "집계 없음" : money(account.assetValue)} />
      <DataRow label="시장 연결" value={snapshot.operations.transport === "ONLINE" ? "온라인" : "오프라인"} tone={snapshot.operations.transport === "ONLINE" ? "success" : "warning"} />
      <NusaButton accessibilityLabel="자산 상세 보기" label="자산 상세 보기" onPress={onOpenPortfolio} tone="neutral" testID="home-open-portfolio" />
    </NusaCard>

    <NusaCard testID="home-ai-insight-card">
      <View style={styles.cardHeader}>
        <View><Text style={[styles.eyebrow, { color: theme.colors.info }]}>AI READ ONLY</Text><Text style={[styles.cardTitle, { color: theme.colors.text }]}>AI 인사이트</Text></View>
        <View style={styles.chips}><StatusChip label={ai?.status ?? "UNAVAILABLE"} tone={ai?.status === "AVAILABLE" ? "success" : ai?.status === "INCOMPLETE" ? "warning" : "neutral"} /><StatusChip label="ZERO AUTHORITY" tone="info" /></View>
      </View>
      <Text style={[styles.thesis, { color: ai?.thesis ? theme.colors.text : theme.colors.textMuted }]}>{ai?.thesis ?? "현재 표시할 AI 분석이 없습니다."}</Text>
      <DataRow label="신뢰도" value={aiConfidence} />
      <DataRow label="근거" value={aiEvidence} />
      <NusaButton accessibilityLabel="AI 근거 보기" label="AI 근거 보기" onPress={onOpenAi} tone="neutral" testID="home-open-ai" />
    </NusaCard>

    <NusaCard testID="home-safety-card">
      <View style={styles.cardHeader}><View><Text style={[styles.eyebrow, { color: theme.colors.textMuted }]}>SAFETY</Text><Text style={[styles.cardTitle, { color: theme.colors.text }]}>안전 상태</Text></View><StatusChip label={snapshot.health} tone={healthTone(snapshot.health)} /></View>
      <DataRow label="PAPER 런타임" value={snapshot.operations.runtimeState} tone={healthTone(snapshot.operations.runtimeState)} />
      <DataRow label="킬 스위치" value={snapshot.dashboard.killSwitchActive ? "활성" : "비활성"} tone={snapshot.dashboard.killSwitchActive ? "danger" : "success"} />
      <DataRow label="LIVE 권한" value={snapshot.liveAuthority} emphasis />
      <DataRow label="Production mutation" value={snapshot.productionMutationAllowed ? "허용" : "금지"} tone={snapshot.productionMutationAllowed ? "danger" : "success"} />
    </NusaCard>

    <NusaButton accessibilityLabel="Disconnect read only" label="읽기 전용 연결 해제" onPress={onDisconnect} tone="neutral" testID="dashboard-disconnect" />
  </>;
}

const styles = StyleSheet.create({
  cardHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 10 },
  chips: { alignItems: "flex-end", gap: 6 },
  eyebrow: { fontSize: 10, fontWeight: "800", letterSpacing: 1.2, marginBottom: 4 },
  cardTitle: { fontSize: 18, fontWeight: "700", letterSpacing: -0.4 },
  heroValue: { fontSize: 34, fontWeight: "800", letterSpacing: -1.4, marginTop: 5 },
  pnl: { marginTop: 7, fontSize: 15, fontWeight: "700" },
  supporting: { fontSize: 13, lineHeight: 20, marginTop: 7 },
  divider: { height: 1, marginVertical: 14 },
  thesis: { fontSize: 16, fontWeight: "600", lineHeight: 24, marginBottom: 10 },
});
