"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const ROOT = join(__dirname, "..");
const SCRIPT_PATH = join(ROOT, "scripts/set-owner-password.js");
const SCRIPT = readFileSync(SCRIPT_PATH, "utf8");

/**
 * This script is the one place a plaintext password exists on the server, for the length of one
 * command. Everything here is about that command not leaving a copy behind.
 */

test("the password cannot arrive as an argument or an environment variable", () => {
  // An argument is in shell history and in `ps` for every user on the box; an environment variable
  // is in /proc. The only safe channel is the terminal itself.
  assert.equal(/process\.argv/.test(SCRIPT), false, "reading argv would put the password in shell history");
  const environmentReads = [...SCRIPT.matchAll(/process\.env\.([A-Z_]+)|process\.env\[["']([A-Z_]+)["']\]/g)]
    .map((match) => match[1] ?? match[2]);
  assert.deepEqual(
    [...new Set(environmentReads)].sort(),
    ["NUSA_CLOUD_STATE_DB_PATH", "NUSA_OWNER_USER_ID"],
    "the only environment this script may read is where the database is and which owner"
  );
});

test("input is read with the terminal echo disabled, and refuses a pipe", () => {
  assert.match(SCRIPT, /setRawMode\(true\)/);
  assert.match(SCRIPT, /isTTY/);
  assert.match(SCRIPT, /refusing to read a password from a pipe/);
});

test("nothing prints the password, a prefix of it, or a hash of it", () => {
  const printed = [...SCRIPT.matchAll(/process\.stdout\.write\((.*)\)/g)].map((match) => match[1]);
  assert.ok(printed.length > 0);
  for (const statement of printed) {
    assert.equal(/\bpassword\b(?!:)/.test(statement.replace(/"[^"]*"|`[^`]*`/g, "")), false, `a write referenced the password variable: ${statement}`);
  }
  assert.equal(/createHash|digest\(/.test(SCRIPT), false, "even a fingerprint of the password would be a copy of it");
});

test("it refuses to write a credential somewhere it will not survive", () => {
  assert.match(SCRIPT, /refusing to write a credential to an in-memory database/);
  assert.match(SCRIPT, /existsSync/);
});

test("mistyping the confirmation changes nothing", () => {
  assert.match(SCRIPT, /the two entries differ; nothing was changed/);
  const confirmIndex = SCRIPT.indexOf("the two entries differ");
  assert.ok(confirmIndex < SCRIPT.indexOf("setOwnerPassword("), "the confirmation must be checked before the write");
});

test("the script runs and refuses cleanly when the database is absent", () => {
  // A wrong path must produce a plain refusal, not a stack trace with the environment in it.
  let output = "";
  try {
    execFileSync("node", [SCRIPT_PATH], {
      cwd: ROOT,
      encoding: "utf8",
      env: { ...process.env, NUSA_CLOUD_STATE_DB_PATH: join(ROOT, "no-such-database.sqlite") },
      stdio: ["pipe", "pipe", "pipe"]
    });
  } catch (error) {
    output = `${error.stdout ?? ""}${error.stderr ?? ""}`;
    assert.equal(error.status, 1);
  }
  assert.match(output, /no database at/);
  assert.equal(/at Object\.<anonymous>|node:internal/.test(output), false, "a stack trace leaked from a routine refusal");
});

test("an in-memory database is refused before anything is read", () => {
  let output = "";
  try {
    execFileSync("node", [SCRIPT_PATH], {
      cwd: ROOT,
      encoding: "utf8",
      env: { ...process.env, NUSA_CLOUD_STATE_DB_PATH: ":memory:" },
      stdio: ["pipe", "pipe", "pipe"]
    });
  } catch (error) {
    output = `${error.stdout ?? ""}${error.stderr ?? ""}`;
  }
  assert.match(output, /in-memory/);
});
