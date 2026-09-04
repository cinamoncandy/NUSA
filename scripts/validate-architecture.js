const { existsSync, readdirSync, readFileSync, writeFileSync } = require("node:fs");
const { join, relative, resolve, dirname, extname } = require("node:path");
const ts = require("typescript");

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".mjs", ".json"]);
const SOURCE_ROOTS = ["apps", "packages"];
const IGNORED_FILE = /(?:\.test|\.spec)\.|\.stories\./;
const IGNORED_DIRECTORY = new Set(["node_modules", "dist", "coverage", "release"]);

function analyzeRepository(root = process.cwd()) {
  const files = sourceFiles(root);
  const nodes = new Set(files.map((file) => relative(root, file).replaceAll("\\", "/")));
  const workspaceOwners = workspacePackageOwners(root);
  const edges = [];
  const unresolved = [];

  for (const file of files) {
    const source = relative(root, file).replaceAll("\\", "/");
    const sourceText = readFileSync(file, "utf8");
    for (const imported of parseImports(sourceText)) {
      if (imported.specifier.startsWith(".")) {
        const target = resolveLocal(file, imported.specifier, nodes, root);
        if (!target) {
          unresolved.push({ source, specifier: imported.specifier });
          continue;
        }
        edges.push({ source, target, kind: imported.typeOnly ? "type" : "runtime" });
        continue;
      }
      const target = resolveWorkspaceOwner(imported.specifier, workspaceOwners);
      if (target) edges.push({ source, target, kind: imported.typeOnly ? "type" : "runtime" });
    }

    for (const imported of parseImportExpressionReferences(sourceText)) {
      if (imported.specifier.startsWith(".")) {
        const target = resolveLocal(file, imported.specifier, nodes, root);
        if (!target) {
          unresolved.push({ source, specifier: imported.specifier });
          continue;
        }
        edges.push({ source, target, kind: imported.typeOnly ? "type" : "runtime", inline: true });
        continue;
      }
      const target = resolveWorkspaceOwner(imported.specifier, workspaceOwners);
      if (target) edges.push({ source, target, kind: imported.typeOnly ? "type" : "runtime", inline: true });
    }
  }

  const findings = [];
  for (const edge of edges) {
    const sourceLayer = layerOf(edge.source);
    const targetLayer = layerOf(edge.target);
    if (sourceLayer === "INFRASTRUCTURE" && targetLayer === "PRESENTATION") {
      findings.push(finding("INFRASTRUCTURE_TO_PRESENTATION", edge, "Infrastructure must not depend on presentation."));
    }
    if (sourceLayer === "DOMAIN" && targetLayer === "INFRASTRUCTURE") {
      findings.push(finding("DOMAIN_TO_INFRASTRUCTURE", edge, "Domain must not depend on infrastructure."));
    }
    if (sourceLayer === "DOMAIN" && targetLayer === "APPLICATION") {
      findings.push(finding("DOMAIN_TO_APPLICATION", edge, "Domain must not depend on application orchestration."));
    }
    if (sourceLayer === "PRESENTATION" && !isMobilePresentationSource(edge.source) && targetLayer !== "APPLICATION") {
      findings.push(finding("PRESENTATION_SHORTCUT", edge, "Presentation may depend only on application-facing contracts."));
    }
    if (edge.kind === "runtime" && edge.source.startsWith("packages/storage/") && edge.target.startsWith("apps/")) {
      findings.push(finding("STORAGE_RUNTIME_APP_REFERENCE", edge, "Storage may consume application ports as types, not application implementations at runtime."));
    }
    if (edge.source.startsWith("apps/execution/") && /^(apps\/(desktop|mobile|cloud)|packages\/storage)\//.test(edge.target)) {
      findings.push(finding("EXECUTION_CROSS_LAYER_REFERENCE", edge, "Execution domain must not depend on desktop, mobile, cloud, or storage implementations."));
    }
    if (edge.source.startsWith("packages/core/") && edge.target.startsWith("packages/aipos/")) {
      findings.push(finding("CORE_TO_AIPOS_REFERENCE", edge, "Stable Core must not depend on AIPOS implementation; AIPOS integrates through Core plugin/runtime contracts."));
    }
    if (edge.source.startsWith("packages/contracts/") && !edge.target.startsWith("packages/contracts/")) {
      findings.push(finding("CONTRACTS_TO_IMPLEMENTATION_REFERENCE", edge, "Shared contracts must remain implementation-free and may depend only on other shared contracts."));
    }
    if (isForbiddenMobilePresentationReference(edge)) {
      findings.push(finding("MOBILE_PRESENTATION_SHORTCUT", edge, "Mobile presentation may consume mobile-local modules and static type-only shared contracts, but not runtime package or cross-app implementations."));
    }
  }

  for (const source of nodes) {
    const sourceLayer = layerOf(source);
    if (sourceLayer === "DOMAIN" && /^(packages\/(contracts|core|aipos))\//.test(source)) {
      for (const edge of edges.filter((item) => item.source === source && item.target.startsWith("apps/"))) {
        findings.push(finding("PACKAGE_DOMAIN_APP_REFERENCE", edge, "Shared domain packages must not import application modules."));
      }
    }
  }

  return {
    files: [...nodes].sort(),
    edges: deduplicate(edges),
    runtimeCycles: cycles(nodes, edges.filter((edge) => edge.kind === "runtime")),
    typeCycles: cycles(nodes, edges),
    unresolved: deduplicate(unresolved),
    findings: deduplicate(findings)
  };
}

