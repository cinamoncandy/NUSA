"use strict";
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(process.env.NUSA_DEPLOY_ROOT || "/opt/nusa");
const releases = path.join(root, "releases");
const current = path.join(root, "current");
const previousFile = path.join(root, ".previous-release");
const action = (process.env.NUSA_DEPLOY_ACTION || "switch").toLowerCase();
const commit = process.env.NUSA_COMMIT_SHA;
const insideReleases = (target) => target === releases || target.startsWith(`${releases}${path.sep}`);

function replaceSymlink(target) {
  if (!insideReleases(path.resolve(target))) throw new Error("deployment target must stay inside releases directory");
  if (fs.existsSync(current) && !fs.lstatSync(current).isSymbolicLink()) throw new Error("current deployment path must be a symlink");
  const next = `${current}.${process.pid}.next`;
  fs.rmSync(next, { force: true });
  fs.symlinkSync(target, next, "junction");
  fs.renameSync(next, current);
}

if (action !== "switch" && action !== "rollback") throw new Error("NUSA_DEPLOY_ACTION must be switch or rollback");

if (action === "switch") {
  if (!commit || !/^[0-9a-f]{40}$/.test(commit)) throw new Error("NUSA_COMMIT_SHA must be a full lowercase commit SHA");
  const release = path.join(releases, commit);
  if (!fs.existsSync(release) || !fs.statSync(release).isDirectory()) throw new Error(`release does not exist: ${release}`);
  const prior = fs.existsSync(current) ? path.resolve(path.dirname(current), fs.readlinkSync(current)) : undefined;
  if (prior !== undefined && !insideReleases(prior)) throw new Error("current release points outside releases directory");
  if (process.env.NUSA_DRY_RUN === "1") {
    console.log(JSON.stringify({ status: "DRY_RUN", action, release, current, prior, restartRequired: true, readinessRequired: true }));
    process.exit(0);
  }
  fs.mkdirSync(root, { recursive: true, mode: 0o755 });
  if (prior !== undefined) {
    const temporary = `${previousFile}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, `${prior}\n`, { mode: 0o600 });
    fs.renameSync(temporary, previousFile);
  }
  replaceSymlink(release);
  console.log(JSON.stringify({ status: "PASS", action, release, current, prior, restartRequired: true, readinessRequired: true }));
  process.exit(0);
}

if (!fs.existsSync(previousFile)) throw new Error("no previous release recorded for rollback");
const previous = path.resolve(fs.readFileSync(previousFile, "utf8").trim());
if (!insideReleases(previous) || !fs.existsSync(previous)) throw new Error("recorded rollback release is unavailable or outside releases directory");
if (process.env.NUSA_DRY_RUN === "1") {
  console.log(JSON.stringify({ status: "DRY_RUN", action, previous, current, restartRequired: true, readinessRequired: true }));
  process.exit(0);
}
replaceSymlink(previous);
console.log(JSON.stringify({ status: "PASS", action, release: previous, current, restartRequired: true, readinessRequired: true }));
