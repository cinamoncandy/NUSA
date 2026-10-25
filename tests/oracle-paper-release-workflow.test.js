const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const workflow = fs.readFileSync(".github/workflows/oracle-paper-release.yml", "utf8");
const wrapper = fs.readFileSync("deploy/oracle/nusa-release-step.sh", "utf8").replaceAll("\r\n", "\n");
const runbook = fs.readFileSync("docs/operations/oracle-p1-008-runbook.md", "utf8");
const readiness = fs.readFileSync("scripts/oracle-readiness-check.js", "utf8");

/**
 * The Oracle PAPER host drifted behind protected main with nothing able to correct it (#1816).
 * Every step already existed as a script; what was missing was anything that ran them in the
 * runbook's order.
 *
 * The privileged work is routed through a single wrapper so sudoers grants one command instead of
 * eleven, two of which were wildcards: `tar *` can write any path on the host, and
 * `rm -rf /opt/nusa/releases/*` expanded a variable the caller controlled. These assertions cover
 * both halves -- the workflow calls the verbs in order, and the wrapper enforces what each verb is
 * allowed to do.
 */

const orderIn = (text, needles) => {
  const positions = needles.map((needle) => {
    const index = text.indexOf(needle);
    assert.ok(index > 0, `expected to find ${needle}`);
    return index;
  });
  for (let i = 1; i < positions.length; i += 1) {
    assert.ok(positions[i] > positions[i - 1], `${needles[i]} must come after ${needles[i - 1]}`);
  }
};

test("the release refuses a source that is not exact protected main", () => {
  assert.match(workflow, /Refusing stale Oracle release/);
  assert.match(workflow, /\^\[0-9a-f\]\{40\}\$/);
  assert.match(workflow, /branches\/main/);
});

test("the release requires successful exact-source CI, found by a paginated lookup", () => {
  assert.match(workflow, /has no successful canonical CI run/);
  assert.match(workflow, /--paginate/, "a first-page lookup ages out and must not be used");
  assert.match(workflow, /actions\/workflows\/ci\.yml\/runs/);
});

test("the small PAPER host receives a sealed build instead of installing or building dependencies", () => {
  const prepare = workflow.slice(workflow.indexOf("  prepare:"), workflow.indexOf("  release:"));
  const release = workflow.slice(workflow.indexOf("  release:"));
  assert.match(prepare, /runs-on: ubuntu-latest/);
  assert.match(prepare, /pnpm install --frozen-lockfile/);
  assert.match(prepare, /pnpm run build/);
  assert.match(release, /needs: prepare/);
  assert.match(release, /runs-on: \[self-hosted, Linux, nusa-paper-host\]/);
  assert.match(release, /sha256sum --check --status/);
  assert.ok(release.indexOf("sha256sum --check --status") < release.indexOf('"$STEP" backup'));
  assert.doesNotMatch(release, /pnpm install|pnpm run build/);
});

test("the host drops only the verified temporary archive after extraction", () => {
  const unpackStart = workflow.indexOf("Verify and unpack the exact built release");
  const unpackEnd = workflow.indexOf("Require reviewed host release helper exact match", unpackStart);
  const unpack = workflow.slice(unpackStart, unpackEnd);
  orderIn(unpack, ["sha256sum --check --status", 'tar -xzf "$RUNNER_TEMP/nusa-release.tar.gz"', 'rm -- "$RUNNER_TEMP/nusa-release.tar.gz"']);
});

test("the host privileged helper must exactly match the reviewed release helper before backup", () => {
  const release = workflow.slice(workflow.indexOf("  release:"));
  const helperGate = release.indexOf("Require reviewed host release helper exact match");
  const backup = release.indexOf("Back up persistent state before touching the release");
  assert.ok(helperGate > 0 && helperGate < backup, "helper drift must fail before any backup or release mutation");
  assert.match(release, /cmp --silent "\$STEP" "\$RELEASE_TREE\/deploy\/oracle\/nusa-release-step\.sh"/);
  assert.match(release, /Host release helper differs from exact reviewed source/);
});

