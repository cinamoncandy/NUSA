const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const workflow = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'autopilot-cloudflare-deploy.yml'), 'utf8');

test('Cloudflare deploy selects the newest canonical exact-head CI run deterministically', () => {
  assert.match(workflow, /\.name == "CI"/);
  assert.match(workflow, /\.path == "\.github\/workflows\/ci\.yml"/);
  assert.match(workflow, /\.head_sha == env\.HEAD_SHA/);
  assert.match(workflow, /sort_by\(\.id\) \| reverse \| \.\[0\]\.conclusion/);
});
