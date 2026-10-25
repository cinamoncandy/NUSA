#!/usr/bin/env node
"use strict";

const { execFileSync } = require("node:child_process");
const { statSync } = require("node:fs");
const { isAbsolute } = require("node:path");

function resolveBackupBlockDevice(stateDbPath, options = {}) {
  const run = options.run ?? ((command, args) => execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim());
  const isBlockDevice = options.isBlockDevice ?? ((path) => statSync(path).isBlockDevice());
  if (typeof stateDbPath !== "string" || !isAbsolute(stateDbPath)) throw new Error("Cloud state path must be absolute before backup");

  const filesystemSource = run("findmnt", ["--noheadings", "--raw", "--output", "SOURCE", "--target", stateDbPath]).trim();
  if (!filesystemSource.startsWith("/dev/") || !isBlockDevice(filesystemSource)) throw new Error("Cloud state filesystem source is not a local block device");

  const filesystemType = run("lsblk", ["--noheadings", "--raw", "--nodeps", "--output", "TYPE", filesystemSource]).trim();
  const parents = [...new Set(run("lsblk", ["--noheadings", "--raw", "--output", "PKNAME", filesystemSource])
    .split(/\r?\n/).map((item) => item.trim()).filter(Boolean))];

  let blockDevice;
  if (filesystemType === "disk" && parents.length === 0) blockDevice = filesystemSource;
  else if (parents.length === 1 && /^[A-Za-z0-9._-]+$/.test(parents[0])) blockDevice = `/dev/${parents[0]}`;
  else throw new Error("Cloud state filesystem backing device topology is ambiguous");

  if (!isBlockDevice(blockDevice) || run("lsblk", ["--noheadings", "--raw", "--nodeps", "--output", "TYPE", blockDevice]).trim() !== "disk") {
    throw new Error("Cloud state filesystem backing device is not a verified disk");
  }
  return blockDevice;
}

if (require.main === module) {
  try {
    process.stdout.write(`${resolveBackupBlockDevice(process.argv[2])}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown topology error";
    process.stderr.write(`oracle backup device verification failed: ${message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { resolveBackupBlockDevice };
