const test = require("node:test");
const assert = require("node:assert/strict");
const { resolveSpotPerpetualPair, ExchangeSymbolResolutionError } = require("../dist/apps/cloud/src/exchangeSymbolResolver.js");
const { scanFundingCarryCandidates } = require("../dist/apps/cloud/src/fundingCarryScanner.js");
const { planAtomicHedge, submitAtomicHedge, applyHedgeFills, recoverPartialHedge } = require("../dist/apps/cloud/src/atomicHedgeCoordinator.js");
const { monitorDeltaNeutralPosition } = require("../dist/apps/cloud/src/deltaNeutralMonitor.js");
const { assessFundingCarryEntrySafety, planFundingCarryExit } = require("../dist/apps/cloud/src/fundingCarryExitEngine.js");
const { buildFundingCarryReadOnlyStatus } = require("../dist/apps/cloud/src/fundingCarryReadOnlyStatus.js");

const instruments = (overrides = []) => [
  { venue: "venue-a", symbol: "BTC-USDT", kind: "SPOT", baseAsset: "BTC", quoteAsset: "USDT", active: true, quantityStep: 0.001, minimumQuantity: 0.001 },
  { venue: "venue-a", symbol: "BTCUSDT-PERP", kind: "PERPETUAL", baseAsset: "BTC", quoteAsset: "USDT", active: true, contractMultiplier: 0.001, quantityStep: 1, minimumQuantity: 1 },
  ...overrides
];
const pair = () => resolveSpotPerpetualPair(instruments(), { venue: "venue-a", baseAsset: "BTC", quoteAsset: "USDT" });
const scan = (overrides = {}) => ({
  pair: pair(), fundingRate: 0.01, fundingObservedAt: 950, nextFundingAt: 2_000, fundingDirection: "SHORT_RECEIVES", notional: 10_000,
  spotEntryFeeBps: 2, spotExitFeeBps: 2, perpetualEntryFeeBps: 2, perpetualExitFeeBps: 2, expectedSlippageBps: 2,
  basisRiskPremiumBps: 1, partialFillRiskPremiumBps: 1, capitalCostBps: 1, liquidityScore: 0.8, confidence: 0.9, ...overrides
});
const scanConfig = (overrides = {}) => ({ now: 1_000, maxFundingAgeMs: 100, minimumNetCarryBps: 10, killSwitchActive: false, paperTradingAllowed: true, ...overrides });
const plan = (overrides = {}) => ({
  id: "hedge-1", mode: "PAPER", contractMultiplier: 1, deltaTolerance: 0.01, createdAt: 1_000,
  spotOrder: { clientOrderId: "spot-1", symbol: "BTC-USDT", side: "BUY", quantity: 2 },
  perpetualOrder: { clientOrderId: "perp-1", symbol: "BTC-PERP", side: "SELL", quantity: 2 }, ...overrides
});
const fill = (filledQuantity, remainingQuantity, updatedAt = 1_001) => ({ filledQuantity, averagePrice: 100, remainingQuantity, updatedAt });
const exitInput = (overrides = {}) => ({
  now: 1_000, fundingRate: 0.01, minimumFundingRate: 0.001, fundingDirection: "SHORT_RECEIVES", netCarry: 10,
  basisBps: 5, maximumBasisBps: 20, liquidityScore: 0.8, minimumLiquidityScore: 0.5, liquidationBufferBps: 200, minimumLiquidationBufferBps: 100,
  killSwitchActive: false, deployableCapital: 500, requiredCapital: 300, spotBaseQuantity: 2, perpetualShortBaseQuantity: 2, maximumTurnoverFraction: 0.25, ...overrides
});

test("resolves metadata-defined spot/perpetual symbols without aliases", () => {
  const result = pair();
  assert.equal(result.spot.symbol, "BTC-USDT");
  assert.equal(result.perpetual.symbol, "BTCUSDT-PERP");
  assert.ok(Object.isFrozen(result));
});