function sourceFiles(root) {
  return SOURCE_ROOTS.flatMap((directory) => walk(join(root, directory)))
    .filter((file) => SOURCE_EXTENSIONS.has(extname(file)) && !IGNORED_FILE.test(file));
}

function walk(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory() && IGNORED_DIRECTORY.has(entry.name)) return [];
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

function importClauseIsTypeOnly(clause) {
  if (!clause) return false;
  if (clause.isTypeOnly) return true;
  if (clause.name || !clause.namedBindings || !ts.isNamedImports(clause.namedBindings)) return false;
  return clause.namedBindings.elements.length > 0 && clause.namedBindings.elements.every((element) => element.isTypeOnly);
}

function exportDeclarationIsTypeOnly(node) {
  if (node.isTypeOnly) return true;
  if (!node.exportClause || !ts.isNamedExports(node.exportClause)) return false;
  return node.exportClause.elements.length > 0 && node.exportClause.elements.every((element) => element.isTypeOnly);
}

function parseModuleReferences(source) {
  const sourceFile = ts.createSourceFile("architecture-source.tsx", String(source ?? ""), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const imports = [];
  const importExpressions = [];

  const visit = (node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteralLike(node.moduleSpecifier)) {
      imports.push({ specifier: node.moduleSpecifier.text, typeOnly: importClauseIsTypeOnly(node.importClause) });
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) {
      imports.push({ specifier: node.moduleSpecifier.text, typeOnly: exportDeclarationIsTypeOnly(node) });
    } else if (ts.isImportEqualsDeclaration(node)
      && ts.isExternalModuleReference(node.moduleReference)
      && node.moduleReference.expression
      && ts.isStringLiteralLike(node.moduleReference.expression)) {
      imports.push({ specifier: node.moduleReference.expression.text, typeOnly: Boolean(node.isTypeOnly) });
    } else if (ts.isCallExpression(node) && node.arguments.length > 0 && ts.isStringLiteralLike(node.arguments[0])) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        importExpressions.push({ specifier: node.arguments[0].text, typeOnly: false });
      } else if (ts.isIdentifier(node.expression) && node.expression.text === "require") {
        imports.push({ specifier: node.arguments[0].text, typeOnly: false });
      }
    } else if (ts.isImportTypeNode(node)
      && ts.isLiteralTypeNode(node.argument)
      && ts.isStringLiteralLike(node.argument.literal)) {
      importExpressions.push({ specifier: node.argument.literal.text, typeOnly: true });
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return { imports, importExpressions };
}

