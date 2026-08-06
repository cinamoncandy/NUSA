"use strict";
const fs = require("node:fs");
const path = require("node:path");
const root = process.env.NUSA_DEPLOY_ROOT || "/opt/nusa";
const commit = process.env.NUSA_COMMIT_SHA;
const release = commit && path.join(root, "releases", commit);
if (!commit || !/^[0-9a-f]{40}$/.test(commit)) throw new Error("NUSA_COMMIT_SHA must be a full commit SHA");
if (process.env.NUSA_DRY_RUN === "1") { console.log(JSON.stringify({ status: "DRY_RUN", release, current: path.join(root, "current") })); process.exit(0); }
if (!fs.existsSync(release)) throw new Error(`release does not exist: ${release}`);
const current = path.join(root, "current");
const next = `${current}.${process.pid}.next`;
fs.symlinkSync(release, next, "junction");
fs.renameSync(next, current);
console.log(JSON.stringify({ status: "PASS", current, release }));
