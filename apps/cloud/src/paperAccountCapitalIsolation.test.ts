import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SqliteDatabase } from "../../../packages/storage/src/index";
import { LEGACY_PAPER_ACCOUNT_ID, PaperTradingExecutionLoop, SqliteCloudPaperAccountRepository, paperAccountIdForCapital } from "./paperTradingExecutionLoop";

describe("PAPER account per initial capital (owner decision 2026-09-28)", () => {
  it("keeps the legacy id for KRW 10,000,000 and derives a separate id for any other capital", () => {
    assert.equal(paperAccountIdForCapital(10_000_000), LEGACY_PAPER_ACCOUNT_ID);
    assert.equal(paperAccountIdForCapital(5_000), "paper-krw-5000");
    assert.equal(paperAccountIdForCapital(1234.5), "paper-krw-1234_5");
    assert.throws(() => paperAccountIdForCapital(0));
    assert.throws(() => paperAccountIdForCapital(Number.NaN));
  });

  it("switching capital opens a fresh account without touching, resetting or crashing on the old ledger", () => {
    const db = new SqliteDatabase(":memory:");
    const legacyRepo = new SqliteCloudPaperAccountRepository(db, { accountId: paperAccountIdForCapital(10_000_000) });
    const legacy = new PaperTradingExecutionLoop({ initialCapital: 10_000_000, repository: legacyRepo });
    legacyRepo.save({ ...legacy.snapshot(), updatedAt: 1_800_000_000_000 });
    legacyRepo.close?.();

    // Previously the same repository restored the 10M account and threw "paper initial capital mismatch".
    const smallRepo = new SqliteCloudPaperAccountRepository(db, { accountId: paperAccountIdForCapital(5_000) });
    const small = new PaperTradingExecutionLoop({ initialCapital: 5_000, repository: smallRepo });
    assert.equal(small.snapshot().initialCapital, 5_000);
    assert.equal(small.snapshot().cash, 5_000);
    smallRepo.close?.();

    const legacyAgain = new SqliteCloudPaperAccountRepository(db, { accountId: LEGACY_PAPER_ACCOUNT_ID });
    assert.equal(legacyAgain.loadLatest()?.initialCapital, 10_000_000, "the original account is preserved for rollback");
    legacyAgain.close?.();
    assert.throws(() => new SqliteCloudPaperAccountRepository(db, { accountId: "not a valid id" }), /paper account id is invalid/);
  });
});