test("blocks ambiguous, missing, inactive, and malformed symbol metadata", () => {
  assert.throws(() => resolveSpotPerpetualPair(instruments([{ venue: "venue-a", symbol: "BTC-ALT", kind: "SPOT", baseAsset: "BTC", quoteAsset: "USDT", active: true }]), { venue: "venue-a", baseAsset: "BTC", quoteAsset: "USDT" }), (error) => error instanceof ExchangeSymbolResolutionError && error.code === "AMBIGUOUS_PAIR");
  assert.throws(() => resolveSpotPerpetualPair(instruments().slice(0, 1), { venue: "venue-a", baseAsset: "BTC", quoteAsset: "USDT" }), /MISSING_PAIR/);
  assert.throws(() => resolveSpotPerpetualPair([{ ...instruments()[0], active: false }], { venue: "venue-a", baseAsset: "BTC", quoteAsset: "USDT" }), /MISSING_PAIR/);
  assert.throws(() => resolveSpotPerpetualPair([{ ...instruments()[0], symbol: " " }], { venue: "venue-a", baseAsset: "BTC", quoteAsset: "USDT" }), /INVALID_METADATA/);
});

test("creates only positive net-carry candidates after all costs", () => {
  const [candidate] = scanFundingCarryCandidates([scan()], scanConfig());
  assert.equal(candidate.expectedFunding, 100);
  assert.equal(candidate.totalTradingCost, 13);
  assert.equal(candidate.netCarry, 87);
  assert.ok(candidate.netCarryBps >= 10);
});

test("excludes negative, stale, unfavourable, and kill-switched funding inputs", () => {
  assert.equal(scanFundingCarryCandidates([scan({ fundingRate: 0.0001 })], scanConfig()).length, 0);
  assert.equal(scanFundingCarryCandidates([scan({ fundingObservedAt: 800 })], scanConfig()).length, 0);
  assert.equal(scanFundingCarryCandidates([scan({ fundingDirection: "SHORT_PAYS" })], scanConfig()).length, 0);
  assert.equal(scanFundingCarryCandidates([scan()], scanConfig({ killSwitchActive: true })).length, 0);
});

test("sorts candidates deterministically by net carry, confidence, liquidity and id", () => {
  const a = scan({ pair: resolveSpotPerpetualPair(instruments().map((item) => ({ ...item, symbol: item.symbol.replace("BTC", "ETH"), baseAsset: "ETH" })), { venue: "venue-a", baseAsset: "ETH", quoteAsset: "USDT" }), confidence: 0.5 });
  const result = scanFundingCarryCandidates([a, scan()], scanConfig());
  assert.deepEqual(result.map((item) => item.id), ["VENUE-A:BTC-USDT:BTCUSDT-PERP", "VENUE-A:ETH-USDT:ETHUSDT-PERP"]);
  assert.deepEqual(result, scanFundingCarryCandidates([scan(), a], scanConfig()));
});

test("order acceptance is not mistaken for a completed hedge", async () => {
  const initial = planAtomicHedge(plan());
  const submitted = await submitAtomicHedge(initial, { submit: async (order) => ({ clientOrderId: order.clientOrderId, accepted: true }), cancel: async () => true }, 1_001);
  assert.equal(submitted.state.status, "SUBMITTING");
  assert.equal(submitted.state.actualDelta, 0);
});

test("marks both actual fills delta-neutral only after quantities reconcile", () => {
  const submitting = { ...planAtomicHedge(plan()), status: "SUBMITTING" };
  const result = applyHedgeFills(submitting, fill(2, 0), fill(2, 0), 1_002);
  assert.equal(result.status, "HEDGED");
  assert.equal(result.actualDelta, 0);
});

test("spot-only and perpetual-only fills remain partially hedged", () => {
  const submitting = { ...planAtomicHedge(plan()), status: "SUBMITTING" };
  assert.equal(applyHedgeFills(submitting, fill(2, 0), fill(0, 2), 1_002).status, "PARTIALLY_HEDGED");
  assert.equal(applyHedgeFills(submitting, fill(0, 2), fill(2, 0), 1_002).status, "PARTIALLY_HEDGED");
});

