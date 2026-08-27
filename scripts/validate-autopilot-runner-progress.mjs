import fs from 'node:fs';

const [inputPath] = process.argv.slice(2);
if (!inputPath) {
  console.error('usage: node scripts/validate-autopilot-runner-progress.mjs <runner-progress.json>');
  process.exit(2);
}

function fail(reason) {
  console.error(reason);
  process.exit(1);
}

let evidence;
try {
  evidence = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
} catch {
  fail('runner-progress-json-invalid');
}

const stages = [
  'NOT_CONNECTED',
  'REQUEST_ACCEPTED',
  'BRANCH_CREATED',
  'PR_OPENED',
  'CI_GREEN',
  'MERGE_READY',
  'MERGED',
];
const stageIndex = stages.indexOf(evidence.status);
if (stageIndex < 0) fail('runner-progress-status-invalid');

if (evidence.schemaVersion !== 1) fail('runner-progress-schema-invalid');
if (evidence.repository !== 'cinamoncandy/NUSA') fail('runner-progress-repository-not-allowed');
if (!/^[0-9a-f]{40}$/i.test(evidence.requested_head_sha ?? '')) fail('runner-progress-requested-head-invalid');
if (evidence.live_authority !== 'NONE') fail('runner-progress-live-authority-drift');
if (evidence.production_mutation_allowed !== false) fail('runner-progress-production-mutation-drift');
if (evidence.ai_authority !== 'ZERO_AUTHORITY') fail('runner-progress-ai-authority-drift');
if (evidence.direct_main_push !== false) fail('runner-progress-direct-main-push-forbidden');
if (evidence.requires_pull_request !== true) fail('runner-progress-pr-required');
if (evidence.merge_only_after_exact_head_green !== true) fail('runner-progress-exact-head-gate-required');

if (evidence.status === 'NOT_CONNECTED') {
  console.log(JSON.stringify({ status: 'NOT_CONNECTED', active: false, mergeReady: false }));
  process.exit(0);
}

if (typeof evidence.request_id !== 'string' || evidence.request_id.trim() === '') fail('runner-progress-request-id-required');
if (!/^[0-9a-f]{64}$/i.test(evidence.idempotency_key ?? '')) fail('runner-progress-idempotency-key-invalid');

if (stageIndex >= stages.indexOf('BRANCH_CREATED')) {
  if (typeof evidence.branch !== 'string' || !evidence.branch.startsWith('autopilot/')) fail('runner-progress-branch-invalid');
  if (evidence.branch === 'main') fail('runner-progress-main-branch-forbidden');
}

if (stageIndex >= stages.indexOf('PR_OPENED')) {
  if (!Number.isInteger(evidence.pr_number) || evidence.pr_number <= 0) fail('runner-progress-pr-number-invalid');
  const expectedPrUrl = `https://github.com/cinamoncandy/NUSA/pull/${evidence.pr_number}`;
  if (evidence.pr_url !== expectedPrUrl) fail('runner-progress-pr-url-invalid');
}

if (stageIndex >= stages.indexOf('CI_GREEN')) {
  if (!/^[0-9a-f]{40}$/i.test(evidence.produced_commit_sha ?? '')) fail('runner-progress-produced-commit-invalid');
  if (evidence.exact_head_ci_state !== 'GREEN') fail('runner-progress-ci-not-green');
  if (evidence.exact_head_ci_sha !== evidence.produced_commit_sha) fail('runner-progress-ci-head-mismatch');
}

if (stageIndex >= stages.indexOf('MERGE_READY') && evidence.exact_head_verified !== true) {
  fail('runner-progress-exact-head-not-verified');
}

if (evidence.status === 'MERGED') {
  if (!/^[0-9a-f]{40}$/i.test(evidence.merge_sha ?? '')) fail('runner-progress-merge-sha-invalid');
}

console.log(JSON.stringify({
  status: evidence.status,
  active: true,
  mergeReady: stageIndex >= stages.indexOf('MERGE_READY'),
  exactHeadGreen: stageIndex >= stages.indexOf('CI_GREEN'),
  requested_head_sha: evidence.requested_head_sha,
  produced_commit_sha: evidence.produced_commit_sha ?? null,
  pr_number: evidence.pr_number ?? null,
}));
