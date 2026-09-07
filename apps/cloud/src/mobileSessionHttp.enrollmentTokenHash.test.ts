import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import { matchesMobileEnrollmentTokenHash } from "./mobileSessionHttp";

const hashOf = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");

describe("mobile PAPER enrollment token fingerprint", () => {
  it("accepts the exact high-entropy credential fingerprint", () => {
    const credential = "x".repeat(32);
    assert.equal(matchesMobileEnrollmentTokenHash(credential, hashOf(credential)), true);
  });

  it("rejects a different credential", () => {
    assert.equal(matchesMobileEnrollmentTokenHash("x".repeat(32), hashOf("y".repeat(32))), false);
  });

  it("fails closed when the configured fingerprint is absent or malformed", () => {
    assert.equal(matchesMobileEnrollmentTokenHash("x".repeat(32), undefined), false);
    assert.equal(matchesMobileEnrollmentTokenHash("x".repeat(32), "not-a-sha256"), false);
  });
});
