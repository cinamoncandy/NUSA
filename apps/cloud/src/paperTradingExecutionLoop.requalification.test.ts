import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const EXPECTED_PAPER_ADAPTER_BLOB = "463660d81039baa61e401e54caccdac86b1c8fdf";

function gitBlobSha(content: string): string {
  // Git stores this repository's TypeScript sources with LF. Windows checkout may materialize
  // CRLF, so normalize the worktree representation before reproducing the canonical Git blob id.
  const normalized = content.replace(/\r\n/g, "\n");
  const body = Buffer.from(normalized, "utf8");
  return createHash("sha1").update(`blob ${body.length}\0`, "utf8").update(body).digest("hex");
}

describe("PAPER_ADAPTER exact-source re-qualification evidence", () => {
  it("binds qualification to the exact lifecycle+durable-ledger source", () => {
    const source = readFileSync("apps/cloud/src/paperTradingExecutionLoop.ts", "utf8");
    assert.equal(gitBlobSha(source), EXPECTED_PAPER_ADAPTER_BLOB);
    assert.match(source, /workingOrders/);
    assert.match(source, /assertPaperAccountingReconciled/);
    assert.match(source, /loadHistory\(\): readonly PaperAccountState\[\]/);
    assert.match(source, /cloud_paper_account_history/);
    assert.match(source, /paper cancelled order\/fill reconciliation mismatch/);
    assert.match(source, /validatePaperExecutionIntent\(fill\.executionIntent\)/);
    assert.match(source, /paper fill execution intent mismatch/);
    assert.match(source, /paper fill execution intent provenance mismatch/);
    assert.match(source, /paperExecutionIntentCommandId\(canonicalExecutionIntent\)/);
    assert.match(source, /cloud_paper_fill_ledger/);
    assert.match(source, /appendFillLedgerRows\(state\.fills\)/);
    assert.match(source, /assertFillLedgerReconcilesState\(state\)/);
    assert.match(source, /PAPER_FILL_LEDGER_CONFLICT/);
    assert.match(source, /PAPER_FILL_LEDGER_CHECKSUM_MISMATCH/);
    assert.match(source, /buildPaperOrderBookExecutionReceipt/);
    assert.match(source, /orderBookExecutionReceipt/);
    assert.match(source, /maximumNotional: executionIntent\.allocationCapital/);
    assert.match(source, /filledQuantity: fill\.quantity/);
    assert.match(source, /validatePaperOrderBookExecutionReceipt/);
    assert.match(source, /advanceStrategyWorkingOrder/);
    assert.match(source, /PAPER_STRATEGY_PARTIALLY_FILLED/);
    assert.match(source, /PAPER_STRATEGY_BUDGET_EXHAUSTED/);
    assert.match(source, /executionIntent: canonicalExecutionIntent/);
    assert.match(source, /workingOrders: Object\.freeze/);
    assert.match(source, /remainingAllocationCapital/);
    assert.match(source, /lastOrderBookObservedAt/);
    assert.match(source, /PAPER_STRATEGY_WORKING_ORDER_AUTOMATIC_ONLY/);
    assert.match(source, /PAPER_STRATEGY_WORKING_WAITING_FOR_NEW_DEPTH/);
    assert.match(source, /paper strategy working-order residual budget mismatch/);
  });
});
