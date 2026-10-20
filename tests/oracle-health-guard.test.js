const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const root = path.join(__dirname, "..");
const scriptPath = path.join(root, "deploy/oracle/nusa-health-guard");
const releasePath = path.join(root, "deploy/oracle/nusa-release-step.sh");
const servicePath = path.join(root, "deploy/oracle/nusa-health-guard.service");
const timerPath = path.join(root, "deploy/oracle/nusa-health-guard.timer");
const script = fs.readFileSync(scriptPath, "utf8");
const release = fs.readFileSync(releasePath, "utf8");
const service = fs.readFileSync(servicePath, "utf8");
const timer = fs.readFileSync(timerPath, "utf8");

test("Oracle health guard is valid POSIX shell", (t) => {
  const result = spawnSync("sh", ["-n", scriptPath], { encoding: "utf8" });
  if (result.error?.code === "ENOENT") return t.skip("POSIX sh is unavailable on this host; Linux CI runs this syntax check");
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
  assert.match(script, /ACTIVATION_LOCK_FILE=\/run\/lock\/nusa-paper-activation\.lock/);
  assert.match(script, /flock -n 9/);
  assert.match(script, /suppressing watchdog recovery without marker mutation/);
  assert.doesNotMatch(script, /pgrep/);
  assert.match(script, /UPBIT_PUBLIC_URL/);
  assert.match(script, /Upbit public REST unreachable; no restart/);
  assert.match(script, /systemctl restart nusa\.service/);
  assert.match(script, /wait_paper_workload_healthy/);
  assert.match(script, /w\.get\("state"\)=="HEALTHY" and not r\.get\("lastError"\)/);
});

test("release activation and watchdog recovery share an atomic exclusion lock", () => {
  assert.match(release, /readonly ACTIVATION_LOCK_FILE=\/run\/lock\/nusa-paper-activation\.lock/);
  assert.match(release, /acquire_paper_activation_lock\(\)/);
  for (const [verb, mutation] of [
    ["install-units", "install_units_from_release"],
    ["switch", "atomic-deploy.js"],
    ["rollback", "NUSA_DEPLOY_ACTION=rollback"],
    ["restart", "systemctl daemon-reload"],
    ["activate", "atomic-deploy.js"],
  ]) {
    const start = release.indexOf(`  ${verb})`);
    assert.notEqual(start, -1, `missing ${verb} verb`);
    const end = release.indexOf("\n    ;;", start);
    assert.notEqual(end, -1, `missing terminator for ${verb} verb`);
    const section = release.slice(start, end + 5);
    assert.ok(section.indexOf("acquire_paper_activation_lock") < section.indexOf(mutation), `${verb} must lock before ${mutation}`);
  }
  const rollback = release.slice(release.indexOf("  rollback)"), release.indexOf("\n  restart)"));
  assert.ok(rollback.indexOf("acquire_paper_activation_lock") < rollback.indexOf('rollback_release="$(previous_release)"'), "rollback must lock before reading its target");
  assert.ok(rollback.indexOf('rollback_release="$(previous_release)"') < rollback.indexOf('assert_segmented_replay_compatible "$rollback_release"'), "rollback target must be validated after it is read under lock");
  assert.ok(rollback.indexOf('assert_segmented_replay_compatible "$rollback_release"') < rollback.indexOf("NUSA_DEPLOY_ACTION=rollback"), "rollback must validate the locked target before switching");
  const activate = release.slice(release.indexOf("  activate)"));
  assert.ok(activate.indexOf("acquire_paper_activation_lock") < activate.indexOf('node "$(script_in "$dir" atomic-deploy.js)"'));
  assert.match(release, /exec 9>>"\$ACTIVATION_LOCK_FILE"/);
  assert.match(release, /flock 9 \|\| die/);

  const recover = script.slice(script.indexOf("maybe_recover_public_market()"), script.indexOf("rc=0"));
  assert.ok(recover.indexOf("acquire_recovery_lock") < recover.indexOf('probe "$UPBIT_PUBLIC_URL"'));
  assert.ok(recover.indexOf("acquire_recovery_lock") < recover.indexOf('mv -f "$tmp" "$MARKER"'));
  assert.ok(recover.indexOf("acquire_recovery_lock") < recover.indexOf("systemctl restart nusa.service"));
  const initialSample = recover.indexOf("failure=$(paper_workload_failure)");
  const lockedSample = recover.indexOf("failure=$(paper_workload_failure)", initialSample + 1);
  assert.ok(initialSample < recover.indexOf("acquire_recovery_lock") && recover.indexOf("acquire_recovery_lock") < lockedSample);
  assert.ok(lockedSample < recover.indexOf('if [ -r "$MARKER" ]'));
});

