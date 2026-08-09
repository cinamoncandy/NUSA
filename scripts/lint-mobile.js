const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const MOBILE_ROOT = path.join("apps", "mobile");
const DESIGN_TOKEN_FILE = path.join(MOBILE_ROOT, "src", "designSystem.ts").replaceAll("\\", "/");
const RAW_HEX = /^#[0-9a-fA-F]{3,8}$/;
const CONSOLE_METHODS = new Set(["log", "debug", "info", "warn", "error"]);

function collectMobileFiles(repositoryRoot) {
  const mobileRoot = path.join(repositoryRoot, MOBILE_ROOT);
  const files = [];
  const app = path.join(mobileRoot, "App.tsx");
  if (fs.existsSync(app)) files.push(app);

  const srcRoot = path.join(mobileRoot, "src");
  if (fs.existsSync(srcRoot)) walk(srcRoot, files);
  return files.sort();
}

function walk(directory, files) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      walk(absolute, files);
      continue;
    }
    if (entry.isFile() && /\.(?:ts|tsx)$/.test(entry.name)) files.push(absolute);
  }
}

function lintSource(fileName, sourceText) {
  const normalizedFile = fileName.replaceAll("\\", "/");
  const scriptKind = normalizedFile.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true, scriptKind);
  const violations = [];

  for (const diagnostic of sourceFile.parseDiagnostics ?? []) {
    violations.push(makeViolation(sourceFile, diagnostic.start ?? 0, "syntax", ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")));
  }

  const tsIgnore = /@ts-ignore\b/g;
  for (let match = tsIgnore.exec(sourceText); match; match = tsIgnore.exec(sourceText)) {
    violations.push(makeViolation(sourceFile, match.index, "no-ts-ignore", "Use a typed fix or @ts-expect-error with a documented expectation instead of @ts-ignore."));
  }

  function visit(node) {
    if (node.kind === ts.SyntaxKind.AnyKeyword) {
      violations.push(makeViolation(sourceFile, node.getStart(sourceFile), "no-explicit-any", "Use an explicit domain type or unknown instead of any."));
    }
    if (node.kind === ts.SyntaxKind.DebuggerStatement) {
      violations.push(makeViolation(sourceFile, node.getStart(sourceFile), "no-debugger", "Remove debugger statements from mobile production code."));
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const target = node.expression.expression;
      const method = node.expression.name.text;
      if (ts.isIdentifier(target) && target.text === "console" && CONSOLE_METHODS.has(method)) {
        violations.push(makeViolation(sourceFile, node.getStart(sourceFile), "no-console", `Remove console.${method} from mobile production code.`));
      }
    }
    if (ts.isStringLiteralLike(node) && RAW_HEX.test(node.text) && !normalizedFile.endsWith(DESIGN_TOKEN_FILE)) {
      violations.push(makeViolation(sourceFile, node.getStart(sourceFile), "design-token-color", "Use the mobile design-system color tokens instead of a raw hex literal."));
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return violations;
}

function makeViolation(sourceFile, position, rule, message) {
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(position);
  return Object.freeze({ line: line + 1, column: character + 1, rule, message });
}

function lintMobileRepository(repositoryRoot = path.join(__dirname, "..")) {
  const files = collectMobileFiles(repositoryRoot);
  const violations = [];
  for (const file of files) {
    const relative = path.relative(repositoryRoot, file).replaceAll("\\", "/");
    const source = fs.readFileSync(file, "utf8");
    for (const violation of lintSource(relative, source)) violations.push({ file: relative, ...violation });
  }
  return Object.freeze({ files: Object.freeze(files.map((file) => path.relative(repositoryRoot, file).replaceAll("\\", "/"))), violations: Object.freeze(violations) });
}

if (require.main === module) {
  const result = lintMobileRepository();
  if (result.violations.length > 0) {
    for (const violation of result.violations) {
      process.stderr.write(`${violation.file}:${violation.line}:${violation.column} [${violation.rule}] ${violation.message}\n`);
    }
    process.stderr.write(`Mobile lint FAIL (${result.violations.length} violation(s) across ${result.files.length} file(s))\n`);
    process.exit(1);
  }
  process.stdout.write(`Mobile lint PASS (${result.files.length} file(s))\n`);
}

module.exports = { collectMobileFiles, lintSource, lintMobileRepository };
