import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const EXPECTED_EXECUTION_BLOB = "a6d9b590408515eebe51109167a4f4218fea544f";

function gitBlobSha(content: string): string {
  const normalized = content.replace(/\r\n/g, "\n");
  const body = Buffer.from(normalized, "utf8");
  return createHash("sha1").update(`blob ${body.length}\0`, "utf8").update(body).digest("hex");
}

describe("EXECUTION exact-source re-qualification evidence", () => {
  it("binds qualification to the exact PortfolioPlan -> intent -> risk -> execution boundary", () => {
    const source = readFileSync("apps/cloud/src/cloudPaperExecutionBoundary.ts", "utf8");
    assert.equal(gitBlobSha(source), EXPECTED_EXECUTION_BLOB);
    assert.match(source, /PAPER_PORTFOLIO_EXECUTION_INTENT_REQUIRED/);
    assert.match(source, /buildPaperExecutionIntent\(\{/);
    assert.match(source, /payloadFingerprintSha256: executionIntent\.intentFingerprintSha256/);
    assert.match(source, /const commandId = paperExecutionIntentCommandId\(executionIntent\)/);
    assert.match(source, /quantity: executionIntent\.quantity/);
    assert.match(source, /executionIntent,/);
    assert.doesNotMatch(source, /quantity = state\.cash \* investmentPercent/);
  });
});
