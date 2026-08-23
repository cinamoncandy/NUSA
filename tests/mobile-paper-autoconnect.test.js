const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("mobile startup restores an enrolled PAPER session without a second manual connect", () => {
  const app = read("apps/mobile/App.tsx");
  const connection = read("apps/mobile/src/paperConnectionSession.ts");
  assert.match(app, /restoreConfiguredPaperSession\(endpoint\)/);
  assert.match(app, /setStatus\(restored \? "SIGNED_IN" : "SIGNED_OUT"\)/);
  assert.match(connection, /let restoreInFlight: Promise<void> \| null = null/);
  assert.match(connection, /if \(restoreInFlight != null\) await restoreInFlight/);
});

test("clean install remains fail-closed when no canonical origin or session is available", () => {
  const app = read("apps/mobile/App.tsx");
  assert.match(app, /if \(endpoint == null\) return false/);
  assert.match(app, /setStatus\(restored \? "SIGNED_IN" : "SIGNED_OUT"\)/);
  assert.match(read("apps/mobile/src/canonicalOrigin.ts"), /DEPLOYMENT_CONFIG_PENDING/);
});
