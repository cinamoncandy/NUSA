const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { MobileNotificationCenter } = require("../dist/apps/mobile/src/notificationCenter.js");

const settings = (overrides = {}) => ({ theme: "SYSTEM", locale: "ko-KR", notifications: { enabled: true, riskAlerts: true, orderUpdates: true, ...overrides } });

test("notification center routes Paper events, obeys settings, and deduplicates", () => {
  const center = new MobileNotificationCenter();
  const event = { id: "fill-1", kind: "FILL", title: "Paper fill", message: "Filled", severity: "INFO", createdAtMs: 10 };
  assert.equal(center.publish(event, settings(), true), true);
  assert.equal(center.publish(event, settings(), true), false);
  assert.equal(center.list(10).length, 1);
  assert.equal(center.publish({ ...event, id: "fill-2" }, settings({ orderUpdates: false }), false), false);
  assert.equal(center.publish({ ...event, id: "system-1", kind: "SYSTEM" }, settings({ enabled: false }), false), false);
});

test("notification UI is Paper-only and wired into More", () => {
  const view = fs.readFileSync(path.join(__dirname, "..", "apps", "mobile", "src", "notificationView.tsx"), "utf8");
  const more = fs.readFileSync(path.join(__dirname, "..", "apps", "mobile", "src", "moreView.tsx"), "utf8");
  assert.match(view, /notifications-paper/);
  assert.match(view, /Paper \/ Read Only/);
  assert.doesNotMatch(view, /placeOrder|cancelOrder|withdraw/);
  assert.match(more, /NotificationView/);
  assert.match(more, /more-notifications-tab/);
});
