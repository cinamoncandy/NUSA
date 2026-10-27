import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { SqliteDatabase } from "../../../packages/storage/src/index";
import { PaperTradingExecutionLoop, SqliteCloudPaperAccountRepository } from "./paperTradingExecutionLoop";
import { PAPER_ACCOUNT_RETIREMENT_RECEIPT_FILE, retiredPaperAccountIds, retirePaperAccounts } from "./paperAccountRetirement";

function seeded() {
  const dir = mkdtempSync(path.join(tmpdir(), "nusa-retire-"));
  const dbPath = path.join(dir, "state.sqlite");
  const db = new SqliteDatabase(dbPath);
  const legacyRepo = new SqliteCloudPaperAccountRepository(db);
  const legacy = new PaperTradingExecutionLoop({ initialCapital: 10_000_000, repository: legacyRepo });
  legacyRepo.save({ ...legacy.snapshot(), updatedAt: 1 });
  legacyRepo.close();
  const activeRepo = new SqliteCloudPaperAccountRepository(db, { accountId: "paper-krw-10000" });
  const active = new PaperTradingExecutionLoop({ initialCapital: 10_000, repository: activeRepo });
  activeRepo.save({ ...active.snapshot(), updatedAt: 2 });
  activeRepo.close();
  return { db, dbPath, dir };
}

const count = (db: SqliteDatabase, accountId: string): number =>
  Number((db.connection.prepare("SELECT COUNT(*) AS n FROM cloud_paper_accounts WHERE account_id = ?").get(accountId) as { n: number }).n);

test("an owner-retired PAPER account is purged and the active account is untouched", () => {
  const { db, dbPath, dir } = seeded();
  assert.equal(count(db, "paper-default"), 1);
  const receipts = retirePaperAccounts(db, ["paper-default"], "paper-krw-10000", { stateDbPath: dbPath, now: 7 });
  assert.equal(count(db, "paper-default"), 0);
  assert.equal(count(db, "paper-krw-10000"), 1);
  assert.equal(receipts[0]!.deletedRows.cloud_paper_accounts, 1);
  assert.ok((receipts[0]!.deletedRows.cloud_paper_account_history ?? 0) >= 1);
  const receipt = JSON.parse(readFileSync(path.join(dir, PAPER_ACCOUNT_RETIREMENT_RECEIPT_FILE), "utf8"));
  assert.equal(receipt.activeAccountId, "paper-krw-10000");
  assert.equal(receipt.retiredAt, 7);
});

test("retirement is idempotent and never touches the active account", () => {
  const { db, dbPath, dir } = seeded();
  retirePaperAccounts(db, ["paper-default"], "paper-krw-10000", { stateDbPath: dbPath });
  const again = retirePaperAccounts(db, ["paper-default"], "paper-krw-10000", { stateDbPath: path.join(dir, "other", "state.sqlite") });
  assert.equal(again[0]!.deletedRows.cloud_paper_accounts, 0);
  assert.throws(() => retirePaperAccounts(db, ["paper-krw-10000"], "paper-krw-10000"), /active PAPER account cannot be retired/);
  assert.equal(count(db, "paper-krw-10000"), 1);
  assert.equal(existsSync(path.join(dir, "other")), false);
});

test("only well-formed PAPER account ids are accepted from the environment", () => {
  assert.deepEqual(retiredPaperAccountIds({}), []);
  assert.deepEqual(retiredPaperAccountIds({ NUSA_PAPER_RETIRED_ACCOUNT_IDS: "paper-default, paper-default" }), ["paper-default"]);
  assert.throws(() => retiredPaperAccountIds({ NUSA_PAPER_RETIRED_ACCOUNT_IDS: "live-account" }), /invalid/);
  assert.throws(() => retiredPaperAccountIds({ NUSA_PAPER_RETIRED_ACCOUNT_IDS: "paper-x; DROP TABLE" }), /invalid/);
});
