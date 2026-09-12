"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const src = (name) => readFileSync(join(__dirname, "..", "apps", "mobile", "src", name), "utf8");
const HOME = src("homeView.tsx");
const SETTINGS = src("settingsView.tsx");
const TRADING = src("tradingView.tsx");

test("the equity hero carries its own age and is struck through when stale", () => {
  assert.match(HOME, /<AgingValue generatedAtMs=\{equityGeneratedAtMs\}/);
  assert.match(HOME, /balanceValueStale/);
  assert.match(HOME, /testID="account-hero-freshness"/);
  // The age must be read as part of the value, not as a separate unlabelled duration.
  assert.match(HOME, /accessibilityLabel=\{`\$\{krw\(account\?\.equity\)\}, \$\{age\}/);
});

test("the age advances on its own instead of freezing at the last render", () => {
  const SURFACES = src("instrumentSurfaces.tsx");
  // Reading Date.now() during render leaves a screen saying "2초 전" while the data ages out,
  // which asserts a freshness the data no longer has -- worse than showing no age at all.
  assert.match(SURFACES, /setInterval\(\(\) => \{ setNowMs\(Date\.now\(\)\); \}, intervalMs\)/);
  assert.match(SURFACES, /return \(\) => \{ clearInterval\(timer\); \};/);
  assert.doesNotMatch(HOME, /Date\.now\(\)[^)]*equity/i);
});

test("the clock sits in a leaf so ticking it does not re-render the chart", () => {
  const SURFACES = src("instrumentSurfaces.tsx");
  assert.match(SURFACES, /export function AgingValue/);
  // AgingValue owns the tick; HOME must not hold one itself, or the whole screen redraws.
  assert.doesNotMatch(HOME, /useNowMs\(/);
  assert.match(HOME, /<CandlePlot/);
});

test("the connection flow renders the structured refusal, not only a flattened sentence", () => {
  assert.match(SETTINGS, /<RefusalRecord refusal=\{connectionRefusal\}/);
  assert.match(SETTINGS, /describeRefusal\(connectionError\.refusal, connectionError\.status\)/);
});

test("a stale refusal never outlives the attempt that produced it", () => {
  // Cleared when a new attempt starts and when the session is dropped, so the screen cannot
  // show a refusal from a previous token next to a fresh result.
  assert.equal(SETTINGS.match(/setConnectionRefusal\(null\)/g)?.length, 2);
});

test("a derived figure ages with the price it was computed from", () => {
  const PORTFOLIO = src("portfolioView.tsx");
  // Unrealized PNL is quantity x current price. Left in profit green off an expired quote it
  // states a gain nobody can act on, so a stale price drops it to neutral and says why.
  assert.match(PORTFOLIO, /priceStale = priceStage === "STALE"/);
  assert.match(PORTFOLIO, /note=\{priceStale \? "현재가가 만료되어 이 값은 신뢰할 수 없습니다"/);
  assert.match(PORTFOLIO, /tone=\{priceStale \? "neutral" : position\.unrealizedPnl >= 0/);
});

test("realized PNL is exempt, because it is booked rather than derived", () => {
  const PORTFOLIO = src("portfolioView.tsx");
  const realized = PORTFOLIO.slice(PORTFOLIO.indexOf('label="REALIZED PNL"'));
  const row = realized.slice(0, realized.indexOf("/>"));
  assert.doesNotMatch(row, /priceStale/, "a booked figure must not dim with a live quote");
});

test("LOCAL PAPER carries no server stamp rather than a borrowed one", () => {
  const PORTFOLIO = src("portfolioView.tsx");
  // No server clock exists on that path, and inventing an age would be worse than showing none.
  assert.match(PORTFOLIO, /generatedAtMs == null \? null : freshnessStage/);
  assert.match(PORTFOLIO, /generatedAtMs == null \? undefined : describeAge/);
});

test("an account-state refusal routes to the control that clears it", () => {
  const { describeRefusal, isResolvableInOperatorPanel } = require("../dist/apps/mobile/src/instrumentState.js");
  // These two are account state, and the owner-scoped user list on this same screen can change
  // it. Sending the operator to "the server" for a control two sections below is what turned a
  // solvable state into days of suspecting the token.
  assert.equal(isResolvableInOperatorPanel(describeRefusal("USER_NOT_ACTIVE")), true);
  assert.equal(isResolvableInOperatorPanel(describeRefusal("USER_NOT_REGISTERED")), true);
  assert.equal(isResolvableInOperatorPanel(describeRefusal("USER_IDENTITY_MISMATCH")), false);
  assert.equal(isResolvableInOperatorPanel(describeRefusal("KILL_SWITCH_ACTIVE")), false);
  // The action must name the in-app control, not a server login.
  assert.match(describeRefusal("USER_NOT_ACTIVE").action, /운영자 사용자 승인/);
  assert.doesNotMatch(describeRefusal("USER_NOT_ACTIVE").action, /^서버에서/);
});

test("the record's button scrolls to the operator panel it names", () => {
  assert.match(SETTINGS, /isResolvableInOperatorPanel\(connectionRefusal\)/);
  assert.match(SETTINGS, /actionLabel: "운영자 승인으로 이동"/);
  assert.match(SETTINGS, /scrollRef\.current\?\.scrollTo\(\{ y: Math\.max\(0, operatorSectionYRef\.current/);
  // The offset has to come from the section's own layout, not a guessed constant.
  assert.match(SETTINGS, /onLayout=\{\(event\) => \{ operatorSectionYRef\.current = event\.nativeEvent\.layout\.y; \}\}/);
});

test("the compatibility token path states the ten-minute rule instead of only calling it one-time", () => {
  // Pairing is the primary path now, and this field is the fallback for a token someone already
  // holds -- which is exactly the person who pastes a bootstrap token issued days ago and reads a
  // bare 401. "One-time" does not tell them that; the expiry rule does.
  assert.match(SETTINGS, /소유자 대시보드 토큰\(만료 없음\)/);
  assert.match(SETTINGS, /부트스트랩 토큰\(발급 후 10분, 1회용\)/);
  assert.match(SETTINGS, /며칠 전에 받아둔 부트스트랩 토큰은 반드시 거부됩니다/);
});

test("a refusal record reaches every surface a gate can refuse", () => {
  const PORTFOLIO = src("portfolioView.tsx");
  const AI = src("aiView.tsx");
  assert.match(PORTFOLIO, /<RefusalRecord refusal=\{refusal\}/);
  assert.match(AI, /<RefusalRecord refusal=\{refusal\}/);
  // The one-line notice stays as the fallback: a client-side condition has no gate to name.
  assert.match(PORTFOLIO, /: error \? <StateNotice/);
  assert.match(AI, /if \(error\) return <AiState/);
});

test("only a named gate produces a record; a client-side condition does not", () => {
  const CLIENT = src("personalPaperOperationsClient.ts");
  // Inventing a gate for "the endpoint is unverified" would claim a diagnosis nobody made.
  assert.match(CLIENT, /readonly refusal\?: RefusalDescriptor/);
  assert.match(CLIENT, /\.\.\.\(refusal == null \? \{\} : \{ refusal \}\)/);
});

test("the AI proposal carries the signature that makes it auditable", () => {
  const AI = src("aiView.tsx");
  assert.match(AI, /model \$\{ai\?\.modelVersion/);
  assert.match(AI, /prompt \$\{ai\?\.promptVersion/);
  assert.match(AI, /testID="ai-signature"/);
  // And states plainly that it cannot act.
  assert.match(AI, /AI는 제안만 합니다\. 주문·이체·출금 실행 권한이 없습니다/);
});

test("no dead surface is left behind", () => {
  const SURFACES = src("instrumentSurfaces.tsx");
  // FreshValue presumed a governed staleness window. Only the PAPER operations contract defines
  // one; public quotes have none, so it had no honest home and was removed rather than given a
  // threshold nobody specified.
  assert.doesNotMatch(SURFACES, /FreshValue/);
  for (const exported of ["AuthoritySpine", "RefusalRecord", "AgingValue", "useNowMs"]) {
    assert.match(SURFACES, new RegExp(`export function ${exported}`), exported);
  }
});

test("production PAPER stays a supervision surface with no manual ticket", () => {
  // The refusal record deliberately did NOT go onto an order ticket: this route has none, and
  // adding one would contradict the documented safety contract rather than implement a design.
  assert.doesNotMatch(TRADING, /RefusalRecord/);
  assert.match(TRADING, /never exposes manual BUY\/SELL/);
});
