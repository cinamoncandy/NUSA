#!/usr/bin/env node
"use strict";

// Read-only programme-wide annual alpha ledger. It never changes the registry.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { DEFAULT_REGISTRY, canonicalJson, readRegistry, validateHypothesis } = require("./registry.js");

const DEFAULT_PROGRAMME = path.resolve(__dirname, "../../research/alpha-lab/programme.json");
const MAX_CONFIG_BYTES = 64 * 1024;

function fail(code) { throw new Error(code); }
function isRecord(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function sha256(bytes) { return crypto.createHash("sha256").update(bytes).digest("hex"); }

function readCanonicalJson(filePath, code, maxBytes = MAX_CONFIG_BYTES) {
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile() || stat.size > maxBytes) fail(`${code}_FILE_INVALID`);
  const bytes = fs.readFileSync(filePath);
  let text;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { fail(`${code}_UTF8_INVALID`); }
  if (text.includes("\r")) fail(`${code}_NEWLINES_INVALID`);
  let value;
  try { value = JSON.parse(text); }
  catch { fail(`${code}_JSON_INVALID`); }
  if (text !== `${canonicalJson(value)}\n`) fail(`${code}_NOT_CANONICAL`);
  return { value, bytes };
}

function loadProgramme(programmePath = DEFAULT_PROGRAMME) {
  let parsed;
  try { parsed = readCanonicalJson(programmePath, "PROGRAMME"); }
  catch (error) { if (error.code === "ENOENT") fail("PROGRAMME_FILE_MISSING"); throw error; }
  const config = parsed.value;
  if (!isRecord(config) || canonicalJson(Object.keys(config).sort()) !== canonicalJson(["annualAlpha", "schemaVersion"])) fail("PROGRAMME_KEYS_INVALID");
  if (config.schemaVersion !== 1 || typeof config.annualAlpha !== "number" || !Number.isFinite(config.annualAlpha) || config.annualAlpha <= 0 || config.annualAlpha >= 1) {
    fail("PROGRAMME_ALPHA_INVALID");
  }
  return { annualAlpha: config.annualAlpha, configSha256: sha256(parsed.bytes) };
}

function calendarYearFromTimestamp(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) fail("REGISTRY_TIMESTAMP_INVALID");
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) fail("REGISTRY_TIMESTAMP_INVALID");
  return Number(value.slice(0, 4));
}

function registrationsByYear(state) {
  const registrations = new Map();
  for (const row of state.rows) {
    if (row.rowType !== "REGISTERED") continue;
    const year = calendarYearFromTimestamp(row.recordedAtUtc);
    const entry = registrations.get(year) || { year, testsRegistered: 0, alphaSpent: 0, ids: [] };
    entry.testsRegistered += 1;
    entry.alphaSpent += row.payload.alphaSpent;
    entry.ids.push(row.id);
    registrations.set(year, entry);
  }
  return registrations;
}

function openLooksForYear(state, year) {
  const result = [];
  for (const hypothesis of state.hypotheses.values()) {
    if (calendarYearFromTimestamp(hypothesis.registeredAtUtc) !== year || hypothesis.retired) continue;
    if (hypothesis.verdicts.some((v) => ["PASS", "FAIL", "FAIL_EARLY"].includes(v.resultCode))) continue;
    const completed = new Set(hypothesis.verdicts.map((v) => v.look));
    for (const look of hypothesis.looks) {
      if (!completed.has(look.id)) result.push({ id: hypothesis.id, look: look.id, date: look.date });
    }
  }
  return result.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id) || a.look.localeCompare(b.look));
}

function reportProgramme({ registryPath = DEFAULT_REGISTRY, programmePath = DEFAULT_PROGRAMME } = {}) {
  const config = loadProgramme(programmePath);
  const state = readRegistry(registryPath);
  const registrations = registrationsByYear(state);
  const years = [...registrations.keys()].sort((a, b) => a - b).map((year) => {
    const entry = registrations.get(year);
    return {
      year,
      testsRegistered: entry.testsRegistered,
      alphaSpent: entry.alphaSpent,
      annualAlpha: config.annualAlpha,
      remainingAlpha: config.annualAlpha - entry.alphaSpent,
      openLooks: openLooksForYear(state, year),
    };
  });
  const output = {
    schemaVersion: 1,
    programmeConfigSha256: config.configSha256,
    registryRows: state.rows.length,
    registryHeadSha256: state.rows.length ? state.rows.at(-1).rowSha256 : "0".repeat(64),
    years,
  };
  return { ...output, reportSha256: sha256(Buffer.from(`${canonicalJson(output)}\n`, "utf8")) };
}

function checkRegistration({ candidatePath, registrationYear, registryPath = DEFAULT_REGISTRY, programmePath = DEFAULT_PROGRAMME }) {
  if (!Number.isSafeInteger(registrationYear) || registrationYear < 2000 || registrationYear > 9999) fail("REGISTRATION_YEAR_INVALID");
  const config = loadProgramme(programmePath);
  const state = readRegistry(registryPath);
  const candidate = readCanonicalJson(candidatePath, "HYPOTHESIS", 1024 * 1024).value;
  const hypothesis = validateHypothesis(candidate);
  const entry = registrationsByYear(state).get(registrationYear) || { testsRegistered: 0, alphaSpent: 0 };
  const remainingAlpha = config.annualAlpha - entry.alphaSpent;
  const wouldSpend = entry.alphaSpent + hypothesis.alphaSpent;
  const withinBudget = hypothesis.alphaSpent <= remainingAlpha;
  return {
    schemaVersion: 1,
    id: hypothesis.id,
    registrationYear,
    testsRegistered: entry.testsRegistered,
    alphaSpent: entry.alphaSpent,
    requestedAlpha: hypothesis.alphaSpent,
    wouldSpend,
    annualAlpha: config.annualAlpha,
    remainingAlpha,
    withinBudget,
    reason: withinBudget ? "WITHIN_ANNUAL_ALPHA_BUDGET" : "ANNUAL_ALPHA_BUDGET_EXCEEDED",
    programmeConfigSha256: config.configSha256,
    registryHeadSha256: state.rows.length ? state.rows.at(-1).rowSha256 : "0".repeat(64),
  };
}

function usage() {
  return [
    "Usage:",
    "  node scripts/alpha-lab/programme.js report [registry.jsonl] [programme.json]",
    "  node scripts/alpha-lab/programme.js check <hypothesis.json> <registration-year> [registry.jsonl] [programme.json]",
  ].join("\n");
}

function main(argv = process.argv.slice(2), io = process) {
  const [command, ...args] = argv;
  try {
    if (command === "report" && args.length <= 2) {
      const result = reportProgramme({ registryPath: args[0] || DEFAULT_REGISTRY, programmePath: args[1] || DEFAULT_PROGRAMME });
      io.stdout.write(`${canonicalJson(result)}\n`);
      return 0;
    }
    if (command === "check" && args.length >= 2 && args.length <= 4) {
      const result = checkRegistration({
        candidatePath: args[0],
        registrationYear: Number(args[1]),
        registryPath: args[2] || DEFAULT_REGISTRY,
        programmePath: args[3] || DEFAULT_PROGRAMME,
      });
      io.stdout.write(`${canonicalJson(result)}\n`);
      return result.withinBudget ? 0 : 3;
    }
    io.stderr.write(`${usage()}\n`);
    return 2;
  } catch (error) {
    io.stderr.write(`${error.message}\n`);
    return 1;
  }
}

if (require.main === module) process.exitCode = main();
module.exports = { DEFAULT_PROGRAMME, checkRegistration, loadProgramme, main, reportProgramme };
