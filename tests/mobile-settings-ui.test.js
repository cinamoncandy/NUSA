const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("settings UI exposes local PAPER, optional Cloud, cash allocation, appearance, safety and local management", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "apps", "mobile", "src", "settingsView.tsx"), "utf8");
  assert.match(source, /testID="settings-screen"/);
  assert.match(source, /<ScreenHeader/);
  assert.match(source, /testID="settings-local-paper"/);
  assert.match(source, /LOCAL PAPER는 연결 없이 즉시 사용할 수 있습니다/);
  assert.match(source, /testID="settings-paper-connection"/);
  assert.match(source, /testID="settings-paper-endpoint"/);
  assert.match(source, /testID="settings-paper-token"/);
  assert.match(source, /testID="settings-paper-connect"/);
  assert.match(source, /testID="settings-paper-disconnect"/);
  assert.match(source, /bootstrap token은 저장하지 않고 한 번만 세션으로 교환합니다/);
  assert.match(source, /LOCAL PAPER 거래에는 사용하지 않습니다/);
  assert.doesNotMatch(source, /iOS 영구 세션 복원/);

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

  assert.match(source, /testID="settings-safety"/);
  assert.match(source, /StatusChip label="PAPER ONLY"/);
  assert.match(source, /DataRow label="기본 운영 모드" value="LOCAL PAPER"/);
  assert.match(source, /DataRow label="Cloud 연결" value="선택"/);
  assert.match(source, /DataRow label="LIVE 주문" value="금지"/);
  assert.match(source, /DataRow label="Production mutation" value="금지"/);
  assert.match(source, /LIVE·출금·이체 권한은 이 화면에서 활성화할 수 없습니다/);
  assert.match(source, /testID="settings-mode"/);
  assert.match(source, /로컬과 개인 모드 관리/);
  assert.doesNotMatch(source, /placeOrder|cancelOrder|withdraw/);

  const order = ["settings-local-paper", "settings-paper-connection", "settings-capital-allocation", "settings-theme", "settings-safety", "settings-mode", "settings-operator-users"].map((testID) => source.indexOf(`testID="${testID}"`));
  assert.ok(order.every((index) => index > -1), "every settings section testID must be present");
  assert.deepEqual(order, [...order].sort((left, right) => left - right), "settings sections must render in local-first order");

  const app = fs.readFileSync(path.join(__dirname, "..", "apps", "mobile", "App.tsx"), "utf8");
  assert.match(app, /createCloudInvestmentAllocationClient/);
  assert.match(app, /exchangeCash=\{accountCash\}/);
  assert.match(app, /onCloudInvestmentPercentSave=\{investmentAllocationClient\.save\}/);
  assert.match(app, /onInvestmentPercentChanged=\{setInvestmentPercent\}/);
  assert.match(app, /investmentPercent=\{investmentPercent\}/);
  assert.match(app, /credentialSession\.clear\(\)/);
  assert.match(app, /signOut\(\)/);
});