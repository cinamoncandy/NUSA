const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("settings UI exposes PAPER connection, cash allocation, appearance, safety and local management", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "apps", "mobile", "src", "settingsView.tsx"), "utf8");
  assert.match(source, /testID="settings-screen"/);
  assert.match(source, /<ScreenHeader/);
  assert.match(source, /testID="settings-paper-connection"/);
  assert.match(source, /testID="settings-paper-endpoint"/);
  assert.match(source, /testID="settings-paper-token"/);
  assert.match(source, /testID="settings-paper-connect"/);
  assert.match(source, /testID="settings-paper-disconnect"/);
  assert.match(source, /입력한 bootstrap token은 저장하지 않고 한 번만 세션으로 교환합니다/);
  assert.match(source, /Access token은 앱 메모리에만 유지/);
  assert.match(source, /rotating refresh token은 Android Keystore로 암호화해 저장합니다/);
  assert.match(source, /iOS 영구 세션 복원은 아직 활성화하지 않습니다/);

  assert.match(source, /testID="settings-capital-allocation"/);
  assert.match(source, /현금 투자 비중/);
  assert.match(source, /투자 가능/);
  assert.match(source, /보호 현금/);
  assert.match(source, /createCashInvestmentEnvelope/);
  assert.match(source, /testID="settings-investment-allocation-presets"/);
  assert.match(source, /testID="settings-investment-percent"/);
  assert.match(source, /testID="settings-investment-percent-save"/);
  assert.match(source, /normalizeInvestmentPercent/);
  assert.match(source, /onCloudInvestmentPercentSave/);
  assert.match(source, /onInvestmentPercentChanged/);

  assert.match(source, /화면 테마/);
  assert.match(source, /testID="settings-theme-segmented-control"/);
  assert.match(source, /selectedKey=\{settings\.theme\}/);
  assert.match(source, /updateTheme\(key as ThemeSetting\)/);

  // v5 (docs/NUSA_MOBILE_UIUX_V5_OBSIDIAN_FINANCE.md §10) splits "safety/authority" and
  // "local/personal-mode management" into two distinct steps rather than one merged block,
  // and the top-of-screen standalone "PAPER ONLY" chip is gone -- the fact is still shown,
  // contextually, inside the safety section's DataRow instead of a redundant top chip.
  assert.doesNotMatch(source, /StatusChip label="PAPER ONLY"/);
  assert.match(source, /testID="settings-safety"/);
  assert.match(source, /DataRow label="운영 모드" value="PAPER"/);
  assert.match(source, /DataRow label="LIVE 주문" value="금지"/);
  assert.match(source, /DataRow label="Production mutation" value="금지"/);
  assert.match(source, /LIVE·출금·이체 권한은 이 화면에서 활성화할 수 없습니다/);
  assert.match(source, /testID="settings-mode"/);
  assert.match(source, /로컬과 개인 모드 관리/);
  assert.doesNotMatch(source, /placeOrder|cancelOrder|withdraw/);

  // Exact section order: connection -> cash allocation -> appearance -> safety/authority ->
  // local/personal-mode management -> operator user access (owner-only extension, last).
  const order = ["settings-paper-connection", "settings-capital-allocation", "settings-theme", "settings-safety", "settings-mode", "settings-operator-users"].map((testID) => source.indexOf(`testID="${testID}"`));
  assert.ok(order.every((index) => index > -1), "every settings section testID must be present");
  assert.deepEqual(order, [...order].sort((left, right) => left - right), "settings sections must render in v5 order");

  const app = fs.readFileSync(path.join(__dirname, "..", "apps", "mobile", "App.tsx"), "utf8");
  assert.match(app, /createCloudInvestmentAllocationClient/);
  assert.match(app, /exchangeCash=\{accountCash\}/);
  assert.match(app, /onCloudInvestmentPercentSave=\{investmentAllocationClient\.save\}/);
  assert.match(app, /onInvestmentPercentChanged=\{setInvestmentPercent\}/);
  assert.match(app, /investmentPercent=\{investmentPercent\}/);
  assert.match(app, /credentialSession\.clear\(\)/);
  assert.match(app, /signOut\(\)/);
});