import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const write = (p, value) => fs.writeFileSync(path.join(root, p), value);
const replace = (source, before, after, label) => {
  if (!source.includes(before)) throw new Error(`missing replacement target: ${label}`);
  return source.replace(before, after);
};

let app = read("apps/mobile/App.tsx");
app = replace(app,
  'const tabLabels: Readonly<Record<PrimaryTab, string>> = { Home: "HOME", Markets: "OBSERVE", Paper: "PAPER", Portfolio: "SUPERVISE" };',
  'const tabLabels: Readonly<Record<PrimaryTab, string>> = { Home: "HOME", Markets: "MARKETS", Paper: "PAPER", Portfolio: "PORTFOLIO" };',
  "canonical bottom-tab labels");
app = replace(app,
  'const tabDescriptions: Readonly<Record<PrimaryTab, string>> = { Home: "현재 NUSA 상태", Markets: "공개 시장 관찰", Paper: "PAPER 운용", Portfolio: "PAPER 운용 감독" };',
  'const tabDescriptions: Readonly<Record<PrimaryTab, string>> = { Home: "현재 NUSA 상태", Markets: "공개 시장 환경", Paper: "PAPER 운용", Portfolio: "PAPER 자산과 결과" };',
  "bottom-tab descriptions");
app = app.replace("PAPER 데이터와 주문 기능을 사용할 수 있습니다.", "PAPER 데이터와 운용 감독 기능을 사용할 수 있습니다.");
write("apps/mobile/App.tsx", app);

let home = read("apps/mobile/src/homeView.tsx");
home = home.replace(/>OBSERVE<\/Text>/g, ">MARKETS</Text>");
home = home.replace(/>SUPERVISE<\/Text>/g, ">PORTFOLIO</Text>");
home = home.replace("한 번의 탭으로 상세 이동", "핵심 화면으로 바로 이동");
write("apps/mobile/src/homeView.tsx", home);

let intelligence = read("apps/mobile/src/intelligenceOs.tsx");
intelligence = intelligence.replace('fontWeight: "850"', 'fontWeight: "800"');
write("apps/mobile/src/intelligenceOs.tsx", intelligence);

let settings = read("apps/mobile/src/settingsView.tsx");
if (!settings.includes("function ConnectionStep")) {
  settings = replace(settings,
    'const actionLabel: Readonly<Record<OperatorUserAction, string>> = { APPROVE: "승인", REJECT: "거절", SUSPEND: "정지", RESTORE: "복구" };\n',
    'const actionLabel: Readonly<Record<OperatorUserAction, string>> = { APPROVE: "승인", REJECT: "거절", SUSPEND: "정지", RESTORE: "복구" };\n\nfunction ConnectionStep({ index, title, detail, state, tone }: Readonly<{ index: string; title: string; detail: string; state: string; tone: "success" | "info" | "warning" | "danger" | "neutral" }>) {\n  const { theme } = useTheme();\n  return <View style={[styles.connectionStep, { borderTopColor: theme.colors.border }]}>\n    <View style={[styles.connectionIndex, { borderColor: theme.colors.borderStrong }]}><Text style={[styles.connectionIndexText, { color: theme.colors.textMuted }]}>{index}</Text></View>\n    <View style={styles.connectionCopy}><Text style={[styles.connectionTitle, { color: theme.colors.text }]}>{title}</Text><Text style={[styles.connectionDetail, { color: theme.colors.textMuted }]}>{detail}</Text></View>\n    <StatusChip label={state} tone={tone} />\n  </View>;\n}\n',
    "connection step component");
}
settings = replace(settings, '  const [connecting, setConnecting] = useState(false);', '  const [connecting, setConnecting] = useState(false);\n  const [connectionAttempted, setConnectionAttempted] = useState(false);', "connection attempt state");
settings = replace(settings, '    connectionInFlightRef.current = true; setConnecting(true); setError(null);', '    connectionInFlightRef.current = true; setConnectionAttempted(true); setConnecting(true); setError(null);', "connection attempt start");
settings = settings.replace('const disconnect = () => { if (isBusyNow()) return; credentialSession.clear(); clearPaperConnectionVerification(); setTokenDraft("");', 'const disconnect = () => { if (isBusyNow()) return; credentialSession.clear(); clearPaperConnectionVerification(); setConnectionAttempted(false); setTokenDraft("");');
settings = settings.replace('credentialSession.clear(); clearPaperConnectionVerification(); resetUpbitReadOnlyState(); setTokenDraft("");', 'credentialSession.clear(); clearPaperConnectionVerification(); resetUpbitReadOnlyState(); setConnectionAttempted(false); setTokenDraft("");');
settings = replace(settings,
  '  const cloudConnectionTone = connecting ? "info" : connection.status === "READY" ? "success" : connection.status === "UNAVAILABLE" ? "danger" : "neutral";\n  const cloudConnectionLabel = connecting ? "확인 중" : connection.status === "READY" ? "연결됨" : "선택 사항";\n  const cloudConnectionDetail = connecting ? "저장된 endpoint와 승인된 보안 세션을 검증하고 있습니다." : connection.status === "READY" ? `${connection.snapshot.operations.runtimeState} · ${connection.snapshot.operations.transport}` : "Cloud 연결 없이 LOCAL PAPER를 바로 사용할 수 있습니다. Cloud PAPER 동기화가 필요할 때만 아래 항목을 연결하세요.";',
  '  const connectionFailed = connectionAttempted && !connecting && connection.status !== "READY";\n  const cloudConnectionTone = connecting ? "info" : connection.status === "READY" ? "success" : connectionFailed || connection.status === "UNAVAILABLE" ? "danger" : "neutral";\n  const cloudConnectionLabel = connecting ? "VERIFYING" : connection.status === "READY" ? "VERIFIED" : connectionFailed || connection.status === "UNAVAILABLE" ? "RETRY" : "NOT CONNECTED";\n  const cloudConnectionDetail = connecting ? "서버, 보안 세션과 PAPER 운영 projection을 검증하고 있습니다." : connection.status === "READY" ? `${connection.snapshot.operations.runtimeState} · ${connection.snapshot.operations.transport}` : connectionFailed ? connection.reason : "Cloud PAPER는 선택 사항입니다. 연결할 때만 서버와 1회용 보안 세션을 검증합니다.";',
  "truthful connection state");

