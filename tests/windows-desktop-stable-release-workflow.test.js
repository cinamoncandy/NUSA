const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const workflowPath = path.join(process.cwd(), '.github', 'workflows', 'windows-desktop-stable-release.yml');
const workflow = fs.readFileSync(workflowPath, 'utf8');

test('Windows desktop stable release is exact-main and CI gated', () => {
  assert.ok(workflow.includes('workflow_run:'));
  assert.ok(workflow.includes('workflows: [CI]'));
  assert.ok(workflow.includes('branches: [main]'));
  assert.ok(workflow.includes('Resolve current-main Windows release candidate'));
  assert.ok(workflow.includes('needs: resolve'));
  assert.ok(workflow.includes('Skipping stale Windows workflow_run'));
  assert.ok(workflow.includes('Refusing stale Windows release'));
  assert.ok(workflow.includes('canonical CI run'));
  assert.ok(workflow.includes('Refusing stale Windows publication'));
});

test('Windows desktop stable release packages the canonical Electron renderer', () => {
  assert.ok(workflow.includes('pnpm run preflight && pnpm run build'));
  assert.ok(workflow.includes("find dist -type f -name '*.map' -delete"));
  assert.ok(workflow.includes('node scripts/validate-package.js'));
  assert.ok(workflow.includes('pnpm exec electron-builder --win nsis'));
  assert.ok(workflow.includes('pnpm run package:validate'));
  assert.ok(workflow.includes('data-runtime-owner="canonical"'));
  assert.ok(workflow.includes('app-runtime.js'));
  assert.ok(workflow.includes("index-v2\\.html|simple-ui\\.js|simple-ui\\.css"));
});

test('Windows desktop stable release prunes maps before pre-packaging validation', () => {
  const pruneIndex = workflow.indexOf("find dist -type f -name '*.map' -delete");
  const validateIndex = workflow.indexOf('node scripts/validate-package.js');
  const packageIndex = workflow.indexOf('pnpm exec electron-builder --win nsis');
  assert.ok(pruneIndex >= 0);
  assert.ok(validateIndex > pruneIndex);
  assert.ok(packageIndex > validateIndex);
});

test('Windows desktop stable release publishes immutable provenance with safety invariants', () => {
  assert.ok(workflow.includes('NUSA-Windows-Setup.exe.sha256'));
  assert.ok(workflow.includes('NUSA-Windows.provenance.txt'));
  assert.ok(workflow.includes('renderer_index_sha256'));
  assert.ok(workflow.includes('live_authority=NONE'));
  assert.ok(workflow.includes('production_mutation_allowed=false'));
  assert.ok(workflow.includes('ai_authority=ZERO_AUTHORITY'));
  assert.ok(workflow.includes('auto_update=sha256_verified_silent_nsis'));
  assert.ok(workflow.includes('gh release upload nusa-windows'));
  assert.ok(workflow.includes('gh release create nusa-windows'));
});
