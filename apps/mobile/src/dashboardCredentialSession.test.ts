import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LEGACY_MOBILE_BOOTSTRAP_PREFIX, normalizeMobileBootstrapToken } from "./dashboardCredentialSession";

describe("mobile PAPER bootstrap token compatibility", () => {
  it("keeps a raw one-time bootstrap token unchanged", () => {
    const token = "abcdefghijklmnop1234567890";
    assert.equal(normalizeMobileBootstrapToken(token), token);
  });

  it("strips the legacy bootstrap transport marker before exchange", () => {
    const token = "abcdefghijklmnopqrstuvwxyz123456";
    assert.equal(normalizeMobileBootstrapToken(`${LEGACY_MOBILE_BOOTSTRAP_PREFIX}${token}`), token);
  });

  it("rejects an empty legacy bootstrap payload", () => {
    assert.throws(() => normalizeMobileBootstrapToken(LEGACY_MOBILE_BOOTSTRAP_PREFIX), /invalid/i);
  });

  it("rejects whitespace inside the actual bootstrap secret", () => {
    assert.throws(() => normalizeMobileBootstrapToken(`${LEGACY_MOBILE_BOOTSTRAP_PREFIX}abcdefghijkl mnopqrstuvwxyz`), /invalid/i);
  });
});
