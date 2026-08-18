const { createHash, randomBytes } = require("node:crypto");
const { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } = require("node:fs");
const { createServer } = require("node:net");
const { dirname, resolve } = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const canonical = (value) => Array.isArray(value)
  ? `[${value.map(canonical).join(",")}]`
  : value && typeof value === "object"
    ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`
    : JSON.stringify(value);

function boundedPush(lines, chunk) {
  lines.push(String(chunk));
  while (lines.join("").length > 32_000) lines.shift();
}

async function availablePort() {
  return await new Promise((resolvePromise, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => error ? reject(error) : resolvePromise(port));
    });
  });
}

function scrubPrivateExchangeEnv(source) {
  const env = { ...source };
  const removed = [];
  for (const key of Object.keys(env)) {
    if (/UPBIT/i.test(key) && /(ACCESS|SECRET|PRIVATE|API[_-]?KEY|TOKEN)/i.test(key)) {
      removed.push(key);
      delete env[key];
    }
  }
  return { env, removed: Object.freeze(removed.sort()) };
}

function gitRevision(root) {
  const result = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8", shell: false });
  return result.status === 0 ? result.stdout.trim() : "UNKNOWN";
}

function assertBuilt(root) {
  const runtimePath = resolve(root, "dist/apps/cloud/src/runtime.js");
  if (!existsSync(runtimePath)) throw new Error("compiled Cloud runtime is missing; run `pnpm run build` before the E2E harness");
}

function startRuntime(root, env) {
  const stdout = [];
  const stderr = [];
  const child = spawn(process.execPath, ["dist/apps/cloud/src/runtime.js"], {
    cwd: root,
    env,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => boundedPush(stdout, chunk));
  child.stderr.on("data", (chunk) => boundedPush(stderr, chunk));
  return { child, stdout, stderr };
}

async function stopRuntime(runtime) {
  if (runtime.child.exitCode != null) return;
  runtime.child.kill("SIGTERM");
  const exited = await Promise.race([
    new Promise((resolvePromise) => runtime.child.once("exit", () => resolvePromise(true))),
    sleep(10_000).then(() => false),
  ]);
  if (!exited && runtime.child.exitCode == null) {
    runtime.child.kill("SIGKILL");
    await new Promise((resolvePromise) => runtime.child.once("exit", resolvePromise));
  }
}

async function waitForHealth(baseUrl, runtime, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (runtime.child.exitCode != null) throw new Error(`cloud runtime exited early (${runtime.child.exitCode}): ${runtime.stderr.join("").slice(-4000)}`);
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
    } catch {}
    await sleep(250);
  }
  throw new Error("cloud runtime health timeout");
}

async function submitOrder(baseUrl, token, command) {
  const response = await fetch(`${baseUrl}/api/paper-orders`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "idempotency-key": command.idempotencyKey,
    },
    body: JSON.stringify(command),
  });
  let body;
  try { body = await response.json(); } catch { body = { error: "NON_JSON_RESPONSE" }; }
  return { httpStatus: response.status, body };
}

async function waitForOrderResult(baseUrl, token, command, expectedStatus, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await submitOrder(baseUrl, token, command);
    if (last.httpStatus === 200 && last.body && last.body.status === expectedStatus) return last.body;
    const retryable = last.body?.reason === "PAPER_MARKET_DATA_UNAVAILABLE" || last.body?.reason === "paper execution gate is closed" || last.body?.error === "PAPER_ORDER_UNAVAILABLE";
    if (!retryable && last.httpStatus !== 429) throw new Error(`unexpected PAPER order result: ${JSON.stringify(last).slice(0, 2000)}`);
    await sleep(750);
  }
  throw new Error(`timed out waiting for ${expectedStatus}; last=${JSON.stringify(last).slice(0, 2000)}`);
}

function summarizeSnapshot(snapshot) {
  const account = snapshot?.portfolio?.account;
  return {
    generatedAt: snapshot?.generatedAt,
    mode: snapshot?.mode,
    health: snapshot?.health,
    readyForPaperOperations: snapshot?.readyForPaperOperations,
    transport: snapshot?.operations?.transport,
    runtimeState: snapshot?.operations?.runtimeState,
    markets: Array.isArray(snapshot?.markets) ? snapshot.markets.map((market) => ({ market: market.market, source: market.source, price: market.price, observedAt: market.observedAt })) : [],
    orderCount: Array.isArray(snapshot?.orders) ? snapshot.orders.length : 0,
    cash: account?.cash,
    equity: account?.equity,
    realizedPnl: account?.realizedPnl,
    unrealizedPnl: account?.unrealizedPnl,
    position: account?.position ? {
      market: account.position.market,
      quantity: account.position.quantity,
      averagePrice: account.position.averagePrice,
      realizedPnl: account.position.realizedPnl,
      unrealizedPnl: account.position.unrealizedPnl,
    } : null,
    liveAuthority: snapshot?.liveAuthority,
    productionMutationAllowed: snapshot?.productionMutationAllowed,
  };
}

async function run(options = {}) {
  const root = resolve(options.root || process.cwd());
  const outputPath = resolve(root, options.outputPath || "artifacts/operational-evidence/actual-paper-runtime-e2e.json");
  const workingDir = resolve(root, options.workingDir || ".runtime-evidence/wo-0059");
  const databasePath = resolve(workingDir, "state.sqlite");
  const market = String(options.market || process.env.NUSA_E2E_MARKET || "KRW-BTC").trim().toUpperCase();
  const quantity = Number(options.quantity || process.env.NUSA_E2E_QUANTITY || "0.000001");
  if (!/^KRW-[A-Z0-9-]+$/.test(market)) throw new Error("invalid E2E market");
  if (!Number.isFinite(quantity) || quantity <= 0) throw new Error("invalid E2E quantity");

  assertBuilt(root);
  rmSync(workingDir, { recursive: true, force: true });
  mkdirSync(workingDir, { recursive: true });

  const token = randomBytes(32).toString("hex");
  const idempotencyKey = `wo0059:${Date.now()}:${randomBytes(8).toString("hex")}`;
  const port = await availablePort();
  const { env: cleanBaseEnv, removed: scrubbedPrivateKeys } = scrubPrivateExchangeEnv(process.env);
  const env = {
    ...cleanBaseEnv,
    NUSA_MODE: "PAPER",
    NUSA_LIVE_MUTATION: "PROHIBITED",
    NUSA_CLOUD_DASHBOARD_PORT: String(port),
    NUSA_CLOUD_DASHBOARD_HOST: "127.0.0.1",
    NUSA_CLOUD_DASHBOARD_TOKEN: token,
    NUSA_CLOUD_UPBIT_PUBLIC_DATA: "true",
    NUSA_CLOUD_UPBIT_MARKETS: market,
    NUSA_CLOUD_STATE_DB_PATH: databasePath,
    NUSA_CLOUD_PAPER_INITIAL_CAPITAL_KRW: "10000000",
    NUSA_CLOUD_PAPER_INVESTMENT_PERCENT: "10",
    NUSA_SOURCE_COMMIT: gitRevision(root),
  };
  const baseUrl = `http://127.0.0.1:${port}`;
  const command = Object.freeze({
    schemaVersion: 1,
    authority: "PAPER_ONLY",
    productionMutationAllowed: false,
    idempotencyKey,
    market,
    side: "BUY",
    orderType: "MARKET",
    quantity,
  });

  let firstRuntime;
  let secondRuntime;
  const startedAt = new Date().toISOString();
  try {
    firstRuntime = startRuntime(root, env);
    await waitForHealth(baseUrl, firstRuntime);
    const filled = await waitForOrderResult(baseUrl, token, command, "FILLED");
    if (filled.liveAuthority !== "NONE" || filled.productionMutationAllowed !== false) throw new Error("FILLED result violated PAPER authority invariant");
    if (!filled.order?.id || filled.order.fills?.length !== 1 || !filled.snapshot) throw new Error("FILLED result missing canonical order/fill/snapshot evidence");
    const firstSummary = summarizeSnapshot(filled.snapshot);
    if (!firstSummary.markets.some((item) => item.market === market && item.source === "UPBIT_PUBLIC_TICKER")) throw new Error("live Upbit PUBLIC ticker evidence missing from PAPER snapshot");
    if (firstSummary.position?.market !== market || firstSummary.position.quantity <= 0) throw new Error("PAPER position was not created");

    await stopRuntime(firstRuntime);
    firstRuntime = undefined;
    if (!existsSync(databasePath) || statSync(databasePath).size <= 0) throw new Error("SQLite PAPER state database was not persisted");
    const dbHashAfterFill = sha256(readFileSync(databasePath));

    secondRuntime = startRuntime(root, env);
    await waitForHealth(baseUrl, secondRuntime);
    const duplicate = await waitForOrderResult(baseUrl, token, command, "DUPLICATE");
    if (duplicate.liveAuthority !== "NONE" || duplicate.productionMutationAllowed !== false) throw new Error("DUPLICATE result violated PAPER authority invariant");
    if (duplicate.order?.id !== filled.order.id || !duplicate.snapshot) throw new Error("restart duplicate did not bind to the original PAPER order");
    const secondSummary = summarizeSnapshot(duplicate.snapshot);
    const repeatedOrders = duplicate.snapshot.orders.filter((order) => order.id === filled.order.id);
    const repeatedFills = repeatedOrders.flatMap((order) => order.fills || []);
    if (repeatedOrders.length !== 1 || repeatedFills.length !== 1) throw new Error("same idempotency retry created a duplicate PAPER order/fill");
    if (secondSummary.position?.quantity !== firstSummary.position?.quantity) throw new Error("PAPER position did not recover identically after restart");

    const payload = {
      schema_version: 1,
      evidence_type: "nusa.actual-paper-runtime-e2e",
      result: "PASS",
      source_commit: gitRevision(root),
      started_at: startedAt,
      completed_at: new Date().toISOString(),
      authority: { mode: "PAPER_ONLY", liveAuthority: "NONE", productionMutationAllowed: false, aiAuthority: "ZERO_AUTHORITY" },
      market_data: { provider: "UPBIT", channel: "PUBLIC_TICKER", market, private_credentials_used: false, scrubbed_private_env_key_count: scrubbedPrivateKeys.length },
      execution: { order_id: filled.order.id, fill_id: filled.order.fills[0].id, side: filled.order.side, quantity: filled.order.quantity, price: filled.order.price, fee: filled.order.fee, idempotency_key_sha256: sha256(idempotencyKey) },
      first_runtime: firstSummary,
      persistence: { sqlite_path: databasePath, sqlite_size_bytes: statSync(databasePath).size, sqlite_sha256_after_fill: dbHashAfterFill },
      restart_recovery: secondSummary,
      idempotency_retry: { status: duplicate.status, original_order_id: filled.order.id, matching_order_count: repeatedOrders.length, matching_fill_count: repeatedFills.length, double_fill: false },
      prohibited_capabilities: { upbit_private_credentials: false, live_order_endpoint: false, withdrawal_transfer: false, real_money_mutation: false },
    };
    const evidence = { ...payload, artifact_hash: { algorithm: "sha256", value: sha256(canonical(payload)) } };
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
    return evidence;
  } finally {
    if (firstRuntime) await stopRuntime(firstRuntime);
    if (secondRuntime) await stopRuntime(secondRuntime);
  }
}

function parseArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--output") options.outputPath = args[++index];
    else if (arg === "--market") options.market = args[++index];
    else if (arg === "--quantity") options.quantity = args[++index];
    else if (arg === "--working-dir") options.workingDir = args[++index];
    else throw new Error(`unknown argument: ${arg}`);
  }
  return options;
}

if (require.main === module) {
  run(parseArgs(process.argv.slice(2))).then((evidence) => {
    process.stdout.write(`${JSON.stringify({ result: evidence.result, evidence_type: evidence.evidence_type, artifact_hash: evidence.artifact_hash.value })}\n`);
  }).catch((error) => {
    process.stderr.write(`actual PAPER runtime E2E failed: ${error instanceof Error ? error.message : "unknown error"}\n`);
    process.exitCode = 1;
  });
}

module.exports = { availablePort, canonical, run, scrubPrivateExchangeEnv, sha256, summarizeSnapshot };
