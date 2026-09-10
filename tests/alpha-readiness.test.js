"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { join } = require("node:path");

const { ALPHA_READINESS, blockersForPromotion, isPromotable } = require("../dist/apps/cloud/src/alpha/alphaReadiness.js");
const { UPBIT_MAJOR_HORIZON_FLOOR_HOURS } = require("../dist/apps/cloud/src/alpha/horizonViability.js");

const ROOT = join(__dirname, "..");

/**
 * Three alphas here carry tests, freeze steps and registry entries while none of them trades,
 * each for a different reason that took reading the import graph by hand to find. These check
 * the declared reason against the source, so the next one announces itself.
 */

/** Callers of a symbol outside its own directory. A module calling itself proves nothing. */
function externalCallers(symbol, homePath) {
  let output = "";
  try {
    output = execFileSync("grep", ["-rn", "--include=*.ts", "--include=*.tsx", symbol, "apps", "packages", "scripts"], { cwd: ROOT, encoding: "utf8" });
  } catch { return []; }
  return output.split("\n").filter((line) => {
    if (!line.trim()) return false;
    const path = line.slice(0, line.indexOf(":"));
    if (path.startsWith(homePath)) return false;
    if (path.includes(".test.")) return false;
    // The readiness declaration names each symbol as a string. Naming is not calling.
    if (path.endsWith("alpha/alphaReadiness.ts")) return false;
    // Its own declaration and re-exports are not callers.
    return !/export (function|const|interface|type)/.test(line);
  });
}

test("every alpha carries evidence for the status it claims", () => {
  assert.ok(ALPHA_READINESS.length > 0);
  for (const alpha of ALPHA_READINESS) {
    assert.ok(alpha.evidence.trim().length > 0, `${alpha.alphaId} asserts a status with no evidence`);
    assert.ok(alpha.typicalHorizonHours > 0, alpha.alphaId);
  }
});

test("a claim of SELF_CONTAINED is checked against the source, not trusted", () => {
  for (const alpha of ALPHA_READINESS.filter((entry) => entry.wiring === "SELF_CONTAINED")) {
    const callers = externalCallers(alpha.entryPointSymbol, alpha.homePath);
    assert.deepEqual(callers, [], `${alpha.alphaId} is declared SELF_CONTAINED but is called from:\n${callers.join("\n")}`);
  }
});

test("a claim of IN_EXECUTION_PATH is checked the same way", () => {
  for (const alpha of ALPHA_READINESS.filter((entry) => entry.wiring === "IN_EXECUTION_PATH")) {
    const callers = externalCallers(alpha.entryPointSymbol, alpha.homePath);
    assert.ok(callers.length > 0, `${alpha.alphaId} is declared IN_EXECUTION_PATH but nothing outside ${alpha.homePath} calls ${alpha.entryPointSymbol}`);
  }
});

test("an alpha whose inputs do not exist on the venue is blocked before anything else", () => {
  const funding = ALPHA_READINESS.find((alpha) => alpha.alphaId === "funding-persistence");
  assert.equal(funding.dataAvailability, "NOT_AVAILABLE_ON_VENUE");
  const problems = blockersForPromotion(funding, UPBIT_MAJOR_HORIZON_FLOOR_HOURS).map((entry) => entry.problem);
  assert.ok(problems.some((problem) => /cannot be fed/.test(problem)));
});

test("no funding rate is fetched anywhere, which is why that alpha cannot be fed", () => {
  // Upbit KRW is spot-only: no perpetual, so no funding rate to obtain.
  let output = "";
  try {
    output = execFileSync("grep", ["-rln", "fundingRate", "--include=*.ts", "apps", "packages", "scripts"], { cwd: ROOT, encoding: "utf8" });
  } catch { output = ""; }
  const fetchers = output.split("\n").filter((path) => path.trim() && !path.includes(".test.")).filter((path) => {
    try { return /\bfetch\s*\(|https?:\/\//.test(execFileSync("cat", [path], { cwd: ROOT, encoding: "utf8" })); } catch { return false; }
  });
  assert.deepEqual(fetchers, [], `something now fetches funding data; revisit alphaReadiness:\n${fetchers.join("\n")}`);
});

test("a horizon under the floor blocks promotion on its own", () => {
  const orderbook = ALPHA_READINESS.find((alpha) => alpha.alphaId === "orderbook-imbalance");
  assert.ok(orderbook.typicalHorizonHours < UPBIT_MAJOR_HORIZON_FLOOR_HOURS);
  assert.ok(blockersForPromotion(orderbook, UPBIT_MAJOR_HORIZON_FLOOR_HOURS).some((entry) => /floor/.test(entry.problem)));
});

test("nothing here is promotable, and each is blocked for its own reason", () => {
  const reasons = new Map();
  for (const alpha of ALPHA_READINESS) {
    assert.equal(isPromotable(alpha, UPBIT_MAJOR_HORIZON_FLOOR_HOURS), false, `${alpha.alphaId} reports promotable`);
    reasons.set(alpha.alphaId, blockersForPromotion(alpha, UPBIT_MAJOR_HORIZON_FLOOR_HOURS).length);
  }
  // The live signal is blocked only by its unproven edge; the other two fail earlier and harder.
  assert.equal(reasons.get("chart-change-rate-24h"), 1);
  assert.ok(reasons.get("orderbook-imbalance") >= 3);
  assert.ok(reasons.get("funding-persistence") >= 3);
});
