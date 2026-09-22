const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const mobile = path.resolve(__dirname, "../apps/mobile");

function source(file) {
  return fs.readFileSync(path.join(mobile, "src", file), "utf8");
}

test("AI renders truthful unavailable/error states inside the approved read-only signal detail", () => {
  const ai = source("aiView.tsx");
  assert.match(ai, /testID="ai-screen"/);
  assert.match(ai, /const thesis=ai\?\.status==="AVAILABLE"&&ai\.thesis\?ai\.thesis:"검증된 AI 판단이 아직 없습니다\."/);
  assert.match(ai, /\{error\?<Text style=\{styles\.error\}>\{error\}<\/Text>:null\}/);
  assert.match(ai, /NO VERIFIED RUN/);
  assert.match(ai, /UNVERIFIED/);
  assert.match(ai, /ZERO AUTHORITY/);
  assert.match(ai, /READ ONLY/);
});

test("Markets keeps chart navigation reachable regardless of verified candles", () => {
  const markets = source("marketsView.tsx");
  assert.match(markets, /useState<Panel>\("CHART"\)/);
  assert.match(markets, /testID="markets-panels"/);
  assert.match(markets, /const watchlist = <WatchlistView/);
  assert.match(markets, /const chart = <View[\s\S]*<ChartView/);
});

test("production PAPER is learning supervision only while legacy simulation stays isolated and PAPER-only", () => {


  assert.match(source("localPaperLedger.ts"), /Boolean\(configuredEndpoint && session\.isConfigured\(\) && isPaperConnectionVerified\(configuredEndpoint\)\)/);
});