function parseImports(source) {
  return parseModuleReferences(source).imports;
}

function parseImportExpressionReferences(source) {
  return parseModuleReferences(source).importExpressions;
}

function parseImportExpressions(source) {
  return parseImportExpressionReferences(source).map((item) => item.specifier);
}

function resolveLocal(file, specifier, nodes, root) {
  const base = resolve(dirname(file), specifier);
  const candidates = [base, ...[".ts", ".tsx", ".js", ".mjs", ".json"].map((extension) => `${base}${extension}`), ...[".ts", ".tsx", ".js", ".mjs", ".json"].map((extension) => join(base, `index${extension}`))];
  return candidates.map((candidate) => relative(root, candidate).replaceAll("\\", "/")).find((candidate) => nodes.has(candidate));
}

function workspacePackageOwners(root) {
  const owners = new Map();
  for (const sourceRoot of SOURCE_ROOTS) {
    const directory = join(root, sourceRoot);
    if (!existsSync(directory)) continue;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const manifestPath = join(directory, entry.name, "package.json");
      if (!existsSync(manifestPath)) continue;
      try {
        const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
        if (typeof manifest.name === "string" && manifest.name.length > 0) {
          owners.set(manifest.name, `${sourceRoot}/${entry.name}/`);
        }
      } catch {
        // Package manifest syntax is validated elsewhere; architecture scanning skips invalid manifests here.
      }
    }
  }
  return owners;
}

function resolveWorkspaceOwner(specifier, owners) {
  for (const [packageName, owner] of owners) {
    if (specifier === packageName || specifier.startsWith(`${packageName}/`)) return owner;
  }
  return undefined;
}

function isMobilePresentationSource(file) {
  return file === "apps/mobile/App.tsx" || (file.startsWith("apps/mobile/") && file.endsWith(".tsx"));
}

function isForbiddenMobilePresentationReference(edge) {
  if (!isMobilePresentationSource(edge.source)) return false;
  if (edge.target.startsWith("apps/mobile/")) return false;
  if (edge.kind === "type" && !edge.inline && edge.target.startsWith("packages/contracts/")) return false;
  return /^(apps|packages)\//.test(edge.target);
}

function layerOf(file) {
  if (file.startsWith("apps/desktop/renderer/") || isMobilePresentationSource(file)) return "PRESENTATION";
  if (file.startsWith("packages/storage/")) return "INFRASTRUCTURE";
  if (file.startsWith("packages/") || file.startsWith("apps/execution/")) return "DOMAIN";
  if (file.startsWith("apps/")) return "APPLICATION";
  return "UNKNOWN";
}

function cycles(nodes, graphEdges) {
  const adjacency = new Map([...nodes].map((node) => [node, []]));
  for (const edge of graphEdges) adjacency.get(edge.source)?.push(edge.target);
  const found = new Set();
  const stack = [];
  const active = new Set();
  const visit = (node) => {
    if (active.has(node)) {
      const cycle = stack.slice(stack.indexOf(node)).concat(node);
      const normalized = normalizeCycle(cycle);
      found.add(normalized.join(" -> "));
      return;
    }
    if (stack.includes(node)) return;
    active.add(node);
    stack.push(node);
    for (const target of adjacency.get(node) || []) visit(target);
    stack.pop();
    active.delete(node);
  };
  for (const node of nodes) visit(node);
  return [...found].map((value) => value.split(" -> "));
}

function normalizeCycle(cycle) {
  const body = cycle.slice(0, -1);
  let best = body;
  for (let index = 1; index < body.length; index += 1) {
    const rotated = body.slice(index).concat(body.slice(0, index));
    if (rotated.join("\n") < best.join("\n")) best = rotated;
  }
  return best.concat(best[0]);
}

