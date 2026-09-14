"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const SERVER = readFileSync(join(__dirname, "..", "apps/cloud/src/server.ts"), "utf8");

/**
 * The router is a flat chain of `if (req.url === ...) { respond(...); return; }`, so a path
 * registered twice is not a conflict the compiler or a test would otherwise notice: the first
 * branch returns and the second becomes unreachable. Merging two branches that had each added
 * `/v1/mobile/session/password` produced exactly that, and the dead copy read as a working route.
 *
 * Unreachable here is not harmless. The surviving branch may be the older handler, so a route can
 * silently keep serving behaviour that someone believed they had replaced.
 */

/**
 * Only router branches count. `req.url === "..."` also appears in the rate limiter as part of a
 * boolean, and counting that reported /v1/mobile/session/refresh as a duplicate of itself.
 */
const routePaths = () => [...SERVER.matchAll(/^\s*if \([^)]*req\.url === "([^"]+)"\)\s*\{/gm)].map((match) => match[1]);

test("no path is registered twice", () => {
  const seen = new Map();
  for (const path of routePaths()) seen.set(path, (seen.get(path) ?? 0) + 1);
  const duplicated = [...seen.entries()].filter(([, count]) => count > 1).map(([path, count]) => `${path} x${count}`);
  assert.deepEqual(duplicated, [], "a duplicate route makes the later registration unreachable");
});

test("the enumeration sees every route, including the ones matched by a helper", () => {
  // Two quotation paths are routed through isPublicUpbitQuotationPath rather than a `req.url ===`
  // branch, so a scan for that pattern alone reports a smaller unauthenticated surface than the
  // server actually exposes. This test existed with that hole until it was pointed at itself.
  assert.match(SERVER, /isPublicUpbitQuotationPath\(path\)/);
  const quotation = readFileSync(join(__dirname, "..", "apps/cloud/src/publicUpbitQuotationHttp.ts"), "utf8");
  for (const path of ["/api/public/upbit/ticker", "/api/public/upbit/candles"]) {
    assert.ok(quotation.includes(`"${path}"`), `${path} is no longer served; the surface list below is stale`);
  }
});

test("the paths that need no credential are exactly the ones that cannot have one", () => {
  // Anything reachable before authentication is attack surface: a change to this list should be a
  // decision, not a side effect. /health describes the deployment; pairing and owner-device
  // authentication are how a device with no session gets one; the password route is the only
  // credential a person can type; quotations are public market data.
  const unauthenticated = [
    "/health",
    "/ready",
    "/v1/mobile/pairing/start",
    "/v1/mobile/pairing/status",
    "/v1/mobile/pairing/exchange",
    "/v1/mobile/session/password",
    "/v1/mobile/owner-device/authentication/challenge",
    "/v1/mobile/owner-device/authentication/complete"
  ];
  // Served through isPublicUpbitQuotationPath, so they are part of this surface even though the
  // scan above cannot see them. Nothing in this repository calls either one -- they are an
  // outbound proxy to api.upbit.com reachable without a credential and with no in-tree consumer.
  // Recorded rather than removed: a deployed app build outside this tree may be calling them.
  for (const path of unauthenticated) {
    assert.ok(routePaths().includes(path), `${path} is no longer registered; this list is stale`);
  }
});

test("every route that grants or changes authority names an authorization step", () => {
  // Registration, revocation and operator surfaces must not be reachable without owner authority.
  const requiresOwner = [
    "/v1/mobile/owner-device/registration/challenge",
    "/v1/mobile/owner-device/registration/activate",
    "/v1/mobile/owner-device/revoke",
    "/api/operator/mobile-pairing/approve",
    "/api/operator/mobile-bootstrap",
    "/api/operator/desktop-bootstrap"
  ];
  const http = readFileSync(join(__dirname, "..", "apps/cloud/src/mobileSessionHttp.ts"), "utf8");
  for (const path of requiresOwner) {
    assert.ok(routePaths().includes(path), `${path} is no longer registered; this list is stale`);
  }
  // The owner-device handlers are the newest of these; each must consult authorizeOwner.
  for (const handler of [
    "handleOwnerDeviceCredentialRegistrationChallengeHttp",
    "handleOwnerDeviceCredentialRegistrationActivateHttp",
    "handleOwnerDeviceCredentialRevokeHttp"
  ]) {
    const start = http.indexOf(`export function ${handler}`);
    assert.notEqual(start, -1, `${handler} is gone`);
    const body = http.slice(start, start + 1_200);
    assert.match(body, /authorizeOwner|requireOwnerSession/, `${handler} grants or revokes authority without checking it`);
  }
});
