const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { spawnSync } = require("node:child_process");

const helper = fs.readFileSync("deploy/oracle/nusa-release-step.sh", "utf8");
const blockPredicate = helper.match(/^backup_device_is_block\(\) \{[\s\S]*?^\}/m)?.[0];
const directDiskPredicate = helper.match(/^backup_device_is_direct_disk_name\(\) \{[\s\S]*?^\}/m)?.[0];
const directoryPredicate = helper.match(/^backup_path_is_directory\(\) \{[\s\S]*?^\}/m)?.[0];
const resolver = helper.match(/^backup_block_device_for_paths\(\) \{[\s\S]*?^\}/m)?.[0];
assert.ok(blockPredicate, "root-owned helper must define the block-device predicate");
assert.ok(directDiskPredicate, "root-owned helper must define the strict direct-disk predicate");
assert.ok(directoryPredicate, "root-owned helper must define the backup-directory predicate");
assert.ok(resolver, "root-owned helper must contain the canonical backup topology resolver");

function runResolver({ mounts, devices, blocks = ["/dev/sda1", "/dev/sda"] }) {
  const quote = (value) => `'${String(value).replaceAll("'", "'\\''")}'`;
  const mountCases = Object.entries(mounts).map(([key, value]) => `${quote(key)}) printf '%s\\n' ${quote(value)} ;;`).join("\n");
  const deviceCases = Object.entries(devices).map(([key, value]) => `${quote(key)}) printf '%s\\n' ${quote(value)} ;;`).join("\n");
  const allowedBlocks = new Set(blocks);
  const blockOverride = `backup_device_is_block() { case "$1" in ${[...allowedBlocks].map((item) => `${item}) return 0 ;;`).join(" ")} *) return 1 ;; esac; }`;
  const script = `set -uo pipefail
die() { printf '%s\\n' "$*" >&2; return 1; }
${blockPredicate}
${directDiskPredicate}
${directoryPredicate}
${blockOverride}
backup_device_is_direct_disk_name() { case "$1" in /dev/sda|/dev/sdb|/dev/nvme0n1) return 0 ;; *) return 1 ;; esac; }
backup_path_is_directory() { return 0; }
findmnt() {
  local output="" target="" previous="" arg
  for arg in "$@"; do
    if [[ "$previous" == --output ]]; then output="$arg"; fi
    if [[ "$previous" == --target ]]; then target="$arg"; fi
    previous="$arg"
  done
  case "$output:$target" in
${mountCases}
    *) return 2 ;;
  esac
}
lsblk() {
  local output="" device="" previous="" arg
  for arg in "$@"; do
    if [[ "$previous" == --output ]]; then output="$arg"; fi
    device="$arg"
    previous="$arg"
  done
  case "$output:$device" in
${deviceCases}
    *) return 2 ;;
  esac
}
${resolver}
backup_block_device_for_paths "$@"`;
  // Pass the multiline harness over stdin. Windows CreateProcess quoting can
  // corrupt a large `bash -c <script>` argument before Git Bash receives it.
  return spawnSync("bash", ["-s", "--", "/var/lib/nusa/state.sqlite", "/var/backups/nusa"], {
    encoding: "utf8",
    input: script,
  });
}

function singleDisk({ stateSource = "/dev/sda1", backupSource = stateSource, stateFs = "ext4", backupFs = stateFs } = {}) {
  const mounts = {
    "SOURCE:/var/lib/nusa/state.sqlite": stateSource,
    "FSTYPE:/var/lib/nusa/state.sqlite": stateFs,
    "SOURCE:/var/backups/nusa": backupSource,
    "FSTYPE:/var/backups/nusa": backupFs,
  };
  const devices = {
    [`TYPE:${stateSource}`]: stateSource === "/dev/sda" ? "disk" : "part",
    [`PKNAME:${stateSource}`]: stateSource === "/dev/sda" ? "" : "sda",
    [`TYPE:${backupSource}`]: backupSource === "/dev/sda" ? "disk" : "part",
    [`PKNAME:${backupSource}`]: backupSource === "/dev/sda" ? "" : "sda",
    "TYPE:/dev/sda": "disk",
  };
  return { mounts, devices };
}