const settingsLines = settings.split("\n");
const localLine = settingsLines.findIndex((line) => line.includes('testID="settings-local-paper"'));
if (localLine < 0) throw new Error("missing local PAPER section");
settingsLines[localLine] = '    <View style={styles.sectionBlock} testID="settings-local-paper"><View style={styles.sectionHeader}><View><Text style={[styles.eyebrow, { color: theme.colors.textMuted }]}>PAPER · LOCAL</Text><Text style={[styles.sectionTitle, { color: theme.colors.text }]}>기기 내 PAPER</Text></View><StatusChip label="READY" tone="success" /></View><InlineNotice title="연결 없이 관측 가능" detail={`Upbit 공개 시세와 가상자금 ${money(LOCAL_PAPER_INITIAL_CASH)}으로 LOCAL PAPER 관측·회계·학습 근거를 사용할 수 있습니다. Cloud endpoint와 bootstrap token은 필요하지 않습니다.`} tone="success" testID="settings-local-paper-ready" /></View>';
const cloudLine = settingsLines.findIndex((line) => line.includes('testID="settings-paper-connection"'));
if (cloudLine < 0) throw new Error("missing cloud PAPER section");
settingsLines[cloudLine] = `    <View style={styles.sectionBlock} testID="settings-paper-connection">
      <View style={styles.sectionHeader}><View><Text style={[styles.eyebrow, { color: theme.colors.textMuted }]}>CONNECTIONS · CLOUD PAPER</Text><Text style={[styles.sectionTitle, { color: theme.colors.text }]}>PAPER 서버 연결</Text></View><StatusChip label={cloudConnectionLabel} tone={cloudConnectionTone} /></View>
      <InlineNotice title={connection.status === "READY" ? "연결 검증 완료" : connectionFailed ? "연결을 다시 확인하세요" : "Cloud PAPER 연결"} detail={cloudConnectionDetail} tone={connection.status === "READY" ? "success" : connectionFailed ? "danger" : connecting ? "info" : "neutral"} testID="settings-connection-summary" />
      <View style={styles.connectionSteps} testID="settings-connection-steps">
        <ConnectionStep index="1" title="SERVER" detail={canonicalEndpoint ? "Release에 주입된 canonical HTTPS endpoint" : endpointDraft.trim() ? "입력한 HTTPS endpoint" : "Cloud를 사용할 때 endpoint 필요"} state={canonicalEndpoint || endpointDraft.trim() ? "READY" : "NEEDED"} tone={canonicalEndpoint || endpointDraft.trim() ? "success" : "neutral"} />
        <ConnectionStep index="2" title="SECURE SESSION" detail="1회용 토큰은 저장하지 않고 승인된 보안 세션으로 교환" state={connection.status === "READY" ? "SECURE" : tokenDraft.trim() ? "TOKEN READY" : "NEEDED"} tone={connection.status === "READY" ? "success" : tokenDraft.trim() ? "info" : "neutral"} />
        <ConnectionStep index="3" title="VERIFY" detail="PAPER 운영 projection까지 읽힌 경우에만 연결 완료" state={connecting ? "CHECKING" : connection.status === "READY" ? "VERIFIED" : connectionFailed ? "ERROR" : "WAITING"} tone={connecting ? "info" : connection.status === "READY" ? "success" : connectionFailed ? "danger" : "neutral"} />
      </View>
      <NusaTextField autoCapitalize="none" autoCorrect={false} editable={!busy && !canonicalEndpoint} keyboardType="url" label="Cloud endpoint" value={endpointDraft} onChangeText={setEndpointDraft} placeholder="https://..." returnKeyType="done" testID="settings-paper-endpoint" />
      <NusaTextField autoCapitalize="none" autoCorrect={false} editable={!busy} label="1회용 연결 토큰" value={tokenDraft} onChangeText={setTokenDraft} placeholder="Cloud를 연결할 때만 입력" returnKeyType="done" secureTextEntry testID="settings-paper-token" />
      <Text style={[styles.hint, { color: theme.colors.textMuted }]}>bootstrap token은 저장하지 않고 한 번만 세션으로 교환합니다. LOCAL PAPER에는 사용하지 않습니다. 인증 후 Android Secure Storage의 회전 refresh 세션으로 복구합니다.</Text>
      <View style={styles.row}><NusaButton disabled={busy} label={connecting ? "검증 중..." : connectionFailed ? "연결 다시 시도" : "Cloud 연결"} onPress={() => void testConnection()} testID="settings-paper-connect" /><NusaButton disabled={busy || connection.status !== "READY"} label="연결 해제" onPress={disconnect} tone="neutral" testID="settings-paper-disconnect" /></View>
    </View>`;
