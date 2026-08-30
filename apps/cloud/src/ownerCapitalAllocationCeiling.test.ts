import assert from "node:assert/strict";
import test from "node:test";
import type { CapitalAllocationResult } from "./capitalAllocationEngine";
import { applyOwnerCapitalAllocationCeiling } from "./ownerCapitalAllocationCeiling";

const allocation = (overrides: Partial<CapitalAllocationResult> = {}): CapitalAllocationResult => ({
  allocationId: "allocation-1",
  strategyId: "strategy-1",
  market: "KRW-BTC",
  decision: "ALLOCATE",
  targetWeight: 0.4,
  maximumWeight: 0.5,
  targetCapitalUsd: 40_000,
  cashReserveUsd: 10_000,
  kellyFraction: 0.4,
  drawdownMultiplier: 1,
  volatilityMultiplier: 1,
  liquidityMultiplier: 1,
  correlationMultiplier: 1,
  reasons: [],
  policyVersion: "capital-v1",
  permissionDecisionId: "permission-1",
  generatedAt: "2026-08-30T00:00:00.000Z",
  ...overrides,
});

const policy = (investmentCapitalWeight: number) => ({
  ownerPrincipalId: "owner-1",
  investmentCapitalWeight,
  configuredAt: "2026-08-30T00:00:00.000Z",
});

test("owner investment weight can only reduce an allocation", () => {
  const result = applyOwnerCapitalAllocationCeiling(allocation(), 100_000, policy(0.25));
  assert.equal(result.decision, "REDUCE");
  assert.equal(result.targetWeight, 0.25);
  assert.equal(result.maximumWeight, 0.25);
  assert.equal(result.targetCapitalUsd, 25_000);
  assert.equal(result.ownerCapitalCeilingUsd, 25_000);
  assert.deepEqual(result.reasons, ["OWNER_CAPITAL_CEILING_APPLIED"]);
});

test("owner ceiling never expands a smaller risk-gated allocation", () => {
  const result = applyOwnerCapitalAllocationCeiling(allocation({ targetWeight: 0.1, targetCapitalUsd: 10_000 }), 100_000, policy(0.8));
  assert.equal(result.decision, "ALLOCATE");
  assert.equal(result.targetWeight, 0.1);
  assert.equal(result.targetCapitalUsd, 10_000);
  assert.deepEqual(result.reasons, []);
});

test("zero owner investment weight rejects autonomous capital use", () => {
  const result = applyOwnerCapitalAllocationCeiling(allocation(), 100_000, policy(0));
  assert.equal(result.decision, "REJECT");
  assert.equal(result.targetCapitalUsd, 0);
  assert.equal(result.targetWeight, 0);
  assert.deepEqual(result.reasons, ["OWNER_CAPITAL_CEILING_APPLIED"]);
});

test("owner setting cannot convert a risk rejection into permission", () => {
  const result = applyOwnerCapitalAllocationCeiling(
    allocation({ decision: "REJECT", targetWeight: 0, maximumWeight: 0, targetCapitalUsd: 0, reasons: ["KILL_SWITCH_ACTIVE"] }),
    100_000,
    policy(1),
  );
  assert.equal(result.decision, "REJECT");
  assert.equal(result.targetCapitalUsd, 0);
  assert.deepEqual(result.reasons, ["KILL_SWITCH_ACTIVE"]);
});

test("invalid owner capital settings fail closed", () => {
  assert.throws(() => applyOwnerCapitalAllocationCeiling(allocation(), 100_000, policy(-0.01)), /between 0 and 1/);
  assert.throws(() => applyOwnerCapitalAllocationCeiling(allocation(), 100_000, policy(1.01)), /between 0 and 1/);
  assert.throws(() => applyOwnerCapitalAllocationCeiling(allocation(), 0, policy(0.5)), /totalEquityUsd must be positive/);
});
