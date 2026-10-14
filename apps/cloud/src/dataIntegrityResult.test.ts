import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DATA_INTEGRITY_RESULT_FILE, parseDataIntegrityResult, readDataIntegrityResult } from "./dataIntegrityResult";

const result = { schemaVersion: 1, observedAt: 1_792_000_000_000, status: "WARN", candleMissing7d: 3, candleSeries: 4, note: "x", negative: -1 };

describe("stored-data integrity result on /health", () => {
  it("keeps the status and non-negative integers only, and rejects unknown shapes", () => {
    assert.deepEqual({ ...parseDataIntegrityResult(result) }, { status: "WARN", observedAt: 1_792_000_000_000, candleMissing7d: 3, candleSeries: 4 });
    for (const bad of [null, [], { ...result, status: "OK" }, { ...result, schemaVersion: 2 }, { ...result, observedAt: 0 }]) assert.equal(parseDataIntegrityResult(bad), undefined, JSON.stringify(bad));
  });

  it("reads the file beside the state database; missing or corrupt files are omitted", () => {
    const dir = mkdtempSync(join(tmpdir(), "nusa-integrity-"));
    const db = join(dir, "cloud-state.db");
    assert.equal(readDataIntegrityResult(db), undefined);
    writeFileSync(join(dir, DATA_INTEGRITY_RESULT_FILE), "{");
    assert.equal(readDataIntegrityResult(db), undefined);
    writeFileSync(join(dir, DATA_INTEGRITY_RESULT_FILE), JSON.stringify(result));
    assert.equal(readDataIntegrityResult(db)?.status, "WARN");
  });
});
