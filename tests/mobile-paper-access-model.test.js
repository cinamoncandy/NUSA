"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.resolve(__dirname, "../apps/mobile/src/paperAccessModel.ts"), "utf8");

test("public observation stays available without a device session", () => {
  assert.match(source, /publicObservationAllowed:\s*true/);
  assert.match(source, /paperMutationAllowed:\s*verified/);
  assert.match(source, /DEVICE_APPROVAL_REQUIRED/);
});

test("PAPER mutation requires a verified non-blocked device session", () => {
  assert.match(source, /input\.deviceSessionVerified\s*&&\s*!blocked/);
  assert.match(source, /SECURE_SESSION/);
  assert.match(source, /BLOCKED/);
});

test("PAPER session never creates LIVE or AI authority", () => {
  assert.match(source, /liveAuthority:\s*"NONE"/);
  assert.match(source, /productionMutationAllowed:\s*false/);
  assert.match(source, /aiAuthority:\s*"ZERO_AUTHORITY"/);
});
