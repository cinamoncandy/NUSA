import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveAndroidBackNavigation, type AndroidBackNavigationState } from "./androidBackNavigation";

const state = (overrides: Partial<AndroidBackNavigationState> = {}): AndroidBackNavigationState => ({
  paperLearningOpen: false,
  utilityViewOpen: false,
  utilityMenuOpen: false,
  activeTab: "Home",
  ...overrides,
});

describe("Android back navigation containment", () => {
  it("closes PAPER learning before any parent surface", () => {
    assert.equal(resolveAndroidBackNavigation(state({ paperLearningOpen: true, utilityViewOpen: true, activeTab: "Paper" })), "CLOSE_PAPER_LEARNING");
  });

  it("closes an open utility view before leaving its parent tab", () => {
    assert.equal(resolveAndroidBackNavigation(state({ utilityViewOpen: true, activeTab: "Portfolio" })), "CLOSE_UTILITY_VIEW");
  });

  it("closes the utility tray before changing tabs", () => {
    assert.equal(resolveAndroidBackNavigation(state({ utilityMenuOpen: true, activeTab: "Markets" })), "CLOSE_UTILITY_MENU");
  });

  it("returns any non-root tab or detail route to HOME", () => {
    for (const activeTab of ["Markets", "Paper", "Portfolio", "AiSignal", "Order"] as const) {
      assert.equal(resolveAndroidBackNavigation(state({ activeTab })), "GO_HOME");
    }
  });

  it("allows Android to exit only from the clean HOME root", () => {
    assert.equal(resolveAndroidBackNavigation(state()), "EXIT_APP");
  });
});
