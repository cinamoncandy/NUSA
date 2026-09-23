const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("HOME keeps verified market observation substantial and tablet-aware", () => {
  const home = read("apps/mobile/src/homeView.tsx");
  assert.match(home, /const tablet = width >= 768;/);
  assert.match(home, /contentContainerStyle=\{\[styles\.content, \{ maxWidth: tablet \? 980 : 720 \}\]\}/);
  // The board carries market observation as one verified status rather than a truncated list, so
  // there is no per-device slice any more. What still matters is that the status is derived from
  // observations the runtime actually verified.
  assert.match(home, /const observedMarkets = marketFeed\.filter\(/);
  assert.match(home, /observedMarkets\.length > 0/);
  assert.match(home, /testID="home-market-status"/);
  assert.match(home, /testID="home-ai-judgement"/);
  assert.match(home, /selectHomeMarketData\(props\.publicMarkets, props\.snapshot\?\.markets \?\? \[\]\)/);
  assert.match(home, /UPBIT PUBLIC/);
});

test("HOME approved intelligence hierarchy remains content-first and evidence-backed", () => {
  const home = read("apps/mobile/src/homeView.tsx");
  const hero = home.indexOf('testID="account-hero-card"');
  const pulse = home.indexOf('testID="home-market-status"');
  const paper = home.indexOf('testID="home-paper-status"');
  const ai = home.indexOf('testID="home-ai-judgement"');
  const capital = home.indexOf('testID="home-capital-limits"');
  const learning = home.indexOf('testID="home-paper-learning"');
  assert.ok([hero, pulse, paper, ai, capital, learning].every((index) => index >= 0));
  assert.ok(hero < pulse && pulse < paper && paper < ai && ai < capital && capital < learning);
});