settings = settingsLines.join("\n");
settings = settings.replace("03 · CASH ALLOCATION", "PAPER · CAPITAL");
settings = settings.replace("04 · APPEARANCE", "APPEARANCE · THEME");
settings = settings.replace("05 · PRIVACY", "ADVANCED · PRIVACY");
settings = settings.replace("06 · SAFETY & AUTHORITY", "ADVANCED · SAFETY");
settings = settings.replace("07 · LOCAL & PERSONAL", "ADVANCED · LOCAL");
settings = settings.replace("08 · USER ACCESS", "ADVANCED · USER ACCESS");
settings = replace(settings,
  'sectionBlock: { gap: 12 }, sectionHeader:',
  'sectionBlock: { gap: 12 }, connectionSteps: { gap: 0 }, connectionStep: { minHeight: 64, borderTopWidth: StyleSheet.hairlineWidth, paddingVertical: 10, flexDirection: "row", alignItems: "center", gap: 10 }, connectionIndex: { width: 30, height: 30, borderRadius: 999, borderWidth: 1, alignItems: "center", justifyContent: "center" }, connectionIndexText: { fontSize: 11, fontWeight: "900" }, connectionCopy: { flex: 1, minWidth: 0, gap: 2 }, connectionTitle: { fontSize: 13, lineHeight: 18, fontWeight: "900" }, connectionDetail: { fontSize: 11, lineHeight: 16 }, sectionHeader:',
  "connection styles");
write("apps/mobile/src/settingsView.tsx", settings);

let canonicalTest = read("tests/mobile-uiux-v3-canonical.test.js");
canonicalTest = canonicalTest.replace('assert.match(source, />SUPERVISE<\\/Text>/);', 'assert.match(source, />PORTFOLIO<\\/Text>/);');
write("tests/mobile-uiux-v3-canonical.test.js", canonicalTest);

