const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (relative) => fs.readFileSync(path.join(__dirname, "..", relative), "utf8");

test("mobile app feeds Cloud PAPER availability from the runtime recovery coordinator while LOCAL PAPER stays independent", () => {
  const app = read("apps/mobile/App.tsx");
  const tradingShell = read("apps/mobile/src/tradingView.tsx");
  const trading = read("apps/mobile/src/tradingViewLegacy.tsx");

  assert.match(app, /MobileRuntimeCoordinator/);
  assert.match(app, /type: "RECOVERY_STARTED"/);
  assert.match(app, /type: "NETWORK_OFFLINE"/);
  assert.match(app, /type: "RECOVERY_MATCHED"/);
  assert.match(app, /runtimeCanSubmit=\{runtimeCanSubmit\}/);
  assert.match(tradingShell, /TradingView as LegacyTradingView/);
  assert.match(tradingShell, /<LegacyTradingView \{\.\.\.props\} \/>/);
  assert.match(trading, /runtimeCanSubmit\?: boolean/);
  assert.match(trading, /const localPaperSubmitAvailable = usingLocalPaper && effectiveMarkPrice != null/);
  assert.match(trading, /const cloudPaperSubmitAvailable = runtimeCanSubmit && builtInSubmitAvailable/);
  assert.match(trading, /const submitAvailable = onSubmit !== undefined \|\| localPaperSubmitAvailable \|\| cloudPaperSubmitAvailable/);
  assert.match(trading, /testID="paper-runtime-blocked"/);
});
