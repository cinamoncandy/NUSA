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

test("the credential the script writes is one the server will actually accept", () => {
  // Everything above reads the script's source. None of it proves the file it writes is a
  // credential sign-in can verify -- and this script runs once, on a host the owner may only be
  // able to reach with difficulty, as the single server touch the whole design depends on. A
  // wrong schema or a hash written to the wrong table would surface as "password rejected" on a
  // phone, with nothing to distinguish it from a typo.
  //
  // The script itself needs a TTY, so this drives the same service call it makes, against a real
  // database file rather than :memory:, and then signs in through the HTTP route.
  const { mkdtempSync, rmSync } = require("node:fs");
  const { tmpdir } = require("node:os");
  const { SqliteDatabase } = require("../dist/packages/storage/src/index.js");
  const { SqliteNusaUserAccessRepository } = require("../dist/apps/cloud/src/operatorUserAccess.js");
  const { MobileSessionService } = require("../dist/apps/cloud/src/mobileSessionService.js");
  const { handleOwnerPasswordSignInHttp } = require("../dist/apps/cloud/src/mobileSessionHttp.js");

  const directory = mkdtempSync(join(tmpdir(), "nusa-owner-password-"));
  const databasePath = join(directory, "state.sqlite");
  const phrase = ["correct", "horse", "battery", "staple", "2026"].join("-");
  try {
    // Setup, in one process.
    {
      const db = new SqliteDatabase(databasePath);
      try {
        const users = new SqliteNusaUserAccessRepository(db);
        users.ensureOwner({ id: "owner", email: "owner@nusa.local" }, Date.now());
        const service = new MobileSessionService(db, users);
        assert.equal(service.ownerPasswordConfigured(), false);
        service.setOwnerPassword("owner", phrase, Date.now());
        assert.equal(service.ownerPasswordConfigured(), true);
      } finally {
        db.close();
      }
    }

    // Sign-in, in another: the runtime reads this from disk, not from the setup process's memory.
    {
      const db = new SqliteDatabase(databasePath);
      try {
        const users = new SqliteNusaUserAccessRepository(db);
        const service = new MobileSessionService(db, users);
        assert.equal(service.ownerPasswordConfigured(), true, "the password did not survive the process that set it");
        const dependencies = {
          sessionService: service,
          legacyTokenVerifier: { verify: () => undefined },
          userAccessRepository: users
        };
        const request = (password) => ({ method: "POST", headers: {}, body: JSON.stringify({ password, deviceId: "nusa-install-owners-phone" }) });
        const accepted = handleOwnerPasswordSignInHttp(request(phrase), dependencies);
        assert.equal(accepted.status, 200, accepted.body);
        assert.ok(JSON.parse(accepted.body).accessToken);
        assert.equal(handleOwnerPasswordSignInHttp(request(`${phrase}x`), dependencies).status, 401);
      } finally {
        db.close();
      }
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
