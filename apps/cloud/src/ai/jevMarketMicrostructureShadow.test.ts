import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildPaperObservedExecutionQuote } from "../paperRuntimeExecutionCostEvidence";
import {
  buildJevMarketMicrostructureFeatures,
  buildJevMarketMicrostructureShadowInput,
  JevMarketMicrostructureShadowObserver,
  validateJevMarketMicrostructureDecision,
} from "./jevMarketMicrostructureShadow";

const quote = buildPaperObservedExecutionQuote({
  market: "KRW-BTC",
  observedAt: 1_000,
  totalAskSize: 5,
  totalBidSize: 7,
  units: [
    { askPrice: 101, bidPrice: 99, askSize: 2, bidSize: 4 },
    { askPrice: 102, bidPrice: 98, askSize: 3, bidSize: 3 },
  ],
});

describe("Jev market microstructure SHADOW advisory", () => {
  it("derives deterministic bounded features from canonical public orderbook evidence", () => {
    const features = buildJevMarketMicrostructureFeatures(quote);
    assert.equal(features.market, "KRW-BTC");
    assert.equal(features.midPrice, 100);
    assert.equal(features.spreadBps, 200);
    assert.equal(features.topBookImbalance, 0.33333333);
    assert.equal(features.depthLevelCount, 2);
    assert.equal(features.depthBidSize, 7);
    assert.equal(features.depthAskSize, 5);
    assert.equal(features.depthImbalance, 0.16666667);
    assert.equal(features.quoteFingerprintSha256, quote.evidenceFingerprintSha256);
    assert.equal(features.depthFingerprintSha256, quote.depthFingerprintSha256);
  });

  it("builds a PAPER-only non-routing SHADOW input with provenance refs", () => {
    const input = buildJevMarketMicrostructureShadowInput(quote);
    assert.equal(input.authority, "PAPER_ONLY");
    assert.equal(input.liveAuthority, "NONE");
    assert.equal(input.productionMutationAllowed, false);
    assert.equal(input.aiAuthority, "ZERO_AUTHORITY");
    assert.equal(input.usableForRouting, false);
    assert.ok(input.evidenceRefs.includes(quote.evidenceFingerprintSha256));
  });

  it("validates only the exact typed advisory contract", () => {
    assert.deepEqual(validateJevMarketMicrostructureDecision({
      state: "WIDE_SPREAD",
      action: "REDUCE_RISK",
      confidence: 0.8,
      reasonCode: "SPREAD_ELEVATED",
    }), {
      state: "WIDE_SPREAD",
      action: "REDUCE_RISK",
      confidence: 0.8,
      reasonCode: "SPREAD_ELEVATED",
    });
    assert.throws(() => validateJevMarketMicrostructureDecision({
      state: "WIDE_SPREAD",
      action: "EXECUTE",
      confidence: 1,
      reasonCode: "BAD",
    }), /ACTION_INVALID/);
  });

  it("records model output as SHADOW advisory without execution authority", async () => {
    const observer = new JevMarketMicrostructureShadowObserver(async () => ({
      state: "IMBALANCED_BOOK",
      action: "OBSERVE",
      confidence: 0.75,
      reasonCode: "BOOK_IMBALANCE",
    }), { modelIdentity: "jev-test", now: () => "2026-09-29T12:00:00.000Z" });
    const receipt = await observer.observe(quote, { NUSA_JEV_MARKET_MICROSTRUCTURE_SHADOW_ENABLED: "true" });
    assert.equal(receipt.selectedState, "IMBALANCED_BOOK");
    assert.equal(receipt.selectedAction, "OBSERVE");
    assert.equal(receipt.confidence, 0.75);
    assert.equal(receipt.fallbackApplied, false);
    assert.equal(receipt.usableForRouting, false);
    assert.equal(receipt.liveAuthority, "NONE");
    assert.equal(receipt.aiAuthority, "ZERO_AUTHORITY");
  });

  it("fails closed on low confidence", async () => {
    const observer = new JevMarketMicrostructureShadowObserver(async () => ({
      state: "NORMAL",
      action: "OBSERVE",
      confidence: 0.2,
      reasonCode: "LOW_SIGNAL",
    }), { minConfidence: 0.5, now: () => "2026-09-29T12:00:00.000Z" });
    const receipt = await observer.observe(quote, { NUSA_JEV_MARKET_MICROSTRUCTURE_SHADOW_ENABLED: "true" });
    assert.equal(receipt.selectedState, "INSUFFICIENT_EVIDENCE");
    assert.equal(receipt.selectedAction, "ESCALATE");
    assert.equal(receipt.fallbackApplied, true);
    assert.equal(receipt.reasonCode, "LOW_CONFIDENCE_FALLBACK");
  });
});
