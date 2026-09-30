const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..", "apps", "mobile");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("product v5 keeps the four primary jobs literal and glanceable", () => {
  const contract = read("src/navigationContract.ts");
  assert.match(contract, /PRIMARY_DESTINATIONS = \["Home", "Paper", "Live", "More"\]/);
  const app = read("App.tsx");
  assert.match(app, /<PrimaryNavigation/);
  assert.match(app, /activeTab === "Paper" \? <PaperLearningMonitorView/);
  assert.match(app, /activeTab === "Live" \? <LiveReadinessMonitorView/);
  const home = read("src/homeView.tsx");
  assert.match(home, /모의투자 자산/);
  assert.match(home, /총 손익/);
  assert.doesNotMatch(app, /Home: "HOME", Markets: "MARKETS", Paper: "PAPER", Portfolio: "PORTFOLIO"/);
});

test("product v5 uses flatter secondary sections and Android-sized actions", () => {
  const intelligence = read("src/intelligenceOs.tsx");
  assert.match(intelligence, /section: { borderTopWidth: StyleSheet.hairlineWidth, borderRadius: 0/);
  assert.match(intelligence, /sectionAction: { minHeight: 48/);
  assert.match(intelligence, /leadTitle: { fontSize: 24, lineHeight: 30/);
  assert.match(intelligence, /leadDetail: { maxWidth: 720, fontSize: 11, lineHeight: 17/);
});

test("Cloud PAPER setup communicates server-verified owner device session without changing authority", () => {
  const settings = read("src/settingsView.tsx");
  const experience = read("src/ownerConnectionExperience.tsx");
  assert.match(settings, /<OwnerConnectionExperience/);
  assert.match(settings, /stage=\{ownerConnectionStage\}/);
  assert.match(settings, /onAuthenticateOwner=\{\(\) => \{ void requestPaperConnection\(\); \}\}/);
  assert.match(settings, /onRecoverWithPairing=\{\(\) => \{ void requestRecoveryPairing\(\); \}\}/);
  assert.match(experience, /모의투자 서버 확인/);
  assert.match(experience, /소유자 확인/);
  assert.match(experience, /이 휴대폰 등록/);
  assert.match(experience, /복구 연결/);
  assert.match(experience, /모의투자 전용/);
  assert.match(experience, /실거래 별도 인증/);
  assert.doesNotMatch(settings, /placeOrder|cancelOrder|withdraw/);
  const productionPaper = read("src/tradingView.tsx");
  assert.match(productionPaper, /<PaperLearningMonitorView/);
  assert.doesNotMatch(productionPaper, /<LegacyTradingView/);
  assert.doesNotMatch(productionPaper, /<NusaTextField|placeOrder\(|submitOrder\(/);
  assert.match(productionPaper, /PAPER ONLY · LIVE NONE · AI ZERO AUTHORITY/);
});

test("Android product UX acceptance bounds emulator startup and preserves diagnostic evidence", () => {
  const workflow = fs.readFileSync(
    path.join(__dirname, "..", ".github", "workflows", "android-product-ux-acceptance.yml"),
    "utf8",
  );
  assert.match(workflow, /export ANDROID_AVD_HOME="\$RUNNER_TEMP\/\.android\/avd"/);
  assert.match(workflow, /echo "ANDROID_AVD_HOME=\$ANDROID_AVD_HOME" >> "\$GITHUB_ENV"/);
  assert.doesNotMatch(workflow, /ANDROID_AVD_HOME: \$\{\{ runner\.temp/);
  assert.match(workflow, /mkdir -p "\$ANDROID_AVD_HOME"/);
  assert.match(workflow, /emulator" -list-avds \| grep -qx nusa_product_qa/);
  assert.match(workflow, /test -f "\$ANDROID_AVD_HOME\/nusa_product_qa\.ini"/);
  assert.match(workflow, /sudo chmod 666 \/dev\/kvm/);
  assert.match(workflow, /timeout 120 adb wait-for-device/);
  assert.match(workflow, /timeout 300 bash -c/);
  assert.match(workflow, /cat "\$RUNNER_TEMP\/emulator\.log" \|\| true/);
  assert.doesNotMatch(workflow, /^\s*adb wait-for-device\s*$/m);
  assert.match(workflow, /enter_personal\(\)/);
  assert.match(workflow, /"local-entry-submit"/);
  assert.match(workflow, /"home-screen"/);
  for (const marker of ["tab-Paper", "tab-Live", "tab-Home", "tab-More", "more-PaperEvidence", "more-Portfolio", "header-tools-menu", "header-settings", "utility-close"]) {
    assert.match(workflow, new RegExp(`(?:tap|tap_after_scroll) "${marker}"`));
  }
  for (const ambiguousLabel of ["MARKETS", "PAPER", "PORTFOLIO", "HOME", "도구", "설정", "설정 닫기"]) {
    assert.doesNotMatch(workflow, new RegExp(`tap "${ambiguousLabel}"`));
  }
  assert.ok(workflow.includes('print(ET.tostring(root, encoding="unicode"), file=sys.stderr)'));
  assert.match(workflow, /if: always\(\)/);
  assert.match(workflow, /grep -q "more-view" qa\/android-product-ux\/05-more\.xml/);
  assert.match(workflow, /grep -q "paper-learning-monitor" qa\/android-product-ux\/06-paper\.xml/);
  assert.match(workflow, /paper-learning-monitor/);
  assert.match(workflow, /grep -q "live-ready-monitor" qa\/android-product-ux\/03-live-readiness\.xml/);
  assert.match(workflow, /grep -q "자산 구성" qa\/android-product-ux\/09-portfolio\.xml/);
  assert.match(workflow, /grep -q "home-screen" qa\/android-product-ux\/13-home-return\.xml/);
  assert.match(workflow, /needle == "__SCROLL__"/);
  assert.match(workflow, /a\.get\("scrollable"\) != "true"/);
  assert.match(workflow, /scroll_once\(\)/);
  assert.match(workflow, /\[ "\$tries" -lt 8 \]/);
  assert.match(workflow, /evidence_disclosure=PASS/);
});