test("partial hedge recovery rebalances or faults with a kill-switch recommendation", () => {
  const partial = applyHedgeFills({ ...planAtomicHedge(plan()), status: "SUBMITTING" }, fill(1, 1), fill(0, 2), 1_002);
  assert.equal(recoverPartialHedge(partial, { now: 1_003, cancellationSucceeded: true, compensationSucceeded: true, rollbackSucceeded: false }).status, "REBALANCING");
  const fault = recoverPartialHedge(partial, { now: 1_003, cancellationSucceeded: false, compensationSucceeded: false, rollbackSucceeded: false });
  assert.equal(fault.status, "FAULTED");
  assert.ok(fault.audit.some((item) => item.type === "KILL_SWITCH_RECOMMENDED"));
});

test("delta monitor honors quantity rules, timeouts, margin buffer, and basis", () => {
  const rebalancing = monitorDeltaNeutralPosition({ now: 1_000, spotBaseQuantity: 2, perpetualShortContracts: 1.8, contractMultiplier: 1, quantityPrecision: 3, minimumOrderQuantity: 0.01, deltaTolerance: 0.1, emergencyAfterMs: 100, maintenanceMarginRatio: 0.1, maximumMaintenanceMarginRatio: 0.2, liquidationPriceBufferBps: 200, minimumLiquidationPriceBufferBps: 100, basisBps: 5, maximumBasisBps: 20 });
  assert.equal(rebalancing.status, "REBALANCE_REQUIRED");
  const emergency = monitorDeltaNeutralPosition({ ...rebalancing, now: 1_200, spotBaseQuantity: 2, perpetualShortContracts: 1.8, contractMultiplier: 1, quantityPrecision: 3, minimumOrderQuantity: 0.01, deltaTolerance: 0.1, breachedSince: 1_000, emergencyAfterMs: 100, maintenanceMarginRatio: 0.1, maximumMaintenanceMarginRatio: 0.2, liquidationPriceBufferBps: 50, minimumLiquidationPriceBufferBps: 100, basisBps: 5, maximumBasisBps: 20 });
  assert.equal(emergency.status, "EMERGENCY_EXIT_REQUIRED");
});

test("exit plans preserve turnover limits except in emergency", () => {
  const gradual = planFundingCarryExit(exitInput({ fundingRate: 0.0001 }));
  assert.equal(gradual.action, "GRADUAL_EXIT");
  assert.equal(gradual.spotReduceQuantity, 0.5);
  const emergency = planFundingCarryExit(exitInput({ fundingDirection: "SHORT_PAYS" }));
  assert.equal(emergency.action, "EMERGENCY_EXIT");
  assert.equal(emergency.spotReduceQuantity, 2);
});

test("reserved withdrawal capital and kill switch block new carry entries", () => {
  const treasury = { totalAssets: 1_000, tradingCapital: 700, reserveCapital: 200, pendingDepositCapital: 100, reservations: [{ id: "w", amount: 500, currency: "USD", requestedAt: 1, status: "RESERVED" }] };
  assert.equal(assessFundingCarryEntrySafety({ mode: "PAPER", killSwitchActive: false, treasury, requestedCapital: 300 }).allowed, false);
  const stopped = assessFundingCarryEntrySafety({ mode: "PAPER", killSwitchActive: true, treasury: { ...treasury, reservations: [] }, requestedCapital: 300 });
  assert.equal(stopped.allowed, false);
  assert.ok(stopped.reasons.includes("KILL_SWITCH_ACTIVE"));
});

test("read-only status exposes carry state without a command path", () => {
  const status = buildFundingCarryReadOnlyStatus({ expectedAnnualizedFundingRate: 0.2, netCarry: 12, currentDelta: 0, hedgeState: "HEDGED", liquidationBufferBps: 200, nextFundingAt: 2_000, generatedAt: 1_000 });
  assert.ok(Object.isFrozen(status));
  assert.equal(status.hedgeState, "HEDGED");
});

test("all deterministic carry outputs are immutable", () => {
  const candidate = scanFundingCarryCandidates([scan()], scanConfig());
  const exit = planFundingCarryExit(exitInput());
  assert.ok(Object.isFrozen(candidate));
  assert.ok(Object.isFrozen(candidate[0]));
  assert.ok(Object.isFrozen(exit));
  assert.deepEqual(planFundingCarryExit(exitInput()), exit);
});