let settingsTest = read("tests/mobile-settings-ui.test.js");
settingsTest = settingsTest.replace('assert.match(source, /bootstrap token은 저장하지 않고 한 번만 세션으로 교환합니다/);', 'assert.match(source, /bootstrap token은 저장하지 않고 한 번만 세션으로 교환합니다/);\n  assert.match(source, /SERVER/);\n  assert.match(source, /SECURE SESSION/);\n  assert.match(source, /VERIFY/);\n  assert.match(source, /연결 다시 시도/);');
write("tests/mobile-settings-ui.test.js", settingsTest);

const productTest = `const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..", "apps", "mobile");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("product v5 keeps the four primary jobs literal and glanceable", () => {
  const app = read("App.tsx");
  assert.match(app, /Home: "HOME", Markets: "MARKETS", Paper: "PAPER", Portfolio: "PORTFOLIO"/);
  const home = read("src/homeView.tsx");
  assert.match(home, />MARKETS<\\/Text>/);
  assert.match(home, />PORTFOLIO<\\/Text>/);
  assert.match(home, /PAPER EQUITY/);
  assert.match(home, /TOTAL PNL/);
});

test("product v5 uses flatter secondary sections and Android-sized actions", () => {
  const intelligence = read("src/intelligenceOs.tsx");
  assert.match(intelligence, /section: \{ borderTopWidth: StyleSheet\.hairlineWidth, borderRadius: 0/);
  assert.match(intelligence, /sectionAction: \{ minHeight: 48/);
  assert.match(intelligence, /leadTitle: \{ fontSize: 30/);
});

test("Cloud PAPER setup communicates server session verify without changing authority", () => {
  const settings = read("src/settingsView.tsx");
  assert.match(settings, /title="SERVER"/);
  assert.match(settings, /title="SECURE SESSION"/);
  assert.match(settings, /title="VERIFY"/);
  assert.match(settings, /연결 다시 시도/);
  assert.doesNotMatch(settings, /placeOrder|cancelOrder|withdraw/);
  const productionPaper = read("src/tradingView.tsx");
  assert.doesNotMatch(productionPaper, /BUY|SELL|quantity|submit/i);
  assert.match(productionPaper, /PAPER ONLY · LIVE NONE · AI ZERO AUTHORITY/);
});
`;
write("tests/mobile-product-v5.test.js", productTest);

