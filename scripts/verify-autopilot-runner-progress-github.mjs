import fs from 'node:fs';

const [evidencePath] = process.argv.slice(2);
if (!evidencePath) {
  console.error('usage: node scripts/verify-autopilot-runner-progress-github.mjs <runner-progress.json>');
  process.exit(2);
}

function fail(reason) {
  console.error(reason);
  process.exit(1);
}

let evidence;
try {
  evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
} catch {
  fail('github-evidence-json-invalid');
}

const repository = 'cinamoncandy/NUSA';
if (evidence.repository !== repository) fail('github-evidence-repository-not-allowed');
if (evidence.live_authority !== 'NONE') fail('github-evidence-live-authority-drift');
if (evidence.production_mutation_allowed !== false) fail('github-evidence-production-mutation-drift');
if (evidence.ai_authority !== 'ZERO_AUTHORITY') fail('github-evidence-ai-authority-drift');

const token = (process.env.GITHUB_TOKEN ?? '').trim();
if (!token) fail('github-evidence-token-missing');
const apiBase = (process.env.NUSA_GITHUB_API_BASE_URL ?? 'https://api.github.com').replace(/\/$/, '');

async function api(path) {
  const response = await fetch(`${apiBase}${path}`, {
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'x-github-api-version': '2022-11-28',
      'user-agent': 'nusa-autopilot-evidence-verifier',
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) fail(`github-evidence-api-${response.status}`);
  return response.json();
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
if (stageIndex < 0) fail('github-evidence-status-invalid');

const verified = {
  schemaVersion: 1,
  status: evidence.status,
  repository,
  requested_head_sha: evidence.requested_head_sha ?? null,
  branchVerified: false,
  pullRequestVerified: false,
  exactHeadCiVerified: false,
  mergeVerified: false,
};

if (stageIndex >= stages.indexOf('BRANCH_CREATED')) {
  if (typeof evidence.branch !== 'string' || !evidence.branch.startsWith('autopilot/') || evidence.branch === 'main') {
    fail('github-evidence-branch-invalid');
  }
  const ref = await api(`/repos/${repository}/git/ref/heads/${evidence.branch}`);
  if (!ref?.object?.sha || !/^[0-9a-f]{40}$/i.test(ref.object.sha)) fail('github-evidence-branch-ref-invalid');
  verified.branchVerified = true;
}

let pr = null;
if (stageIndex >= stages.indexOf('PR_OPENED')) {
  if (!Number.isInteger(evidence.pr_number) || evidence.pr_number <= 0) fail('github-evidence-pr-number-invalid');
  pr = await api(`/repos/${repository}/pulls/${evidence.pr_number}`);
  if (pr?.base?.ref !== 'main') fail('github-evidence-pr-base-invalid');
  if (pr?.head?.ref !== evidence.branch) fail('github-evidence-pr-branch-mismatch');
  if (pr?.head?.repo?.full_name !== repository) fail('github-evidence-pr-repository-mismatch');
  if (stageIndex < stages.indexOf('MERGED') && pr?.state !== 'open') fail('github-evidence-pr-not-open');
  verified.pullRequestVerified = true;
}

if (stageIndex >= stages.indexOf('CI_GREEN')) {
  if (!/^[0-9a-f]{40}$/i.test(evidence.produced_commit_sha ?? '')) fail('github-evidence-produced-commit-invalid');
  if (pr?.head?.sha !== evidence.produced_commit_sha) fail('github-evidence-pr-head-drift');
  if (evidence.exact_head_ci_state !== 'GREEN' || evidence.exact_head_ci_sha !== evidence.produced_commit_sha) {
    fail('github-evidence-exact-head-claim-invalid');
  }

  const runs = await api(`/repos/${repository}/actions/runs?head_sha=${evidence.produced_commit_sha}&event=pull_request&per_page=100`);
  const required = [
    'CI',
    'Restricted LIVE Activation Rehearsal',
    'Restricted LIVE Transport Credential Readiness',
    'Restricted LIVE Capability Surface Guard',
    'Actual PAPER Public-Market Runtime Evidence',
    'Read-only Broker Credential Integration',
  ];
  for (const name of required) {
    const passed = (runs.workflow_runs ?? []).some((run) =>
      run.name === name &&
      run.head_sha === evidence.produced_commit_sha &&
      run.status === 'completed' &&
      run.conclusion === 'success'
    );
    if (!passed) fail(`github-evidence-required-workflow-not-green:${name}`);
  }
  verified.exactHeadCiVerified = true;
}

if (evidence.status === 'MERGED') {
  if (!pr?.merged_at) fail('github-evidence-pr-not-merged');
  if (!/^[0-9a-f]{40}$/i.test(evidence.merge_sha ?? '')) fail('github-evidence-merge-sha-invalid');
  if (pr.merge_commit_sha !== evidence.merge_sha) fail('github-evidence-merge-sha-mismatch');
  verified.mergeVerified = true;
}

console.log(JSON.stringify(verified));
