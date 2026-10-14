import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

/**
 * The PAPER futures domain is pure accounting: it must never reach an exchange, hold a credential or open a socket.
 * This scans the non-test sources so any such addition fails CI instead of relying on a reviewer to notice it.
 */
const FUTURES_DIR = "apps/cloud/src/futures";
const SOURCES = [
  ...readdirSync(FUTURES_DIR).filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts")).map((name) => join(FUTURES_DIR, name)),
  "packages/contracts/src/paperFutures.ts",
];
const FORBIDDEN = /fetch\(|https?:\/\/|binance|ccxt|axios|node:https|node:http|node:net|node:tls|websocket|apikey|api_key|secret|process\.env/i;

describe("PAPER futures domain has no network or credential path", () => {
  it("covers the simulator, the risk gate and the contract", () => {
    assert.ok(SOURCES.some((file) => file.endsWith("paperFuturesSimulator.ts")));
    assert.ok(SOURCES.some((file) => file.endsWith("paperFuturesRiskGate.ts")));
  });

  it("no source mentions a network call, an exchange, a credential or the environment", () => {
    for (const file of SOURCES) {
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, index) => assert.doesNotMatch(line, FORBIDDEN, `${file}:${index + 1}`));
    }
  });

  it("the contract declares no credentials and no LIVE authority", () => {
    const contract = readFileSync("packages/contracts/src/paperFutures.ts", "utf8");
    assert.match(contract, /credentials: "NONE" as const/);
    assert.match(contract, /liveAuthority: "NONE" as const/);
  });
});
