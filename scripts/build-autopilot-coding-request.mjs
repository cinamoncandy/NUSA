import fs from 'node:fs';
import path from 'node:path';

const [eventPath] = process.argv.slice(2);
if (!eventPath) throw new Error('AUTOPILOT_EVENT_PATH_REQUIRED');

const event = JSON.parse(fs.readFileSync(eventPath, 'utf8'));
const payload = event?.client_payload;
if (!payload || typeof payload !== 'object') throw new Error('AUTOPILOT_CLIENT_PAYLOAD_REQUIRED');

const SHA40 = /^[0-9a-f]{40}$/i;
const allowedKinds = new Set(['REPOSITORY_AUTOPILOT', 'CI_RECOVERY']);

if (!allowedKinds.has(payload.kind)) throw new Error('AUTOPILOT_KIND_NOT_RUNNABLE');
if (payload.repository !== 'cinamoncandy/NUSA') throw new Error('AUTOPILOT_REPOSITORY_NOT_ALLOWED');
if (typeof payload.head_sha !== 'string' || !SHA40.test(payload.head_sha)) throw new Error('AUTOPILOT_HEAD_SHA_INVALID');
if (payload.live_authority !== 'NONE') throw new Error('AUTOPILOT_LIVE_AUTHORITY_DRIFT');
if (payload.production_mutation_allowed !== false) throw new Error('AUTOPILOT_PRODUCTION_MUTATION_DRIFT');
if (payload.ai_authority !== 'ZERO_AUTHORITY') throw new Error('AUTOPILOT_AI_AUTHORITY_DRIFT');

const request = Object.freeze({
  schemaVersion: 1,
  kind: payload.kind,
  repository: payload.repository,
  headSha: payload.head_sha,
  workflowRunId: Number.isSafeInteger(payload.workflow_run_id) ? payload.workflow_run_id : null,
  reason: typeof payload.reason === 'string' ? payload.reason : 'unspecified',
  requestedAction: payload.kind === 'CI_RECOVERY'
    ? 'CLASSIFY_AND_REPAIR_CI_FAILURE'
    : 'DISCOVER_AND_IMPLEMENT_HIGHEST_VALUE_SAFE_REPOSITORY_WORK',
  requiredGates: ['targeted-tests', 'typecheck', 'build', 'lint', 'exact-head-ci'],
  mergePolicy: 'NO_MERGE_WITHOUT_EXACT_HEAD_GREEN',
  liveAuthority: 'NONE',
  productionMutationAllowed: false,
  aiAuthority: 'ZERO_AUTHORITY',
});

const outDir = path.join(process.cwd(), 'artifacts', 'autopilot');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'coding-request.json'), JSON.stringify(request, null, 2) + '\n');
console.log(JSON.stringify(request));
