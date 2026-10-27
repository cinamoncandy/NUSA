import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { readPreviousRuntimeFailure, recordRuntimeFailure, runtimeFailureCode, runtimeFailureRecordPath } from "./runtimeFailureRecord";

const stateDb = (): string => path.join(mkdtempSync(path.join(tmpdir(), "nusa-failure-")), "state.sqlite");
const fingerprint = (message: string): string => `MESSAGE_${createHash("sha256").update(message).digest("hex").slice(0, 12).toUpperCase()}`;

test("a recorded fail-closed stop is reported to the next process within the public code allowlist", () => {
  const db = stateDb();
  assert.equal(readPreviousRuntimeFailure(db), undefined);
  recordRuntimeFailure(db, "CLOSED_LEARNING_SCHEDULER", new Error("PAPER_WRITER_LEASE_LOST"), 1_000);
  assert.equal(readPreviousRuntimeFailure(db), "PREVIOUS_CLOSED_LEARNING_SCHEDULER:PAPER_WRITER_LEASE_LOST");
  recordRuntimeFailure(db, "STARTUP", new Error("qualified PAPER challenger artifact is unavailable"), 2_000);
  const reported = readPreviousRuntimeFailure(db)!;
  assert.equal(reported, `PREVIOUS_STARTUP:${fingerprint("qualified PAPER challenger artifact is unavailable")}`);
  assert.match(reported, /^[A-Z0-9_.:-]{1,160}$/);
});

test("free-text messages are never published, only their fingerprint", () => {
  const sensitive = "authentication failed for account alice token ABC-XYZ";
  const code = runtimeFailureCode(new Error(sensitive));
  assert.equal(code, fingerprint(sensitive));
  for (const fragment of ["ALICE", "ABC", "XYZ", "TOKEN", "ACCOUNT"]) assert.equal(code.includes(fragment), false, fragment);
  assert.equal(runtimeFailureCode(new Error("ENOENT: open '/var/lib/nusa/secret.json'")).startsWith("MESSAGE_"), true);
  assert.equal(runtimeFailureCode(new Error("   ")), "UNKNOWN");
  assert.equal(runtimeFailureCode(undefined), "UNKNOWN");
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
  writeFileSync(file, JSON.stringify({ schemaVersion: 1, kind: "UNHANDLED_REJECTION", code: "ALICE TOKEN ABC" }));
  assert.equal(readPreviousRuntimeFailure(db), "PREVIOUS_UNHANDLED_REJECTION:UNKNOWN");
  recordRuntimeFailure(db, "UNCAUGHT_EXCEPTION", new Error("boom"), 5);
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), { schemaVersion: 1, kind: "UNCAUGHT_EXCEPTION", code: fingerprint("boom"), at: 5 });
});


test("bounded first causes survive a durable record without publishing SQL messages or owner identities", () => {
  const db = stateDb();
  const cause = Object.assign(new Error("database locked token SECRET owner PRIVATE"), { errcode: 261 });
  const reason = new Error("PAPER_WRITER_LEASE_LOST", { cause });
  recordRuntimeFailure(db, "CLOSED_LEARNING_SCHEDULER", reason, 9);
  const bytes = readFileSync(runtimeFailureRecordPath(db)!, "utf8");
  assert.deepEqual(JSON.parse(bytes), { schemaVersion: 1, kind: "CLOSED_LEARNING_SCHEDULER", code: "PAPER_WRITER_LEASE_LOST", at: 9, causeCode: "SQLITE_BUSY" });
  assert.equal(/SECRET|PRIVATE|token|owner/.test(bytes), false);
  assert.equal(readPreviousRuntimeFailure(db), "PREVIOUS_CLOSED_LEARNING_SCHEDULER:PAPER_WRITER_LEASE_LOST");
});

test("untrusted and cyclic causes are bounded and never copied into the receipt", () => {
  const db = stateDb();
  const reason = new Error("PAPER_WRITER_LEASE_LOST", { cause: new Error("TOKEN_SECRET") });
  recordRuntimeFailure(db, "STARTUP", reason, 9);
  assert.equal(JSON.parse(readFileSync(runtimeFailureRecordPath(db)!, "utf8")).causeCode, undefined);
  reason.cause = reason;
  recordRuntimeFailure(db, "STARTUP", reason, 10);
  assert.equal(JSON.parse(readFileSync(runtimeFailureRecordPath(db)!, "utf8")).causeCode, undefined);
  reason.cause = new Error("PAPER_WRITER_LEASE_EXPIRED");
  recordRuntimeFailure(db, "STARTUP", reason, 11);
  assert.equal(JSON.parse(readFileSync(runtimeFailureRecordPath(db)!, "utf8")).causeCode, "PAPER_WRITER_LEASE_EXPIRED");
});
