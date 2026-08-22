const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { DesktopPersistenceStore } = require("../dist/apps/desktop/src/persistence/desktopPersistenceStore.js");

function setup() { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-opportunity-")); const dbPath = path.join(dir, "opportunity.sqlite"); new DatabaseSync(dbPath).close(); return dbPath; }
function input(overrides = {}) { return { scheduleId: "schedule-1", source: "approved-scheduler-fixture", generatedAt: 1_000, schedule: { mode: "PAPER", totalAllocation: 100, reservedCash: 900, opportunities: [{ id: "opp-1", asset: "KRW-BTC", side: "LONG", score: 0.8, allocation: 100, rank: 1, reasons: ["POSITIVE_NET_EDGE"] }], rejected: [] }, ...overrides }; }

test("validated opportunity schedule persists and reloads as a read-only source", () => { const store = new DesktopPersistenceStore(setup()); store.appendOpportunitySchedule(input()); const loaded = store.loadLatestOpportunitySchedule(); assert.equal(loaded.scheduleId, "schedule-1"); assert.equal(loaded.schedule.opportunities[0].asset, "KRW-BTC"); store.close(); });
test("opportunity schedule identity conflicts fail closed", () => { const store = new DesktopPersistenceStore(setup()); store.appendOpportunitySchedule(input()); assert.throws(() => store.appendOpportunitySchedule(input({ source: "other" })), /identity conflict/); store.close(); });
