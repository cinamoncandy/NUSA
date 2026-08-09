const { existsSync, readdirSync, readFileSync, writeFileSync } = require("node:fs");
const { join, relative, resolve, dirname, extname } = require("node:path");

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".mjs", ".json"]);
const SOURCE_ROOTS = ["apps", "packages"];
const IGNORED_FILE = /(?:\.test|\.spec)\.|\.stories\./;
const IGNORED_DIRECTORY = new Set(["node_modules", "dist", "coverage", "release"]);

function analyzeRepository(root = process.cwd()) {
  const files = sourceFiles(root);
  const nodes = new Set(files.map((file) => relative(root, file).replaceAll("\\", "/")));
  const edges = [];
  const boundaryReferences = [];
  const unresolved = [];

  for (const file of files) {
    const source = relative(root, file).replaceAll("\\", "/");
    const sourceText = readFileSync(file, "utf8");
    for (const imported of parseImports(sourceText)) {
      if (!imported.specifier.startsWith(".")) continue;
      const target = resolveLocal(file, imported.specifier, nodes, root);
      if (!target) {
        unresolved.push({ source, specifier: imported.specifier });
        continue;
      }
      edges.push({ source, target, kind: imported.typeOnly ? "type" : "runtime" });
    }
    if (source.startsWith("packages/core/") || source.startsWith("packages/contracts/") || isMobilePresentationSource(source)) {
      for (const specifier of parseImportExpressions(sourceText)) {
        if (!specifier.startsWith(".")) continue;
        const target = resolveLocal(file, specifier, nodes, root);
        if (!target) {
          unresolved.push({ source, specifier });
          continue;
        }
        boundaryReferences.push({ source, target, kind: "inline-import" });
      }
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
    if (sourceLayer === "PRESENTATION" && targetLayer !== "APPLICATION") {
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
    if (isMobilePresentationSource(edge.source) && /^(apps|packages)\//.test(edge.target) && !edge.target.startsWith("apps/mobile/")) {
      findings.push(finding("MOBILE_PRESENTATION_SHORTCUT", edge, "Mobile presentation must consume mobile-local application/view-model modules instead of package or cross-app implementations."));
    }
  }

  for (const edge of boundaryReferences) {
    if (edge.source.startsWith("packages/core/") && edge.target.startsWith("packages/aipos/")) {
      findings.push(finding("CORE_TO_AIPOS_REFERENCE", edge, "Stable Core must not depend on AIPOS implementation; AIPOS integrates through Core plugin/runtime contracts."));
    }
    if (edge.source.startsWith("packages/contracts/") && !edge.target.startsWith("packages/contracts/")) {
      findings.push(finding("CONTRACTS_TO_IMPLEMENTATION_REFERENCE", edge, "Shared contracts must remain implementation-free and may depend only on other shared contracts."));
    }
    if (isMobilePresentationSource(edge.source) && /^(apps|packages)\//.test(edge.target) && !edge.target.startsWith("apps/mobile/")) {
      findings.push(finding("MOBILE_PRESENTATION_SHORTCUT", edge, "Mobile presentation must consume mobile-local application/view-model modules instead of package or cross-app implementations."));
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

function parseImports(source) {
  const imports = [];
  const patterns = [
    /\bimport\s+(type\s+)?[\s\S]*?\sfrom\s*["']([^"']+)["']/g,
    /\bexport\s+(type\s+)?[\s\S]*?\sfrom\s*["']([^"']+)["']/g,
    /\brequire\(\s*["']([^"']+)["']\s*\)/g
  ];
  for (const [index, pattern] of patterns.entries()) {
    for (const match of source.matchAll(pattern)) {
      imports.push({
        specifier: index === 2 ? match[1] : match[2],
        typeOnly: index !== 2 && /^\s*(?:import|export)\s+type\b/.test(match[0])
      });
    }
  }
  return imports;
}

function parseImportExpressions(source) {
  return [...source.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)].map((match) => match[1]);
}

function resolveLocal(file, specifier, nodes, root) {
  const base = resolve(dirname(file), specifier);
  const candidates = [base, ...[".ts", ".tsx", ".js", ".mjs", ".json"].map((extension) => `${base}${extension}`), ...[".ts", ".tsx", ".js", ".mjs", ".json"].map((extension) => join(base, `index${extension}`))];
  return candidates.map((candidate) => relative(root, candidate).replaceAll("\\", "/")).find((candidate) => nodes.has(candidate));
}

function isMobilePresentationSource(file) {
  return file === "apps/mobile/App.tsx" || (file.startsWith("apps/mobile/") && file.endsWith(".tsx"));
}

function layerOf(file) {
  if (file.startsWith("apps/desktop/renderer/")) return "PRESENTATION";
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

module.exports = { analyzeRepository, isMobilePresentationSource, layerOf, parseImports, parseImportExpressions };
