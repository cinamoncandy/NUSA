const test = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync } = require("node:fs");
const { join } = require("node:path");
const { tmpdir } = require("node:os");
const { DesktopPersistenceStore } = require("../dist/apps/desktop/src/persistence/desktopPersistenceStore.js");

const dbPath = () => join(mkdtempSync(join(tmpdir(), "nusa-operations-")), "runtime.db");

test("operations audit and alerts are append-only and survive restart", () => {
  const filename = dbPath();
  const first = new DesktopPersistenceStore(filename);
  first.appendOperationsAudit({ auditId: "audit-1", actor: "SYSTEM", action: "APPLICATION_START", target: null, metadata: { mode: "PAPER" }, createdAt: "2026-07-31T00:00:00.000Z" });
  first.appendOperationsAudit({ auditId: "audit-1", actor: "tamper", action: "REPLACE", target: null, metadata: {}, createdAt: "2026-07-31T00:00:01.000Z" });
  first.appendOperationsAlert({ alertId: "alert-1", severity: "WARNING", source: "MARKET", code: "MARKET_DATA_STALE", message: "market data is stale", createdAt: "2026-07-31T00:00:00.000Z" });
  first.close();
  const second = new DesktopPersistenceStore(filename);
  assert.deepEqual(second.loadOperationsAudit(), [{ auditId: "audit-1", actor: "SYSTEM", action: "APPLICATION_START", target: null, metadata: { mode: "PAPER" }, createdAt: "2026-07-31T00:00:00.000Z" }]);
  assert.deepEqual(second.loadOperationsAlerts(), [{ alertId: "alert-1", severity: "WARNING", source: "MARKET", code: "MARKET_DATA_STALE", message: "market data is stale", createdAt: "2026-07-31T00:00:00.000Z" }]);
  second.close();
});
