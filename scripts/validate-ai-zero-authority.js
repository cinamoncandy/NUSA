const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const aiRoot = path.join(root, 'apps', 'cloud', 'src', 'ai');
const files = fs.existsSync(aiRoot)
  ? fs.readdirSync(aiRoot).filter((name) => name.endsWith('.ts')).sort()
  : [];

if (files.length === 0) {
  throw new Error('AI_ZERO_AUTHORITY_GUARD: no AI runtime files found');
}

const source = files.map((name) => ({
  name,
  text: fs.readFileSync(path.join(aiRoot, name), 'utf8'),
}));
const violations = [];

for (const { name, text } of source) {
  if (/from ['"].*(?:paperBroker|runtimeCommandService|execution).*["']/.test(text)) {
    violations.push(`${name}: AI runtime imports an execution surface`);
  }
  if (/\b(?:PaperBroker|submitOrder|cancelOrder|replaceOrder|withdraw)\s*\(/.test(text)) {
    violations.push(`${name}: AI runtime contains a mutation invocation`);
  }
  if (/productionMutationAllowed\s*:\s*true|realOrderAuthority\s*:\s*true|realTransferAuthority\s*:\s*true/.test(text)) {
    violations.push(`${name}: AI runtime enables a prohibited authority`);
  }
}

const orchestrator = source.find(({ name }) => name === 'multiAgentOrchestrator.ts');
if (!orchestrator || !/evaluateMultiAgentDecision/.test(orchestrator.text)) {
  violations.push('multiAgentOrchestrator.ts: deterministic governance decision is not required');
}

const runtime = source.find(({ name }) => name === 'runtime.ts');
if (!runtime || !/NUSA_AI_ENABLED/.test(runtime.text)) {
  violations.push('runtime.ts: AI default-off environment boundary is missing');
}

if (violations.length > 0) {
  console.error(violations.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`AI_ZERO_AUTHORITY_GUARD PASS (${files.length} files; mutation authority absent)`);
}
