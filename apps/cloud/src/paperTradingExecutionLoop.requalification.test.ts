import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const EXPECTED_PAPER_ADAPTER_BLOB = "f56b719bc7195cdb9754b3006b387f24c41a5e36";

function gitBlobSha(content: string): string {
  const body = Buffer.from(content, "utf8");
  return createHash("sha1").update(`blob ${body.length}\0`, "utf8").update(body).digest("hex");
}

describe("PAPER_ADAPTER exact-source re-qualification evidence", () => {
  it("binds qualification to the exact lifecycle+ledger execution source", () => {
    const source = readFileSync("apps/cloud/src/paperTradingExecutionLoop.ts", "utf8");
    assert.equal(gitBlobSha(source), EXPECTED_PAPER_ADAPTER_BLOB);
    assert.match(source, /workingOrders/);
    assert.match(source, /assertPaperAccountingReconciled/);
    assert.match(source, /PAPER_PARTIAL_FILL_REQUIRES_WORKING_ORDER/);
    assert.match(source, /paper cancelled order\/fill reconciliation mismatch/);
  });
});