function finding(rule, edge, message) {
  return { rule, source: edge.source, target: edge.target, kind: edge.kind, message };
}

function deduplicate(items) {
  return [...new Map(items.map((item) => [JSON.stringify(item), item])).values()];
}

function reportDate() {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
}

function writeReports(root, result) {
  const date = reportDate();
  const reportDirectory = join(root, "docs", "audits");
  const edgeRows = result.edges.map((edge) => `| ${edge.kind} | ${edge.source} | ${edge.target} |`).join("\n");
  const findingRows = result.findings.map((item) => `| ${item.rule} | ${item.kind} | ${item.source} | ${item.target} | ${item.message} |`).join("\n");
  const cycleRows = (cyclesList) => cyclesList.map((cycle) => `| ${cycle.join(" -> ")} |`).join("\n");
  writeFileSync(join(reportDirectory, `architecture-compliance-${date}.md`), `# NUSA Architecture Compliance Report\n\nAudited: ${date}\n\n- Source files: ${result.files.length}\n- Runtime edges: ${result.edges.filter((edge) => edge.kind === "runtime").length}\n- Type-only edges: ${result.edges.filter((edge) => edge.kind === "type").length}\n- Runtime cycles: ${result.runtimeCycles.length}\n- Type cycles: ${result.typeCycles.length}\n- Layer/forbidden findings: ${result.findings.length}\n\n## Verdict\n\n${result.findings.length === 0 && result.runtimeCycles.length === 0 ? "PASS" : "FAIL"}\n\nType-only cycles are reported separately because they do not create emitted JavaScript cycles; they remain architecture debt until removed.\n`);
  writeFileSync(join(reportDirectory, `dependency-graph-${date}.md`), `# NUSA Dependency Graph Report\n\nAudited: ${date}\n\n| Kind | Source | Target |\n|---|---|---|\n${edgeRows}\n`);
  writeFileSync(join(reportDirectory, `layer-violations-${date}.md`), `# NUSA Layer Violation Report\n\nAudited: ${date}\n\n| Rule | Kind | Source | Target | Message |\n|---|---|---|---|---|\n${findingRows || "| None | - | - | - | No forbidden layer references found |"}\n`);
  writeFileSync(join(reportDirectory, `circular-dependencies-${date}.md`), `# NUSA Circular Dependency Report\n\nAudited: ${date}\n\n## Runtime cycles\n\n| Cycle |\n|---|\n${cycleRows(result.runtimeCycles) || "| None |"}\n\n## Type-only cycles\n\n| Cycle |\n|---|\n${cycleRows(result.typeCycles) || "| None |"}\n`);
}

if (require.main === module) {
  const result = analyzeRepository();
  writeReports(process.cwd(), result);
  console.log(`Architecture files=${result.files.length} runtimeEdges=${result.edges.filter((edge) => edge.kind === "runtime").length} typeEdges=${result.edges.filter((edge) => edge.kind === "type").length} runtimeCycles=${result.runtimeCycles.length} typeCycles=${result.typeCycles.length} findings=${result.findings.length}`);
  if (result.unresolved.length > 0) {
    console.error(`Architecture validation found ${result.unresolved.length} unresolved local imports.`);
    process.exit(1);
  }
  if (result.runtimeCycles.length > 0) {
    for (const cycle of result.runtimeCycles) console.error(`Runtime cycle: ${cycle.join(" -> ")}`);
  }
  if (result.findings.length > 0) {
    for (const item of result.findings) console.error(`${item.rule}: ${item.source} -> ${item.target} (${item.kind})`);
  }
  if (result.runtimeCycles.length > 0 || result.findings.length > 0) process.exit(1);
}

module.exports = { analyzeRepository, layerOf, parseImports, parseImportExpressions, resolveWorkspaceOwner, workspacePackageOwners };
