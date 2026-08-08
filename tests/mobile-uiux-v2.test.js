const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..", "apps", "mobile");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("product navigation promotes PAPER and AI without changing foundation tab keys", () => {
  const app = read("App.tsx");
  assert.match(app, /const tabs = \["Home", "Markets", "Trade", "Portfolio", "More"\] as const/);
  assert.match(app, /Trade: "PAPER"/);
  assert.match(app, /More: "AI"/);
  assert.match(app, /activeTab === "More" \? <AiView/);
  assert.doesNotMatch(app, /<MoreView/);
  assert.match(app, /header-notifications/);
  assert.match(app, /header-settings/);
  assert.match(app, /setUtilityView\(null\); setActiveTab\(tab\)/);
});

test("AI destination is evidence-backed and explicitly zero authority", () => {
  const source = read("src/aiView.tsx");
  assert.match(source, /ZERO AUTHORITY/);
  assert.match(source, /READ ONLY/);
  assert.match(source, /ai\.evidenceReferences/);
  assert.match(source, /ai\.counterEvidence/);
  assert.match(source, /ai\.disagreements/);
  assert.match(source, /liveAuthority/);
  assert.match(source, /productionMutationAllowed/);
  assert.match(source, /주문·이체·LIVE 실행 권한은 없습니다/);
  assert.doesNotMatch(source, /onSubmit|ORDER_CREATE|LIVE_EXECUTION/);
});

test("Markets does not expose an interactive chart path without candle data", () => {
  const source = read("src/marketsView.tsx");
  assert.match(source, /const chartAvailable = Array\.isArray\(rawCandles\) && rawCandles\.length > 0/);
  assert.match(source, /if \(!chartAvailable\)/);
  assert.match(source, /<WatchlistView/);
  assert.match(source, /panel === "CHART"/);
});

test("read-only PAPER path removes fake order controls while retaining explicit authority copy", () => {
  const source = read("src/tradingView.tsx");
  assert.match(source, /const readOnly = onSubmit === undefined/);
  assert.match(source, /trading-readonly-state/);
  assert.match(source, /주문 입력 비활성/);
  assert.match(source, /매수\/매도 요청을 서버로 전송할 수 없습니다/);
  assert.match(source, /현재 App wiring에는 주문 제출 callback이 없습니다/);
  assert.doesNotMatch(source, /매수 미리보기|매도 미리보기/);
});