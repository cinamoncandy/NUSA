import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LEGACY_MOBILE_BOOTSTRAP_PREFIX, normalizeMobileBootstrapToken, shouldFallbackToMobileEnrollment } from "./dashboardCredentialSession";

describe("mobile PAPER bootstrap token compatibility", () => {
  it("keeps a raw one-time bootstrap token unchanged", () => {
    assert.equal(normalizeMobileBootstrapToken("x".repeat(32)), "x".repeat(32));
  });

  it("strips the legacy bootstrap transport marker before exchange", () => {
    assert.equal(normalizeMobileBootstrapToken(`${LEGACY_MOBILE_BOOTSTRAP_PREFIX}${"y".repeat(32)}`), "y".repeat(32));
  });

  it("rejects an empty legacy bootstrap payload", () => {
    assert.throws(() => normalizeMobileBootstrapToken(LEGACY_MOBILE_BOOTSTRAP_PREFIX), /invalid/i);
  });

  it("rejects whitespace inside the actual bootstrap secret", () => {
    assert.throws(() => normalizeMobileBootstrapToken(`${LEGACY_MOBILE_BOOTSTRAP_PREFIX}${"x".repeat(16)} ${"y".repeat(16)}`), /invalid/i);
  });

  it("falls back to approved-user enrollment only after a raw bootstrap miss", () => {
    assert.equal(shouldFallbackToMobileEnrollment("x".repeat(43), false), true);
    assert.equal(shouldFallbackToMobileEnrollment("x".repeat(43), true), false);
    assert.equal(shouldFallbackToMobileEnrollment(`${LEGACY_MOBILE_BOOTSTRAP_PREFIX}${"x".repeat(43)}`, false), false);
  });
});
