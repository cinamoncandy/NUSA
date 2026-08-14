const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (relative) => fs.readFileSync(path.join(__dirname, "..", relative), "utf8");

test("mobile app feeds PAPER availability from the runtime recovery coordinator", () => {
  const app = read("apps/mobile/App.tsx");
  const trading = read("apps/mobile/src/tradingView.tsx");

  assert.match(app, /MobileRuntimeCoordinator/);
  assert.match(app, /type: "RECOVERY_STARTED"/);
  assert.match(app, /type: "NETWORK_OFFLINE"/);
  assert.match(app, /type: "RECOVERY_MATCHED"/);
  assert.match(app, /runtimeCanSubmit=\{runtimeCanSubmit\}/);
  assert.match(trading, /runtimeCanSubmit\?: boolean/);
  assert.match(trading, /const submitAvailable = runtimeCanSubmit &&/);
  assert.match(trading, /testID="paper-runtime-blocked"/);
});