test("the privileged backup uses the configured runtime state database", () => {
  const backupStart = wrapper.indexOf("  backup)");
  const backupEnd = wrapper.indexOf("\n\n  preflight)", backupStart);
  const backup = wrapper.slice(backupStart, backupEnd);
  assert.ok(backup.length > 0);
  assert.match(backup, /source "\$RUNTIME_ENV"/, "backup must read the canonical runtime env without printing it");
  assert.match(backup, /NUSA_CLOUD_STATE_DB_PATH/);
  assert.match(backup, /backup_block_device_for_paths "\$state_db" "\$backup_dir"/, "the installed root-owned helper must resolve both DB and backup devices before the first release");
  assert.match(backup, /IOReadBandwidthMax=\$\{backup_device\} 1048576/);
  assert.match(backup, /IOWriteBandwidthMax=\$\{backup_device\} 1048576/);
  assert.ok(backup.indexOf("backup_block_device_for_paths") < backup.indexOf("systemd-run"), "topology validation must fail before the backup process starts");
  assert.match(backup, /systemd-run --quiet --collect --scope/, "backup must run in a dedicated transient cgroup");
  assert.match(backup, /nice -n 19 runuser -u "\$SERVICE_USER"/, "backup must yield CPU priority to the foreground PAPER runtime");
  assert.match(backup, /env NUSA_DB="\$state_db"/, "sqlite-backup must target the configured durable runtime database");
  assert.match(backup, /Cloud state path must be absolute before backup/);
});

test("the measured backup I/O cap fits the bounded host job without extending readiness or soak gates", () => {
  const release = workflow.slice(workflow.indexOf("  release:"));
  // Conservative production envelope recorded by WO-OPS-20261025-ORACLE-BACKUP-IO-THROTTLE.
  // Six full-file phases are VACUUM INTO, daily integrity/hash, weekly copy, and weekly
  // integrity/hash. The 15-minute non-backup reserve includes the existing readiness and soak.
  const databaseMiB = 957;
  const observedMiBPerSecond = 0.8;
  const fullFilePhases = 6;
  const backupSafetyMargin = 0.30;
  const nonBackupObservedMinutes = 661 / 60;
  const nonBackupReserveMinutes = Math.ceil(nonBackupObservedMinutes / 5) * 5;
  const backupRoundUpToMinutes = 10;
  const jobRoundUpToMinutes = 10;
  const rawBackupMinutes = (databaseMiB * fullFilePhases) / observedMiBPerSecond / 60;
  const backupRequiredMinutes = rawBackupMinutes * (1 + backupSafetyMargin);
  const backupBudgetMinutes = Math.ceil(backupRequiredMinutes / backupRoundUpToMinutes) * backupRoundUpToMinutes;
  const jobRequiredMinutes = backupBudgetMinutes + nonBackupReserveMinutes;
  const jobBudgetMinutes = Math.ceil(jobRequiredMinutes / jobRoundUpToMinutes) * jobRoundUpToMinutes;
  const jobTimeout = Number(release.match(/timeout-minutes:\s*(\d+)/)?.[1]);
  const backupStep = release.match(/- name: Back up persistent state before touching the release\n\s+if:[^\n]+\n\s+timeout-minutes:\s*(\d+)/);

  assert.equal(Math.round(rawBackupMinutes * 10) / 10, 119.6);
  assert.equal(backupBudgetMinutes, 160);
  assert.equal(nonBackupReserveMinutes, 15);
  assert.equal(jobBudgetMinutes, 180);
  assert.equal(Number(backupStep?.[1]), backupBudgetMinutes, "slow backup must fail before staging or activation");
  assert.ok(jobTimeout >= jobBudgetMinutes, "outer job timeout must cover bounded backup and measured release reserve");
  assert.match(readiness, /NUSA_READY_STARTUP_WAIT_MS \|\| 300_000/);
  assert.match(readiness, /startupWaitMs > 300_000/);
  assert.match(wrapper, /POST_ACTIVATION_SOAK_SECONDS=180/);
});

test("the workflow runs the release verbs in the runbook's order", () => {
  // Staging precedes preflight because the runbook runs both checks from the exact release tree.
  // Activation owns switch + unit convergence + readiness + rollback as one fail-closed boundary.
  orderIn(workflow, ['"$STEP" backup', '"$STEP" stage', '"$STEP" preflight', '"$STEP" activate']);
  assert.doesNotMatch(workflow, /"\$STEP"\s+(switch|restart|readiness|rollback)\b/, "activation must not be split across workflow steps");
});

