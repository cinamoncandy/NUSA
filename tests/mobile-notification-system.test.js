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

test("notification UI truthfully exposes disconnected runtime without fake event controls", () => {
  const view = fs.readFileSync(path.join(__dirname, "..", "apps", "mobile", "src", "notificationView.tsx"), "utf8");
  const app = fs.readFileSync(path.join(__dirname, "..", "apps", "mobile", "App.tsx"), "utf8");
  const settingsView = fs.readFileSync(path.join(__dirname, "..", "apps", "mobile", "src", "settingsView.tsx"), "utf8");

  assert.match(view, /notifications-paper/);
  assert.match(view, /StatusChip label="미연결"/);
  assert.match(view, /DataRow label="운영 모드" value="PAPER" emphasis/);
  assert.match(view, /DataRow label="권한" value="읽기 전용"/);
  assert.match(view, /DataRow label="현재 상태" value="이벤트 수집 미연결"/);
  assert.match(view, /실제 이벤트가 연결되기 전에는 알림 목록이나 동작하지 않는 알림 설정을 제공하지 않습니다/);
  assert.doesNotMatch(view, /중복 제거 후 표시됩니다/);
  assert.doesNotMatch(view, /\.list\(/);
  assert.doesNotMatch(view, /placeOrder|cancelOrder|withdraw/);

  assert.match(app, /header-notifications/);
  assert.match(app, /utilityView === "NOTIFICATIONS" \? <NotificationView repository=\{settingsRepository\}/);
  assert.match(app, /testID="utility-close"/);
  assert.doesNotMatch(app, /new MobileNotificationCenter/);

  assert.doesNotMatch(settingsView, /updateNotification|전체 알림|리스크 알림|주문 상태 업데이트/);
});
