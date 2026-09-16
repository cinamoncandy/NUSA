import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { NusaButton, NusaCard, StatusChip } from "./components";
import { useTheme } from "./ThemeProvider";

export type OwnerConnectionStage = "CONNECT" | "VERIFY_OWNER" | "VERIFY_DEVICE" | "SECURE_SESSION" | "COMPLETE" | "BLOCKED";

export interface OwnerConnectionExperienceProps {
  readonly stage: OwnerConnectionStage;
  readonly deviceCredentialAvailable: boolean;
  readonly busy?: boolean;
  readonly detail?: string;
  readonly onAuthenticateOwner: () => void;
  readonly onRecoverWithPairing: () => void;
}

const STEPS = Object.freeze([
  ["CONNECT", "NUSA 연결"],
  ["VERIFY_OWNER", "소유자 인증"],
  ["VERIFY_DEVICE", "이 휴대폰 승인"],
  ["SECURE_SESSION", "Secure Session"],
]);

export function OwnerConnectionExperience({ stage, deviceCredentialAvailable, busy = false, detail, onAuthenticateOwner, onRecoverWithPairing }: OwnerConnectionExperienceProps) {
  const { theme } = useTheme();
  const complete = stage === "COMPLETE";
  const blocked = stage === "BLOCKED";
  return <NusaCard raised testID="owner-connection-experience">
    <View style={styles.header}>
      <View style={styles.headerCopy}>
        <Text style={[styles.eyebrow, { color: theme.colors.textMuted }]}>OWNER · SECURE CONNECTION</Text>
        <Text style={[styles.title, { color: theme.colors.text }]}>{complete ? "안전하게 연결됨" : "이 휴대폰을 NUSA에 연결"}</Text>
      </View>
      <StatusChip label={complete ? "SECURE" : blocked ? "BLOCKED" : "PAPER ONLY"} tone={complete ? "success" : blocked ? "danger" : "neutral"} />
    </View>

    {complete ? <View style={[styles.success, { borderColor: theme.colors.success }]} testID="owner-connection-success"><Text style={[styles.successTitle, { color: theme.colors.success }]}>✓ 이 휴대폰이 안전하게 연결되었습니다.</Text><Text style={[styles.detail, { color: theme.colors.textMuted }]}>서버가 소유자와 이 기기의 자격 증명을 검증했습니다. 세션은 PAPER 전용입니다.</Text></View> : <>
      <View style={styles.steps} accessibilityLabel="소유자 연결 진행 단계">
        {STEPS.map(([key, label], index) => {
          const activeIndex = Math.max(0, STEPS.findIndex(([candidate]) => candidate === stage));
          const passed = activeIndex > index;
          const active = key === stage;
          return <View key={key} style={styles.step}>
            <View style={[styles.stepDot, { borderColor: passed || active ? theme.colors.primary : theme.colors.borderStrong, backgroundColor: passed ? theme.colors.primary : "transparent" }]}><Text style={[styles.stepIndex, { color: passed ? theme.colors.background : active ? theme.colors.primary : theme.colors.textMuted }]}>{passed ? "✓" : index + 1}</Text></View>
            <Text style={[styles.stepLabel, { color: active ? theme.colors.text : theme.colors.textMuted }]}>{label}</Text>
          </View>;
        })}
      </View>
      <Text style={[styles.detail, { color: blocked ? theme.colors.danger : theme.colors.textMuted }]}>{detail ?? (deviceCredentialAvailable ? "서버가 발급한 요청을 지문·얼굴 인증으로 확인합니다. 생체정보 자체는 서버로 전송되지 않습니다." : "최초 연결은 서버가 소유자 신원과 이 휴대폰을 검증한 뒤 완료됩니다.")}</Text>
      {deviceCredentialAvailable ? <NusaButton disabled={busy || blocked} label={busy ? "소유자 확인 중…" : "지문·얼굴로 소유자 인증"} onPress={onAuthenticateOwner} testID="owner-authenticate-primary" /> : null}
      <View style={[styles.recovery, { borderTopColor: theme.colors.border }]}>
        <Text style={[styles.recoveryTitle, { color: theme.colors.text }]}>복구 연결</Text>
        <Text style={[styles.recoveryDetail, { color: theme.colors.textMuted }]}>등록된 소유자 기기를 사용할 수 없을 때만 6자리 확인 코드를 사용합니다.</Text>
        <NusaButton disabled={busy} label="6자리 코드로 복구" onPress={onRecoverWithPairing} tone="neutral" testID="owner-pairing-recovery" />
      </View>
    </>}
    <Text style={[styles.authority, { color: theme.colors.textMuted }]}>PAPER ONLY · LIVE 권한 없음 · 주문/이체/출금 권한 없음</Text>
  </NusaCard>;
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 },
  headerCopy: { flex: 1, gap: 5 }, eyebrow: { fontSize: 10, lineHeight: 14, fontWeight: "800", letterSpacing: 1.1 },
  title: { fontSize: 22, lineHeight: 28, fontWeight: "800", letterSpacing: -0.5 }, steps: { gap: 0, marginTop: 18, marginBottom: 16 },
  step: { minHeight: 46, flexDirection: "row", alignItems: "center", gap: 12 }, stepDot: { width: 28, height: 28, borderRadius: 14, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  stepIndex: { fontSize: 11, fontWeight: "900" }, stepLabel: { fontSize: 14, lineHeight: 20, fontWeight: "700" }, detail: { fontSize: 13, lineHeight: 20, marginBottom: 14 },
  recovery: { marginTop: 16, paddingTop: 16, borderTopWidth: StyleSheet.hairlineWidth, gap: 8 }, recoveryTitle: { fontSize: 13, lineHeight: 18, fontWeight: "800" }, recoveryDetail: { fontSize: 12, lineHeight: 18 },
  success: { marginTop: 18, paddingTop: 14, borderTopWidth: 1 }, successTitle: { fontSize: 15, lineHeight: 21, fontWeight: "800", marginBottom: 6 }, authority: { marginTop: 16, fontSize: 10, lineHeight: 15, fontWeight: "700", letterSpacing: 0.35 },
});