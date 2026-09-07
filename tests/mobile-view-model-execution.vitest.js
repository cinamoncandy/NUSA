// @vitest-environment jsdom
// Executes apps/desktop/renderer/mobile-view-model.js (a classic browser
// script previously at 0% in the unified baseline because renderer tests only
// asserted on source text). Pure formatting/summary functions with fail-closed
// fallbacks ("-", null) for non-finite input.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, beforeEach } from "vitest";

const root = path.resolve(import.meta.dirname, "..");
const source = readFileSync(path.join(root, "apps/desktop/renderer/mobile-view-model.js"), "utf8");

function load() {
  delete window.NUSAMobileViewModel;
  window.eval(source);
  return window.NUSAMobileViewModel;
}

describe("mobile view model execution", () => {
  beforeEach(() => {
    load();
  });

  it("exposes a frozen view-model API", () => {
    expect(Object.isFrozen(window.NUSAMobileViewModel)).toBe(true);
    for (const key of ["formatMoney", "formatQuantity", "formatSignedMoney", "formatSignedPercent", "normalizeConnection", "summarize"]) {
      expect(typeof window.NUSAMobileViewModel[key]).toBe("function");
    }
  });

  it("formats money and quantities, failing closed on non-finite input", () => {
    const vm = window.NUSAMobileViewModel;
    expect(vm.formatMoney(1500)).toContain("1,500");
    expect(vm.formatMoney(Number.NaN)).toBe("-");
    expect(vm.formatMoney(undefined)).toBe("-");
    expect(vm.formatQuantity(0.123456789)).toContain("0.12345679");
    expect(vm.formatQuantity("3")).toBe("-");
    expect(vm.formatSignedMoney(200)).toMatch(/^\+/);
    expect(vm.formatSignedMoney(-200)).not.toMatch(/^\+/);
    expect(vm.formatSignedPercent(0.0123)).toBe("+1.23%");
    expect(vm.formatSignedPercent(Number.POSITIVE_INFINITY)).toBe("-");
  });

  it("normalizes connection states deterministically", () => {
    const vm = window.NUSAMobileViewModel;
    expect(vm.normalizeConnection("RECONNECTING")).toEqual(["reconnecting", "재연결 중"]);
    expect(vm.normalizeConnection("stale")).toEqual(["disconnected", "연결 끊김"]);
    expect(vm.normalizeConnection("healthy")).toEqual(["connected", "연결됨"]);
    expect(vm.normalizeConnection("connecting")).toEqual(["connecting", "연결 중"]);
    expect(vm.normalizeConnection("FAULT")).toEqual(["error", "오류"]);
    expect(vm.normalizeConnection("???")).toEqual(["unknown", "확인 중"]);
    expect(vm.normalizeConnection(null)).toEqual(["unknown", "확인 중"]);
  });

  it("summarizes snapshots without trusting partial state", () => {
    const vm = window.NUSAMobileViewModel;
    const full = vm.summarize(
      { cash: 1000, equity: 1500, position: { quantity: 2, realizedPnl: 50 }, orders: [{}, {}], unrealizedPnl: 100 },
      250
    );
    expect(full.heldValue).toBe(500);
    expect(full.total).toBe(1500);
    expect(full.hasPosition).toBe(true);
    expect(full.orderCount).toBe(2);
    const empty = vm.summarize({}, Number.NaN);
    expect(empty.heldValue).toBeNull();
    expect(empty.cash).toBeNull();
    expect(empty.total).toBeNull();
    expect(empty.hasPosition).toBe(false);
    expect(empty.orderCount).toBeNull();
    const hostile = vm.summarize({ cash: -5, equity: -5, position: { quantity: -1 } }, 10);
    expect(hostile.cash).toBe(0);
    expect(hostile.heldValue).toBe(0);
    expect(hostile.hasPosition).toBe(false);
  });
});
