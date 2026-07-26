const test = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync, rmSync } = require("node:fs");
const { join } = require("node:path");
const { tmpdir } = require("node:os");
const {
  loadStrategyChoice, saveStrategyChoice, loadStrategyPeriods, saveStrategyPeriods,
  loadPositionProtection, savePositionProtection, loadPositionSizing, savePositionSizing,
  loadLimitOrders, saveLimitOrders, loadNotificationSettings, saveNotificationSettings
} = require("../dist/apps/server/src/runtimeSettingsStore.js");

test("saveStrategyChoice/loadStrategyChoice round-trip", () => {
  const dir = mkdtempSync(join(tmpdir(), "dokkaebi-strategy-choice-"));
  const path = join(dir, "nested", "choice.json");
  try {
    assert.equal(loadStrategyChoice(path), undefined);
    saveStrategyChoice(path, "ema-crossover");
    assert.equal(loadStrategyChoice(path), "ema-crossover");
    saveStrategyChoice(path, "sma-crossover");
    assert.equal(loadStrategyChoice(path), "sma-crossover");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("saveStrategyPeriods/loadStrategyPeriods round-trip", () => {
  const dir = mkdtempSync(join(tmpdir(), "dokkaebi-strategy-choice-"));
  const path = join(dir, "periods.json");
  try {
    assert.equal(loadStrategyPeriods(path), undefined);
    saveStrategyPeriods(path, { shortPeriod: 7, longPeriod: 25 });
    assert.deepEqual(loadStrategyPeriods(path), { shortPeriod: 7, longPeriod: 25 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("saving choice and periods to the same file preserves both (read-modify-write, not overwrite)", () => {
  const dir = mkdtempSync(join(tmpdir(), "dokkaebi-strategy-choice-"));
  const path = join(dir, "combined.json");
  try {
    saveStrategyChoice(path, "ema-crossover");
    saveStrategyPeriods(path, { shortPeriod: 10, longPeriod: 30 });
    assert.equal(loadStrategyChoice(path), "ema-crossover", "periods save must not clobber the choice");
    assert.deepEqual(loadStrategyPeriods(path), { shortPeriod: 10, longPeriod: 30 });

    saveStrategyChoice(path, "sma-crossover");
    assert.deepEqual(loadStrategyPeriods(path), { shortPeriod: 10, longPeriod: 30 }, "choice save must not clobber periods");
    assert.equal(loadStrategyChoice(path), "sma-crossover");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("loadStrategyPeriods rejects non-integer or invalid-ordering periods", () => {
  const dir = mkdtempSync(join(tmpdir(), "dokkaebi-strategy-choice-"));
  const path = join(dir, "invalid.json");
  const { writeFileSync } = require("node:fs");
  try {
    writeFileSync(path, JSON.stringify({ shortPeriod: 5.5, longPeriod: 20 }), "utf8");
    assert.equal(loadStrategyPeriods(path), undefined, "non-integer shortPeriod");
    writeFileSync(path, JSON.stringify({ shortPeriod: 20, longPeriod: 5 }), "utf8");
    assert.equal(loadStrategyPeriods(path), undefined, "longPeriod must exceed shortPeriod");
    writeFileSync(path, JSON.stringify({ shortPeriod: 1, longPeriod: 20 }), "utf8");
    assert.equal(loadStrategyPeriods(path), undefined, "shortPeriod must be at least 2");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("loadStrategyChoice ignores malformed or unknown content instead of throwing", () => {
  const dir = mkdtempSync(join(tmpdir(), "dokkaebi-strategy-choice-"));
  const path = join(dir, "choice.json");
  const { writeFileSync } = require("node:fs");
  try {
    writeFileSync(path, "not json", "utf8");
    assert.equal(loadStrategyChoice(path), undefined);
    writeFileSync(path, JSON.stringify({ choice: "macd-cross" }), "utf8");
    assert.equal(loadStrategyChoice(path), undefined);
    writeFileSync(path, JSON.stringify({}), "utf8");
    assert.equal(loadStrategyChoice(path), undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("savePositionProtection/loadPositionProtection round-trip", () => {
  const dir = mkdtempSync(join(tmpdir(), "dokkaebi-runtime-settings-"));
  const path = join(dir, "protection.json");
  try {
    assert.equal(loadPositionProtection(path), undefined);
    const settings = { stopLossPrice: 90000000, takeProfitPrice: 100000000, trailingStopPercent: null, trailingPeakPrice: null };
    savePositionProtection(path, settings);
    assert.deepEqual(loadPositionProtection(path), settings);

    const trailing = { stopLossPrice: null, takeProfitPrice: null, trailingStopPercent: 0.05, trailingPeakPrice: 95000000 };
    savePositionProtection(path, trailing);
    assert.deepEqual(loadPositionProtection(path), trailing);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("loadPositionProtection ignores malformed content", () => {
  const dir = mkdtempSync(join(tmpdir(), "dokkaebi-runtime-settings-"));
  const path = join(dir, "protection.json");
  const { writeFileSync } = require("node:fs");
  try {
    writeFileSync(path, JSON.stringify({ positionProtection: { stopLossPrice: "not a number" } }), "utf8");
    assert.equal(loadPositionProtection(path), undefined);
    writeFileSync(path, JSON.stringify({ positionProtection: null }), "utf8");
    assert.equal(loadPositionProtection(path), undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("savePositionSizing/loadPositionSizing round-trip", () => {
  const dir = mkdtempSync(join(tmpdir(), "dokkaebi-runtime-settings-"));
  const path = join(dir, "sizing.json");
  try {
    assert.equal(loadPositionSizing(path), undefined);
    savePositionSizing(path, { mode: "FIXED_FRACTIONAL", riskFraction: 0.25 });
    assert.deepEqual(loadPositionSizing(path), { mode: "FIXED_FRACTIONAL", riskFraction: 0.25 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("loadPositionSizing rejects an unknown mode or out-of-range riskFraction", () => {
  const dir = mkdtempSync(join(tmpdir(), "dokkaebi-runtime-settings-"));
  const path = join(dir, "sizing.json");
  const { writeFileSync } = require("node:fs");
  try {
    writeFileSync(path, JSON.stringify({ positionSizing: { mode: "MARTINGALE", riskFraction: 0.1 } }), "utf8");
    assert.equal(loadPositionSizing(path), undefined);
    writeFileSync(path, JSON.stringify({ positionSizing: { mode: "FIXED_FRACTIONAL", riskFraction: 1.5 } }), "utf8");
    assert.equal(loadPositionSizing(path), undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("saveLimitOrders/loadLimitOrders round-trip", () => {
  const dir = mkdtempSync(join(tmpdir(), "dokkaebi-runtime-settings-"));
  const path = join(dir, "limit-orders.json");
  try {
    assert.equal(loadLimitOrders(path), undefined);
    const orders = [{ id: "1-1", side: "BUY", quantity: 0.001, limitPrice: 90000000, createdAt: "2026-01-01T00:00:00.000Z" }];
    saveLimitOrders(path, { orders, sequence: 1 });
    assert.deepEqual(loadLimitOrders(path), { orders, sequence: 1 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("loadLimitOrders rejects malformed entries", () => {
  const dir = mkdtempSync(join(tmpdir(), "dokkaebi-runtime-settings-"));
  const path = join(dir, "limit-orders.json");
  const { writeFileSync } = require("node:fs");
  try {
    writeFileSync(path, JSON.stringify({ limitOrders: [{ id: "1-1", side: "BUY", quantity: -1, limitPrice: 90000000, createdAt: "x" }], limitOrderSequence: 1 }), "utf8");
    assert.equal(loadLimitOrders(path), undefined);
    writeFileSync(path, JSON.stringify({ limitOrders: "not an array", limitOrderSequence: 1 }), "utf8");
    assert.equal(loadLimitOrders(path), undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("all settings share one sidecar file without clobbering each other", () => {
  const dir = mkdtempSync(join(tmpdir(), "dokkaebi-runtime-settings-"));
  const path = join(dir, "combined.json");
  try {
    saveStrategyChoice(path, "ema-crossover");
    savePositionProtection(path, { stopLossPrice: 90000000, takeProfitPrice: null, trailingStopPercent: null, trailingPeakPrice: null });
    savePositionSizing(path, { mode: "FIXED", riskFraction: 0.1 });
    saveLimitOrders(path, { orders: [], sequence: 0 });

    assert.equal(loadStrategyChoice(path), "ema-crossover");
    assert.deepEqual(loadPositionProtection(path), { stopLossPrice: 90000000, takeProfitPrice: null, trailingStopPercent: null, trailingPeakPrice: null });
    assert.deepEqual(loadPositionSizing(path), { mode: "FIXED", riskFraction: 0.1 });
    assert.deepEqual(loadLimitOrders(path), { orders: [], sequence: 0 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("saveNotificationSettings/loadNotificationSettings round-trip", () => {
  const dir = mkdtempSync(join(tmpdir(), "dokkaebi-runtime-settings-"));
  const path = join(dir, "notifications.json");
  try {
    assert.equal(loadNotificationSettings(path), undefined);
    saveNotificationSettings(path, { enabled: true, webhookUrl: "https://example.com/hook" });
    assert.deepEqual(loadNotificationSettings(path), { enabled: true, webhookUrl: "https://example.com/hook" });
    saveNotificationSettings(path, { enabled: false, webhookUrl: null });
    assert.deepEqual(loadNotificationSettings(path), { enabled: false, webhookUrl: null });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("loadNotificationSettings rejects a malformed or unsafe-scheme webhookUrl", () => {
  const dir = mkdtempSync(join(tmpdir(), "dokkaebi-runtime-settings-"));
  const path = join(dir, "notifications.json");
  const { writeFileSync } = require("node:fs");
  try {
    writeFileSync(path, JSON.stringify({ notifications: { enabled: true, webhookUrl: "javascript:alert(1)" } }), "utf8");
    assert.equal(loadNotificationSettings(path), undefined, "non-http(s) scheme");
    writeFileSync(path, JSON.stringify({ notifications: { enabled: "yes", webhookUrl: null } }), "utf8");
    assert.equal(loadNotificationSettings(path), undefined, "enabled must be a boolean");
    writeFileSync(path, JSON.stringify({ notifications: null }), "utf8");
    assert.equal(loadNotificationSettings(path), undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
