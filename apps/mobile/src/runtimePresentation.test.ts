import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { initialMobileRuntimeSnapshot, transitionMobileRuntime } from "./mobileRuntime";
import { projectRuntimePresentation } from "./runtimePresentation";

describe("runtime presentation boundary", () => {
  it("renders a ready runtime as connected", () => {
    assert.equal(projectRuntimePresentation(initialMobileRuntimeSnapshot()).status, "CONNECTED");
  });

  it("keeps recovery distinct from authentication required", () => {
    const recovering = transitionMobileRuntime(initialMobileRuntimeSnapshot(), { type: "RECOVERY_STARTED" });
    const view = projectRuntimePresentation(recovering);
    assert.equal(view.status, "RECOVERING");
    assert.equal(view.motion, "RECOVERY");
  });

  it("renders offline and degraded states without inventing recovery", () => {
    const offline = transitionMobileRuntime(initialMobileRuntimeSnapshot(), { type: "NETWORK_OFFLINE" });
    const degraded = transitionMobileRuntime(initialMobileRuntimeSnapshot(), { type: "NETWORK_DEGRADED" });
    assert.equal(projectRuntimePresentation(offline).status, "DISCONNECTED");
    assert.equal(projectRuntimePresentation(degraded).status, "DEGRADED");
  });

  it("only renders auth required when the auth boundary explicitly says so", () => {
    const recovering = transitionMobileRuntime(initialMobileRuntimeSnapshot(), { type: "RECOVERY_STARTED" });
    assert.equal(projectRuntimePresentation(recovering, true).status, "AUTH_REQUIRED");
  });

  it("renders blocked recovery as unavailable", () => {
    const blocked = transitionMobileRuntime(initialMobileRuntimeSnapshot(), { type: "RECOVERY_FAILED", reason: "verification failed" });
    assert.equal(projectRuntimePresentation(blocked).status, "UNAVAILABLE");
  });
});
