const test=require("node:test");const assert=require("node:assert/strict");const fs=require("node:fs");
const app=fs.readFileSync("apps/mobile/App.tsx","utf8");
const more=fs.readFileSync("apps/mobile/src/moreMenuView.tsx","utf8");
const risk=fs.readFileSync("apps/mobile/src/riskView.tsx","utf8");
const perf=fs.readFileSync("apps/mobile/src/performanceView.tsx","utf8");
const home=fs.readFileSync("apps/mobile/src/homeView.tsx","utf8");
const markets=fs.readFileSync("apps/mobile/src/marketsView.tsx","utf8");
test("MASTER reference exposes five primary destinations and truthful Risk/Performance depth",()=>{
 assert.match(app,/const tabs = \["Home", "Market", "Signals", "Strategies", "More"\]/);
 assert.match(more,/key: "RISK"/);assert.match(more,/key: "PERFORMANCE"/);
 assert.match(app,/utilityView === "RISK" \? <RiskView/);assert.match(app,/utilityView === "PERFORMANCE" \? <PerformanceView/);
 assert.match(risk,/testID="risk-screen"/);assert.match(perf,/testID="performance-screen"/);
});
test("HOME and Market use approved concept hierarchy instead of dense command dashboard",()=>{
 assert.match(home,/A More\{"\\n"\}Rational Tomorrow\./);
 assert.match(home,/testID="home-system-status"/);assert.match(home,/testID="home-market-status"/);assert.match(home,/testID="home-paper-status"/);
 assert.match(markets,/testID="market-globe-hero"/);assert.match(markets,/Global Markets/);assert.match(markets,/Overview","Indices","Sectors","Assets/);
});
test("truthful missing-evidence states stay explicit",()=>{
 assert.match(risk,/PORTFOLIO VAR" value="—"/);assert.match(perf,/NO VERIFIED EQUITY HISTORY/);assert.match(perf,/NO SYNTHETIC CURVE/);
});
test("Signals are real Terrain and Detail states and Strategies follows the master hierarchy",()=>{
 const ai=fs.readFileSync("apps/mobile/src/aiView.tsx","utf8");const strategies=fs.readFileSync("apps/mobile/src/strategiesView.tsx","utf8");
 assert.match(ai,/testID="signal-terrain-hero"/);assert.match(ai,/testID="signal-open-detail"/);assert.match(ai,/setDetailOpen\(true\)/);assert.match(ai,/signal-detail-back/);
 assert.match(strategies,/Families","Active","Watchlist/);assert.match(strategies,/testID="strategies-list"/);assert.match(strategies,/testID="strategies-featured"/);
});
