"use strict";

// Coverage floor gate for the unified baseline produced by
// `node scripts/run-coverage.js` (see coverage/unified-summary.json).
// Compares unified totals AND the critical-path aggregate against
// config/coverage/floors.json and fails closed on breach. Run after the
// merge step:
//
//   node scripts/check-coverage-floor.js
//   node scripts/check-coverage-floor.js --summary <absolute-summary.json>
//   node scripts/check-coverage-floor.js --floors <absolute-floors.json> --summary <absolute-summary.json>
//
// Totals catch broad regressions; the critical aggregate (ledger, accounting,
// portfolio, recovery, risk, market, strategy, execution, order modules)
// catches targeted erosion in safety-relevant code that totals would hide.
// Per-module floors are deliberately absent: they would turn every new file
// into a gate change. Module-level regressions remain visible in
// unified-report.md (lowest/critical-path tables).
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const floorsPath = path.join(root, "config", "coverage", "floors.json");
const defaultSummaryPath = path.join(root, "coverage", "unified-summary.json");

function summaryPathFromArgs(argv) {
  const flag = argv.indexOf("--summary");
  if (flag >= 0 && argv[flag + 1]) return path.resolve(argv[flag + 1]);
  return defaultSummaryPath;
}

function floorsPathFromArgs(argv) {
  const flag = argv.indexOf("--floors");
  if (flag >= 0 && argv[flag + 1]) return path.resolve(argv[flag + 1]);
  return floorsPath;
}

function main() {
  const summaryPath = summaryPathFromArgs(process.argv.slice(2));
  const activeFloorsPath = floorsPathFromArgs(process.argv.slice(2));
  if (!fs.existsSync(activeFloorsPath)) {
    console.error(`COVERAGE_FLOOR_GATE CONFIG_MISSING: ${path.relative(root, activeFloorsPath)}`);
    process.exit(2);
  }
  if (!fs.existsSync(summaryPath)) {
    console.error(`COVERAGE_FLOOR_GATE SUMMARY_MISSING: ${path.relative(root, summaryPath)} (run pnpm coverage first)`);
    process.exit(2);
  }
  const config = JSON.parse(fs.readFileSync(activeFloorsPath, "utf8"));
  const summary = JSON.parse(fs.readFileSync(summaryPath, "utf8"));
  const totals = summary.totals;
  const metrics = ["statements", "branches", "functions", "lines"];
  const failures = [];
  for (const name of metrics) {
    const floor = Number(config.floors?.[name]);
    const actual = Number(totals?.[name]?.pct);
    if (!Number.isFinite(floor) || !Number.isFinite(actual)) {
      failures.push(`${name}: non-numeric floor (${config.floors?.[name]}) or actual (${totals?.[name]?.pct})`);
      continue;
    }
    if (actual < floor) failures.push(`${name}: ${actual}% < floor ${floor}%`);
  }
  const critical = aggregateCritical(summary.criticalPathModules);
  if (!critical) {
    failures.push("critical: summary has no criticalPathModules array (regenerate with pnpm coverage)");
  } else {
    for (const name of metrics) {
      const floor = Number(config.criticalFloors?.[name]);
      const actual = Number(critical[name]?.pct);
      if (!Number.isFinite(floor) || !Number.isFinite(actual)) {
        failures.push(`critical.${name}: non-numeric floor or actual`);
        continue;
      }
      if (actual < floor) failures.push(`critical.${name}: ${actual}% < floor ${floor}%`);
    }
  }
  const moduleEntries = Array.isArray(config.moduleFloors) ? config.moduleFloors : [];
  const moduleFailures = checkModuleFloors(summary, moduleEntries);
  failures.push(...moduleFailures);
  if (failures.length > 0) {
    console.error(`COVERAGE_FLOOR_GATE FAIL\n${failures.join("\n")}`);
    process.exit(1);
  }
  const actuals = metrics.map((name) => `${name}=${totals[name].pct}%`).join(" ");
  const criticalActuals = metrics.map((name) => `${name}=${critical[name].pct}%`).join(" ");
  console.log(`COVERAGE_FLOOR_GATE PASS (totals ${actuals}; critical ${criticalActuals}; modules ${moduleEntries.length} pinned)`);
}

function normalizeModulePath(value) {
  return String(value ?? "").replace(/\\/g, "/");
}

// Per-module floors for a pinned list of safety-critical modules. Each entry
// must match exactly one summary module (matched as a path suffix substring);
// zero or multiple matches fail explicitly so renames and collisions force a
// floors update instead of silently passing or checking the wrong file.
function checkModuleFloors(summary, entries) {
  const failures = [];
  const modules = [...(summary.criticalPathModules ?? []), ...(summary.lowestModules ?? [])];
  const seen = new Set();
  for (const entry of entries) {
    const match = normalizeModulePath(entry.match);
    const hits = modules.filter((module) => normalizeModulePath(module.path).includes(match));
    const unique = hits.filter((module) => !seen.has(normalizeModulePath(module.path)));
    if (hits.length === 0) {
      failures.push(`module ${match}: no summary module matched (stale floors entry?)`);
      continue;
    }
    if (unique.length === 0) {
      failures.push(`module ${match}: already pinned by an earlier entry (duplicate floors entry?)`);
      continue;
    }
    if (unique.length > 1) {
      failures.push(`module ${match}: ambiguous, matched ${unique.length} modules (narrow the match)`);
      continue;
    }
    const module = unique[0];
    seen.add(normalizeModulePath(module.path));
    for (const name of ["lines", "branches"]) {
      const floor = Number(entry[name]);
      const actual = Number(module?.[name]?.pct);
      if (!Number.isFinite(floor) || !Number.isFinite(actual)) {
        failures.push(`module ${match} ${name}: non-numeric floor or actual`);
        continue;
      }
      if (actual < floor) failures.push(`module ${match} ${name}: ${actual}% < floor ${floor}%`);
    }
  }
  return failures;
}

function aggregateCritical(modules) {
  if (!Array.isArray(modules)) return null;
  const result = {};
  for (const name of ["statements", "branches", "functions", "lines"]) {
    let total = 0;
    let covered = 0;
    for (const module of modules) {
      total += Number(module?.[name]?.total ?? 0);
      covered += Number(module?.[name]?.covered ?? 0);
    }
    result[name] = { total, covered, pct: total === 0 ? 100 : Number(((covered / total) * 100).toFixed(2)) };
  }
  return result;
}

main();
