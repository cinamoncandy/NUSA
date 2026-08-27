import fs from 'node:fs';
import crypto from 'node:crypto';

const [requestPath] = process.argv.slice(2);
if (!requestPath) {
  console.error('usage: node scripts/dispatch-autopilot-coding-runner.mjs <coding-request.json>');
  process.exit(2);
}

const runnerUrl = (process.env.NUSA_CODING_RUNNER_URL ?? '').trim();
const runnerToken = (process.env.NUSA_CODING_RUNNER_TOKEN ?? '').trim();
const request = JSON.parse(fs.readFileSync(requestPath, 'utf8'));

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (!runnerUrl || !runnerToken) {
  console.log(JSON.stringify({ status: 'NOT_CONNECTED', reason: 'runner-secret-not-configured' }));
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

const response = await fetch(url, {
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

if (response.status === 200 || response.status === 202 || response.status === 204) {
  console.log(JSON.stringify({ status: 'DISPATCHED', http_status: response.status, idempotency_key: idempotencyKey }));
  process.exit(0);
}

if (response.status === 401 || response.status === 403) fail(`runner-auth-rejected:${response.status}`);
if (response.status === 404) fail('runner-endpoint-not-found');
if (response.status === 409) {
  console.log(JSON.stringify({ status: 'DEDUPLICATED', http_status: 409, idempotency_key: idempotencyKey }));
  process.exit(0);
}
fail(`runner-http-${response.status}`);
