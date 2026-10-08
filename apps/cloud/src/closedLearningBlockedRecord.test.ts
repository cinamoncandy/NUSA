import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ClosedLearningLoopStatusTracker } from "./closedLearningLoopStatus";
import { closedLearningBlockedRecordPath, readClosedLearningBlocked, recordClosedLearningBlocked } from "./closedLearningBlockedRecord";

const dbPath = (): string => path.join(mkdtempSync(path.join(tmpdir(), "nusa-blocked-")), "cloud-state.sqlite");

test("a recorded reason survives a read and only bare codes are accepted", () => {
  const db = dbPath();
  assert.equal(readClosedLearningBlocked(db), undefined);
  assert.equal(recordClosedLearningBlocked(db, { reason: "CANDIDATE_BINDING_MIXED", at: 1_700_000_000_000 }), true);
  assert.deepEqual({ ...readClosedLearningBlocked(db) }, { reason: "CANDIDATE_BINDING_MIXED", at: 1_700_000_000_000 });
  recordClosedLearningBlocked(db, { reason: "free text with spaces", at: 5 });
  recordClosedLearningBlocked(db, { reason: "TICK_ERROR", at: -1 });
  assert.equal(readClosedLearningBlocked(db)?.reason, "CANDIDATE_BINDING_MIXED", "invalid records never replace the stored one");
});

test("memory and relative paths are ignored, and corrupt or foreign files read as nothing", () => {
  assert.equal(closedLearningBlockedRecordPath(":memory:"), undefined);
  assert.equal(closedLearningBlockedRecordPath("relative.sqlite"), undefined);
  assert.equal(recordClosedLearningBlocked(":memory:", { reason: "TICK_ERROR", at: 1 }), false, "nothing is written, so the caller keeps retrying");
  assert.equal(recordClosedLearningBlocked("/nonexistent-directory-nusa/cloud-state.sqlite", { reason: "TICK_ERROR", at: 1 }), false, "a failed write reports false");
  const db = dbPath();
  writeFileSync(closedLearningBlockedRecordPath(db)!, "{not json");
  assert.equal(readClosedLearningBlocked(db), undefined);
  writeFileSync(closedLearningBlockedRecordPath(db)!, JSON.stringify({ schemaVersion: 2, reason: "TICK_ERROR", at: 1 }));
  assert.equal(readClosedLearningBlocked(db), undefined);
  writeFileSync(closedLearningBlockedRecordPath(db)!, JSON.stringify({ schemaVersion: 1, reason: "has space", at: 1 }));
  assert.equal(readClosedLearningBlocked(db), undefined);
});

test("a seeded reason fills the gap after a restart, and a reason seen by this process wins", () => {
  const seeded = new ClosedLearningLoopStatusTracker();
  seeded.seedLastBlocked({ reason: "CANDIDATE_BINDING_MIXED", at: 100 });
  seeded.observeRollover({ status: "WAITING_FOR_KST_DAY_ROLLOVER" } as never, 200);
  assert.equal(seeded.snapshot()?.lastBlockedReason, "CANDIDATE_BINDING_MIXED");
  assert.equal(seeded.snapshot()?.lastBlockedAt, 100, "the seed keeps its own, older timestamp");
  seeded.observeRollover({ status: "BLOCKED", reason: "PAPER_ACCOUNT_REPLACED_RETIREMENT_UNAVAILABLE" } as never, 300);
  assert.equal(seeded.snapshot()?.lastBlockedReason, "PAPER_ACCOUNT_REPLACED_RETIREMENT_UNAVAILABLE");
  assert.equal(seeded.lastBlockedRecord()?.at, 300);
  const late = new ClosedLearningLoopStatusTracker();
  late.observeRollover({ status: "BLOCKED", reason: "ALPHA_BLOCK" } as never, 400);
  late.seedLastBlocked({ reason: "OLD_REASON", at: 50 });
  assert.equal(late.snapshot()?.lastBlockedReason, "ALPHA_BLOCK", "a seed never overrides a reason already seen by this process");
  late.seedLastBlocked({ reason: "bad reason", at: 1 });
  assert.equal(new ClosedLearningLoopStatusTracker().lastBlockedRecord(), undefined);
});
