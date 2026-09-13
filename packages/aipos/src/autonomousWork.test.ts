import { describe, expect, it } from "vitest";
import {
  AutonomousWorkController,
  InMemoryAutonomousWorkStore,
  createAutonomousWorkState,
} from "./autonomousWork";

describe("AutonomousWorkController", () => {
  it("dispatches deterministically by dependency then priority", async () => {
    const store = new InMemoryAutonomousWorkStore(createAutonomousWorkState(new Date("2026-09-13T00:00:00Z")));
    const controller = new AutonomousWorkController(store);
    await controller.enqueue({ id: "a", workOrderId: "WO-A", priority: 1 }, new Date("2026-09-13T00:00:01Z"));
    await controller.enqueue({ id: "b", workOrderId: "WO-B", priority: 10, dependencies: ["a"] }, new Date("2026-09-13T00:00:02Z"));
    await controller.enqueue({ id: "c", workOrderId: "WO-C", priority: 5 }, new Date("2026-09-13T00:00:03Z"));

    expect((await controller.claimNext("worker-1", 1_000, new Date("2026-09-13T00:00:04Z")))?.id).toBe("c");
  });

  it("recovers expired worker leases without losing corrections", async () => {
    const store = new InMemoryAutonomousWorkStore(createAutonomousWorkState());
    const controller = new AutonomousWorkController(store);
    await controller.enqueue({ id: "a", workOrderId: "WO-A" }, new Date("2026-09-13T00:00:00Z"));
    await controller.claimNext("worker-1", 1_000, new Date("2026-09-13T00:00:01Z"));
    await controller.correct("a", "Prioritize the safety regression test", new Date("2026-09-13T00:00:01.500Z"));

    const reclaimed = await controller.claimNext("worker-2", 1_000, new Date("2026-09-13T00:00:03Z"));
    expect(reclaimed?.id).toBe("a");
    expect(reclaimed?.workerId).toBe("worker-2");
    expect(reclaimed?.corrections.map((item) => item.instruction)).toEqual(["Prioritize the safety regression test"]);
  });

  it("requires durable evidence before completion", async () => {
    const store = new InMemoryAutonomousWorkStore(createAutonomousWorkState());
    const controller = new AutonomousWorkController(store);
    await controller.enqueue({ id: "a", workOrderId: "WO-A" });
    await controller.claimNext("worker-1", 1_000);

    await expect(controller.complete("a", "worker-1", [])).rejects.toThrow("Completion requires durable evidence");
    await controller.complete("a", "worker-1", ["evidence:WO-A:tests"]);
    expect(await controller.decideNext()).toEqual({ kind: "idle" });
  });

  it("freezes dispatch and completion until explicitly released", async () => {
    const store = new InMemoryAutonomousWorkStore(createAutonomousWorkState());
    const controller = new AutonomousWorkController(store);
    await controller.enqueue({ id: "a", workOrderId: "WO-A" });
    await controller.freeze("release audit hold");

    expect(await controller.claimNext("worker-1", 1_000)).toBeUndefined();
    expect(await controller.decideNext()).toEqual({ kind: "frozen", reason: "release audit hold" });

    await controller.unfreeze();
    expect((await controller.claimNext("worker-1", 1_000))?.id).toBe("a");
  });
});
