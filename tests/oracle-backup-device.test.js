const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { spawnSync } = require("node:child_process");

const helper = fs.readFileSync("deploy/oracle/nusa-release-step.sh", "utf8");
const blockPredicate = helper.match(/^backup_device_is_block\(\) \{[\s\S]*?^\}/m)?.[0];
const directoryPredicate = helper.match(/^backup_path_is_directory\(\) \{[\s\S]*?^\}/m)?.[0];
const resolver = helper.match(/^backup_block_device_for_paths\(\) \{[\s\S]*?^\}/m)?.[0];
assert.ok(blockPredicate, "root-owned helper must define the block-device predicate");
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
${directoryPredicate}
${blockOverride}
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
  return spawnSync("bash", ["-c", script, "nusa-test", "/var/lib/nusa/state.sqlite", "/var/backups/nusa"], { encoding: "utf8" });
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
  const badName = runResolver({
    mounts: { ...direct.mounts, "SOURCE:/var/lib/nusa/state.sqlite": "/dev/sda[bad]" },
    devices: direct.devices,
    blocks: ["/dev/sda[bad]", "/dev/sda"],
  });
  assert.notEqual(badName.status, 0);
  assert.match(badName.stderr, /verified local block device/);

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
