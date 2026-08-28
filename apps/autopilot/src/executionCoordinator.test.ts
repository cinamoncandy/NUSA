import { describe, expect, it } from "vitest";
import {
  acquirePersistentExecution,
  type DurableObjectIdLike,
  type DurableObjectStubLike,
  type ExecutionCoordinatorNamespace,
} from "./executionCoordinator";

function fakeNamespace(status: number, body: object): ExecutionCoordinatorNamespace {
  const id: DurableObjectIdLike = {};
  return {
    idFromName: () => id,
    get: () => ({ fetch: async () => new Response(JSON.stringify(body), { status }) } as DurableObjectStubLike),
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
    expect(result).toEqual({ acquired: true });
  });

  it("suppresses a duplicate", async () => {
    const result = await acquirePersistentExecution(fakeNamespace(409, { acquired: false, reason: "ALREADY_DISPATCHED" }), {
      dedupeKey: "ci:1:abc",
      executionId: "github:redelivery",
      now: 100,
      leaseExpiresAt: 200,
    });
    expect(result).toEqual({ acquired: false, reason: "ALREADY_DISPATCHED" });
  });

  it("fails closed on coordinator failure", async () => {
    await expect(acquirePersistentExecution(fakeNamespace(500, { error: "FAILED" }), {
      dedupeKey: "ci:1:abc",
      executionId: "github:delivery-1",
      now: 100,
      leaseExpiresAt: 200,
    })).rejects.toThrow("PERSISTENT_EXECUTION_COORDINATION_FAILED");
  });
});