const qaWorkflow = `name: Android Product UX Acceptance

on:
  pull_request:
    paths:
      - "apps/mobile/**"
      - "tests/mobile-product-v5.test.js"
      - ".github/workflows/android-product-ux-acceptance.yml"
  workflow_dispatch: {}

permissions:
  contents: read

concurrency:
  group: android-product-ux-\${{ github.workflow }}-\${{ github.event.pull_request.number || github.ref }}
  cancel-in-progress: true

jobs:
  touch-visual:
    runs-on: ubuntu-latest
    timeout-minutes: 35
    steps:
      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262
      - run: corepack enable && corepack prepare pnpm@11.7.0 --activate
      - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020
        with:
          node-version: 24
          cache: pnpm
          cache-dependency-path: pnpm-lock.yaml
      - uses: actions/setup-java@cf277c60eb25467037889841efdb72551f06f6c3
        with:
          distribution: temurin
          java-version: 17
      - uses: android-actions/setup-android@9fc6c4e9069bf8d3d10b2204b1fb8f6ef7065407
        with:
          cmdline-tools-version: 11076708
      - name: Prepare Pixel 6 Android 15 emulator
        run: |
          yes | sdkmanager --licenses >/dev/null || true
          sdkmanager "platform-tools" "emulator" "platforms;android-35" "build-tools;35.0.0" "system-images;android-35;google_apis;x86_64"
          echo no | avdmanager create avd -n nusa_product_qa -k "system-images;android-35;google_apis;x86_64" -d pixel_6 --force
      - name: Build exact debug APK
        env:
          EXPO_PUBLIC_NUSA_API_BASE_URL: \${{ vars.NUSA_MOBILE_API_BASE_URL }}
          NUSA_BUILD_SHA: \${{ github.event.pull_request.head.sha || github.sha }}
          NUSA_BUILD_NUMBER: \${{ github.run_number }}
        run: |
          pnpm install --frozen-lockfile
          node scripts/prepare-mobile-build-config.js
          chmod +x apps/mobile/android/gradlew apps/mobile/node_modules/hermes-compiler/hermesc/linux64-bin/hermesc
          cd apps/mobile/android
          ./gradlew :app:assembleDebug -PnusaEmbedDebugBundle
      - name: Boot and install
        run: |
          nohup "$ANDROID_HOME/emulator/emulator" -avd nusa_product_qa -no-window -no-snapshot -noaudio -no-boot-anim -gpu swiftshader_indirect > "$RUNNER_TEMP/emulator.log" 2>&1 &
          adb wait-for-device
          timeout 300 bash -c 'until [ "$(adb shell getprop sys.boot_completed | tr -d "\\r")" = "1" ]; do sleep 3; done'
          adb shell settings put global window_animation_scale 0
          adb shell settings put global transition_animation_scale 0
          adb shell settings put global animator_duration_scale 0
          adb install -r apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk
          adb shell pm clear com.nusa.mobile.preview
          adb shell am start -W -n com.nusa.mobile.preview/com.nusa.mobile.MainActivity
          sleep 4
      - name: Touch primary flow and capture frames
        run: |
          set -euo pipefail
          mkdir -p qa/android-product-ux
          cat > "$RUNNER_TEMP/tap.py" <<'PY'
          import re, subprocess, sys, xml.etree.ElementTree as ET
          needle=sys.argv[1]
          subprocess.run(["adb","shell","uiautomator","dump","/sdcard/window.xml"],check=True,stdout=subprocess.DEVNULL)
          subprocess.run(["adb","pull","/sdcard/window.xml","/tmp/window.xml"],check=True,stdout=subprocess.DEVNULL)
          for n in ET.parse("/tmp/window.xml").getroot().iter("node"):
              a=n.attrib; hay=" | ".join((a.get("text",""),a.get("content-desc",""),a.get("resource-id","")))
              if needle in hay:
                  m=re.fullmatch(r"\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]",a.get("bounds",""))
                  if m:
                      x1,y1,x2,y2=map(int,m.groups()); print((x1+x2)//2,(y1+y2)//2); sys.exit(0)
          sys.exit(2)
          PY
          capture(){ adb exec-out screencap -p > "qa/android-product-ux/$1.png"; adb shell uiautomator dump /sdcard/window.xml >/dev/null; adb pull /sdcard/window.xml "qa/android-product-ux/$1.xml" >/dev/null; }
          tap(){ read x y < <(python3 "$RUNNER_TEMP/tap.py" "$1"); adb shell input tap "$x" "$y"; sleep 2; }
          capture 00-entry
          tap "Start personal mode"; capture 01-home
          tap "MARKETS"; capture 02-markets
          tap "PAPER"; capture 03-paper
          adb shell input swipe 540 1800 540 500 450; sleep 1; capture 04-paper-scroll
          tap "PORTFOLIO"; capture 05-portfolio
          tap "도구"; tap "설정"; capture 06-settings
          adb shell input swipe 540 1800 540 600 450; sleep 1; capture 07-settings-scroll
          grep -q "PAPER ONLY" qa/android-product-ux/03-paper.xml
          grep -q "MARKETS" qa/android-product-ux/02-markets.xml
          grep -q "PORTFOLIO" qa/android-product-ux/05-portfolio.xml
          printf 'touch_navigation=PASS\\nframes=%s\\n' "$(find qa/android-product-ux -name '*.png' | wc -l)" > qa/android-product-ux/report.txt
      - uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02
        with:
          name: android-product-ux-\${{ github.event.pull_request.head.sha || github.sha }}
          path: qa/android-product-ux
          retention-days: 7
          if-no-files-found: error
`;
fs.mkdirSync(path.join(root, ".github/workflows"), { recursive: true });
write(".github/workflows/android-product-ux-acceptance.yml", qaWorkflow);

fs.rmSync(path.join(root, "scripts/mobile-product-v5-apply.mjs"), { force: true });
fs.rmSync(path.join(root, ".github/workflows/mobile-product-v5-apply.yml"), { force: true });
console.log("mobile product v5 convergence applied");