test("a release that cannot prove either runtime ready is rolled back, not left serving", () => {
  const activateStart = wrapper.indexOf("  activate)");
  const activateEnd = wrapper.indexOf("\n  rollback)", activateStart);
  const activateCase = wrapper.slice(activateStart, activateEnd);
  assert.ok(activateCase.length > 0, "activate must be an explicit wrapper case");
  orderIn(activateCase, ["atomic-deploy.js", "bind_runtime_source_identity", "install_units_from_release", "enable_units", "restart_units", "oracle-readiness-check.js", "autopilot-readiness.js"]);
  assert.match(activateCase, /rollback_and_restore/, "activation failure must restore the previous release and unit set");
  assert.match(activateCase, /systemctl is-active --quiet "\$SERVICE"/);
  assert.match(activateCase, /systemctl is-active --quiet "\$AUTOPILOT_SERVICE"/);

  const rollbackHelper = wrapper.slice(wrapper.indexOf("rollback_and_restore()"), wrapper.indexOf("\n}\n", wrapper.indexOf("rollback_and_restore()")) + 2);
  orderIn(rollbackHelper, ["rollback_legacy_ok=true", "nusa-autopilot.service", "NUSA_DEPLOY_ACTION=rollback", "bind_runtime_source_identity", "install_units_from_release", "enable_units", "restart_units"]);
  assert.match(rollbackHelper, /rollback_legacy_ok=false/, "a modern rollback release must restart its own Autopilot runtime");
  assert.match(rollbackHelper, /restart_units "\$rollback_legacy_ok"/, "rollback restart policy must follow the rollback release capability");
  assert.doesNotMatch(rollbackHelper, /restart_units true/, "modern rollback must not unconditionally leave the candidate Autopilot running");
  assert.doesNotMatch(wrapper, /scripts\/[a-z0-9-]*restore[a-z0-9-]*\.js/i);
  assert.doesNotMatch(rollbackHelper, /rm\s+-rf\s+\/var\/lib\/nusa|DROP\s+TABLE/i, "the failure path must not touch persistent state");
});

test("writer lease recovery is diagnosis-scoped, fail-closed, and bounded to one retry", () => {
  const recoverStart = wrapper.indexOf("recover_abandoned_writer_lease_once()");
  const recoverEnd = wrapper.indexOf("\n}\n", recoverStart) + 2;
  const recover = wrapper.slice(recoverStart, recoverEnd);
  assert.ok(recover.length > 0);
  assert.match(recover, /journalctl -u "\$SERVICE" --since "\$since"/, "old journal evidence must not authorize recovery");
  assert.match(recover, /PAPER_WRITER_CLOCK_ANOMALY/);
  assert.match(recover, /reset-paper-writer-lease\.js/);
  assert.match(recover, /runuser -u "\$SERVICE_USER"/, "lease reset must not run as root");
  orderIn(recover, ["reset-paper-writer-lease.js", "restart_units", "oracle-readiness-check.js"]);

  const activateStart = wrapper.indexOf("  activate)");
  const activateEnd = wrapper.indexOf("\n  rollback)", activateStart);
  const activate = wrapper.slice(activateStart, activateEnd);
  assert.equal((activate.match(/recover_abandoned_writer_lease_once/g) ?? []).length, 1, "activation gets exactly one recovery attempt");
  assert.match(activate, /activation_started=.*date --iso-8601=seconds/);
  assert.match(activate, /paper_ready=false/);
  assert.match(activate, /rollback_and_restore/, "failed recovery must retain the existing rollback boundary");
  assert.doesNotMatch(recover, /DELETE|DROP|UPDATE|INSERT|\/var\/lib\/nusa/, "the privileged wrapper must delegate persistent-state safety to the canonical reset script");
});

