const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");

const workflow = fs.readFileSync(
  ".github/workflows/android-stable-release.yml",
  "utf8",
);

test("manual Android stable release resolves CI through the canonical workflow endpoint", () => {
  assert.match(
    workflow,
    /github\.event_name != 'workflow_dispatch'[\s\S]*github\.ref == 'refs\/heads\/main'/,
  );
  assert.match(
    workflow,
    /Refusing stale manual Android release source/,
  );
  assert.match(
    workflow,
    /Verify source is still current main before build/,
  );
  assert.match(
    workflow,
    /actions\/workflows\/ci\.yml\/runs\?head_sha=\$SOURCE_SHA&status=completed&per_page=100/,
  );
  assert.match(workflow, /\.path == "\.github\/workflows\/ci\.yml"/);
  assert.match(workflow, /\.head_sha == .*SOURCE_SHA/);
  assert.doesNotMatch(workflow, /actions\/runs\?head_sha=\$SOURCE_SHA/);
});

test("stable release verifies the uploaded GitHub asset by downloading and hashing it", () => {
  assert.match(workflow, /Verify stable GitHub asset download integrity/);
  assert.match(workflow, /releases\/tags\/nusa-android/);
  assert.match(workflow, /browser_download_url/);
  assert.ok(workflow.includes("const expectedUrl = `https://github.com/"));
  assert.match(workflow, /outside the canonical GitHub release path/);
  assert.match(workflow, /curl -fsSL --retry 3/);
  assert.match(workflow, /Content-Length mismatch/);
  assert.match(workflow, /text\/html/);
  assert.match(workflow, /apk_magic/);
  assert.match(workflow, /sha256sum/);
  assert.match(workflow, /declared_sha.*downloaded_sha/s);
});
