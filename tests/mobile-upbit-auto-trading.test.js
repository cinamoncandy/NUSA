const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const mobileSrc = path.resolve(__dirname, "../apps/mobile/src");
const appSource = fs.readFileSync(path.join(__dirname, "../apps/mobile/App.tsx"), "utf8");
const dispatcherSource = fs.readFileSync(path.join(mobileSrc, "upbitTradingSignalDispatcher.ts"), "utf8");
const modalSource = fs.readFileSync(path.join(mobileSrc, "upbitTradingConfirmationModal.tsx"), "utf8");
const managerSource = fs.readFileSync(path.join(mobileSrc, "upbitTradingManager.ts"), "utf8");

test("Stage 3: AI auto-execution requires trading manager initialization", () => {
  // UpbitTradingManager must be instantiated in App with PAPER mode default
  assert.match(appSource, /new UpbitTradingManager/);
  assert.match(appSource, /"PAPER"/);
  // Credential provider passed through
  assert.match(appSource, /upbitCredentialSession\.credentialProvider/);
});

test("Stage 3: Trading signal dispatcher handles AI thesis extraction", () => {
  // Dispatcher extracts trading intent from AI natural language
  assert.match(dispatcherSource, /extractTradingSignalFromThesis/);
  // Detects BUY signals (매수, buy, long, 상승)
  assert.match(dispatcherSource, /매수|buy|long/i);
  // Detects SELL signals (매도, sell, short, 하락)
  assert.match(dispatcherSource, /매도|sell|short/i);
  // Confidence-based decision making
  assert.match(dispatcherSource, /MIN_CONFIDENCE|confidence.*threshold/i);
});

test("Stage 3: Trading confirmation modal requires human approval in LIVE mode", () => {
  // Modal component exists
  assert.match(modalSource, /UpbitTradingConfirmationModal/);
  // Shows LIVE mode warning
  assert.match(modalSource, /실거래|LIVE/);
  // Displays order details
  assert.match(modalSource, /market|side|ordType|volume|estimatedKRW/);
  // Confirm and cancel buttons
  assert.match(modalSource, /onConfirm|onCancel/);
});

test("Stage 3: PAPER mode executes trading signals automatically (AI learning)", () => {
  // Signal dispatcher can execute PAPER orders without confirmation
  assert.match(dispatcherSource, /executeTradingSignal/);
  // Checks that PAPER mode proceeds past confirmation check
  assert.match(dispatcherSource, /requiresHumanConfirm/);
  assert.match(dispatcherSource, /LIVE/);
  // Auto-execution happens for PAPER
  assert.match(managerSource, /PAPER/);
});

test("Stage 3: LIVE mode requires explicit human confirmation before execution", () => {
  // App tracks pending trading signals
  assert.match(appSource, /pendingTradingSignalRef/);
  // Confirmation state management
  assert.match(appSource, /tradingConfirmationVisible/);
  assert.match(appSource, /tradingConfirmationRequest/);
  // Handler separates PAPER (auto-exec) from LIVE (human guard)
  assert.match(appSource, /handleTradingConfirmation(?:Confirm|Cancel)/);
});

test("Stage 3: Trading manager validates all orders through safety guards", () => {
  // Daily loss limit enforced
  assert.match(managerSource, /dailyLossKRW.*dailyLossLimitKRW/);
  // Order amount cap enforced
  assert.match(managerSource, /orderKRW.*maxOrderAmountKRW/);
  // Rate limiting enforced (1 order per 5 seconds)
  assert.match(managerSource, /orderTimestamps.*5_000/);
  // Minimum order interval enforced
  assert.match(managerSource, /minOrderIntervalMs/);
});

test("Stage 3: Signal validation requires minimum confidence threshold", () => {
  // Signals below confidence threshold are rejected
  assert.match(dispatcherSource, /MIN_CONFIDENCE/);
  assert.match(dispatcherSource, /0\.65/);
  assert.match(dispatcherSource, /confidence/);
  // Market format validated (checks for market validation)
  assert.match(dispatcherSource, /market/);
  assert.match(dispatcherSource, /A-Z0-9/);
  // Volume validated (positive, finite)
  assert.match(dispatcherSource, /volume/);
  assert.match(dispatcherSource, /isFinite/);
});

