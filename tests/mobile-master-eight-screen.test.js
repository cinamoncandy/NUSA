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
 assert.match(markets,/testID="market-globe-hero"/);// The board captioned this "Global Markets". NUSA observes Upbit KRW only, so the caption names
 // the real scope; "global" would be a claim the feed does not support.
 assert.match(markets,/Upbit KRW Markets/);// Upbit KRW publishes no indices and no sector classification, and the board's tabs were plain
 // Views with no handler. Only the tab the screen actually shows remains.
 assert.match(markets,/KRW Markets/);
 assert.doesNotMatch(markets,/"Indices"|"Sectors"/);
});
test("truthful missing-evidence states stay explicit",()=>{
 assert.match(risk,/PORTFOLIO VAR" value="—"/);assert.match(perf,/NO VERIFIED EQUITY HISTORY/);assert.match(perf,/NO SYNTHETIC CURVE/);
});
test("Signals are real Terrain and Detail states and Strategies follows the master hierarchy",()=>{
 const ai=fs.readFileSync("apps/mobile/src/aiView.tsx","utf8");const strategies=fs.readFileSync("apps/mobile/src/strategiesView.tsx","utf8");
 assert.match(ai,/testID="signal-terrain-hero"/);assert.match(ai,/testID="signal-open-detail"/);assert.match(ai,/setDetailOpen\(true\)/);assert.match(ai,/signal-detail-back/);
 assert.match(strategies,/Families","Active","Watchlist/);assert.match(strategies,/testID="strategies-list"/);assert.match(strategies,/testID="strategies-featured"/);
});

test("More matches the master primary menu and keeps Risk/Performance secondary",()=>{
 const more=fs.readFileSync("apps/mobile/src/moreMenuView.tsx","utf8");
 for(const label of ["AI Analysis","Research","System Status","Settings","Help"]) assert.match(more,new RegExp(label));
 assert.match(more,/testID="more-insight-rail"/);assert.match(more,/INSIGHTS/);
});
