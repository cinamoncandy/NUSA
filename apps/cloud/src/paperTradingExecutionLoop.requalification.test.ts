import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const EXPECTED_PAPER_ADAPTER_BLOB = "7aa0cf033c7b177505cb2891eef7b31f5f08928a";

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
    assert.match(source, /paperExecutionIntentCommandId\(executionIntent\)/);
  });
});
