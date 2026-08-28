import fs from 'node:fs';

const [inputPath] = process.argv.slice(2);
if (!inputPath) {
  console.error('usage: node scripts/evaluate-engineering-outcome.mjs <outcome-evidence.json>');
  process.exit(2);
}

function fail(reason) {
  console.error(reason);
  process.exit(1);
}

let input;
try {
  input = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
} catch {
  fail('outcome-evidence-json-invalid');
}

const allowedDirections = new Set(['LOWER_IS_BETTER', 'HIGHER_IS_BETTER']);
if (input.schemaVersion !== 1) fail('outcome-evidence-schema-version-invalid');
if (input.liveAuthority !== 'NONE') fail('outcome-evidence-live-authority-drift');
if (input.productionMutationAllowed !== false) fail('outcome-evidence-production-mutation-drift');
if (input.aiAuthority !== 'ZERO_AUTHORITY') fail('outcome-evidence-ai-authority-drift');
if (typeof input.metric !== 'string' || !input.metric.trim()) fail('outcome-evidence-metric-invalid');
if (!allowedDirections.has(input.direction)) fail('outcome-evidence-direction-invalid');

const baseline = input.baseline ?? {};
const postMerge = input.postMerge ?? {};
const evidenceComplete =
  baseline.source === 'GITHUB' &&
  postMerge.source === 'GITHUB' &&
  typeof baseline.evidenceRef === 'string' && baseline.evidenceRef.length > 0 &&
  typeof postMerge.evidenceRef === 'string' && postMerge.evidenceRef.length > 0 &&
  Number.isFinite(baseline.value) && Number.isFinite(postMerge.value);

let classification = 'INSUFFICIENT';
let delta = null;
let recommendation = 'COLLECT_EVIDENCE';

if (evidenceComplete) {
  delta = postMerge.value - baseline.value;
  const tolerance = Number.isFinite(input.neutralTolerance) && input.neutralTolerance >= 0
    ? input.neutralTolerance
    : 0;
  const signedImprovement = input.direction === 'LOWER_IS_BETTER' ? -delta : delta;

  if (signedImprovement > tolerance) {
    classification = 'VERIFIED_IMPROVEMENT';
    recommendation = 'KEEP';
  } else if (signedImprovement < -tolerance) {
    classification = 'REGRESSION';
    recommendation = 'REWORK_OR_ROLLBACK';
  } else {
    classification = 'NEUTRAL';
    recommendation = 'KEEP_OR_REPRIORITIZE';
  }
}

const output = {
  schemaVersion: 1,
  metric: input.metric,
  direction: input.direction,
  classification,
  baseline: evidenceComplete ? baseline : null,
  postMerge: evidenceComplete ? postMerge : null,
  delta,
  recommendation,
  evidenceComplete,
  liveAuthority: 'NONE',
  productionMutationAllowed: false,
  aiAuthority: 'ZERO_AUTHORITY',
};

console.log(JSON.stringify(output));
