import { createHash } from "node:crypto";
import type { CanonicalPaperLedger } from "./canonicalPaperLedger";

export interface CanonicalPaperPerformanceEvidence {
  readonly schemaVersion: 1;
  readonly evidenceType: "PAPER";
  readonly periodStartAt: number;
  readonly periodEndAt: number;
  readonly sourceLedgerFingerprintSha256: string;
  readonly tradeCount: number;
  readonly fees: number;
  readonly realizedPnL: number;
  readonly unrealizedPnL: number;
  readonly returnRatio: number;
  readonly fingerprintSha256: string;
}

function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, item) => {
    if (typeof item === "number" && !Number.isFinite(item)) throw new Error("performance evidence contains a non-finite value");
    return item;
  });
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(canonical(value), "utf8").digest("hex");
}

export function buildCanonicalPaperPerformanceEvidence(
  ledger: CanonicalPaperLedger,
  periodStartAt: number,
  periodEndAt: number,
): CanonicalPaperPerformanceEvidence | undefined {
  if (!Number.isSafeInteger(periodStartAt) || periodStartAt < 0 || !Number.isSafeInteger(periodEndAt) || periodEndAt < periodStartAt) {
    throw new Error("performance evidence window is invalid");
  }
  if (!/^[a-f0-9]{64}$/.test(ledger.fingerprintSha256)) throw new Error("ledger fingerprint is invalid");
  const entries = ledger.entries.filter((entry) => entry.filledAt >= periodStartAt && entry.filledAt <= periodEndAt);
  if (entries.length === 0) return undefined;

  // Total-return evidence is only emitted when the requested period contains the complete
  // canonical ledger. A partial ledger window cannot reconstruct starting equity without a
  // second source of truth, so it fails closed rather than fabricating a baseline.
  const firstFillAt = ledger.entries[0]?.filledAt;
  const lastFillAt = ledger.entries.at(-1)?.filledAt;
  if (firstFillAt == null || lastFillAt == null || periodStartAt > firstFillAt || periodEndAt < lastFillAt) return undefined;

  const fees = entries.reduce((sum, entry) => sum + entry.fee, 0);
  const realizedPnL = entries.reduce((sum, entry) => sum + entry.realizedPnL, 0);
  const startingCapital = ledger.initialCapital;
  const returnRatio = startingCapital === 0 ? 0 : (ledger.equity - startingCapital) / startingCapital;
  if (!Number.isFinite(returnRatio)) throw new Error("performance return is invalid");

  const base = Object.freeze({
    schemaVersion: 1 as const,
    evidenceType: "PAPER" as const,
    periodStartAt,
    periodEndAt,
    sourceLedgerFingerprintSha256: ledger.fingerprintSha256,
    tradeCount: entries.length,
    fees,
    realizedPnL,
    unrealizedPnL: ledger.unrealizedPnL,
    returnRatio,
  });
  return Object.freeze({ ...base, fingerprintSha256: fingerprint(base) });
}
