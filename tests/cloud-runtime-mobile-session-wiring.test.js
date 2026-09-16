const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("production Cloud runtime wires mobile sessions to the canonical durable auth database", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "apps/cloud/src/runtime.ts"), "utf8");
  assert.match(source, /import \{ MobileSessionService \} from "\.\/mobileSessionService";/);
  assert.match(source, /new MobileSessionService\(durableAuthDatabase, userAccessRepository\)/);
  assert.match(source, /mobileSessionService == null \? \{\} : \{ mobileSessionService \}/);
});
