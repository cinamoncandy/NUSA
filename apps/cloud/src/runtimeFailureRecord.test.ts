import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { readPreviousRuntimeFailure, recordRuntimeFailure, runtimeFailureCode, runtimeFailureRecordPath } from "./runtimeFailureRecord";

const stateDb = (): string => path.join(mkdtempSync(path.join(tmpdir(), "nusa-failure-")), "state.sqlite");

test("a recorded fail-closed stop is reported to the next process as a bare public code", () => {
  const db = stateDb();
  assert.equal(readPreviousRuntimeFailure(db), undefined);
  recordRuntimeFailure(db, "CLOSED_LEARNING_SCHEDULER", new Error("qualified PAPER challenger artifact is unavailable"), 1_000);
  assert.equal(readPreviousRuntimeFailure(db), "PREVIOUS_CLOSED_LEARNING_SCHEDULER:QUALIFIED_PAPER_CHALLENGER_ARTIFACT_IS_UNAVAILABLE");
  assert.match(readPreviousRuntimeFailure(db)!, /^[A-Z0-9_.:-]{1,160}$/, "must pass the public liveness error allowlist");
});

test("failure codes drop paths, hashes and long numbers instead of publishing free text", () => {
  assert.equal(runtimeFailureCode(new Error("ENOENT: open '/var/lib/nusa/secret.json'")), "ENOENT_OPEN");
  assert.equal(runtimeFailureCode(new Error(`binding ${"a".repeat(64)} conflict at 1790637268567`)), "BINDING_CONFLICT_AT");
  assert.equal(runtimeFailureCode(new Error("   ")), "UNKNOWN");
  assert.equal(runtimeFailureCode(undefined), "UNKNOWN");
  assert.ok(runtimeFailureCode(new Error("x ".repeat(400))).length <= 120);
});

test("unreadable or tampered records and non-durable paths are ignored", () => {
  assert.equal(runtimeFailureRecordPath(":memory:"), undefined);
  assert.equal(runtimeFailureRecordPath("relative/state.sqlite"), undefined);
  recordRuntimeFailure(":memory:", "UNCAUGHT_EXCEPTION", new Error("boom"));
  const db = stateDb();
  const file = runtimeFailureRecordPath(db)!;
  writeFileSync(file, "{not json");
  assert.equal(readPreviousRuntimeFailure(db), undefined);
  writeFileSync(file, JSON.stringify({ schemaVersion: 1, kind: "LIVE_ORDER", code: "X" }));
  assert.equal(readPreviousRuntimeFailure(db), undefined);
  writeFileSync(file, JSON.stringify({ schemaVersion: 1, kind: "UNHANDLED_REJECTION", code: "free text <script>" }));
  assert.equal(readPreviousRuntimeFailure(db), "PREVIOUS_UNHANDLED_REJECTION:UNKNOWN");
  recordRuntimeFailure(db, "UNCAUGHT_EXCEPTION", new Error("boom"), 5);
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), { schemaVersion: 1, kind: "UNCAUGHT_EXCEPTION", code: "BOOM", at: 5 });
});