test("activation owns a bounded post-readiness stability soak and disk guard", () => {
  assert.match(wrapper, /readonly ROOT_DISK_GUARD_PERCENT=92/);
  assert.match(wrapper, /readonly ROOT_DISK_STAGE_MARGIN_BYTES=536870912/);
  assert.match(wrapper, /readonly POST_ACTIVATION_SOAK_SECONDS=180/);
  assert.match(wrapper, /readonly POST_ACTIVATION_CHECK_INTERVAL_SECONDS=10/);
  assert.match(wrapper, /readonly POST_ACTIVATION_ROUTE_PROOF_WINDOW_MS=30000/);
  assert.match(wrapper, /readonly POST_ACTIVATION_READY_WINDOW_MS=30000/);
  assert.match(wrapper, /readonly POST_ACTIVATION_READY_TIMEOUT_MS=2000/);
  assert.match(wrapper, /readonly POST_ACTIVATION_READY_RETRY_DELAY_MS=500/);
  assert.match(runbook, /Initial authenticated `\/ready` keeps the 300-second cold-start budget, with each request capped at 5 seconds and 1-second retry delay\./);
  assert.match(runbook, /initial activation uses each route request cap of 5 seconds and a 1-second retry delay\./);
  assert.match(runbook, /During soak, authenticated `\/ready` uses a bounded 30-second retry window, with each request capped at 2 seconds and 500 ms retry delay/);
  assert.match(runbook, /post-activation checks, with route requests capped at 2 seconds and a 500 ms retry delay/);

  const routeProofWindow = Number(wrapper.match(/readonly POST_ACTIVATION_ROUTE_PROOF_WINDOW_MS=(\d+)/)?.[1]);
  const readyWindow = Number(wrapper.match(/readonly POST_ACTIVATION_READY_WINDOW_MS=(\d+)/)?.[1]);
  const requestTimeout = Number(wrapper.match(/readonly POST_ACTIVATION_READY_TIMEOUT_MS=(\d+)/)?.[1]);
  const retryDelay = Number(wrapper.match(/readonly POST_ACTIVATION_READY_RETRY_DELAY_MS=(\d+)/)?.[1]);
  const twoAttemptsAcrossBothOwnerRoutes = 2 * ((2 * requestTimeout) + retryDelay);
  assert.equal(readyWindow, 30_000, "post-activation /ready retries must survive the observed startup stall class without using the long cold-start budget");
  assert.ok(readyWindow < 180_000, "post-activation /ready proof remains bounded inside the 180s soak");
  assert.ok(
    routeProofWindow >= twoAttemptsAcrossBothOwnerRoutes,
    "route proof must let both owner routes each survive one transient timeout without weakening /ready failure speed",
  );

  const diskStart = wrapper.indexOf("assert_root_disk_headroom()");
  const diskEnd = wrapper.indexOf("\n}\n", diskStart) + 2;
  const disk = wrapper.slice(diskStart, diskEnd);
  assert.match(disk, /df -P \/|ROOT_DISK_GUARD_PERCENT/);

  const stageGateStart = wrapper.indexOf("assert_stage_disk_headroom()");
  const stageGateEnd = wrapper.indexOf("\n}\n", stageGateStart) + 2;
  const stageGate = wrapper.slice(stageGateStart, stageGateEnd);
  assert.match(stageGate, /du -sb/);
  assert.match(stageGate, /stat -c '%d'/);
  assert.match(stageGate, /source_device.*release_device/);
  assert.match(stageGate, /ROOT_DISK_STAGE_MARGIN_BYTES/);
  assert.match(stageGate, /ROOT_DISK_GUARD_PERCENT/);

  const stageCaseStart = wrapper.indexOf("  stage)");
  const stageCaseEnd = wrapper.indexOf("\n\n  switch)", stageCaseStart);
  assert.match(wrapper.slice(stageCaseStart, stageCaseEnd), /assert_stage_disk_headroom "\$source_tree"/);
  const stageCase = wrapper.slice(stageCaseStart, stageCaseEnd);
  assert.match(stageCase, /mv --no-copy -T -- "\$source_tree" "\$dir"/);
  assert.match(stageCase, /assert_stage_disk_headroom "\$source_tree" true/);
  assert.match(stageCase, /tar -cf - .*tar -xf -/s);
  orderIn(stageCase, ['mv --no-copy -T -- "$source_tree" "$dir"', 'assert_stage_disk_headroom "$source_tree" true', 'tar -cf - --exclude=.git -C "$source_tree" .']);

  const preflightStart = wrapper.indexOf("  preflight)");
  const preflightEnd = wrapper.indexOf("\n\n  install-units)", preflightStart);
  assert.match(wrapper.slice(preflightStart, preflightEnd), /assert_root_disk_headroom/);

  const soakStart = wrapper.indexOf("prove_post_activation_stability()");
  const soakEnd = wrapper.indexOf("\n}\n", soakStart) + 2;
  const soak = wrapper.slice(soakStart, soakEnd);
  assert.ok(soak.length > 0);
  assert.match(soak, /active_release_sha/);
  assert.match(soak, /oracle-readiness-check\.js/);
  assert.match(soak, /autopilot-readiness\.js/);
  assert.match(soak, /sleep "\$POST_ACTIVATION_CHECK_INTERVAL_SECONDS"/);
  assert.match(soak, /NUSA_READY_STARTUP_WAIT_MS="\$POST_ACTIVATION_READY_WINDOW_MS"/);
  assert.match(soak, /NUSA_READY_ROUTE_PROOF_WAIT_MS="\$POST_ACTIVATION_ROUTE_PROOF_WINDOW_MS"/);
  assert.match(wrapper, /POST_ACTIVATION_ROUTE_PROOF_WINDOW_MS=30000/);
  assert.match(soak, /NUSA_READY_TIMEOUT_MS="\$POST_ACTIVATION_READY_TIMEOUT_MS"/);
  assert.match(soak, /NUSA_READY_RETRY_DELAY_MS="\$POST_ACTIVATION_READY_RETRY_DELAY_MS"/);

  const activateStart = wrapper.indexOf("  activate)");
  const activateEnd = wrapper.indexOf("\n  readiness)", activateStart);
  const activate = wrapper.slice(activateStart, activateEnd);
  orderIn(activate, ["oracle-readiness-check.js", "autopilot-readiness.js", "prove_post_activation_stability", "activation accepted"]);
  assert.match(activate, /stability_ready=false/);
  assert.match(activate, /rollback_and_restore/, "failed soak must stay inside the activation rollback boundary");

  assert.doesNotMatch(workflow.slice(workflow.indexOf("  release:")), /rm -rf|find .* -delete/, "workflow deletion remains forbidden; disk admission belongs to the bounded helper");
});

