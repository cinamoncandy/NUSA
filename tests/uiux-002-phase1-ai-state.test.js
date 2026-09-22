const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const mobile = path.resolve(__dirname, "../apps/mobile");

function source(file) {
  return fs.readFileSync(path.join(mobile, "src", file), "utf8");
}

test("AI renders fail-closed read-only truth without fabricated loading or analysis claims", () => {
  const ai = source("aiView.tsx");

  assert.match(ai, /testID="ai-screen"/);
  assert.match(ai, /const thesis=ai\?\.status==="AVAILABLE"&&ai\.thesis\?ai\.thesis:"검증된 AI 판단이 아직 없습니다\."/);
  assert.match(ai, /const calibrated=ai\?\.calibrationStatus==="CALIBRATED"/);
  assert.match(ai, /const trusted=calibrated\?percent\(ai\?\.confidence\):"UNVERIFIED"/);
  assert.match(ai, /보정되지 않은 출력입니다\. 수익 확률로 표시하지 않습니다\./);
  assert.match(ai, /VERIFIED EVIDENCE UNAVAILABLE/);
  assert.match(ai, /VERIFIED CHART UNAVAILABLE/);
  assert.match(ai, /AI ZERO AUTHORITY/);
  assert.match(ai, /SIGNAL IS READ ONLY/);
  assert.match(ai, /\{error\?<Text style=\{styles\.error\}>\{error\}<\/Text>:null\}/);
  assert.doesNotMatch(ai, /ActivityIndicator/);
  assert.doesNotMatch(ai, /ORDER_CREATE|LIVE_EXECUTION|onSubmit/);
});

test("Markets keeps chart navigation reachable regardless of verified candles", () => {
  const markets = source("marketsView.tsx");
  assert.match(markets, /useState<Panel>\("CHART"\)/);
  assert.match(markets, /testID="markets-panels"/);
  assert.match(markets, /const watchlist = <WatchlistView/);
  assert.match(markets, /const chart = <View[\s\S]*<ChartView/);
});

test("production PAPER supervises autonomous learning while legacy PAPER execution remains isolated and runtime-gated", () => {


  assert.match(source("localPaperLedger.ts"), /Boolean\(configuredEndpoint && session\.isConfigured\(\) && isPaperConnectionVerified\(configuredEndpoint\)\)/);

  // The two order surfaces these guards used to cover were deleted with the ORDER
  // destination. The guards now cover the PAPER surfaces that replaced them.
  for (const candidate of [source("paperLearningMonitorView.tsx"), source("homeView.tsx")]) {
    assert.doesNotMatch(candidate, /productionMutationAllowed:\s*true/);
    assert.doesNotMatch(candidate, /authority:\s*["']LIVE["']/);
    assert.doesNotMatch(candidate, /\/(?:live|withdraw|transfer)(?:\/|["'`])/i);
  }
});
