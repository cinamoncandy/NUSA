import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const workflow = fs.readFileSync(".github/workflows/android-stable-release-trigger.yml", "utf8");

test("Android stable trigger only no-ops when stable already targets exact main", () => {
  assert.match(workflow, /RELEASE_TARGET=.*nusa-android/);
  assert.match(workflow, /if \[ "\$RELEASE_TARGET" = "\$MAIN_SHA" \]/);
  assert.match(workflow, /Android stable already targets exact main/);
  assert.doesNotMatch(workflow, /git diff --quiet/);
  assert.doesNotMatch(workflow, /No Android release-relevant changes since stable source/);
});

test("Android stable trigger preserves exact-main CI, dedupe, and stale-main guards", () => {
  assert.match(workflow, /actions\/workflows\/ci\.yml\/runs\?head_sha=\$MAIN_SHA/);
  assert.match(workflow, /CI_CONCLUSION.*success/);
  assert.match(workflow, /Android Stable Release already active for exact main/);
  assert.match(workflow, /Main changed before dispatch; refusing stale promotion/);
  assert.match(workflow, /actions\/workflows\/android-stable-release\.yml\/dispatches/);
  assert.match(workflow, /inputs\[source_sha\]=\$MAIN_SHA/);
});
