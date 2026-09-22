const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (relative) => fs.readFileSync(path.join(__dirname, "..", relative), "utf8");

test("mobile app feeds Cloud PAPER availability from the runtime recovery coordinator while production PAPER stays supervision-only", () => {
  const app = read("apps/mobile/App.tsx");

  assert.match(app, /MobileRuntimeCoordinator/);
  assert.match(app, /type: "RECOVERY_STARTED"/);
  assert.match(app, /type: "NETWORK_OFFLINE"/);
  assert.match(app, /type: "RECOVERY_MATCHED"/);
  // runtimeCanSubmit only ever fed the order ticket, which the board does not have.
  assert.doesNotMatch(app, /runtimeCanSubmit/);
});
