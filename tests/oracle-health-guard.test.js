const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const root = path.join(__dirname, "..");
const scriptPath = path.join(root, "deploy/oracle/nusa-health-guard");
const servicePath = path.join(root, "deploy/oracle/nusa-health-guard.service");
const timerPath = path.join(root, "deploy/oracle/nusa-health-guard.timer");
const script = fs.readFileSync(scriptPath, "utf8");
const service = fs.readFileSync(servicePath, "utf8");
const timer = fs.readFileSync(timerPath, "utf8");

test("Oracle health guard is valid POSIX shell", () => {
  const result = spawnSync("sh", ["-n", scriptPath], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("public-market recovery is workload-aware and bounded", () => {
  assert.match(script, /w\.get\("state"\) == "STALE"/);
  assert.match(script, /r\.get\("lastError"\) == "PUBLIC_MARKET_FAILED"/);
  assert.match(script, /lastMarketEventAt/);
  assert.match(script, /COOLDOWN_MS=900000/);
  assert.match(script, /MARKER_DIR=\/var\/lib\/nusa-health-guard/);
  assert.match(script, /install -d -o root -g root -m 0700 "\$MARKER_DIR"/);
  assert.match(script, /mktemp "\$\{MARKER_DIR\}\/\.public-market-restart\.XXXXXX"/);
  assert.doesNotMatch(script, /\$\{MARKER\}\.tmp\.\$\$/);
  assert.match(script, /last_market.*prev_market/);
  assert.match(script, /no repeat restart/);
  assert.match(script, /release_activation_active/);
  assert.match(script, /suppressing watchdog restart/);
  assert.match(script, /UPBIT_PUBLIC_URL/);
  assert.match(script, /Upbit public REST unreachable; no restart/);
  assert.match(script, /systemctl restart nusa\.service/);
  assert.match(script, /wait_paper_workload_healthy/);
  assert.match(script, /w\.get\("state"\)=="HEALTHY" and not r\.get\("lastError"\)/);
});

test("guard stays fail-closed and does not mutate database history", () => {
  assert.match(script, /paper supervisor inactive; no watchdog restart/);
  assert.match(script, /paper endpoint unhealthy; no blind restart/);
  assert.equal((script.match(/systemctl restart nusa\.service/g) ?? []).length, 1, "PAPER restart exists only in the PUBLIC_MARKET_FAILED bounded recovery path");
  assert.match(script, /mcp health degraded while PAPER upstream is unavailable; suppressing dependent-service restart/);
  assert.doesNotMatch(script, /sqlite3|DELETE FROM|UPDATE\s+.+SET|INSERT INTO|VACUUM/i);
  assert.doesNotMatch(script, /liveAuthority|productionMutationAllowed|aiAuthority/i);
});

test("systemd owner remains one bounded timer-driven guard", () => {
  assert.match(service, /^Type=oneshot$/m);
  assert.match(service, /^TimeoutStartSec=15min$/m);
  assert.match(service, /^ExecStart=\/usr\/local\/sbin\/nusa-health-guard$/m);
  assert.match(timer, /^OnBootSec=4min$/m);
  assert.match(timer, /^OnUnitActiveSec=5min$/m);
  assert.match(timer, /^RandomizedDelaySec=30s$/m);
  assert.match(timer, /^Persistent=true$/m);
});
