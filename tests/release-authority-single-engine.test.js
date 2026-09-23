const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const workflowsDir = path.join(__dirname, '..', '.github', 'workflows');
const canonicalName = 'autopilot-deterministic-audit-release.yml';
const realCreateStatusFixture = JSON.parse(fs.readFileSync(
  path.join(__dirname, 'fixtures', 'github-create-commit-status-response.json'),
  'utf8',
));

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

function simulatePostSuccessThenFailure({ verificationPass, mergePass }) {
  let published = false;
  let merged = false;
  let latestAuthorizationState = 'none';

  latestAuthorizationState = 'success';
  published = true;

  if (!verificationPass) {
    if (published && !merged) latestAuthorizationState = 'failure';
    return { published, merged, latestAuthorizationState };
  }

  if (mergePass) merged = true;
  if (published && !merged) latestAuthorizationState = 'failure';
  return { published, merged, latestAuthorizationState };
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

test('real GitHub Create Commit Status response is verified without nonexistent sha or commit_url fields', () => {
  assert.equal(realCreateStatusFixture.state, 'success');
  assert.equal(realCreateStatusFixture.context, 'nusa/release-authorized');
  assert.equal(realCreateStatusFixture.target_url, 'https://github.com/cinamoncandy/NUSA/actions/runs/34813290255');
  assert.equal(realCreateStatusFixture.url,
    'https://api.github.com/repos/cinamoncandy/NUSA/statuses/4f2a0402b1ba96b0dfaac0554f0d03c566e1e4f6');
  assert.equal(realCreateStatusFixture.creator.login, 'nusa-release-authority[bot]');
  assert.equal(typeof realCreateStatusFixture.id, 'number');
  assert.equal(Object.hasOwn(realCreateStatusFixture, 'sha'), false);
  assert.equal(Object.hasOwn(realCreateStatusFixture, 'commit_url'), false);

  const release = canonicalReleaseJob();
  assert.match(release, /commits\/\$EXPECTED_HEAD\/statuses/,
    'exact SHA must be established by the SHA-bound status-list endpoint');
  assert.match(release, /select\(\.id == \$status_id\)/,
    'the SHA-bound re-read must select the exact POST-returned status id');
  assert.doesNotMatch(release, /\.sha == \$head|\.commit_url/);
});

test('POST success -> verify failure -> no merge -> latest authorization non-success', () => {
  const release = canonicalReleaseJob();
  const authorize = release.indexOf('- name: Publish exact-head release authorization');
  const published = release.indexOf("echo 'published=true' >> \"$GITHUB_OUTPUT\"");
  const selfVerify = release.indexOf('status_id="$(jq -r');
  const merge = release.indexOf('- name: Canonical expected-head merge');
  const revoke = release.indexOf('- name: Revoke authorization if exact-head merge did not complete');

  assert.ok(authorize >= 0 && published > authorize && selfVerify > published && merge > selfVerify && revoke > merge);
  assert.match(release, /if:\s*\$\{\{ failure\(\) && steps\.authorize\.outputs\.published == 'true' \}\}/);
  const revokeStep = release.slice(revoke);
  assert.match(revokeStep, /statuses\/\$EXPECTED_HEAD/);
  assert.match(revokeStep, /-f state=failure/);
  assert.match(revokeStep, /GH_TOKEN:\s*\$\{\{ steps\.release_authority_token\.outputs\.token \}\}/);

  const outcome = simulatePostSuccessThenFailure({ verificationPass: false, mergePass: false });
  assert.deepEqual(outcome, {
    published: true,
    merged: false,
    latestAuthorizationState: 'failure',
  });
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
  assert.match(release, /expected_status_url="\$GITHUB_API_URL\/repos\/\$GITHUB_REPOSITORY\/statuses\/\$EXPECTED_HEAD"/);
  assert.match(release, /expected_target_url="\$GITHUB_SERVER_URL\/\$GITHUB_REPOSITORY\/actions\/runs\/\$GITHUB_RUN_ID"/);
  assert.match(release, /expected_creator='nusa-release-authority\[bot\]'/);
  assert.match(release, /commits\/\$EXPECTED_HEAD\/statuses/);
  assert.doesNotMatch(release, /\.sha == \$head|\.commit_url/,
    'exact-head proof must use the SHA-bound status endpoints and real GitHub status fields');
  assert.match(release, /\.target_url == \$target/);
  assert.match(release, /\.url == \$status_url/);
  assert.match(release, /\.creator\.login == \$creator/);
  assert.match(release, /context=\"\$AUTH_CONTEXT\"/);
  const published = release.indexOf("echo 'published=true' >> \"$GITHUB_OUTPUT\"");
  const selfVerify = release.indexOf('status_id="$(jq -r');
  assert.ok(published > authorize && published < selfVerify,
    'published output must be persisted before self-verification so failure always revokes');
  assert.match(release, /if:\s*\$\{\{ failure\(\) && steps\.authorize\.outputs\.published == 'true' \}\}/);
  assert.match(release, /parent_count/);
  assert.match(release, /parent_base/);
  assert.match(release, /parent_head/);
  assert.match(release, /\[ \"\$parent_base\" = \"\$AUDITED_BASE\" \]/);
  assert.match(release, /\[ \"\$parent_head\" = \"\$EXPECTED_HEAD\" \]/);
});