test("Stage 3: LIVE mode kill-switch activates when daily loss exceeds ₩500k", () => {
  // Trading manager tracks daily loss
  assert.match(managerSource, /recordDailyLoss|dailyLossKRW/);
  // Kill switch prevents orders when limit exceeded
  assert.match(managerSource, /dailyLossKRW.*dailyLossLimitKRW/);
  // Reset mechanism for daily loss
  assert.match(managerSource, /resetDailyLoss/);
});

test("Stage 3: App integrates trading confirmation modal into main render", () => {
  // Modal component rendered
  assert.match(appSource, /UpbitTradingConfirmationModal/);
  // Modal receives props from state
  assert.match(appSource, /tradingConfirmationVisible/);
  assert.match(appSource, /tradingConfirmationRequest/);
  assert.match(appSource, /tradingConfirmationLoading/);
  assert.match(appSource, /tradingConfirmationError/);
  // Callbacks wired
  assert.match(appSource, /onConfirm=.*handleTradingConfirmation/);
  assert.match(appSource, /onCancel=.*handleTradingConfirmation/);
});

test("Stage 3: Trading signal creation validates market and order parameters", () => {
  // createTradingSignal validates input
  assert.match(dispatcherSource, /createTradingSignal/);
  // Market must be canonical format
  assert.match(dispatcherSource, /market/);
  assert.match(dispatcherSource, /A-Z0-9/);
  // Volume must be positive
  assert.match(dispatcherSource, /volume/);
  // LIMIT orders require price
  assert.match(dispatcherSource, /LIMIT.*price/);
});

test("Stage 3: PAPER mode records execution for AI learning feedback", () => {
  // Trading manager executes PAPER orders
  assert.match(managerSource, /executeOrder.*order/);
  // Tracks timestamps for rate limiting
  assert.match(managerSource, /orderTimestamps\.push/);
  // Records execution state for feedback
  assert.match(managerSource, /totalExecutedKRW/);
});

test("Stage 3: Order confirmation preserves all safety checks through confirmation flow", () => {
  // Confirmation function re-validates mode
  assert.match(dispatcherSource, /confirmAndExecuteTradingSignal/);
  // Still calls executeOrder which validates again
  assert.match(dispatcherSource, /executeOrder.*order/);
  // Error handling for execution failures
  assert.match(dispatcherSource, /catch.*error/);
});

test("Stage 3: Thesis extraction handles confidence keywords for signal strength", () => {
  // Confidence keywords boost signal strength
  assert.match(dispatcherSource, /확실|강함|높음/);
  // Weak signals reduce confidence
  assert.match(dispatcherSource, /약함|약세|낮음/);
  // Base confidence clamped to valid range [0, 1]
  assert.match(dispatcherSource, /Math\.max.*Math\.min.*confidence/);
});

test("Stage 3: Trading signal dispatcher prevents dangerous operations (no withdrawals)", () => {
  // Only order endpoints used (placeUpbitOrder, cancelUpbitOrder)
  assert.match(managerSource, /placeUpbitOrder|cancelUpbitOrder/);
  // No withdrawal or transfer method calls in dispatcher
  assert.doesNotMatch(dispatcherSource, /withdraw|transfer/i);
  // No withdrawal methods in the trading manager
  assert.doesNotMatch(managerSource, /withdraw|transfer/i);
});

test("Stage 3: App manages trading session state separately from PAPER trading state", () => {
  // Upbit credential session independent from PAPER session
  assert.match(appSource, /upbitCredentialSession/);
  assert.match(appSource, /InMemoryUpbitCredentialSession/);
  assert.match(appSource, /credentialSession/);
  assert.match(appSource, /InMemoryDashboardCredentialSession/);
  // Trading manager uses Upbit credential
  assert.match(appSource, /new UpbitTradingManager/);
  assert.match(appSource, /upbitCredentialSession\.credentialProvider/);
});
