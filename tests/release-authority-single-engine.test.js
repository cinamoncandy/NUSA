const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const workflowsDir = path.join(__dirname, '..', '.github', 'workflows');
const canonicalName = 'autopilot-deterministic-audit-release.yml';

function workflowFiles() {
  return fs.readdirSync(workflowsDir)
    .filter((name) => /\.ya?ml$/i.test(name))
    .map((name) => ({ name, text: fs.readFileSync(path.join(workflowsDir, name), 'utf8') }));
}

function canonicalReleaseJob() {
  const canonical = fs.readFileSync(path.join(workflowsDir, canonicalName), 'utf8');
  const release = canonical.match(/\r?\n  release:\r?\n[\s\S]*?(?=\r?\n  [A-Za-z0-9_-]+:\r?\n|$)/)?.[0] || '';
  assert.notEqual(release, '', 'missing canonical release job');
  return release;
}

test('PR merge API exists only in the canonical deterministic Release workflow', () => {
  const mergeMutation = /pulls\/[^\s"']+\/merge/;
  const offenders = workflowFiles()
    .filter(({ name, text }) => name !== canonicalName && mergeMutation.test(text))
    .map(({ name }) => name);
  assert.deepEqual(offenders, []);
});

test('canonical merge step is bound to the dedicated Release App token', () => {
  const canonical = fs.readFileSync(path.join(workflowsDir, canonicalName), 'utf8');
  assert.match(canonical, /environment:\s*nusa-release-authority/);
  assert.match(canonical, /app-id:\s*\$\{\{ secrets\.NUSA_RELEASE_AUTH_APP_ID \}\}/);
  assert.match(canonical, /private-key:\s*\$\{\{ secrets\.NUSA_RELEASE_AUTH_APP_PRIVATE_KEY \}\}/);

  const mergeStep = canonical.match(/- name: Canonical expected-head merge[\s\S]*?(?=\r?\n\s{6}- name:|$)/)?.[0] || '';
  assert.notEqual(mergeStep, '');
  assert.match(mergeStep, /GH_TOKEN:\s*\$\{\{ steps\.release_authority_token\.outputs\.token \}\}/);
  assert.doesNotMatch(mergeStep, /GH_TOKEN:\s*\$\{\{ github\.token \}\}/);
  assert.match(mergeStep, /pulls\/\$PR_NUMBER\/merge/);
});

test('ordinary GITHUB_TOKEN has no Release merge or status mutation authority', () => {
  const release = canonicalReleaseJob();
  assert.match(release, /permissions:\s*\r?\n\s+actions:\s*write/);
  assert.match(release, /contents:\s*read/);
  assert.match(release, /issues:\s*read/);
  assert.match(release, /pull-requests:\s*read/);
  assert.doesNotMatch(release, /contents:\s*write/);
  assert.doesNotMatch(release, /pull-requests:\s*write/);
  assert.doesNotMatch(release, /statuses:\s*write/);
});

test('execution consumer remains non-Release and keeps safety invariants', () => {
  const consumer = fs.readFileSync(path.join(workflowsDir, 'autopilot-execution-consumer.yml'), 'utf8');
  assert.doesNotMatch(consumer, /^\s{2}release:/m);
  assert.doesNotMatch(consumer, /^\s{2}release-recovery:/m);
  assert.doesNotMatch(consumer, /pulls\/[^\s"']+\/merge/);
  assert.match(consumer, /live_authority !== 'NONE'/);
  assert.match(consumer, /production_mutation_allowed !== false/);
  assert.match(consumer, /ai_authority !== 'ZERO_AUTHORITY'/);
});


test('canonical Release preserves P0 #903 serialization before authority mint', () => {
  const release = canonicalReleaseJob();
  const serialization = release.indexOf('- name: Enforce canonical P0 Release serialization');
  const mint = release.indexOf('- name: Mint dedicated release authority token');
  assert.notEqual(serialization, -1, 'missing canonical P0 serialization');
  assert.notEqual(mint, -1, 'missing dedicated App token mint');
  assert.ok(serialization < mint, 'P0 serialization must precede Release authority mint');
  assert.match(release, /issues\?state=open&per_page=100/);
  assert.match(release, /Refs\\s\+#903/);
  assert.match(release, /Release serialized behind canonical P0 #903 repair/);
});

test('authorization, merge proof, and invalidation remain fail-closed and ordered', () => {
  const release = canonicalReleaseJob();
  const mint = release.indexOf('- name: Mint dedicated release authority token');
  const authorize = release.indexOf('- name: Publish exact-head release authorization');
  const reverify = release.indexOf('- name: Re-verify authorization is still current before merge');
  const merge = release.indexOf('- name: Canonical expected-head merge');
  const revoke = release.indexOf('- name: Revoke authorization if exact-head merge did not complete');
  assert.ok(mint >= 0 && authorize > mint && reverify > authorize && merge > reverify && revoke > merge);
  assert.match(release, /AUTH_GH_TOKEN:\s*\$\{\{ steps\.release_authority_token\.outputs\.token \}\}/);
  assert.match(release, /statuses\/\$EXPECTED_HEAD/);
  assert.match(release, /context=\"\$AUTH_CONTEXT\"/);
  assert.match(release, /if:\s*\$\{\{ failure\(\) && steps\.authorize\.outputs\.published == 'true' \}\}/);
  assert.match(release, /parent_count/);
  assert.match(release, /parent_base/);
  assert.match(release, /parent_head/);
  assert.match(release, /\[ \"\$parent_base\" = \"\$AUDITED_BASE\" \]/);
  assert.match(release, /\[ \"\$parent_head\" = \"\$EXPECTED_HEAD\" \]/);
});