test("flock is kernel-released after failed owner exits", (t) => {
  const flockVersion = spawnSync("flock", ["--version"], { encoding: "utf8" });
  if (flockVersion.error?.code === "ENOENT") return t.skip("util-linux flock is unavailable on this host; Linux CI runs this lock recovery check");
  const os = require("node:os");
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-health-guard-lock-release-"));
  const lock = path.join(temp, "paper.lock");
  const marker = path.join(temp, "later-operation");
  try {
    const result = spawnSync("sh", ["-c", [
      'flock "$1" -c "exit 7" || true',
      'flock -n "$1" -c "touch \\\"$2\\\""',
      '[ -e "$2" ]',
    ].join("\n"), "nusa-lock-release-test", lock, marker], { encoding: "utf8", timeout: 5000 });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(fs.existsSync(marker), true);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("a contended shared flock runs no watchdog-side mutation", (t) => {
  const flockVersion = spawnSync("flock", ["--version"], { encoding: "utf8" });
  if (flockVersion.error?.code === "ENOENT") return t.skip("util-linux flock is unavailable on this host; Linux CI runs this contention check");
  const os = require("node:os");
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-health-guard-lock-"));
  const lock = path.join(temp, "paper.lock");
  const marker = path.join(temp, "marker");
  try {
    const result = spawnSync("sh", ["-c", [
      'flock -n "$1" -c "sleep 1" & holder=$!',
      "sleep 0.1",
      'if flock -n "$1" -c "touch \\\"$2\\\""; then exit 1; fi',
      'wait "$holder"',
      '[ ! -e "$2" ]',
    ].join("\n"), "nusa-lock-test", lock, marker], { encoding: "utf8", timeout: 5000 });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(fs.existsSync(marker), false);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("release activation waits for an in-progress watchdog recovery lock holder", (t) => {
  const flockVersion = spawnSync("flock", ["--version"], { encoding: "utf8" });
  if (flockVersion.error?.code === "ENOENT") return t.skip("util-linux flock is unavailable on this host; Linux CI runs this contention check");
  const os = require("node:os");
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-health-guard-lock-order-"));
  const lock = path.join(temp, "paper.lock");
  const guardReady = path.join(temp, "guard-ready");
  const releaseAcquired = path.join(temp, "release-acquired");
  try {
    const result = spawnSync("sh", ["-c", [
      'flock -n "$1" -c \'touch "$2"; sleep 0.3\' & holder=$!',
      'i=0; while [ ! -e "$2" ] && [ "$i" -lt 100 ]; do sleep 0.01; i=$((i+1)); done',
      '[ -e "$2" ] || exit 2',
      'flock "$1" -c \'touch "$3"\'',
      'wait "$holder"',
      '[ -e "$3" ]',
    ].join("\n"), "nusa-lock-order-test", lock, guardReady, releaseAcquired], { encoding: "utf8", timeout: 5000 });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(fs.existsSync(releaseAcquired), true);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
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

test("host convergence requires matching guard and canonical release helper", () => {
  const operations = fs.readFileSync(path.join(root, "docs/operations/oracle-health-guard.md"), "utf8");
  assert.match(operations, /must be installed from the same reviewed source before enabling the guard timer/);
  assert.match(operations, /deploy\/oracle\/nusa-release-step\.sh \/opt\/nusa\/bin\/nusa-release-step/);
  assert.match(operations, /cmp --silent deploy\/oracle\/nusa-release-step\.sh \/opt\/nusa\/bin\/nusa-release-step/);
});
