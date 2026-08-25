"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { validateAndroidReleaseModel } = require("../scripts/validate-android-release-model.js");

test("Android 101 release model retires active Preview packaging and keeps RC provenance separate", () => {
  const result = validateAndroidReleaseModel();
  assert.equal(result.ok, true, result.failures.join("\n"));
});
