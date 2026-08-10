import type { ProtectedTreasuryState } from "./withdrawalReservation";

export type CapitalBucket = "SPOT" | "FUTURES" | "CASH";

export interface CapitalAllocationRequest {
  readonly id: string;
  readonly bucket: CapitalBucket;
  readonly amount: number;
}

export interface GuardedCapitalAllocation {
  readonly deployableCapital: number;
  readonly allocatedCapital: number;
  readonly remainingCash: number;
  readonly protectedCapital: number;
  readonly allocations: readonly CapitalAllocationRequest[];
}

export interface CashInvestmentEnvelope {
  readonly exchangeCash: number;
  readonly investmentPercent: number;
  readonly reservePercent: number;
  readonly investableCash: number;
  readonly reservedCash: number;
}

const assertMoney = (value: number, field: string): void => {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${field} must be a finite non-negative number`);
  }
};

const assertText = (value: string, field: string): void => {
  if (value.trim().length === 0) {
    throw new Error(`${field} must not be empty`);
  }
};

/**
 * Converts the user's cash-allocation percentage into a hard capital envelope.
 * Only `investableCash` may be used to create new exposure; `reservedCash`
 * remains untouched at the exchange. This does not prevent exits/sells.
 */
export const createCashInvestmentEnvelope = (
  exchangeCash: number,
  investmentPercent: number
): CashInvestmentEnvelope => {
  assertMoney(exchangeCash, "exchangeCash");
  if (!Number.isFinite(investmentPercent) || investmentPercent < 0 || investmentPercent > 100) {
    throw new Error("investmentPercent must be between 0 and 100");
  }

  const normalizedPercent = Math.round(investmentPercent * 100) / 100;
  const investableCash = exchangeCash * (normalizedPercent / 100);
  const reservedCash = exchangeCash - investableCash;

  return Object.freeze({
    exchangeCash,
    investmentPercent: normalizedPercent,
    reservePercent: Math.round((100 - normalizedPercent) * 100) / 100,
    investableCash,
    reservedCash,
  });
};

export const guardCapitalAllocation = (
  treasury: ProtectedTreasuryState,
  requestedAllocations: readonly CapitalAllocationRequest[]
): GuardedCapitalAllocation => {
  assertMoney(treasury.deployableCapital, "treasury.deployableCapital");
  assertMoney(treasury.reservedWithdrawalCapital, "treasury.reservedWithdrawalCapital");
  assertMoney(treasury.reserveCapital, "treasury.reserveCapital");
  assertMoney(treasury.pendingDepositCapital, "treasury.pendingDepositCapital");

  const ids = new Set<string>();
  const allocations = requestedAllocations.map((allocation) => {
    assertText(allocation.id, "allocation.id");
    assertMoney(allocation.amount, "allocation.amount");
    const id = allocation.id.trim();
    if (ids.has(id)) {
      throw new Error(`duplicate allocation id: ${id}`);
    }
    ids.add(id);
    return Object.freeze({ ...allocation, id });
  });

  const sortedAllocations = Object.freeze([...allocations].sort((left, right) =>
    left.bucket.localeCompare(right.bucket) || left.id.localeCompare(right.id)
  ));
  const allocatedCapital = sortedAllocations.reduce((sum, allocation) => sum + allocation.amount, 0);

  if (allocatedCapital - treasury.deployableCapital > 1e-8) {
    throw new Error("requested allocation exceeds deployable capital");
  }

  const remainingCash = treasury.deployableCapital - allocatedCapital;
  const protectedCapital = treasury.reservedWithdrawalCapital + treasury.reserveCapital + treasury.pendingDepositCapital;

  return Object.freeze({
    deployableCapital: treasury.deployableCapital,
    allocatedCapital,
    remainingCash,
    protectedCapital,
    allocations: sortedAllocations
  });
};
