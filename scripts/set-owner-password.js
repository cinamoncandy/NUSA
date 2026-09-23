"use strict";
/**
 * Sets the owner's password on this host. Run once, in the server's shell, and never again.
 *
 * This is the single server touch the whole design needs. After it, the owner signs in from any
 * phone with something they remember, and the fingerprint unlocks the rotating session from there
 * -- no token to retrieve from a file, which is the failure that locked the owner out of their own
 * PAPER server while the credential sat in /etc/nusa/cloud-runtime.env.
 *
 * The password is read from the terminal with echo off. It is deliberately NOT accepted as an
 * argument or an environment variable: an argument lands in shell history and in `ps` output for
 * every user on the box, and an environment variable lands in /proc. Nothing here prints it back,
 * and the only thing written to disk is the scrypt hash.
 *
 * Usage:
 *   sudo -u nusa NUSA_CLOUD_STATE_DB_PATH=/var/lib/nusa/state.sqlite \
 *     node /opt/nusa/current/scripts/set-owner-password.js
 */
const { createInterface } = require("node:readline");
const { existsSync } = require("node:fs");

const DATABASE_PATH = (process.env.NUSA_CLOUD_STATE_DB_PATH || "").trim();
const OWNER_ID = (process.env.NUSA_OWNER_USER_ID || "").trim();

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

/** Reads a line with the terminal's echo disabled, so the password never appears on screen. */
function readSecret(prompt) {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY) {
      reject(new Error("refusing to read a password from a pipe: run this in an interactive shell"));
      return;
    }
    process.stdout.write(prompt);
    const wasRaw = process.stdin.isRaw === true;
    process.stdin.setRawMode(true);
    let value = "";
    const onData = (chunk) => {
      for (const byte of chunk) {
        if (byte === 0x03) { cleanup(); reject(new Error("cancelled")); return; }
        if (byte === 0x0d || byte === 0x0a) { cleanup(); process.stdout.write("\n"); resolve(value); return; }
        if (byte === 0x7f || byte === 0x08) { value = value.slice(0, -1); continue; }
        value += String.fromCharCode(byte);
      }
    };
    const cleanup = () => {
      process.stdin.off("data", onData);
      process.stdin.setRawMode(wasRaw);
      process.stdin.pause();
    };
    process.stdin.on("data", onData);
    process.stdin.resume();
  });
}

async function main() {
  if (!DATABASE_PATH) fail("NUSA_CLOUD_STATE_DB_PATH must name the runtime's durable database");
  if (DATABASE_PATH === ":memory:") fail("refusing to write a credential to an in-memory database");
  if (!existsSync(DATABASE_PATH)) fail(`no database at ${DATABASE_PATH}; start the runtime once before setting a password`);

  const { SqliteDatabase } = require("../dist/packages/storage/src/index.js");
  const { SqliteNusaUserAccessRepository } = require("../dist/apps/cloud/src/operatorUserAccess.js");
  const { MobileSessionService } = require("../dist/apps/cloud/src/mobileSessionService.js");
  const { MINIMUM_PASSWORD_LENGTH } = require("../dist/apps/cloud/src/ownerCredential/ownerPassword.js");

  const database = new SqliteDatabase(DATABASE_PATH);
  try {
    const users = new SqliteNusaUserAccessRepository(database);
    const owners = users.list().filter((user) => user.role === "OWNER");
    if (owners.length === 0) fail("no OWNER account exists on this host yet");
    const owner = OWNER_ID ? owners.find((user) => user.id === OWNER_ID) : owners.length === 1 ? owners[0] : undefined;
    if (owner == null) {
      fail(`set NUSA_OWNER_USER_ID to one of: ${owners.map((user) => user.id).join(", ")}`);
    }

    const service = new MobileSessionService(database, users);
    const replacing = service.ownerPasswordConfigured();
    process.stdout.write(`${replacing ? "Replacing" : "Setting"} the password for owner ${owner.id} (${owner.email}).\n`);
    process.stdout.write(`At least ${MINIMUM_PASSWORD_LENGTH} characters. Nothing is echoed.\n`);

    const password = await readSecret("Password: ");
    const again = await readSecret("Repeat:   ");
    if (password !== again) fail("the two entries differ; nothing was changed");

    service.setOwnerPassword(owner.id, password, Date.now());
    // Deliberately reports only that it happened. Printing any part of the password, or a
    // fingerprint of it, would put it in a scrollback buffer someone else can read.
    process.stdout.write("Done. Sign in from the app with this password.\n");
    process.stdout.write("Restart is not required; the runtime reads this from the database.\n");
  } catch (error) {
    fail(error instanceof Error ? error.message : "failed to set the owner password");
  } finally {
    database.close();
  }
}

void main();
