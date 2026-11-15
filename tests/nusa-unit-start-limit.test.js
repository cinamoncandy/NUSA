"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const unit = fs.readFileSync(path.join(__dirname, "..", "deploy", "oracle", "nusa.service"), "utf8");

// Restart=on-failure with no limit would loop forever on a start that always fails (and reset every readiness bound).
test("nusa.service stops restarting after 3 starts in 20 minutes and stays failed", () => {
  assert.match(unit, /^StartLimitIntervalSec=20min$/m);
  assert.match(unit, /^StartLimitBurst=3$/m);
  assert.match(unit, /^Restart=on-failure$/m);
  const unitSection = unit.slice(unit.indexOf("[Unit]"), unit.indexOf("[Service]"));
  assert.match(unitSection, /StartLimitBurst=3/, "the limits are in [Unit], where systemd reads them");
  assert.doesNotMatch(unit, /StartLimitAction=/, "no automatic reboot or poweroff action");
});