test("every privileged action goes through the one wrapper command", () => {
  const sudoCalls = workflow.match(/sudo\s+\S+/g) ?? [];
  assert.ok(sudoCalls.length > 0);
  for (const call of sudoCalls) {
    assert.match(call, /sudo\s+"\$STEP"/, `sudoers must grant one command only, found: ${call}`);
  }
  assert.match(workflow, /STEP: \/opt\/nusa\/bin\/nusa-release-step/);
});

test("activation and rollback atomically bind runtime source identity to the selected release", () => {
  const bindStart = wrapper.indexOf("bind_runtime_source_identity()");
  const bindEnd = wrapper.indexOf("\n}\n", bindStart) + 2;
  const bind = wrapper.slice(bindStart, bindEnd);
  assert.ok(bind.length > 0);
  assert.match(bind, /NUSA_SOURCE_COMMIT=/);
  assert.match(bind, /NUSA_SOURCE_COMMIT_SHA=/);
  assert.match(bind, /chmod --reference/);
  assert.match(bind, /chown --reference/);
  assert.match(bind, /mv -f -- "\$tmp" "\$RUNTIME_ENV"/);
  assert.doesNotMatch(bind, /cat\s+"?\$RUNTIME_ENV"?/, "release must never print the secret-bearing runtime environment");

  const activateStart = wrapper.indexOf("  activate)");
  const activateEnd = wrapper.indexOf("\n  rollback)", activateStart);
  const activate = wrapper.slice(activateStart, activateEnd);
  orderIn(activate, ["atomic-deploy.js", "bind_runtime_source_identity", "restart_units"]);

  const rollbackStart = wrapper.indexOf("rollback_and_restore()");
  const rollbackEnd = wrapper.indexOf("\n}\n", rollbackStart) + 2;
  const rollback = wrapper.slice(rollbackStart, rollbackEnd);
  orderIn(rollback, ["NUSA_DEPLOY_ACTION=rollback", "bind_runtime_source_identity", "restart_units"]);
  assert.match(rollback, /active_release_sha/);
});

