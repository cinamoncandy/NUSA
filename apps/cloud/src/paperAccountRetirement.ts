import { writeFileSync } from "node:fs";
import path from "node:path";
import type { SqliteDatabase } from "../../../packages/storage/src/index";

/**
 * Owner-approved removal of a retired PAPER account's ledger (owner decision 2026-09-29).
 *
 * Changing PAPER capital opens a new account and leaves the previous ledger untouched. When the
 * owner explicitly lists that previous account as retired, its PAPER-only rows are deleted once at
 * start-up in one transaction: account state, history, fill ledger, legacy reconciliation receipts
 * and its writer lease. The active account can never be retired, identifiers must be PAPER account
 * ids, and a receipt with the deleted row counts is written beside the state DB. The Oracle release
 * step backs up the state DB before every release, so the deletion is recoverable from that backup.
 *
 * Research/League evidence and realized-period records are not touched.
 */
export const RETIRED_PAPER_ACCOUNTS_ENV = "NUSA_PAPER_RETIRED_ACCOUNT_IDS";
export const PAPER_ACCOUNT_RETIREMENT_RECEIPT_FILE = "paper-account-retirement.json";

const ACCOUNT_ID = /^paper-[a-z0-9_-]{1,64}$/;
const ACCOUNT_TABLES = [
  "cloud_paper_fill_ledger",
  "cloud_paper_account_history",
  "cloud_paper_legacy_reconciliation_receipts",
  "cloud_paper_writer_leases",
  "cloud_paper_accounts",
] as const;

export function retiredPaperAccountIds(env: NodeJS.ProcessEnv): readonly string[] {
  const raw = env[RETIRED_PAPER_ACCOUNTS_ENV]?.trim();
  if (!raw) return Object.freeze([]);
  const ids = [...new Set(raw.split(",").map((value) => value.trim()).filter(Boolean))];
  if (ids.some((id) => !ACCOUNT_ID.test(id))) throw new Error("retired PAPER account id is invalid");
  return Object.freeze(ids);
}

export interface PaperAccountRetirementReceipt {
  readonly accountId: string;
  readonly deletedRows: Readonly<Record<string, number>>;
}

export function retirePaperAccounts(
  db: SqliteDatabase,
  retiredAccountIds: readonly string[],
  activeAccountId: string,
  options: Readonly<{ stateDbPath?: string; now?: number }> = {},
): readonly PaperAccountRetirementReceipt[] {
  if (retiredAccountIds.includes(activeAccountId)) throw new Error("the active PAPER account cannot be retired");
  const existing = new Set((db.connection.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map((row) => row.name));
  const receipts: PaperAccountRetirementReceipt[] = [];
  db.transaction(() => {
    for (const accountId of retiredAccountIds) {
      if (!ACCOUNT_ID.test(accountId)) throw new Error("retired PAPER account id is invalid");
      const deletedRows: Record<string, number> = {};
      for (const table of ACCOUNT_TABLES) {
        if (!existing.has(table)) continue;
        deletedRows[table] = Number(db.connection.prepare(`DELETE FROM ${table} WHERE account_id = ?`).run(accountId).changes);
      }
      receipts.push(Object.freeze({ accountId, deletedRows: Object.freeze(deletedRows) }));
    }
  });
  const removed = receipts.filter((receipt) => Object.values(receipt.deletedRows).some((count) => count > 0));
  const dbPath = options.stateDbPath?.trim();
  if (removed.length > 0 && dbPath && dbPath !== ":memory:" && path.isAbsolute(dbPath)) {
    try {
      writeFileSync(
        path.join(path.dirname(dbPath), PAPER_ACCOUNT_RETIREMENT_RECEIPT_FILE),
        JSON.stringify({ schemaVersion: 1, retiredAt: options.now ?? Date.now(), activeAccountId, receipts: removed }),
        { mode: 0o600 },
      );
    } catch { /* the receipt is informational; the deletion itself is already committed */ }
  }
  return Object.freeze(receipts);
}
