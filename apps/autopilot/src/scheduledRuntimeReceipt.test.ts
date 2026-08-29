import test from "node:test";
import assert from "node:assert/strict";
import {
  ExecutionCoordinator,
  readScheduledRuntimeReceipt,
  recordScheduledRuntimeReceipt,
  type ExecutionCoordinatorNamespace,
  type ScheduledRuntimeReceipt,
} from "./executionCoordinator";

function coordinatorNamespace(): ExecutionCoordinatorNamespace {
  const records = new Map<string, unknown>();
  const coordinator = new ExecutionCoordinator({
    storage: {
      async get<T>(key: string): Promise<T | undefined> { return records.get(key) as T | undefined; },
      async put<T>(key: string, value: T): Promise<void> { records.set(key, value); },
    },
  });
  return {
    idFromName: (name: string) => ({ name }),
    get: () => ({ fetch: (input, init) => coordinator.fetch(new Request(input, init)) }),
  };
}

const RECEIPT: ScheduledRuntimeReceipt = Object.freeze({
  scheduledTime: 1_700_000_000_000,
  observedAt: 1_700_000_000_123,
  status: "DUPLICATE_EXECUTION_SUPPRESSED",
  reason: "ALREADY_DISPATCHED",
  headSha: "a".repeat(40),
  workflowRunId: 4242,
  liveAuthority: "NONE",
  productionMutationAllowed: false,
  aiAuthority: "ZERO_AUTHORITY",
});

test("scheduled runtime receipt round-trips through the existing execution coordinator", async () => {
  const namespace = coordinatorNamespace();
  await recordScheduledRuntimeReceipt(namespace, RECEIPT);
  assert.deepEqual(await readScheduledRuntimeReceipt(namespace), RECEIPT);
});

test("scheduled runtime receipt rejects authority drift", async () => {
  const namespace = coordinatorNamespace();
  await assert.rejects(
    () => recordScheduledRuntimeReceipt(namespace, { ...RECEIPT, liveAuthority: "FULL" as never }),
    /SCHEDULED_RUNTIME_RECEIPT_PERSIST_FAILED/,
  );
  assert.equal(await readScheduledRuntimeReceipt(namespace), null);
});
