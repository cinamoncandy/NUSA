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

test("notification UI is Paper-only, retryable, and routed as a header utility", () => {
  const view = fs.readFileSync(path.join(__dirname, "..", "apps", "mobile", "src", "notificationView.tsx"), "utf8");
  const app = fs.readFileSync(path.join(__dirname, "..", "apps", "mobile", "App.tsx"), "utf8");
  assert.match(view, /notifications-paper/);
  assert.match(view, /notifications-loading/);
  assert.match(view, /notifications-error/);
  assert.match(view, /NusaButton label="다시 시도" onPress=\{load\}/);
  assert.match(view, /<DataRow label="운영 모드" value="PAPER" emphasis \/>/);
  assert.match(view, /<DataRow label="권한" value="읽기 전용" \/>/);
  assert.doesNotMatch(view, /placeOrder|cancelOrder|withdraw/);
  assert.match(app, /header-notifications/);
  assert.match(app, /utilityView === "NOTIFICATIONS" \? <NotificationView repository=\{settingsRepository\}/);
  assert.match(app, /testID="utility-close"/);
});
