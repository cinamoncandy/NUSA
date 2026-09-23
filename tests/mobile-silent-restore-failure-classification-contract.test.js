"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

/**
 * Structural safety net for the class of bug fixed in
 * WO-20260923-MOBILE-SILENT-RESTORE-STATUS-FAILURE: a native/network call inside a foreground
 * PAPER-session restore path threw without ever setting `restoreRetryable = true`, so a purely
 * transient failure (Keystore/biometric provider briefly unavailable right after Android
 * Doze/background) left the foreground retry timer unarmed and the app stuck requiring a manual
 * reconnect -- indistinguishable, from the owner's side, from a real DEVICE_UNREGISTERED/REVOKED.
 *
 * This does not re-verify the specific fix (mobileApprovedSession.test.ts already does, with a
 * real thrown status check). It guards the *pattern*: every restore-path method in this file that
 * can observe a failure must account for both outcomes -- a definitive session rejection
 * (isDefinitiveSessionRejection) and a non-definitive one (restoreRetryable = true) -- somewhere in
 * its own body. A new restore-path method, or a new unguarded call added to an existing one, that
 * forgets this fails this test instead of silently reintroducing the same unrecoverable stuck state.
 */

const RESTORE_PATH_METHODS = [
  "connectBootstrapForDevice",
  "restore",
  "restoreWithSilentDevice",
  "authenticateSilentDeviceCredential",
  "refreshFromMemory",
];

function extractMethodBody(source, methodName) {
  const signature = new RegExp(`(?:public|private)\\s+async\\s+${methodName}\\s*\\(`);
  const match = signature.exec(source);
  assert.ok(match, `expected to find method ${methodName} in mobileApprovedSession.ts`);
  const openBraceIndex = source.indexOf("{", match.index);
  assert.ok(openBraceIndex > -1, `expected a body for ${methodName}`);
  let depth = 0;
  for (let index = openBraceIndex; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    else if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(openBraceIndex, index + 1);
    }
  }
  throw new Error(`unterminated body for ${methodName}`);
}

// restoreWithSilentDevice delegates its definitive-rejection handling to restore() and
// authenticateSilentDeviceCredential() (both required below); it still must classify a failure
// from its own leading native call, so it is held only to the restoreRetryable requirement.
const DEFINITIVE_REJECTION_REQUIRED = RESTORE_PATH_METHODS.filter((name) => name !== "restoreWithSilentDevice");

test("every silent/session restore-path method classifies both definitive and transient failures", () => {
  const root = path.resolve(__dirname, "..");
  const source = fs.readFileSync(path.join(root, "apps/mobile/src/mobileApprovedSession.ts"), "utf8");

  for (const methodName of RESTORE_PATH_METHODS) {
    const body = extractMethodBody(source, methodName);
    if (DEFINITIVE_REJECTION_REQUIRED.includes(methodName)) {
      assert.match(
        body,
        /isDefinitiveSessionRejection/,
        `${methodName} must distinguish a definitive session rejection (401/403) from a transient failure`,
      );
    }
    assert.match(
      body,
      /restoreRetryable\s*=\s*true/,
      `${methodName} must set restoreRetryable = true on a non-definitive failure, or a transient ` +
      "failure (native bridge hiccup, network blip, timeout after Doze/background) leaves the " +
      "foreground retry timer unarmed and the app stuck requiring a manual reconnect",
    );
  }
});

test("restoreWithSilentDevice classifies a thrown native status check before any conditional branch consumes it", () => {
  const root = path.resolve(__dirname, "..");
  const source = fs.readFileSync(path.join(root, "apps/mobile/src/mobileApprovedSession.ts"), "utf8");
  const body = extractMethodBody(source, "restoreWithSilentDevice");
  // The exact regression: `getSilentDeviceStatus()` awaited directly, uncaught, before the
  // function's own failure classification. A future edit that removes the try/catch around it
  // (even while leaving restoreRetryable = true elsewhere in the method) must still fail this.
  // Matched against the actual call (`native.getSilentDeviceStatus()`), not this file's own
  // explanatory comment, which also contains the bare method name as prose.
  const statusCallIndex = body.indexOf("native.getSilentDeviceStatus()");
  assert.ok(statusCallIndex > -1, "expected restoreWithSilentDevice to call native.getSilentDeviceStatus()");
  const precedingTry = body.lastIndexOf("try {", statusCallIndex);
  assert.ok(precedingTry > -1 && precedingTry < statusCallIndex, "the getSilentDeviceStatus() call must be inside a try block");
  const enclosingCatch = body.slice(statusCallIndex, body.indexOf("}", statusCallIndex) + 200);
  assert.match(enclosingCatch, /restoreRetryable\s*=\s*true/);
});
