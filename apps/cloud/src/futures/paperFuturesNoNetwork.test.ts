import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { describe, it } from "node:test";

/**
 * The PAPER futures domain is pure accounting: it must never reach an exchange, hold a credential or open a socket.
 * It walks every relative import from the futures sources (transitively) and scans each reached file, so a network
 * call hidden behind a shared module is caught too. Node built-ins are limited to an allowlist; any package import fails.
 */
const FUTURES_DIR = "apps/cloud/src/futures";
const ROOTS = readdirSync(FUTURES_DIR).filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts")).map((name) => join(FUTURES_DIR, name));
const FORBIDDEN = /fetch\(|https?:\/\/|binance|ccxt|axios|node:https|node:http|node:net|node:tls|node:dgram|websocket|apikey|api_key|secret|process\.env/i;
const ALLOWED_BUILTINS = new Set(["node:crypto"]);
const IMPORT = /(?:^|\n)\s*(?:import|export)\b[^;]*?\bfrom\s*"([^"]+)"|(?:^|\n)\s*import\s*"([^"]+)"|\brequire\(\s*"([^"]+)"\s*\)|\bimport\(\s*"([^"]+)"\s*\)/g;

function resolveImport(from: string, specifier: string): string {
  const base = normalize(join(dirname(from), specifier));
  for (const candidate of [`${base}.ts`, `${base}.tsx`, join(base, "index.ts")]) if (existsSync(candidate)) return candidate;
  throw new Error(`unresolved import ${specifier} from ${from}`);
}

function reachableFiles(): { files: string[]; external: string[] } {
  const seen = new Set<string>();
  const external: string[] = [];
  const queue = [...ROOTS];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const match of readFileSync(file, "utf8").matchAll(IMPORT)) {
      const specifier = match[1] ?? match[2] ?? match[3] ?? match[4]!;
      if (specifier.startsWith(".")) queue.push(resolveImport(file, specifier));
      else external.push(`${file} -> ${specifier}`);
    }
  }
  return { files: [...seen].sort(), external };
}

describe("PAPER futures domain has no network or credential path", () => {
  const { files, external } = reachableFiles();

  it("follows the imports into the shared modules it uses", () => {
    for (const expected of ["paperFuturesSimulator.ts", "paperFuturesRiskGate.ts", "packages/contracts/src/paperFutures.ts", "apps/cloud/src/paperTradingDay.ts"]) {
      assert.ok(files.some((file) => file.endsWith(expected)), `${expected} not reached: ${files.join(", ")}`);
    }
  });

  it("imports no package and only allowlisted Node built-ins, anywhere in the reachable graph", () => {
    const disallowed = external.filter((edge) => !ALLOWED_BUILTINS.has(edge.split(" -> ")[1]!));
    assert.deepEqual(disallowed, [], "a package or non-allowlisted built-in is reachable from the futures domain");
  });

  it("no reachable file mentions a network call, an exchange, a credential or the environment", () => {
    for (const file of files) {
      readFileSync(file, "utf8").split("\n").forEach((line, index) => {
        assert.doesNotMatch(line, FORBIDDEN, `${file}:${index + 1}: ${line.trim().slice(0, 160)}`);
      });
    }
  });

  it("the contract declares no credentials and no LIVE authority", () => {
    const contract = readFileSync("packages/contracts/src/paperFutures.ts", "utf8");
    assert.match(contract, /credentials: "NONE" as const/);
    assert.match(contract, /liveAuthority: "NONE" as const/);
  });
});
