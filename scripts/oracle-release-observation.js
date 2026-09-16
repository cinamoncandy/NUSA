"use strict";

const fs = require("node:fs");
const path = require("node:path");

const SHA_PATTERN = /^[0-9a-f]{40}$/;
const deployRoot = path.resolve(process.env.NUSA_DEPLOY_ROOT || "/opt/nusa");
const releasesRoot = path.join(deployRoot, "releases");
const currentPath = path.join(deployRoot, "current");
const expectedSha = process.env.NUSA_EXPECTED_SHA || "";

function isRealDirectory(target) {
  if (!fs.existsSync(target)) return false;
  const entry = fs.lstatSync(target);
  return entry.isDirectory() && !entry.isSymbolicLink();
}

function insideDirectory(parent, child) {
  return child !== parent && child.startsWith(`${parent}${path.sep}`);
}

function releaseDirectoryState(target) {
  if (!isRealDirectory(releasesRoot) || !isRealDirectory(target)) return false;
  const releasesReal = fs.realpathSync(releasesRoot);
  const targetReal = fs.realpathSync(target);
  return insideDirectory(releasesReal, targetReal);
}

function baseReceipt() {
  return {
    schema_version: 1,
    observation_source: "local-filesystem",
    status: "BLOCKED",
    pass: false,
    reason: "UNKNOWN",
    target_sha: expectedSha || null,
    observed_sha: null,
    deploy_root: deployRoot,
    current_path: currentPath,
    observed_release_path: null,
    target_release_staged: false,
    safety: {
      liveAuthority: "NONE",
      productionMutationAllowed: false,
      aiAuthority: "ZERO_AUTHORITY",
    },
  };
}

function observe() {
  const receipt = baseReceipt();

  if (!SHA_PATTERN.test(expectedSha)) {
    receipt.reason = "INVALID_EXPECTED_SHA";
    return receipt;
  }

  const expectedRelease = path.join(releasesRoot, expectedSha);
  try {
    receipt.target_release_staged = releaseDirectoryState(expectedRelease);
  } catch {
    receipt.reason = "TARGET_RELEASE_UNREADABLE";
    return receipt;
  }

  if (!fs.existsSync(currentPath)) {
    receipt.reason = "CURRENT_PATH_MISSING";
    return receipt;
  }

  let currentEntry;
  try {
    currentEntry = fs.lstatSync(currentPath);
  } catch {
    receipt.reason = "CURRENT_PATH_UNREADABLE";
    return receipt;
  }
  if (!currentEntry.isSymbolicLink()) {
    receipt.reason = "CURRENT_PATH_NOT_SYMLINK";
    return receipt;
  }

  let resolvedCurrent;
  try {
    resolvedCurrent = fs.realpathSync(currentPath);
    if (!releaseDirectoryState(resolvedCurrent)) {
      receipt.reason = "CURRENT_TARGET_INVALID";
      return receipt;
    }
  } catch {
    receipt.reason = "CURRENT_TARGET_UNREADABLE";
    return receipt;
  }

  const observedSha = path.basename(resolvedCurrent);
  receipt.observed_release_path = resolvedCurrent;
  if (!SHA_PATTERN.test(observedSha)) {
    receipt.reason = "CURRENT_TARGET_NOT_COMMIT_RELEASE";
    return receipt;
  }

  receipt.observed_sha = observedSha;
  if (observedSha !== expectedSha) {
    receipt.status = "STALE";
    receipt.reason = receipt.target_release_staged ? "TARGET_STAGED_NOT_CURRENT" : "TARGET_NOT_STAGED";
    return receipt;
  }

  if (!receipt.target_release_staged) {
    receipt.reason = "CURRENT_TARGET_NOT_STAGED";
    return receipt;
  }

  receipt.status = "CURRENT";
  receipt.pass = true;
  receipt.reason = "EXACT_MAIN_RELEASE";
  return receipt;
}

const receipt = observe();
process.stdout.write(`${JSON.stringify(receipt)}\n`);
if (!receipt.pass) process.exitCode = 1;
