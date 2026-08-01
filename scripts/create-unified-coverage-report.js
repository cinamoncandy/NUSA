const { existsSync, readFileSync, writeFileSync } = require("node:fs");
const { join, relative } = require("node:path");

const root = process.cwd();
const coverageDirectory = join(root, "coverage");
const sources = [
  join(coverageDirectory, "core", "coverage-final.json"),
  join(coverageDirectory, "ui", "coverage-final.json")
];
const files = {};
for (const source of sources) {
  if (!existsSync(source)) throw new Error(`Missing coverage file: ${relative(root, source)}`);
  const isUiReport = source.includes(`${join("coverage", "ui")}`);
  const entries = Object.entries(JSON.parse(readFileSync(source, "utf8"))).filter(([path, file]) => {
    if (!isUiReport) return true;
    return /apps[\\/]desktop[\\/]renderer/.test(path) && hasCoverageHits(file);
  });
  for (const [path, file] of entries) {
    files[path] = files[path] ? mergeFile(files[path], file) : file;
  }
}

const modules = Object.values(files).map((file) => ({
  path: file.path,
  statements: metric(Object.values(file.s || {})),
  branches: metric(Object.values(file.b || {}).flat()),
  functions: metric(Object.values(file.f || {})),
  lines: lineMetric(file)
}));
const total = aggregate(modules);
const lowest = [...modules]
  .filter((module) => module.statements.total > 0)
  .sort((a, b) => score(a) - score(b) || a.path.localeCompare(b.path))
  .slice(0, 20);
const critical = modules
  .filter((module) => /ledger|account|portfolio|reconcil|recover|risk|offline|session|secure|biometric|trusted|market|strategy|execution|order/i.test(module.path))
  .sort((a, b) => score(a) - score(b) || a.path.localeCompare(b.path));

