import { describe, expect, it } from "vitest";
import { LiveRuntimeSessionDurableStore } from "./liveRuntimeSessionDurableStore";

describe("final reservation input validation", () => {
  it("fails closed before storage for malformed identity", async () => {
    const store = new LiveRuntimeSessionDurableStore({ transaction: async () => { throw new Error("must not reach storage"); } });
    expect(await store.reserveFinalExecution("", "session", 1, "e".repeat(64), 1)).toEqual({ status: "REJECTED", reason: "SESSION_IDENTITY_INVALID" });
  });
});
