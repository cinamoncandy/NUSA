import assert from "node:assert/strict";
import { test } from "node:test";
import { projectCanonicalPaperLedger } from "./canonicalPaperLedger";
import { buildCanonicalPaperPerformanceEvidence } from "./canonicalPaperPerformanceEvidence";

const ledger = projectCanonicalPaperLedger(1_000, [
  { fillId: "f1", orderId: "o1", market: "KRW-BTC", side: "BUY" as const, quantity: 1, price: 100, fee: 1, filledAt: 1 },
  { fillId: "f2", orderId: "o2", market: "KRW-BTC", side: "SELL" as const, quantity: 1, price: 120, fee: 1, filledAt: 2 },
], []);

test("builds deterministic PAPER evidence from complete ledger truth", () => {
  const a = buildCanonicalPaperPerformanceEvidence(ledger, 0, 2);
  const b = buildCanonicalPaperPerformanceEvidence(ledger, 0, 2);
  assert.ok(a);
  assert.equal(a.evidenceType, "PAPER");
  assert.equal(a.tradeCount, 2);
  assert.equal(a.fees, 2);
  assert.equal(a.realizedPnL, 18);
  assert.equal(a.returnRatio, 0.018);
  assert.equal(a.sourceLedgerFingerprintSha256, ledger.fingerprintSha256);
  assert.equal(a.fingerprintSha256, b?.fingerprintSha256);
});

test("fails closed when a partial period cannot reconstruct its starting baseline", () => {
  assert.equal(buildCanonicalPaperPerformanceEvidence(ledger, 2, 2), undefined);
});

test("rejects malformed evidence windows", () => {
  assert.throws(() => buildCanonicalPaperPerformanceEvidence(ledger, 3, 2), /window is invalid/);
});