const summary = {
  generatedAt: new Date().toISOString(),
  sourceFiles: modules.length,
  totals: total,
  threshold: "REPORT_ONLY: no repository coverage threshold is configured",
  lowestModules: lowest,
  criticalPathModules: critical
};
writeFileSync(join(coverageDirectory, "unified-summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
writeFileSync(join(coverageDirectory, "unified-lcov.info"), lcov(), "utf8");
writeFileSync(join(coverageDirectory, "index.html"), html(summary), "utf8");
writeFileSync(join(coverageDirectory, "unified-report.md"), markdown(summary), "utf8");
writeFileSync(join(coverageDirectory, "badge.svg"), badge(summary), "utf8");

function metric(values) {
  const total = values.length;
  const covered = values.filter((value) => value > 0).length;
  return { total, covered, pct: percent(covered, total) };
}

function mergeFile(left, right) {
  const merged = { ...left, s: { ...left.s }, b: { ...left.b }, f: { ...left.f } };
  for (const [key, value] of Object.entries(right.s || {})) merged.s[key] = (merged.s[key] || 0) + value;
  for (const [key, values] of Object.entries(right.b || {})) {
    const current = merged.b[key] || [];
    merged.b[key] = values.map((value, index) => (current[index] || 0) + value);
  }
  for (const [key, value] of Object.entries(right.f || {})) merged.f[key] = (merged.f[key] || 0) + value;
  return merged;
}

function hasCoverageHits(file) {
  return [
    ...Object.values(file.s || {}),
    ...Object.values(file.f || {}),
    ...Object.values(file.b || {}).flat()
  ].some((value) => value > 0);
}

function lineMetric(file) {
  const lines = new Map();
  for (const [id, location] of Object.entries(file.statementMap || {})) {
    const line = location.start.line;
    lines.set(line, Math.max(lines.get(line) || 0, file.s?.[id] || 0));
  }
  return metric([...lines.values()]);
}

function aggregate(entries) {
  return ["statements", "branches", "functions", "lines"].reduce((result, name) => {
    const total = entries.reduce((sum, entry) => sum + entry[name].total, 0);
    const covered = entries.reduce((sum, entry) => sum + entry[name].covered, 0);
    result[name] = { total, covered, pct: percent(covered, total) };
    return result;
  }, {});
}

function score(module) {
  return [module.statements, module.branches, module.functions, module.lines]
    .reduce((sum, item) => sum + item.pct, 0) / 4;
}

function percent(covered, total) {
  return total === 0 ? 100 : Number(((covered / total) * 100).toFixed(2));
}

function markdown(report) {
  const totals = report.totals;
  const rows = report.lowestModules.map((module) => `| ${module.path} | ${module.statements.pct}% | ${module.branches.pct}% | ${module.functions.pct}% | ${module.lines.pct}% |`).join("\n");
  const criticalRows = report.criticalPathModules.map((module) => `| ${module.path} | ${module.statements.pct}% | ${module.branches.pct}% | ${module.functions.pct}% | ${module.lines.pct}% |`).join("\n");
  return `# NUSA Coverage Baseline\n\n![Statements coverage](badge.svg)\n\nGenerated: ${report.generatedAt}\n\nCoverage is report-only. No repository threshold is configured, so no module is classified as failing an invented gate.\n\n## Unified totals\n\n| Metric | Covered | Total | Percent |\n|---|---:|---:|---:|\n| Statements | ${totals.statements.covered} | ${totals.statements.total} | ${totals.statements.pct}% |\n| Branches | ${totals.branches.covered} | ${totals.branches.total} | ${totals.branches.pct}% |\n| Functions | ${totals.functions.covered} | ${totals.functions.total} | ${totals.functions.pct}% |\n| Lines | ${totals.lines.covered} | ${totals.lines.total} | ${totals.lines.pct}% |\n\n## Lowest modules\n\n| Module | Statements | Branches | Functions | Lines |\n|---|---:|---:|---:|---:|\n${rows || "| None | - | - | - | - |"}\n\n## Critical-path modules\n\nThese are repository-backed modules whose paths match accounting, ledger, portfolio, recovery, risk, offline, security, market, strategy, execution, or order responsibilities.\n\n| Module | Statements | Branches | Functions | Lines |\n|---|---:|---:|---:|---:|\n${criticalRows || "| None found in coverage output | - | - | - | - |"}\n\n## Suite scope\n\n- Core isolated tests: Node V8 coverage.\n- Vitest UI tests: Vitest V8 provider.\n- Playwright E2E: executed by the coverage command; Chromium page JavaScript is not instrumented by the current static-server configuration.\n- HTML reports: [core](core/index.html) and [UI](ui/index.html).\n- Combined machine-readable report: [unified-summary.json](unified-summary.json).\n- Generated badge: [badge.svg](badge.svg).\n`;
}

function badge(report) {
  const value = `${report.totals.statements.pct}%`;
  const color = report.totals.statements.pct >= 80 ? "4c1" : report.totals.statements.pct >= 60 ? "dfb317" : "e05d44";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="154" height="20" role="img" aria-label="coverage: ${value}"><title>coverage: ${value}</title><linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient><clipPath id="r"><rect width="154" height="20" rx="3" fill="#fff"/></clipPath><g clip-path="url(#r)"><rect width="86" height="20" fill="#555"/><rect x="86" width="68" height="20" fill="#${color}"/><rect width="154" height="20" fill="url(#s)"/></g><g fill="#fff" text-anchor="middle" font-family="Verdana,DejaVu Sans,sans-serif" font-size="11"><text x="43" y="15" fill="#010101" fill-opacity=".3">coverage</text><text x="43" y="14">coverage</text><text x="120" y="15" fill="#010101" fill-opacity=".3">${value}</text><text x="120" y="14">${value}</text></g></svg>\n`;
}

function html(report) {
  const t = report.totals;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>NUSA Coverage Baseline</title></head><body><h1>NUSA Coverage Baseline</h1><p>Generated ${report.generatedAt}</p><table><tr><th>Metric</th><th>Covered</th><th>Total</th><th>Percent</th></tr>${["statements", "branches", "functions", "lines"].map((name) => `<tr><td>${name}</td><td>${t[name].covered}</td><td>${t[name].total}</td><td>${t[name].pct}%</td></tr>`).join("")}</table><p><a href="core/index.html">Core detailed report</a> | <a href="ui/index.html">UI detailed report</a></p></body></html>`;
}

function lcov() {
  return ["core", "ui"]
    .map((part) => {
      const path = join(coverageDirectory, part, "lcov.info");
      return existsSync(path) ? readFileSync(path, "utf8").trim() : "";
    })
    .filter(Boolean)
    .join("\n") + "\n";
}
