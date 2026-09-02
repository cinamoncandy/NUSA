import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const workflow = fs.readFileSync('.github/workflows/autopilot-cloudflare-deploy.yml', 'utf8');

test('Cloudflare deploy finds canonical CI across the complete exact-head run page', () => {
  assert.match(workflow, /head_sha=\$HEAD_SHA&status=completed&per_page=100/);
  assert.match(workflow, /select\(\.path == "\.github\/workflows\/ci\.yml"\)/);
});

test('Cloudflare deploy does not use the ambiguous first-page CI-name lookup', () => {
  assert.doesNotMatch(workflow, /select\(\.name == "CI"\)/);
  assert.doesNotMatch(workflow, /head_sha=\$HEAD_SHA&status=completed"/);
});
