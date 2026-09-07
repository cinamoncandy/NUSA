import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SqliteDatabase } from "../../../packages/storage/src/index";
import type { CioDecision, PaperCandidateExecutionBinding } from "./cioDecisionEngine";
import { buildPaperObservedExecutionQuote } from "./paperRuntimeExecutionCostEvidence";
import { PaperTradingExecutionLoop, SqliteCloudPaperAccountRepository, type PaperAccountRepository, type PaperAccountState } from "./paperTradingExecutionLoop";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);

function binding(): PaperCandidateExecutionBinding {
  return Object.freeze({
    schemaVersion: 1,
    status: "BOUND_UNVERIFIED",
    authority: "PAPER_RESEARCH_ONLY",
    liveAuthority: "NONE",
    productionMutationAllowed: false,
    candidateId: "candidate-quote-receipt",
    datasetId: "dataset-quote-receipt",
    datasetContentSha256: HASH_A,
    advisoryGeneratedAt: 1_000,
    periodStartAt: 2_000,
    advisoryFingerprintSha256: HASH_B,
    bindingFingerprintSha256: HASH_C,
  });
}

function decision(): CioDecision {
  return Object.freeze({
    symbol: "KRW-BTC",
    action: "BUY",
    confidence: 0.9,
    risk: "LOW",
    allocation: 0.1,
    leverage: 1,
    score: 0.8,
    reasons: Object.freeze(["canonical quote receipt test"]),
    decidedAt: 3_000,
    paperCandidateBinding: binding(),
  });
}

function quote(observedAt: number) {
  return buildPaperObservedExecutionQuote({
    market: "KRW-BTC",
    observedAt,
    totalAskSize: 10,
    totalBidSize: 10,
    units: [
      { askPrice: 101, bidPrice: 99, askSize: 5, bidSize: 5 },
      { askPrice: 102, bidPrice: 98, askSize: 5, bidSize: 5 },
    ],
  });
}

function tick(observedQuote?: ReturnType<typeof quote>) {
  return {
    now: 4_000,
    market: "KRW-BTC",
    price: 101,
    quantity: 1,
    observedAt: 3_900,
    mode: "PAPER" as const,
    killSwitchActive: false,
    tradingAllowed: true,
    overallHealth: "HEALTHY" as const,
    decisions: [decision()],
    investmentPercent: 100,
    ...(observedQuote == null ? {} : { observedQuote }),
  };
}

class CountingRepository implements PaperAccountRepository {
  public saves = 0;
  public state?: PaperAccountState;
  public save(state: PaperAccountState): void { this.saves += 1; this.state = state; }
  public loadLatest(): PaperAccountState | undefined { return this.state; }
  public clear(): void { this.state = undefined; }
}

test("persists the canonical quote receipt with the PAPER fill and revalidates it after restart", () => {
  const directory = mkdtempSync(join(tmpdir(), "nusa-paper-quote-receipt-"));
  const filename = join(directory, "paper.db");
  const firstDb = new SqliteDatabase(filename);
  const firstRepository = new SqliteCloudPaperAccountRepository(firstDb, { ownerId: "quote-receipt-writer-a" });
  const first = new PaperTradingExecutionLoop({ initialCapital: 10_000, repository: firstRepository });
  try {
    const result = first.processTick(tick(quote(3_900)));
    assert.equal(result.status, "FILLED");
    assert.ok(result.fills[0]?.orderBookQuoteReceipt);
    assert.ok(result.fills[0]?.executionCostAttribution);
    const expected = result.state.fills[0];
    firstRepository.close?.();
    firstDb.close();

    const secondDb = new SqliteDatabase(filename);
    const secondRepository = new SqliteCloudPaperAccountRepository(secondDb, { ownerId: "quote-receipt-writer-b" });
    try {
      const restored = new PaperTradingExecutionLoop({ initialCapital: 10_000, repository: secondRepository });
      assert.deepEqual(restored.snapshot().fills[0], expected);
    } finally {
      secondRepository.close?.();
      secondDb.close();
    }
  } finally {
    try { firstRepository.close?.(); } catch { /* already closed */ }
    try { firstDb.close(); } catch { /* already closed */ }
  }
});

test("rejects a stale quote before the PAPER repository is mutated", () => {
  const repository = new CountingRepository();
  const loop = new PaperTradingExecutionLoop({ initialCapital: 10_000, repository });
  const result = loop.processTick({ ...tick(quote(0)), now: 10_000, observedAt: 9_000 });
  assert.equal(result.status, "REJECTED");
  assert.equal(repository.saves, 0);
  assert.equal(result.state.orders.length, 0);
  assert.equal(result.state.fills.length, 0);
});

test("rejects persisted receipt tampering even when the outer account checksum is recomputed", () => {
  const directory = mkdtempSync(join(tmpdir(), "nusa-paper-quote-tamper-"));
  const filename = join(directory, "paper.db");
  const firstDb = new SqliteDatabase(filename);
  const firstRepository = new SqliteCloudPaperAccountRepository(firstDb, { ownerId: "quote-tamper-writer-a" });
  const first = new PaperTradingExecutionLoop({ initialCapital: 10_000, repository: firstRepository });
  try {
    first.processTick(tick(quote(3_900)));
    const row = firstDb.connection.prepare("SELECT state_json FROM cloud_paper_accounts WHERE account_id = ?").get("paper-default") as { state_json: string };
    const state = JSON.parse(row.state_json) as PaperAccountState;
    const fill = state.fills[0]!;
    const tamperedState: PaperAccountState = {
      ...state,
      fills: [{
        ...fill,
        orderBookQuoteReceipt: { ...fill.orderBookQuoteReceipt!, bestAskPrice: fill.orderBookQuoteReceipt!.bestAskPrice + 1 },
      }],
    };
    const checksum = createHash("sha256").update(JSON.stringify(tamperedState), "utf8").digest("hex");
    // The canonical history trigger correctly rejects a conflicting immutable snapshot.
    // Remove only that snapshot here to model a storage attacker that altered both the
    // current row and its outer checksum; the receipt fingerprint must still fail closed.
    firstDb.connection.prepare("DELETE FROM cloud_paper_account_history WHERE account_id = ? AND updated_at = ?").run("paper-default", tamperedState.updatedAt);
    firstDb.connection.prepare("UPDATE cloud_paper_accounts SET state_json = ?, checksum = ? WHERE account_id = ?").run(JSON.stringify(tamperedState), checksum, "paper-default");
    firstRepository.close?.();
    firstDb.close();

    const secondDb = new SqliteDatabase(filename);
    const secondRepository = new SqliteCloudPaperAccountRepository(secondDb, { ownerId: "quote-tamper-writer-b" });
    try {
      assert.throws(() => secondRepository.loadLatest(), /order-book quote receipt is invalid|fingerprint|receipt/i);
    } finally {
      secondRepository.close?.();
      secondDb.close();
    }
  } finally {
    try { firstRepository.close?.(); } catch { /* already closed */ }
    try { firstDb.close(); } catch { /* already closed */ }
  }
});
