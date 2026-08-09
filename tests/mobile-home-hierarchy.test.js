const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const appPath = path.join(__dirname, "..", "apps", "mobile", "App.tsx");
const readApp = () => fs.readFileSync(appPath, "utf8");

test("home prioritizes financial status, AI insight, then compact system safety", () => {
  const app = readApp();
  assert.match(app, /title="오늘의 금융 상태"/);
  const equity = app.indexOf('testID="account-hero-card"');
  const ai = app.indexOf('testID="ai-card"');
  const system = app.indexOf('testID="system-status-card"');
  assert.ok(equity >= 0, "account hero must exist");
  assert.ok(ai > equity, "AI insight must follow the financial hero");
  assert.ok(system > ai, "system safety summary must follow AI insight");
});

test("home actions navigate to real Portfolio and AI destinations", () => {
  const app = readApp();
  assert.match(app, /testID="home-open-portfolio"/);
  assert.match(app, /onPress=\{\(\) => setActiveTab\("Portfolio"\)\}/);
  assert.match(app, /testID="home-open-ai"/);
  assert.match(app, /onPress=\{\(\) => setActiveTab\("More"\)\}/);
});

test("home removes developer-console card proliferation without hiding safety truth", () => {
  const app = readApp();
  assert.doesNotMatch(app, /testID="operations-card"/);
  assert.doesNotMatch(app, /testID="research-card"/);
  assert.doesNotMatch(app, /testID="safety-card"/);
  assert.doesNotMatch(app, /label="스케줄러"/);
  assert.doesNotMatch(app, /label="대기 쓰기"/);
  assert.match(app, /<DataRow label="PAPER 운영"/);
  assert.match(app, /<DataRow label="런타임"/);
  assert.match(app, /<DataRow label="시장 전송"/);
  assert.match(app, /<DataRow label="킬 스위치"/);
  assert.match(app, /<DataRow label="LIVE 권한" value=\{snapshot\.liveAuthority\} emphasis \/>/);
  assert.match(app, /<DataRow label="Production mutation" value=\{snapshot\.productionMutationAllowed \? "허용" : "금지"\}/);
});

test("home uses only real snapshot-derived financial and AI values", () => {
  const app = readApp();
  assert.match(app, /account \? krw\(account\.equity\) : "포트폴리오 없음"/);
  assert.match(app, /const totalPnl = account == null \? null : \(account\.realizedPnl \?\? account\.position\.realizedPnl\) \+ account\.unrealizedPnl/);
  assert.match(app, /ai\?\.thesis \?\? "현재 표시할 AI 분석이 없습니다\."/);
  assert.doesNotMatch(app, /94%|예상 수익|가상 잔고|샘플 데이터/);
});
