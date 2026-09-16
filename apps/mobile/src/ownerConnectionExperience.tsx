import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { NusaButton, StatusChip } from "./components";
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
  ["CONNECT", "NUSA 연결", "서버 확인"],
  ["VERIFY_OWNER", "소유자 인증", "서버 검증"],
  ["VERIFY_DEVICE", "이 휴대폰 승인", "기기 자격 증명"],
  ["SECURE_SESSION", "Secure Session", "PAPER 전용"],
]);

export function OwnerConnectionExperience({ stage, deviceCredentialAvailable, busy = false, detail, onAuthenticateOwner, onRecoverWithPairing }: OwnerConnectionExperienceProps) {
  const { theme } = useTheme();
  const complete = stage === "COMPLETE";
  const blocked = stage === "BLOCKED";
  const activeIndex = Math.max(0, STEPS.findIndex(([candidate]) => candidate === stage));
  return <View style={[styles.shell, { backgroundColor: theme.colors.surface, borderColor: theme.colors.borderStrong }]} testID="owner-connection-experience">
    <View style={[styles.topRail, { borderBottomColor: theme.colors.border }]}>
      <Text style={[styles.railLabel, { color: theme.colors.textMuted }]}>OWNER IDENTITY</Text>
      <Text style={[styles.railTruth, { color: complete ? theme.colors.success : blocked ? theme.colors.danger : theme.colors.text }]}>SERVER VERIFIED</Text>
      <Text style={[styles.railLabel, { color: theme.colors.textMuted }]}>PAPER ONLY</Text>
    </View>

    <View style={styles.hero}>
      <View style={styles.heroCopy}>
        <Text style={[styles.eyebrow, { color: theme.colors.textMuted }]}>NUSA · SECURE CONNECTION</Text>
        <Text style={[styles.title, { color: theme.colors.text }]}>{complete ? "안전하게 연결됨" : "이 휴대폰을 NUSA에 연결"}</Text>
        <Text style={[styles.subtitle, { color: theme.colors.textMuted }]}>{complete ? "소유자와 기기 자격 증명이 서버에서 확인되었습니다." : "소유자 확인은 이 기기 안에서 시작되고, 신뢰 여부는 서버가 결정합니다."}</Text>
      </View>
      <StatusChip label={complete ? "SECURE" : blocked ? "BLOCKED" : "NO AUTHORITY"} tone={complete ? "success" : blocked ? "danger" : "neutral"} />
    </View>

    {complete ? <View style={[styles.success, { backgroundColor: theme.colors.surfaceSunken, borderColor: theme.colors.success }]} testID="owner-connection-success">
      <Text style={[styles.successMark, { color: theme.colors.success }]}>✓</Text>
      <View style={styles.successCopy}><Text style={[styles.successTitle, { color: theme.colors.text }]}>이 휴대폰이 안전하게 연결되었습니다.</Text><Text style={[styles.body, { color: theme.colors.textMuted }]}>Secure Session은 PAPER 전용이며 주문·이체·출금 권한을 만들지 않습니다.</Text></View>
    </View> : <>
      <View style={styles.timeline} accessibilityLabel="소유자 연결 진행 단계">
        {STEPS.map(([key, label, caption], index) => {
          const passed = activeIndex > index;
          const active = key === stage;
          return <View key={key} style={[styles.step, { borderTopColor: theme.colors.border }]}>
            <View style={[styles.stepDot, { borderColor: passed || active ? theme.colors.primary : theme.colors.borderStrong, backgroundColor: passed ? theme.colors.primary : "transparent" }]}><Text style={[styles.stepIndex, { color: passed ? theme.colors.background : active ? theme.colors.primary : theme.colors.textMuted }]}>{passed ? "✓" : `0${index + 1}`}</Text></View>
            <View style={styles.stepCopy}><Text style={[styles.stepLabel, { color: active ? theme.colors.text : theme.colors.textMuted }]}>{label}</Text><Text style={[styles.stepCaption, { color: theme.colors.textMuted }]}>{caption}</Text></View>
            <Text style={[styles.stepState, { color: passed ? theme.colors.success : active ? theme.colors.primary : theme.colors.textMuted }]}>{passed ? "DONE" : active ? "NOW" : "NEXT"}</Text>
          </View>;
        })}
      </View>

      <View style={[styles.truthPanel, { backgroundColor: theme.colors.surfaceSunken, borderColor: blocked ? theme.colors.danger : theme.colors.border }]}>
        <Text style={[styles.truthKicker, { color: blocked ? theme.colors.danger : theme.colors.textMuted }]}>{blocked ? "CONNECTION BLOCKED" : "WHAT NUSA WILL VERIFY"}</Text>
        <Text style={[styles.body, { color: theme.colors.text }]}>{detail ?? (deviceCredentialAvailable ? "서버 요청에 이 휴대폰의 보호된 키로 서명합니다. 지문·얼굴 정보 자체는 서버로 전송되지 않습니다." : "최초 연결은 기존 OWNER 신원과 이 휴대폰의 자격 증명을 서버가 함께 검증한 뒤 완료됩니다.")}</Text>
      </View>

      {deviceCredentialAvailable ? <NusaButton disabled={busy || blocked} label={busy ? "소유자 확인 중…" : "지문·얼굴로 소유자 인증"} onPress={onAuthenticateOwner} testID="owner-authenticate-primary" /> : null}

      <View style={[styles.recovery, { borderTopColor: theme.colors.border }]}>
        <View style={styles.recoveryCopy}><Text style={[styles.recoveryTitle, { color: theme.colors.text }]}>복구 연결</Text><Text style={[styles.recoveryDetail, { color: theme.colors.textMuted }]}>등록된 OWNER 기기를 사용할 수 없는 경우에만 6자리 확인 코드를 사용합니다.</Text></View>
        <NusaButton disabled={busy} label="6자리 코드" onPress={onRecoverWithPairing} tone="neutral" testID="owner-pairing-recovery" />
      </View>
    </>}

    <View style={[styles.authorityRail, { borderTopColor: theme.colors.border }]}>
      <Text style={[styles.authorityStrong, { color: theme.colors.text }]}>PAPER ONLY</Text>
      <Text style={[styles.authority, { color: theme.colors.textMuted }]}>LIVE NONE · MUTATION FALSE · 주문/이체/출금 권한 없음</Text>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  shell: { borderWidth: 1, borderRadius: 22, overflow: "hidden" }, topRail: { minHeight: 38, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, gap: 8 }, railLabel: { fontSize: 9, lineHeight: 13, fontWeight: "800", letterSpacing: 0.9 }, railTruth: { fontSize: 9, lineHeight: 13, fontWeight: "900", letterSpacing: 0.7 },
  hero: { padding: 18, paddingBottom: 14, flexDirection: "row", alignItems: "flex-start", gap: 12 }, heroCopy: { flex: 1, minWidth: 0 }, eyebrow: { fontSize: 10, lineHeight: 14, fontWeight: "800", letterSpacing: 1.2 }, title: { marginTop: 7, fontSize: 24, lineHeight: 30, fontWeight: "800", letterSpacing: -0.7 }, subtitle: { marginTop: 8, fontSize: 12, lineHeight: 19 },
  timeline: { paddingHorizontal: 18 }, step: { minHeight: 58, borderTopWidth: StyleSheet.hairlineWidth, flexDirection: "row", alignItems: "center", gap: 12 }, stepDot: { width: 31, height: 31, borderRadius: 16, borderWidth: 1, alignItems: "center", justifyContent: "center" }, stepIndex: { fontSize: 10, fontWeight: "900", fontVariant: ["tabular-nums"] }, stepCopy: { flex: 1, gap: 2 }, stepLabel: { fontSize: 14, lineHeight: 19, fontWeight: "800" }, stepCaption: { fontSize: 10, lineHeight: 15 }, stepState: { fontSize: 9, lineHeight: 13, fontWeight: "900", letterSpacing: 0.8 },
  truthPanel: { marginHorizontal: 18, marginTop: 16, padding: 14, borderWidth: StyleSheet.hairlineWidth, borderRadius: 14 }, truthKicker: { marginBottom: 7, fontSize: 9, lineHeight: 13, fontWeight: "900", letterSpacing: 1 }, body: { fontSize: 12, lineHeight: 19 },
  recovery: { margin: 18, marginBottom: 4, paddingTop: 16, borderTopWidth: StyleSheet.hairlineWidth, gap: 12 }, recoveryCopy: { gap: 4 }, recoveryTitle: { fontSize: 12, lineHeight: 17, fontWeight: "800" }, recoveryDetail: { fontSize: 11, lineHeight: 17 },
  success: { margin: 18, padding: 16, borderWidth: 1, borderRadius: 16, flexDirection: "row", gap: 13, alignItems: "flex-start" }, successMark: { fontSize: 21, lineHeight: 25, fontWeight: "900" }, successCopy: { flex: 1 }, successTitle: { fontSize: 15, lineHeight: 21, fontWeight: "800", marginBottom: 5 },
  authorityRail: { marginTop: 14, minHeight: 43, borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 16, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }, authorityStrong: { fontSize: 9, lineHeight: 13, fontWeight: "900", letterSpacing: 0.8 }, authority: { flex: 1, textAlign: "right", fontSize: 8, lineHeight: 12, fontWeight: "700", letterSpacing: 0.25 },
});