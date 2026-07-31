import assert from "node:assert/strict";
import test from "node:test";
import { NusaRuntime } from "../../core/src/runtime";
import { AiposPlugin } from "./plugin";
import { RecoveryEngine } from "./recovery";
import { InMemoryAiposStore } from "./store";

function createStore(): InMemoryAiposStore {
  return new InMemoryAiposStore({
    project: "NUSA",
    phase: "foundation",
    summary: "AIPOS foundation is available to the NUSA runtime.",
    updatedAt: "2026-07-31T00:00:00.000Z",
  });
}

test("AIPOS plugin registers runtime services", async () => {
  const runtime = new NusaRuntime();
  runtime.plugins.add(new AiposPlugin({ store: createStore() }));

  await runtime.start();

  assert.equal(runtime.plugins.state("aipos"), "loaded");
  assert.ok(runtime.services.resolve<RecoveryEngine>("aipos.recovery") instanceof RecoveryEngine);

  await runtime.stop();
  assert.equal(runtime.plugins.state("aipos"), "disposed");
});
