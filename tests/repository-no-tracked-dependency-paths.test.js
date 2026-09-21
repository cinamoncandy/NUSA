"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const tracked = () =>
  execFileSync("git", ["ls-files", "-z"], { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 })
    .toString("utf8")
    .split("\0")
    .filter(Boolean);

test("no dependency directory is tracked", () => {
  // A symlink named node_modules slipped past the .gitignore rule `node_modules/`, which matches
  // directories only, and `git add -A` committed it. It pointed at an absolute path on one
  // developer's machine, so on every CI runner it was a dangling symlink where pnpm needed to
  // create a directory, and `pnpm install` died with ENOENT before a single test ran.
  const offenders = tracked().filter((file) => file === "node_modules" || file.split("/").includes("node_modules"));
  assert.deepEqual(offenders, [], `dependency paths must never be tracked: ${offenders.join(", ")}`);
});

test("no tracked symlink points outside the repository", () => {
  // The same failure in its general form: a tracked symlink whose target is an absolute path, or
  // escapes the repository root, resolves to nothing on any other machine.
  const entries = execFileSync("git", ["ls-files", "-s", "-z"], { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 })
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .map((line) => {
      const [meta, file] = line.split("\t");
      return { mode: meta.split(" ")[0], file };
    })
    .filter((entry) => entry.mode === "120000");

  const escaping = entries.filter((entry) => {
    const target = execFileSync("git", ["show", `HEAD:${entry.file}`], { cwd: ROOT }).toString("utf8").trim();
    if (path.isAbsolute(target)) return true;
    const resolved = path.resolve(ROOT, path.dirname(entry.file), target);
    return !resolved.startsWith(ROOT + path.sep);
  });

  assert.deepEqual(escaping.map((entry) => entry.file), [], "tracked symlinks must resolve inside the repository");
});
