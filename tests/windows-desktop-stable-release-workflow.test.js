const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const workflowPath = path.join(process.cwd(), '.github', 'workflows', 'windows-desktop-stable-release.yml');
const workflow = fs.readFileSync(workflowPath, 'utf8');

test('Windows desktop stable release is exact-main and CI gated', () => {
  assert.match(workflow, /workflow_run:/);
  assert.match(workflow, /workflows: \[CI\]/);
  assert.match(workflow, /branches: \[main\]/);
  assert.match(workflow, /Refusing stale Windows release/);
  assert.match(workflow, /canonical CI run/);
  assert.match(workflow, /Refusing stale Windows publication/);
});

test('Windows desktop stable release packages the canonical Electron renderer', () => {
  assert.match(workflow, /pnpm run package:win/);
  assert.match(workflow, /pnpm run package:validate/);
  assert.match(workflow, /data-runtime-owner=\\"canonical\\"/);
  assert.match(workflow, /app-runtime\.js/);
  assert.match(workflow, /index-v2\\\.html\|simple-ui\\\.js\|simple-ui\\\.css/);
});

test('Windows desktop stable release publishes immutable provenance with safety invariants', () => {
  assert.match(workflow, /NUSA-Windows-Setup\.exe\.sha256/);
  assert.match(workflow, /NUSA-Windows\.provenance\.txt/);
  assert.match(workflow, /renderer_index_sha256/);
  assert.match(workflow, /live_authority=NONE/);
  assert.match(workflow, /production_mutation_allowed=false/);
  assert.match(workflow, /ai_authority=ZERO_AUTHORITY/);
  assert.match(workflow, /gh release (create|upload) nusa-windows/);
});
