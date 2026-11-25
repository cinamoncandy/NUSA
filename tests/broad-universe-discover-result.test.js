"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const mining = require("../scripts/run-broad-mining.js");

const root = path.join(__dirname, "..");
const record = JSON.parse(fs.readFileSync(path.join(root, "docs", "research-data", "broad-universe-discover-result-2026-11-25.json"), "utf8"));
const pool = JSON.parse(fs.readFileSync(path.join(root, "docs", "research-data", "broad-universe-filter-count-20bp-2026-11-24.json"), "utf8"));

test("the recorded freeze record keeps its fingerprint and says NO_CANDIDATE with an empty shortlist", () => {
  const { fingerprint, ...body } = record.freezeRecord;
  assert.equal(mining.fingerprintOf(body), fingerprint);
  assert.equal(fingerprint, "6dc40f09f31af53e93a3ea37c8b231691cde82bfe0ee73e973eb91eab376f55d");
  assert.equal(record.freezeRecord.status, "NO_CANDIDATE");
  assert.deepEqual(record.freezeRecord.shortlist, []);
  assert.equal(record.freezeRecord.sourceCommit, record.run.sourceCommit);
});

test("the result covers exactly the committed discovery pool and its hour counts add up", () => {
  assert.deepEqual(Object.keys(record.result.perMarketUsableHours).sort(), [...pool.discoveryPool].sort());
  assert.deepEqual(record.freezeRecord.markets, [...pool.discoveryPool].sort());
  assert.equal(Object.values(record.result.perMarketUsableHours).reduce((a, b) => a + b, 0), record.result.usableDecisionHours);
  assert.equal(record.result.status, "NO_CANDIDATE");
  assert.equal(record.result.eligibleRules, 0);
  assert.equal(record.result.trials, 64);
  assert.equal(record.result.gridFingerprint, record.freezeRecord.gridFingerprint);
});

test("the record holds counts and identifiers only (no price-like fields)", () => {
  const text = JSON.stringify(record);
  assert.doesNotMatch(text, /"(open|high|low|close|price|volume)"/i);
});
