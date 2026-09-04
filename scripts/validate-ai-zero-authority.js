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

// Trading execution surfaces only. Autopilot's own coding-execution files
// (executionCoordinator, executionTelemetry, codingExecutionEvidence, ...)
// are out of scope here and covered by sandboxPatchValidator instead.
const EXECUTION_SURFACE_PATTERN = /paperBroker|runtimeCommandService|liveOrderAdapter|tradingAdapter|upbit.*order/i;

let ts = null;
try {
  ts = require('typescript');
} catch {
  ts = null;
}

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

// AST-based module-reference detection. Unlike the previous regex, comments
// and string literals cannot trigger it, while `export ... from`, dynamic
// `import()`, and `require()` are all covered. Files that fail to parse fall
// back to the regex so a syntax error can never silently bypass the guard.
function astExecutionReferences(text, fileName) {
  const references = [];
  if (!ts) return { references, parsed: false };
  let sourceFile;
  try {
    sourceFile = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  } catch {
    return { references, parsed: false };
  }
  if (sourceFile.parseDiagnostics && sourceFile.parseDiagnostics.length > 0) {
    return { references, parsed: false };
  }
  function specifierOf(node) {
    return node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)
      ? node.moduleSpecifier.text
      : null;
  }
  function visit(node) {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      const specifier = specifierOf(node);
      if (specifier && EXECUTION_SURFACE_PATTERN.test(specifier)) references.push(specifier);
    } else if (ts.isCallExpression(node)) {
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire =
        ts.isIdentifier(node.expression) && node.expression.text === 'require';
      if ((isDynamicImport || isRequire) && node.arguments.length === 1) {
        const first = node.arguments[0];
        if (ts.isStringLiteralLike(first) && EXECUTION_SURFACE_PATTERN.test(first.text)) {
          references.push(first.text);
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return { references, parsed: true };
}

function regexExecutionReferences(text) {
  const references = [];
  const staticImport = /from ['"]([^'"]*)["']/g;
  const dynamicImport = /(?:import\s*\(|require\s*\()\s*['"]([^'"]*)['"]/g;
  let match;
  while ((match = staticImport.exec(text)) !== null) {
    if (EXECUTION_SURFACE_PATTERN.test(match[1])) references.push(match[1]);
  }
  while ((match = dynamicImport.exec(text)) !== null) {
    if (EXECUTION_SURFACE_PATTERN.test(match[1])) references.push(match[1]);
  }
  return references;
}

const files = scanRoots.flatMap(collectTsFiles);

if (files.length === 0) {
  throw new Error('AI_ZERO_AUTHORITY_GUARD: no AI runtime files found');
}

// Meta-guard: any *new* AI directory outside the scanned roots fails closed
// instead of silently escaping the guard. `packages/aipos` (continuity
// contract, not AI runtime) is intentionally not an `ai` directory.
const coveredRoots = scanRoots.map((dir) => dir + path.sep);
const uncoveredAiDirs = [];
function collectUncoveredAiDirs(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist') continue;
    const full = path.join(dir, entry.name);
    if (entry.name.toLowerCase() === 'ai' && !coveredRoots.some((covered) => (full + path.sep).startsWith(covered))) {
      uncoveredAiDirs.push(path.relative(root, full).replace(/\\/g, '/'));
    }
    collectUncoveredAiDirs(full);
  }
}
for (const top of ['apps', 'packages', 'services']) collectUncoveredAiDirs(path.join(root, top));
const source = files.map((full) => ({
  name: path.relative(root, full).replace(/\\/g, '/'),
  text: fs.readFileSync(full, 'utf8'),
}));
const violations = [];
for (const dir of uncoveredAiDirs.sort()) {
  violations.push(`${dir}: AI directory outside guard scan roots (register it in scanRoots or justify the exclusion)`);
}
let astParsed = 0;
let regexFallback = 0;

for (const { name, text } of source) {
  const ast = astExecutionReferences(text, name);
  let references;
  if (ast.parsed) {
    astParsed += 1;
    references = ast.references;
  } else {
    regexFallback += 1;
    references = regexExecutionReferences(text);
  }
  for (const specifier of references) {
    violations.push(`${name}: AI runtime references an execution surface (${specifier})`);
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
  const engine = ts ? `typescript-ast (${astParsed} parsed, ${regexFallback} regex-fallback)` : 'regex-only (typescript unavailable)';
  console.log(`AI_ZERO_AUTHORITY_GUARD PASS (${files.length} files across ${scanRoots.length} roots via ${engine}; mutation authority absent)`);
}
