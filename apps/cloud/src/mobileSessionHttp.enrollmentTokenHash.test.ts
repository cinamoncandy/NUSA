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

  it("accepts one of a bounded migration fingerprint set without broadening token authority", () => {
    const current = "c".repeat(48);
    const older = "o".repeat(48);
    assert.equal(matchesMobileEnrollmentTokenHash(current, `${hashOf(older)},${hashOf(current)}`), true);
    assert.equal(matchesMobileEnrollmentTokenHash("z".repeat(48), `${hashOf(older)},${hashOf(current)}`), false);
  });

  it("fails closed for malformed, duplicate, or oversized migration fingerprint sets", () => {
    const values = ["a", "b", "c", "d", "e"].map((value) => hashOf(value.repeat(48)));
    assert.equal(matchesMobileEnrollmentTokenHash("a".repeat(48), `${values[0]},not-a-sha256`), false);
    assert.equal(matchesMobileEnrollmentTokenHash("a".repeat(48), `${values[0]},${values[0]}`), false);
    assert.equal(matchesMobileEnrollmentTokenHash("a".repeat(48), values.join(",")), false);
  });
});
