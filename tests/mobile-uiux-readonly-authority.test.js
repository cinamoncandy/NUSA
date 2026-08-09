const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const mobile = path.resolve(__dirname, "../apps/mobile");
const read = (file) => fs.readFileSync(path.join(mobile, file), "utf8");

test("UIUX-001 keeps the five-tab foundation while presenting Korean primary navigation", () => {
  const app = read("App.tsx");
  assert.match(app, /const tabs = \["Home", "Markets", "Trade", "Portfolio", "More"\] as const/);
  assert.match(app, /Home: "홈"/);
  assert.match(app, /Markets: "시장"/);
  assert.match(app, /Trade: "거래"/);
  assert.match(app, /Portfolio: "자산"/);
  assert.match(app, /More: "더보기"/);
});

test("mobile intelligence shell displays real AI projection and truthful authority state", () => {
  const app = read("App.tsx");
  const components = read("src/components.tsx");
  assert.match(app, /const ai = snapshot\?\.ai \?\? null/);
  assert.match(app, /ai\?\.thesis \?\? "현재 표시할 AI 분석이 없습니다\."/);
  assert.match(components, /ZERO AUTHORITY/);
  assert.match(components, /UI 주문 경로 없음/);
  assert.doesNotMatch(components, /LIVE 권한 없음/);
  assert.match(app, /<DataRow label="LIVE 권한" value=\{snapshot\.liveAuthority\} emphasis \/>/);
  assert.match(app, /<DataRow label="Production mutation" value=\{snapshot\.productionMutationAllowed \? "허용" : "금지"\}/);
  assert.match(components, /실제 주문 권한은 없습니다/);
  assert.doesNotMatch(app, /94%/);
});

test("read-only PAPER surface exposes authority state without fake order controls", () => {
  const app = read("App.tsx");
  const trading = read("src/tradingView.tsx");
  assert.match(app, /<TradingView[^>]*snapshot=/s);
  assert.doesNotMatch(app, /<TradingView[^>]*onSubmit=/s);
  assert.match(trading, /const readOnly = onSubmit === undefined/);
  assert.match(trading, /PAPER 관찰 모드/);
  assert.match(trading, /ZERO MUTATION/);
  assert.match(trading, /매수·매도 요청을 만들거나 서버로 전송할 수 없습니다/);
  assert.match(trading, /<DataRow label="주문 생성" value="연결 안 됨"/);
  assert.match(trading, /<DataRow label="서버 전송" value="불가"/);
  assert.match(trading, /<DataRow label="현재 권한" value="읽기 전용"/);
  assert.doesNotMatch(trading, /disabled label="매수 미리보기"/);
  assert.doesNotMatch(trading, /disabled label="매도 미리보기"/);
  assert.doesNotMatch(trading, /읽기 전용 — 주문 권한 없음/);
});

test("dashboard credential flow remains memory-only and independently connected", () => {
  const app = read("App.tsx");
  assert.match(app, /InMemoryDashboardCredentialSession/);
  assert.match(app, /credentialSession\.connect\(dashboardTokenDraft\)/);
  assert.match(app, /credentialSession\.clear\(\)/);
  assert.match(app, /프로세스 메모리에만 유지/);
  assert.match(app, /testID="dashboard-connect"/);
  assert.match(app, /testID="dashboard-disconnect"/);
});