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
