import { describe, expect, it } from "vitest";
import { applyLiveRuntimeSessionCommand } from "./liveRuntimeSessionCommands";
import { LiveRuntimeSessionDurableStore, type LiveRuntimeSessionStorage } from "./liveRuntimeSessionDurableStore";

class MemoryStorage implements LiveRuntimeSessionStorage {
  private readonly values = new Map<string, unknown>();
  async transaction<T>(callback: (txn: any) => Promise<T>): Promise<T> {
    return callback({ get: async (key: string) => this.values.get(key), put: async (key: string, value: unknown) => { this.values.set(key, value); } });
  }
}

async function setup(state: "ACTIVE" | "STOPPED" = "STOPPED") {
  const store = new LiveRuntimeSessionDurableStore(new MemoryStorage());
  await store.write({ sessionId: "s1", ownerPrincipalId: "owner-1", investmentCapitalWeight: 0.25, state, killSwitchEngaged: false, activatedAtMs: 1_000, expiresAtMs: 5_000 }, null);
  return store;
}

describe("LIVE runtime session commands", () => {
  it("starts and stops through revisioned durable writes", async () => {
    const store = await setup();
    const started = await applyLiveRuntimeSessionCommand(store, "owner-1", 1, { type: "START" }, 2_000);
    expect(started.status).toBe("APPLIED");
    if (started.status !== "APPLIED") return;
    expect(started.record.session.state).toBe("ACTIVE");
    const stopped = await applyLiveRuntimeSessionCommand(store, "owner-1", started.record.revision, { type: "STOP" }, 2_100);
    expect(stopped.status).toBe("APPLIED");
    if (stopped.status === "APPLIED") expect(stopped.record.session.state).toBe("STOPPED");
  });

  it("atomically updates the investment capital weight", async () => {
    const store = await setup("ACTIVE");
    const result = await applyLiveRuntimeSessionCommand(store, "owner-1", 1, { type: "SET_CAPITAL_WEIGHT", investmentCapitalWeight: 0.1 }, 2_000);
    expect(result.status).toBe("APPLIED");
    if (result.status === "APPLIED") expect(result.record.session.investmentCapitalWeight).toBe(0.1);
  });

  it("rejects stale commands", async () => {
    const store = await setup();
    await applyLiveRuntimeSessionCommand(store, "owner-1", 1, { type: "START" }, 2_000);
    expect(await applyLiveRuntimeSessionCommand(store, "owner-1", 1, { type: "STOP" }, 2_100)).toEqual({ status: "REJECTED", reason: "REVISION_CONFLICT" });
  });

  it("engages a one-way kill switch for the current session", async () => {
    const store = await setup("ACTIVE");
    const killed = await applyLiveRuntimeSessionCommand(store, "owner-1", 1, { type: "ENGAGE_KILL_SWITCH" }, 2_000);
    expect(killed.status).toBe("APPLIED");
    if (killed.status !== "APPLIED") return;
    expect(killed.record.session.killSwitchEngaged).toBe(true);
    expect(killed.record.session.state).toBe("STOPPED");
    expect(await applyLiveRuntimeSessionCommand(store, "owner-1", killed.record.revision, { type: "START" }, 2_100)).toEqual({ status: "REJECTED", reason: "KILL_SWITCH_ENGAGED" });
  });

  it("rejects invalid capital weights and inactive start windows", async () => {
    const store = await setup();
    expect(await applyLiveRuntimeSessionCommand(store, "owner-1", 1, { type: "SET_CAPITAL_WEIGHT", investmentCapitalWeight: 2 }, 2_000)).toEqual({ status: "REJECTED", reason: "CAPITAL_WEIGHT_INVALID" });
    expect(await applyLiveRuntimeSessionCommand(store, "owner-1", 1, { type: "START" }, 6_000)).toEqual({ status: "REJECTED", reason: "SESSION_WINDOW_INACTIVE" });
  });
});
