import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { acquirePersistentExecution, type ExecutionCoordinatorNamespace } from "./executionCoordinator";

function fakeNamespace(status: number, body: object): ExecutionCoordinatorNamespace {
  const id = {};
  return {
    idFromName: () => id,
    get: () => ({
      fetch: async () => new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
    }),
  };
}

describe("persistent execution coordination", () => {
  it("accepts a new lease", async () => {
    const result = await acquirePersistentExecution(fakeNamespace(201, { acquired: true }), {
      dedupeKey: "ci:1:abc",
      executionId: "github:delivery-1",
      now: 100,
      leaseExpiresAt: 200,
    });
    assert.deepEqual(result, { acquired: true });
  });

  it("suppresses a duplicate", async () => {
    const result = await acquirePersistentExecution(fakeNamespace(409, { acquired: false, reason: "ALREADY_DISPATCHED" }), {
      dedupeKey: "ci:1:abc",
      executionId: "github:redelivery",
      now: 100,
      leaseExpiresAt: 200,
    });
    assert.deepEqual(result, { acquired: false, reason: "ALREADY_DISPATCHED" });
  });

  it("fails closed on coordinator failure", async () => {
    await assert.rejects(
      acquirePersistentExecution(fakeNamespace(500, { error: "FAILED" }), {
        dedupeKey: "ci:1:abc",
        executionId: "github:delivery-1",
        now: 100,
        leaseExpiresAt: 200,
      }),
      /PERSISTENT_EXECUTION_COORDINATION_FAILED/,
    );
  });
});
