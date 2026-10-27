import { createHash } from "node:crypto";
import type { PaperAccountState } from "./paperTradingExecutionLoop";

/**
 * Display-only identity of the canonical PAPER ledger, so a restart, recovery or replay can be checked for an
 * identical accounting state without publishing any amount. Only ledger truth enters the fingerprint (initial
 * capital, cash, realized PnL, position quantity/average entry/realized PnL, every fill); mark-dependent values
 * (unrealized PnL, mark price, equity) are excluded because they move with the market, not the ledger.
 */
export interface PaperLedgerFingerprint {
  readonly ledgerFingerprintSha256: string;
  readonly fillCount: number;
  readonly openPositionCount: number;
  readonly lastFillAt?: number;
  readonly ledgerUpdatedAt: number;
}

export function paperLedgerFingerprint(state: PaperAccountState): PaperLedgerFingerprint {
  const positions = [...state.positions]
    .map((position) => [position.market, position.quantity, position.averageEntryPrice, position.realizedPnL] as const)
    .sort((left, right) => left[0].localeCompare(right[0]));
  const fills = [...state.fills]
    .map((fill) => [fill.id, fill.orderId, fill.market, fill.side, fill.quantity, fill.price, fill.fee, fill.filledAt] as const)
    .sort((left, right) => left[7] - right[7] || left[0].localeCompare(right[0]));
  const material = JSON.stringify({ schemaVersion: 1, initialCapital: state.initialCapital, cash: state.cash, realizedPnL: state.realizedPnL, positions, fills });
  const lastFillAt = fills.length === 0 ? undefined : fills[fills.length - 1]![7];
  return Object.freeze({
    ledgerFingerprintSha256: createHash("sha256").update(material, "utf8").digest("hex"),
    fillCount: fills.length,
    openPositionCount: positions.filter((position) => position[1] !== 0).length,
    ...(lastFillAt === undefined ? {} : { lastFillAt }),
    ledgerUpdatedAt: state.updatedAt,
  });
}
