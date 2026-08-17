const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const mobileSrc = path.resolve(__dirname, "../apps/mobile/src");
const read = (file) => fs.readFileSync(file, "utf8");

/**
 * Absence assertions below run against code with comments stripped. Prose that
 * explains an invariant must not trip the check that enforces it -- otherwise
 * documenting the rule breaks the build, and the test becomes something to work
 * around rather than a guard.
 */
const code = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

const appSource = read(path.join(__dirname, "../apps/mobile/App.tsx"));
const dispatcherSource = read(path.join(mobileSrc, "upbitTradingSignalDispatcher.ts"));
const modalSource = read(path.join(mobileSrc, "upbitTradingConfirmationModal.tsx"));
const managerSource = read(path.join(mobileSrc, "upbitTradingManager.ts"));
const dispatcherCode = code(dispatcherSource);
const appCode = code(appSource);
const managerCode = code(managerSource);

/**
 * These assert the ABSENCE of constructs that would let AI analysis originate an
 * order. An absence assertion is an enforceable invariant: it fails the moment the
 * construct returns. (Asserting a string is merely present proves nothing about
 * behaviour, which is why the earlier presence-greps here were replaced.)
 *
 * The invariant: AiReadOnlyProjection carries no trade direction, because AI holds
 * no order authority (ADR-0004). Deriving a side from thesis prose manufactures an
 * authority the contract withholds.
 */

test("no order path derives trade intent from AI thesis prose", () => {
  // The Korean/English keyword matcher that turned "상승" into BUY and "확실" into
  // +0.2 confidence must not come back in any form.
  assert.doesNotMatch(dispatcherCode, /extractTradingSignalFromThesis/);
  assert.doesNotMatch(dispatcherCode, /thesis/i);
  assert.doesNotMatch(appCode, /extractTradingSignalFromThesis/);

  // Direction must never be inferred from natural-language keywords.
  assert.doesNotMatch(dispatcherCode, /매수|매도|상승|하락/);
  assert.doesNotMatch(dispatcherCode, /buyPatterns|sellPatterns/);
});

test("no order path fabricates a confidence score", () => {
  // Trusted confidence lives on AiReadOnlyProjection and stays zero unless
  // calibration is verified. The dispatcher must not mint its own number or gate
  // execution on one.
  assert.doesNotMatch(dispatcherCode, /MIN_CONFIDENCE/);
  assert.doesNotMatch(dispatcherCode, /confidence/i);
  assert.doesNotMatch(dispatcherCode, /0\.65/);
  assert.doesNotMatch(dispatcherCode, /createTradingSignal/);
  assert.doesNotMatch(appCode, /createTradingSignal/);
});

test("an order records human origin in its type", () => {
  assert.match(dispatcherSource, /readonly origin: "HUMAN"/);
  // "HUMAN" must be the only permitted origin -- no AI/AUTO alternative.
  assert.doesNotMatch(dispatcherCode, /origin\??:\s*"(?:AI|AUTO|MODEL)"/);
});

test("LIVE execution stays behind explicit human confirmation", () => {
  assert.match(dispatcherSource, /requiresHumanConfirm/);
  assert.match(dispatcherSource, /requiresConfirmation: true/);
  // confirmAndExecute is reachable only in LIVE and refuses other modes.
  assert.match(dispatcherSource, /getMode\(\) !== "LIVE"/);
  assert.match(appSource, /handleTradingConfirmationConfirm/);
  assert.match(appSource, /handleTradingConfirmationCancel/);
});

test("every order is validated by the trading manager before execution", () => {
  assert.match(dispatcherSource, /validateOrderPlacement/);
  assert.match(dispatcherSource, /if \(!validation\.permitted\)/);
  // Both execution entry points go through executeOrder, never a raw client call.
  assert.doesNotMatch(dispatcherCode, /placeUpbitOrder/);
  assert.match(dispatcherSource, /tradingManager\.executeOrder/);
});

test("trading manager enforces the four safety guards", () => {
  assert.match(managerSource, /dailyLossKRW.*dailyLossLimitKRW/);
  assert.match(managerSource, /orderKRW.*maxOrderAmountKRW/);
  assert.match(managerSource, /orderTimestamps.*5_000/);
  assert.match(managerSource, /minOrderIntervalMs/);
  assert.match(managerSource, /resetDailyLoss/);
});

test("no order path can withdraw or transfer funds", () => {
  assert.doesNotMatch(dispatcherCode, /withdraw|transfer/i);
  assert.doesNotMatch(managerCode, /withdraw|transfer/i);
  assert.match(managerSource, /placeUpbitOrder|cancelUpbitOrder/);
});

test("confirmation modal shows the order and warns on LIVE", () => {
  assert.match(modalSource, /UpbitTradingConfirmationModal/);
  assert.match(modalSource, /실거래/);
  assert.match(modalSource, /estimatedKRW/);
  assert.match(modalSource, /onConfirm/);
  assert.match(modalSource, /onCancel/);
});

test("App keeps the Upbit credential session separate from the PAPER session", () => {
  assert.match(appSource, /InMemoryUpbitCredentialSession/);
  assert.match(appSource, /InMemoryDashboardCredentialSession/);
  assert.match(appSource, /new UpbitTradingManager/);
  assert.match(appSource, /upbitCredentialSession\.credentialProvider/);
});
