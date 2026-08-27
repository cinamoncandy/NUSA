import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const [requestPath, receiptPathArg] = process.argv.slice(2);
if (!requestPath) {
  console.error('usage: node scripts/dispatch-autopilot-coding-runner.mjs <coding-request.json> [receipt.json]');
  process.exit(2);
}

const receiptPath = receiptPathArg ?? 'artifacts/autopilot/coding-runner-dispatch-receipt.json';
const runnerUrl = (process.env.NUSA_CODING_RUNNER_URL ?? '').trim();
const runnerToken = (process.env.NUSA_CODING_RUNNER_TOKEN ?? '').trim();
const request = JSON.parse(fs.readFileSync(requestPath, 'utf8'));

function persistReceipt(receipt) {
  fs.mkdirSync(path.dirname(receiptPath), { recursive: true });
  fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify(receipt));
}

function fail(reason, httpStatus = null) {
  persistReceipt({
    schemaVersion: 1,
    status: 'REJECTED',
    reason,
    http_status: httpStatus,
    repository: request.repository ?? null,
    head_sha: request.head_sha ?? null,
    kind: request.kind ?? null,
  });
  process.exit(1);
}

if (!runnerUrl || !runnerToken) {
  persistReceipt({
    schemaVersion: 1,
    status: 'NOT_CONNECTED',
    reason: 'runner-secret-not-configured',
    repository: request.repository ?? null,
    head_sha: request.head_sha ?? null,
    kind: request.kind ?? null,
  });
  process.exit(0);
}

let url;
try {
  url = new URL(runnerUrl);
} catch {
  fail('runner-url-invalid');
}
if (url.protocol !== 'https:') fail('runner-url-must-use-https');
if (request.repository !== 'cinamoncandy/NUSA') fail('repository-not-allowed');
if (!/^[0-9a-f]{40}$/i.test(request.head_sha ?? '')) fail('head-sha-invalid');
if (request.live_authority !== 'NONE') fail('live-authority-drift');
if (request.production_mutation_allowed !== false) fail('production-mutation-drift');
if (request.ai_authority !== 'ZERO_AUTHORITY') fail('ai-authority-drift');

const body = JSON.stringify(request);
const idempotencyKey = crypto.createHash('sha256').update(`${request.kind}:${request.head_sha}:${request.workflow_run_id ?? ''}`).digest('hex');

let response;
try {
  response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'authorization': `Bearer ${runnerToken}`,
      'x-nusa-idempotency-key': idempotencyKey,
      'user-agent': 'nusa-autopilot-actions',
    },
    body,
    signal: AbortSignal.timeout(15_000),
  });
} catch (error) {
  fail(`runner-network-error:${error?.name ?? 'unknown'}`);
}

if (response.status === 200 || response.status === 202 || response.status === 204) {
  persistReceipt({
    schemaVersion: 1,
    status: 'DISPATCHED',
    http_status: response.status,
    idempotency_key: idempotencyKey,
    repository: request.repository,
    head_sha: request.head_sha,
    kind: request.kind,
  });
  process.exit(0);
}

if (response.status === 401 || response.status === 403) fail('runner-auth-rejected', response.status);
if (response.status === 404) fail('runner-endpoint-not-found', 404);
if (response.status === 409) {
  persistReceipt({
    schemaVersion: 1,
    status: 'DEDUPLICATED',
    http_status: 409,
    idempotency_key: idempotencyKey,
    repository: request.repository,
    head_sha: request.head_sha,
    kind: request.kind,
  });
  process.exit(0);
}
fail('runner-http-error', response.status);
