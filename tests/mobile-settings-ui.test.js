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
  assert.match(source, /토큰은 현재 앱 프로세스 메모리에만 존재합니다/);

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

  assert.match(source, /안전과 로컬 관리/);
  assert.match(source, /StatusChip label="PAPER ONLY"/);
  assert.match(source, /DataRow label="LIVE 주문" value="금지"/);
  assert.match(source, /DataRow label="Production mutation" value="금지"/);
  assert.match(source, /LIVE·출금·이체 권한은 이 화면에서 활성화할 수 없습니다/);
  assert.doesNotMatch(source, /placeOrder|cancelOrder|withdraw/);

  const app = fs.readFileSync(path.join(__dirname, "..", "apps", "mobile", "App.tsx"), "utf8");
  assert.match(app, /createCloudInvestmentAllocationClient/);
  assert.match(app, /exchangeCash=\{accountCash\}/);
  assert.match(app, /onCloudInvestmentPercentSave=\{investmentAllocationClient\.save\}/);
  assert.match(app, /onInvestmentPercentChanged=\{setInvestmentPercent\}/);
  assert.match(app, /investmentPercent=\{investmentPercent\}/);
  assert.match(app, /credentialSession\.clear\(\)/);
  assert.match(app, /signOut\(\)/);
});
