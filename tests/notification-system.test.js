const test = require("node:test");
const assert = require("node:assert/strict");
const { DEFAULT_SETTINGS, NotificationCenter, normalizeSettings } = require("../apps/desktop/renderer/notification-center.js");

test("notifications are Paper-only and deduplicated", () => {
  const center = new NotificationCenter();
  const event = { id: "fill-1", kind: "FILL", title: "BUY filled", body: "0.001 BTC" };
  const first = center.consume(event, DEFAULT_SETTINGS, false);
  assert.equal(first.title, "NUSA Paper - BUY filled");
  assert.equal(first.delivery, "IN_APP");
  assert.equal(center.consume(event, DEFAULT_SETTINGS, false), null);
});

test("background events use system delivery without mutating Paper state", () => {
  const result = new NotificationCenter().consume({ id: "order-1", kind: "ORDER_STATUS", title: "Order status", body: "filled" }, DEFAULT_SETTINGS, true);
  assert.equal(result.delivery, "SYSTEM");
  assert.equal(result.kind, "ORDER_STATUS");
});

test("disabled notification settings fail closed", () => {
  const center = new NotificationCenter();
  const settings = normalizeSettings({ enabled: false, priceAlerts: true });
  assert.equal(center.consume({ id: "price-1", kind: "PRICE_ALERT", title: "Price", body: "threshold" }, settings, false), null);
});

test("invalid thresholds are ignored and settings are immutable", () => {
  const settings = normalizeSettings({ priceAbove: -1, priceBelow: "500" });
  assert.equal(settings.priceAbove, null);
  assert.equal(settings.priceBelow, null);
  assert.ok(Object.isFrozen(settings));
});

test("each notification kind has an independent setting", () => {
  const center = new NotificationCenter();
  const settings = normalizeSettings({ fillAlerts: false, systemErrorAlerts: true });
  assert.equal(center.consume({ id: "fill-1", kind: "FILL", title: "Fill", body: "x" }, settings, false), null);
  assert.ok(center.consume({ id: "system-1", kind: "SYSTEM_ERROR", title: "Error", body: "x" }, settings, false));
});