test("the installed root-owned helper resolves the first backup without reading a resolver from the old release", () => {
  const helperDefinition = helper.indexOf("backup_block_device_for_paths() {");
  const dispatch = helper.indexOf('case "$verb" in');
  const backupStart = helper.indexOf("  backup)");
  const backupCase = helper.slice(backupStart, helper.indexOf("\n\n  preflight)", backupStart));
  assert.ok(helperDefinition >= 0 && helperDefinition < dispatch);
  assert.match(backupCase, /backup_block_device_for_paths "\$state_db" "\$backup_dir"/);
  assert.doesNotMatch(backupCase, /script_in .*oracle-backup-device/);
  assert.match(backupCase, /IOReadBandwidthMax=\$\{backup_device\} 1048576/);
  assert.match(backupCase, /IOWriteBandwidthMax=\$\{backup_device\} 1048576/);

  const fixture = singleDisk();
  const result = runResolver(fixture);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "/dev/sda");
});

test("the verified database and backup directory can share a single ext4 or xfs disk", () => {
  for (const filesystem of ["ext4", "xfs"]) {
    const result = runResolver(singleDisk({ stateFs: filesystem, backupFs: filesystem }));
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "/dev/sda");
  }
});

test("multi-device and unsupported filesystems fail closed", () => {
  const btrfs = singleDisk({ stateFs: "btrfs", backupFs: "btrfs" });
  const btrfsResult = runResolver(btrfs);
  assert.notEqual(btrfsResult.status, 0);
  assert.match(btrfsResult.stderr, /filesystem type is not supported/);

  const bindMount = singleDisk({ stateSource: "/dev/sda1[/var/lib/nusa]" });
  const bindResult = runResolver({ ...bindMount, blocks: [] });
  assert.notEqual(bindResult.status, 0);
  assert.match(bindResult.stderr, /verified local block device/);
});

test("backup data on a different disk fails closed instead of leaving writes uncapped", () => {
  const fixture = singleDisk({ backupSource: "/dev/sdb1" });
  Object.assign(fixture.devices, {
    "TYPE:/dev/sdb1": "part",
    "PKNAME:/dev/sdb1": "sdb",
    "TYPE:/dev/sdb": "disk",
  });
  const result = runResolver({ ...fixture, blocks: ["/dev/sda1", "/dev/sda", "/dev/sdb1", "/dev/sdb"] });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /different backing disks/);
});

test("direct disk device names are validated and ambiguous parent chains fail closed", () => {
  const direct = {
    mounts: {
      "SOURCE:/var/lib/nusa/state.sqlite": "/dev/sda",
      "FSTYPE:/var/lib/nusa/state.sqlite": "ext4",
      "SOURCE:/var/backups/nusa": "/dev/sda",
      "FSTYPE:/var/backups/nusa": "ext4",
    },
    devices: { "TYPE:/dev/sda": "disk", "PKNAME:/dev/sda": "" },
  };
  const directResult = runResolver({ ...direct, blocks: ["/dev/sda"] });
  assert.equal(directResult.status, 0, directResult.stderr);
  assert.equal(directResult.stdout, "/dev/sda");

  const badName = runResolver({
    mounts: { ...direct.mounts, "SOURCE:/var/lib/nusa/state.sqlite": "/dev/sda[bad]" },
    devices: direct.devices,
    blocks: ["/dev/sda[bad]", "/dev/sda"],
  });
  assert.notEqual(badName.status, 0);
  assert.match(badName.stderr, /verified local block device/);

  const singleParentLayered = {
    ...singleDisk({ stateSource: "/dev/mapper/nusa" }),
    devices: {
      "TYPE:/dev/mapper/nusa": "lvm",
      "PKNAME:/dev/mapper/nusa": "sda",
      "TYPE:/dev/sda": "disk",
    },
  };
  const layered = runResolver({ ...singleParentLayered, blocks: ["/dev/mapper/nusa", "/dev/sda"] });
  assert.notEqual(layered.status, 0);
  assert.match(layered.stderr, /topology is ambiguous/);

  const multipleParents = {
    ...singleDisk({ stateSource: "/dev/mapper/nusa" }),
    devices: {
      "TYPE:/dev/mapper/nusa": "lvm",
      "PKNAME:/dev/mapper/nusa": "sda2\\nsdb2",
      "TYPE:/dev/sda": "disk",
    },
  };
  const ambiguous = runResolver({ ...multipleParents, blocks: ["/dev/mapper/nusa", "/dev/sda"] });
  assert.notEqual(ambiguous.status, 0);
  assert.match(ambiguous.stderr, /topology is ambiguous/);
});

