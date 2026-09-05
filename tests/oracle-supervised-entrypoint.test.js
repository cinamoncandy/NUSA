"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const unitPath = "deploy/oracle/nusa.service";

test("Oracle systemd launches the supervised production PAPER entrypoint", () => {
  const unit = fs.readFileSync(unitPath, "utf8");
  assert.match(unit, /ExecStart=\/usr\/bin\/node \/opt\/nusa\/current\/scripts\/start-cloud-runtime\.js/);
  assert.doesNotMatch(unit, /ExecStart=.*dist\/apps\/cloud\/src\/runtime\.js/);
});
