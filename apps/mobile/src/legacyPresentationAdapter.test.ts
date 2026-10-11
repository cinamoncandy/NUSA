import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { legacyDetailForMore, legacySurfaceForPrimary } from "./legacyPresentationAdapter";

describe("legacy presentation adapter", () => {
  it("keeps HOME as the only legacy-backed primary surface", () => {
    assert.equal(legacySurfaceForPrimary("Home"), "Home");
  });

  it("does not invent legacy primary surfaces for PAPER, LIVE, or MORE", () => {
    assert.equal(legacySurfaceForPrimary("Paper"), null);
    assert.equal(legacySurfaceForPrimary("Live"), null);
    assert.equal(legacySurfaceForPrimary("More"), null);
  });

  it("keeps operational details behind More without granting authority", () => {
    assert.equal(legacyDetailForMore("Portfolio"), "Portfolio");
    assert.equal(legacyDetailForMore("PaperEvidence"), "Paper");
    assert.equal(legacyDetailForMore("OrderHistory"), "Order");
  });
});
