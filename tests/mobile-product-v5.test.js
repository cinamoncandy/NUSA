const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..", "apps", "mobile");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("product v5 keeps the four primary jobs literal and glanceable", () => {
  const app = read("App.tsx");
  assert.match(app, /Home: "HOME", Markets: "MARKETS", Paper: "PAPER", Portfolio: "PORTFOLIO"/);
  const home = read("src/homeView.tsx");
  assert.match(home, />MARKETS<\/Text>/);
  assert.match(home, />PORTFOLIO<\/Text>/);
  assert.match(home, /PAPER EQUITY/);
  assert.match(home, /TOTAL PNL/);
});

test("product v5 uses flatter secondary sections and Android-sized actions", () => {
  const intelligence = read("src/intelligenceOs.tsx");
  assert.match(intelligence, /section: { borderTopWidth: StyleSheet.hairlineWidth, borderRadius: 0/);
  assert.match(intelligence, /sectionAction: { minHeight: 48/);
  assert.match(intelligence, /leadTitle: { fontSize: 30/);
});

test("Cloud PAPER setup communicates server session verify without changing authority", () => {
  const settings = read("src/settingsView.tsx");
  assert.match(settings, /title="SERVER"/);
  assert.match(settings, /title="SECURE SESSION"/);
  assert.match(settings, /title="VERIFY"/);
  assert.match(settings, /연결 다시 시도/);
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
  for (const marker of ["tab-Markets", "tab-Paper", "paper-learning-detail-toggle", "tab-Portfolio", "header-tools-menu", "header-settings", "utility-close", "tab-Home"]) {
    assert.match(workflow, new RegExp(`tap(?:_after_scroll)? "${marker}"`));
  }
  for (const ambiguousLabel of ["MARKETS", "PAPER", "PORTFOLIO", "HOME", "도구", "설정", "설정 닫기"]) {
    assert.doesNotMatch(workflow, new RegExp(`tap "${ambiguousLabel.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\  assert.match(workflow, /"home-screen"/);
")}"`));
  }
  assert.match(workflow, /ET\.tostring\(ET\.parse\("\/tmp\/window\.xml"\)\.getroot\(\), encoding="unicode"\)/);
  assert.match(workflow, /if: always\(\)/);
  assert.match(workflow, /grep -q "PAPER ONLY"/);
  assert.match(workflow, /evidence_disclosure=PASS/);
});
