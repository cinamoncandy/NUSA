import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  closePresentationDetail,
  initialPresentationRoute,
  navigateMoreDetail,
  navigatePrimary,
  openPaperLearning,
} from "./presentationRouter";

describe("presentation router", () => {
  it("starts at the HOME root", () => {
    assert.deepEqual(initialPresentationRoute(), { primary: "Home", detail: null });
  });

  it("primary navigation always closes presentation details", () => {
    const withDetail = navigateMoreDetail(initialPresentationRoute(), "Portfolio");
    assert.deepEqual(navigatePrimary(withDetail, "Paper"), { primary: "Paper", detail: null });
  });

  it("keeps legacy operational surfaces behind More details", () => {
    const route = navigateMoreDetail(initialPresentationRoute(), "PaperEvidence");
    assert.equal(route.primary, "More");
    assert.deepEqual(route.detail, { kind: "MORE", destination: "PaperEvidence" });
  });

  it("opens and closes PAPER learning without changing the primary destination", () => {
    const paper = navigatePrimary(initialPresentationRoute(), "Paper");
    const learning = openPaperLearning(paper);
    assert.equal(learning.primary, "Paper");
    assert.deepEqual(closePresentationDetail(learning), paper);
  });
});