test("the wrapper lives outside the release tree it installs", () => {
  assert.match(workflow, /STEP: \/opt\/nusa\/bin\//, "a release must not be able to rewrite the root helper");
  assert.doesNotMatch(workflow, /STEP: \/opt\/nusa\/(current|releases)/);
});

test("the wrapper validates the SHA and confines privileged staging to the runner temp", () => {
  assert.match(wrapper, /\^\[0-9a-f\]\{40\}\$/, "the SHA is validated in the wrapper, not trusted from the caller");
  assert.match(wrapper, /release_dir\(\)/, "paths are rebuilt from the validated SHA");
  assert.match(wrapper, /RUNNER_TEMP_ROOT=\/opt\/actions-runner-nusa-paper\/_work\/_temp/);
  assert.match(wrapper, /nusa-release-tree-\[0-9\]\+/);
  assert.match(wrapper, /\[ -d "\$source_tree" \]/);
  assert.match(wrapper, /set -euo pipefail/);
});

test("the wrapper refuses an unknown verb instead of doing something else", () => {
  assert.match(wrapper, /unknown verb/);
  for (const verb of ["backup", "preflight", "install-units", "prune", "stage", "switch", "activate", "rollback", "restart", "readiness"]) {
    assert.match(wrapper, new RegExp(`^\\s*${verb}\\)`, "m"), `${verb} must be an explicit case`);
  }
});

test("the wrapper never restages the active release", () => {
  assert.match(wrapper, /refusing to restage the active release/);
});

test("bounded release pruning preserves rollback safety and validates before deletion", () => {
  const pruneStart = wrapper.indexOf("prune_releases()");
  const pruneEnd = wrapper.indexOf("\n}\n", pruneStart) + 2;
  const prune = wrapper.slice(pruneStart, pruneEnd);
  assert.match(prune, /active_release/);
  assert.match(prune, /previous_release/);
  assert.match(wrapper, /readonly RELEASE_RETENTION=0/);
  assert.match(prune, /Validate the entire candidate set before deleting anything/);
  assert.ok(prune.indexOf("unexpected release directory name") < prune.indexOf("rm -rf --"), "validation must dominate deletion");
  assert.match(prune, /\[ "\$dir" = "\$active" \] && continue/);
  assert.match(prune, /\[ -n "\$previous" \] && \[ "\$dir" = "\$previous" \] && continue/);
  assert.doesNotMatch(prune, /\/var\/lib\/nusa|\/var\/backups\/nusa/);
});

test("the wrapper runs the exact-release validation and activation scripts", () => {
  for (const script of ["sqlite-backup.js", "host-security-validate.js", "oracle-validate.js", "atomic-deploy.js", "oracle-readiness-check.js", "autopilot-readiness.js"]) {
    assert.ok(wrapper.includes(script), `${script} must be run by the wrapper`);
    assert.ok(fs.existsSync(`scripts/${script}`), `scripts/${script} must exist`);
  }
  for (const documented of ["sqlite-backup.js", "host-security-validate.js", "oracle-validate.js", "oracle-readiness-check.js", "autopilot-readiness.js"]) {
    assert.ok(runbook.includes(documented), `${documented} must remain documented for operators`);
  }
  assert.match(runbook, /nusa-release-step activate/, "the runbook must document the atomic activation boundary");
  assert.match(wrapper, /script_in\(\)/, "scripts are read from the release being deployed");
});

test("the release is dispatch-only and holds no repository write authority", () => {
  const on = workflow.slice(workflow.indexOf("\non:"), workflow.indexOf("permissions:"));
  assert.match(on, /workflow_dispatch:/);
  assert.doesNotMatch(on, /\bpush:/, "a production host writer must not run on every merge");
  assert.doesNotMatch(on, /schedule:/);
  assert.doesNotMatch(on, /pull_request/);
  assert.match(workflow, /permissions:\s*\n\s*contents: read/);
  assert.doesNotMatch(workflow, /contents: write/);
  assert.match(workflow, /nusa-paper-host/);
  assert.doesNotMatch(workflow, /nusa-codex-dev/, "the development runner's contract forbids deploying");
});

test("the deployed identity and fail-closed authority are always recorded", () => {
  assert.match(workflow, /currentRelease=/);
  // A superseded source skips every host step yet the run stays green; the receipt must say so.
  for (const result of ["SKIPPED_MAIN_MOVED", "FAILED", "DEPLOYED", "FAILED_ACTIVATION_IDENTITY"]) assert.match(workflow, new RegExp(`RESULT=${result}\\b`));
  assert.match(workflow, /SOURCE_FRESH: \$\{\{ steps\.source_fresh\.outputs\.fresh \}\}/);
  assert.match(workflow, /if \[ "\$SOURCE_FRESH" != "true" \]; then\r?\n\s+RESULT=SKIPPED_MAIN_MOVED/);
  assert.match(workflow, /\[ "\$\(basename "\$CURRENT_RELEASE"\)" = "\$SOURCE_SHA" \]/, "DEPLOYED only when current resolves to the requested source");
  assert.match(workflow, /deploymentResult=\$RESULT/);
  assert.match(workflow, />> "\$GITHUB_STEP_SUMMARY"/);
  assert.match(workflow, /liveAuthority=NONE/);
  assert.match(workflow, /productionMutationAllowed=false/);
  assert.match(workflow, /aiAuthority=ZERO_AUTHORITY/);
});


test("the privileged helper declares helper locals before expanding them under nounset", () => {
  const scriptIn = wrapper.slice(wrapper.indexOf("script_in()"), wrapper.indexOf("\n}\n", wrapper.indexOf("script_in()")) + 2);
  const unitIn = wrapper.slice(wrapper.indexOf("unit_in()"), wrapper.indexOf("\n}\n", wrapper.indexOf("unit_in()")) + 2);

  for (const helper of [scriptIn, unitIn]) {
    assert.match(helper, /local dir="\$1"\n\s*local name="\$2"\n\s*local path=/);
    assert.doesNotMatch(helper, /local dir="\$1" name="\$2" path=/);
  }
});


test("rollback restores a legacy release that predates the Autopilot systemd unit", () => {
  const rollbackStart = wrapper.indexOf("rollback_and_restore()");
  const rollbackEnd = wrapper.indexOf("\n}\n", rollbackStart) + 2;
  const rollback = wrapper.slice(rollbackStart, rollbackEnd);
  assert.match(rollback, /rollback_legacy_ok=true/);
  assert.match(rollback, /\[ -f "\$\{rollback_release\}\/deploy\/oracle\/nusa-autopilot\.service" \] && rollback_legacy_ok=false/);
  assert.match(rollback, /install_units_from_release "\$\(active_release\)" "\$rollback_legacy_ok"/);
  assert.match(rollback, /enable_units "\$rollback_legacy_ok"/);
  assert.match(rollback, /restart_units "\$rollback_legacy_ok"/);

  const installStart = wrapper.indexOf("install_units_from_release()");
  const installEnd = wrapper.indexOf("\n}\n", installStart) + 2;
  const installUnits = wrapper.slice(installStart, installEnd);
  assert.match(installUnits, /if \[ -f "\$\{dir\}\/deploy\/oracle\/nusa-autopilot\.service" \]/);
  assert.match(installUnits, /systemctl disable --now "\$\{AUTOPILOT_SERVICE\}"/);
  assert.match(installUnits, /rm -f -- "\$\{SYSTEMD_UNIT_DIR\}\/\$\{AUTOPILOT_SERVICE\}"/);
  assert.match(installUnits, /die "missing nusa-autopilot\.service/, "forward activation must still fail closed when the unit is missing");
});

test("superseded releases are pruned before the host is touched so a full disk cannot fail the backup", () => {
  const release = workflow.slice(workflow.indexOf("  release:"));
  const recheck = release.indexOf("Recheck exact protected main before host mutation");
  const prune = release.indexOf('sudo "$STEP" prune');
  const download = release.indexOf("Download built release");
  const backup = release.indexOf('"$STEP" backup');
  assert.ok(prune > recheck && prune < download, "prune must run after the main recheck and before the download");
  assert.ok(prune < backup, "prune must free space before the backup");
  assert.equal(release.split('"$STEP" prune').length - 1, 1, "prune is invoked exactly once");
  assert.doesNotMatch(release, /rm -rf|find .* -delete/, "the workflow itself never deletes; only the bounded helper does");
});
