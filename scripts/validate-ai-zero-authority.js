const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
// Scan all AI/automation surfaces recursively (cloud + desktop + autopilot).
// Test fixtures (*.test.ts) and type declarations (*.d.ts) are excluded.
const scanRoots = [
  path.join(root, 'apps', 'cloud', 'src', 'ai'),
  path.join(root, 'apps', 'desktop', 'src', 'ai'),
  path.join(root, 'apps', 'autopilot', 'src'),
];

function collectTsFiles(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectTsFiles(full));
    } else if (
      entry.isFile() &&
      entry.name.endsWith('.ts') &&
      !entry.name.endsWith('.test.ts') &&
      !entry.name.endsWith('.d.ts')
    ) {
      out.push(full);
    }
  }
  return out.sort();
}

const files = scanRoots.flatMap(collectTsFiles);

if (files.length === 0) {
  throw new Error('AI_ZERO_AUTHORITY_GUARD: no AI runtime files found');
}

const source = files.map((full) => ({
  name: path.relative(root, full).replace(/\\/g, '/'),
  text: fs.readFileSync(full, 'utf8'),
}));
const violations = [];

for (const { name, text } of source) {
  // Trading execution surfaces only. Autopilot's own coding-execution files
  // (executionCoordinator, executionTelemetry, codingExecutionEvidence, ...)
  // are out of scope here and covered by sandboxPatchValidator instead.
  if (/from ['"].*(?:paperBroker|runtimeCommandService|liveOrderAdapter|tradingAdapter|upbit.*order).*["']/.test(text)) {
    violations.push(`${name}: AI runtime imports an execution surface`);
  }
  // Dynamic import() / require() of trading execution surfaces.
  if (/(?:import\s*\(|require\s*\()\s*['"][^'"]*(?:paperBroker|runtimeCommandService|liveOrderAdapter|tradingAdapter)[^'"]*['"]/.test(text)) {
    violations.push(`${name}: AI runtime dynamically loads an execution surface`);
  }
  if (/\b(?:PaperBroker|submitOrder|cancelOrder|replaceOrder|withdraw|activateLive|dialBroker)\s*\(/.test(text)) {
    violations.push(`${name}: AI runtime contains a mutation invocation`);
  }
  if (/productionMutationAllowed\s*:\s*true|realOrderAuthority\s*:\s*true|realTransferAuthority\s*:\s*true/.test(text)) {
    violations.push(`${name}: AI runtime enables a prohibited authority`);
  }
  // BOUNDED_LIVE must never appear inside AI/automation surfaces; it belongs
  // to dormant governance-only scaffolding outside these directories.
  if (/liveAuthority\s*:\s*['"]BOUNDED_LIVE['"]/.test(text)) {
    violations.push(`${name}: AI surface references BOUNDED_LIVE authority`);
  }
}

const orchestrator = source.find(({ name }) => name === 'apps/cloud/src/ai/multiAgentOrchestrator.ts');
if (!orchestrator || !/evaluateMultiAgentDecision/.test(orchestrator.text)) {
  violations.push('multiAgentOrchestrator.ts: deterministic governance decision is not required');
}

const runtime = source.find(({ name }) => name === 'apps/cloud/src/ai/runtime.ts');
if (!runtime || !/NUSA_AI_ENABLED/.test(runtime.text)) {
  violations.push('runtime.ts: AI default-off environment boundary is missing');
}

if (violations.length > 0) {
  console.error(violations.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`AI_ZERO_AUTHORITY_GUARD PASS (${files.length} files across ${scanRoots.length} roots; mutation authority absent)`);
}