test("backup refuses to run when the cgroup v2 io controller is not available", () => {
  const predicate = helper.match(/^backup_io_controller_available\(\) \{[\s\S]*?^\}/m)?.[0];
  assert.ok(predicate, "root-owned helper must define the io controller preflight");
  const backupStart = helper.indexOf("  backup)");
  const backupCase = helper.slice(backupStart, helper.indexOf("\n\n  preflight)", backupStart));
  assert.ok(
    backupCase.indexOf("backup_io_controller_available ||") !== -1
      && backupCase.indexOf("backup_io_controller_available ||") < backupCase.indexOf("exec systemd-run"),
    "controller check must precede the capped backup exec",
  );
  const run = (controllers) => spawnSync("bash", ["-s"], {
    input: `${predicate.replace("/sys/fs/cgroup/cgroup.controllers", "/dev/fd/3")}\nbackup_io_controller_available 3<<<'${controllers}'`,
    encoding: "utf8",
  });
  assert.equal(run("cpuset cpu io memory pids").status, 0);
  assert.notEqual(run("cpuset cpu memory pids").status, 0);
  assert.notEqual(run("cpuset cpu ionice memory").status, 0);
});

test("backup verifies the applied io.max inside the transient scope before running node", () => {
  const check = helper.match(/^BACKUP_SCOPE_CAP_CHECK='([^\n]*)'$/m)?.[1];
  assert.ok(check, "root-owned helper must define the in-scope cap check");
  const backupStart = helper.indexOf("  backup)");
  const backupCase = helper.slice(backupStart, helper.indexOf("\n\n  preflight)", backupStart));
  assert.match(backupCase, /backup_device_major_minor "\$backup_device"/);
  assert.match(backupCase, /bash -c "\$BACKUP_SCOPE_CAP_CHECK" backup-cap-check "\$backup_major_minor"/);
  assert.ok(
    backupCase.indexOf("backup-cap-check") < backupCase.indexOf("nice -n 19 runuser"),
    "cap read-back must run before the backup command",
  );
  const fs2 = require("node:fs");
  const os = require("node:os");
  const path = require("node:path");
  const dir = fs2.mkdtempSync(path.join(os.tmpdir(), "nusa-cg-"));
  const scoped = check.replace('"/sys/fs/cgroup$(sed -n "s/^0:://p" /proc/self/cgroup)"', JSON.stringify(dir));
  const run = (ioMax) => {
    const file = path.join(dir, "io.max");
    fs2.rmSync(file, { force: true });
    if (ioMax !== null) fs2.writeFileSync(file, ioMax);
    return spawnSync("bash", ["-c", scoped, "backup-cap-check", "8:0", "true"], { encoding: "utf8" });
  };
  assert.equal(run("8:0 rbps=1048576 wbps=1048576 riops=max wiops=max\n").status, 0);
  assert.notEqual(run("8:0 rbps=max wbps=max riops=max wiops=max\n").status, 0);
  assert.notEqual(run("8:16 rbps=1048576 wbps=1048576 riops=max wiops=max\n").status, 0);
  assert.notEqual(run("8:0 rbps=10485760 wbps=1048576 riops=max wiops=max\n").status, 0);
  assert.notEqual(run(null).status, 0);
});
