import test from "node:test";
import assert from "node:assert/strict";
import {
  ExecutionCoordinator,
  readScheduledRuntimeEvidence,
  readScheduledRuntimeReceipt,
  recordScheduledRuntimeReceipt,
  type ExecutionCoordinatorNamespace,
  type ScheduledRuntimeReceipt,
} from "./executionCoordinator";

function coordinatorNamespace(initial: Record<string, unknown> = {}): ExecutionCoordinatorNamespace {
  const records = new Map<string, unknown>(Object.entries(initial));
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
  const evidence = await readScheduledRuntimeEvidence(namespace);
  assert.deepEqual(evidence.history, [RECEIPT]);
  assert.equal(evidence.summary.receiptCount, 1);
  assert.equal(evidence.summary.windowSpanMs, 0);
});

test("scheduled runtime evidence uses one current-coordinator read", async () => {
  const records = new Map<string, unknown>();
  const coordinator = new ExecutionCoordinator({
    storage: {
      async get<T>(key: string): Promise<T | undefined> { return records.get(key) as T | undefined; },
      async put<T>(key: string, value: T): Promise<void> { records.set(key, value); },
    },
  });
  let reads = 0;
  const namespace: ExecutionCoordinatorNamespace = {
    idFromName: (name: string) => ({ name }),
    get: () => ({
      fetch: (input, init) => {
        if (new Request(input, init).method === "GET") reads += 1;
        return coordinator.fetch(new Request(input, init));
      },
    }),
  };
  await recordScheduledRuntimeReceipt(namespace, RECEIPT);
  reads = 0;
  await readScheduledRuntimeEvidence(namespace);
  assert.equal(reads, 1);
});

test("scheduled runtime evidence falls back to legacy coordinators", async () => {
  const records = new Map<string, unknown>([["scheduled-receipt", RECEIPT]]);
  const coordinator = new ExecutionCoordinator({
    storage: {
      async get<T>(key: string): Promise<T | undefined> { return records.get(key) as T | undefined; },
      async put<T>(key: string, value: T): Promise<void> { records.set(key, value); },
    },
  });
  const namespace: ExecutionCoordinatorNamespace = {
    idFromName: (name: string) => ({ name }),
    get: () => ({
      fetch: (input, init) => {
        const request = new Request(input, init);
        if (request.url.endsWith("/scheduled-receipt-history")) return Promise.resolve(new Response(null, { status: 404 }));
        return coordinator.fetch(request);
      },
    }),
  };
  const evidence = await readScheduledRuntimeEvidence(namespace);
  assert.deepEqual(evidence.history, [RECEIPT]);
});

test("scheduled runtime history is deterministic, bounded, and replay-idempotent", async () => {
  const namespace = coordinatorNamespace();
  for (let index = 0; index < 125; index += 1) {
    await recordScheduledRuntimeReceipt(namespace, {
      ...RECEIPT,
      scheduledTime: RECEIPT.scheduledTime + index,
      observedAt: RECEIPT.observedAt + index,
    });
  }
  await recordScheduledRuntimeReceipt(namespace, { ...RECEIPT, scheduledTime: RECEIPT.scheduledTime + 124, observedAt: RECEIPT.observedAt + 124 });
  const evidence = await readScheduledRuntimeEvidence(namespace);
  assert.equal(evidence.history.length, 120);
  assert.equal(evidence.history[0]?.scheduledTime, RECEIPT.scheduledTime + 5);
  assert.equal(evidence.history.at(-1)?.scheduledTime, RECEIPT.scheduledTime + 124);
  assert.equal(evidence.summary.receiptCount, 120);
  assert.equal(evidence.summary.statusCounts.DUPLICATE_EXECUTION_SUPPRESSED, 120);
});

test("scheduled runtime receipt identity conflicts fail closed", async () => {
  const namespace = coordinatorNamespace();
  await recordScheduledRuntimeReceipt(namespace, RECEIPT);
  await assert.rejects(
    () => recordScheduledRuntimeReceipt(namespace, { ...RECEIPT, reason: "different-payload" }),
    /SCHEDULED_RUNTIME_RECEIPT_PERSIST_FAILED/,
  );
  assert.deepEqual(await readScheduledRuntimeEvidence(namespace).then((value) => value.history), [RECEIPT]);
});

test("legacy single receipt storage is read without losing safety invariants", async () => {
  const namespace = coordinatorNamespace({ "scheduled-receipt": RECEIPT });
  const evidence = await readScheduledRuntimeEvidence(namespace);
  assert.deepEqual(evidence.receipt, RECEIPT);
  assert.deepEqual(evidence.history, [RECEIPT]);
});

test("malformed persisted receipt history fails closed before replay or append", async () => {
  const namespace = coordinatorNamespace({
    "scheduled-runtime-receipts-v1": { schemaVersion: 1, receipts: [{ ...RECEIPT, productionMutationAllowed: true }] },
  });
  await assert.rejects(() => readScheduledRuntimeEvidence(namespace), /SCHEDULED_RUNTIME_RECEIPT_READ_FAILED/);
  await assert.rejects(() => recordScheduledRuntimeReceipt(namespace, RECEIPT), /SCHEDULED_RUNTIME_RECEIPT_PERSIST_FAILED/);
});

test("scheduled runtime receipt rejects authority drift", async () => {
  const namespace = coordinatorNamespace();
  await assert.rejects(
    () => recordScheduledRuntimeReceipt(namespace, { ...RECEIPT, liveAuthority: "FULL" as never }),
    /SCHEDULED_RUNTIME_RECEIPT_PERSIST_FAILED/,
  );
  assert.equal(await readScheduledRuntimeReceipt(namespace), null);
});
