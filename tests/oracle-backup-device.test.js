const test = require("node:test");
const assert = require("node:assert/strict");
const { resolveBackupBlockDevice } = require("../scripts/oracle-backup-device.js");

function topology(entries, isBlockDevice = () => true) {
  const calls = [];
  return {
    calls,
    resolve: (path) => resolveBackupBlockDevice(path, {
      isBlockDevice,
      run(command, args) {
        calls.push([command, args]);
        const key = `${command} ${args.join(" ")}`;
        if (!(key in entries)) throw new Error(`unexpected topology query: ${key}`);
        return entries[key];
      },
    }),
  };
}

test("a partition-backed state database resolves to its verified parent disk", () => {
  const fixture = topology({
    "findmnt --noheadings --raw --output SOURCE --target /var/lib/nusa/state.sqlite": "/dev/sda1",
    "lsblk --noheadings --raw --nodeps --output TYPE /dev/sda1": "part",
    "lsblk --noheadings --raw --output PKNAME /dev/sda1": "sda",
    "lsblk --noheadings --raw --nodeps --output TYPE /dev/sda": "disk",
  });
  assert.equal(fixture.resolve("/var/lib/nusa/state.sqlite"), "/dev/sda");
});

test("a filesystem directly on one disk uses that disk", () => {
  const fixture = topology({
    "findmnt --noheadings --raw --output SOURCE --target /var/lib/nusa/state.sqlite": "/dev/nvme0n1",
    "lsblk --noheadings --raw --nodeps --output TYPE /dev/nvme0n1": "disk",
    "lsblk --noheadings --raw --output PKNAME /dev/nvme0n1": "",
  });
  assert.equal(fixture.resolve("/var/lib/nusa/state.sqlite"), "/dev/nvme0n1");
});

test("remote, non-block, and ambiguous storage topologies fail closed", () => {
  const remote = topology({
    "findmnt --noheadings --raw --output SOURCE --target /var/lib/nusa/state.sqlite": "server:/nusa",
  });
  assert.throws(() => remote.resolve("/var/lib/nusa/state.sqlite"), /not a local block device/);

  const multipleParents = topology({
    "findmnt --noheadings --raw --output SOURCE --target /var/lib/nusa/state.sqlite": "/dev/mapper/nusa",
    "lsblk --noheadings --raw --nodeps --output TYPE /dev/mapper/nusa": "lvm",
    "lsblk --noheadings --raw --output PKNAME /dev/mapper/nusa": "sda2\nsdb2",
  });
  assert.throws(() => multipleParents.resolve("/var/lib/nusa/state.sqlite"), /topology is ambiguous/);

  const nonBlock = topology({
    "findmnt --noheadings --raw --output SOURCE --target /var/lib/nusa/state.sqlite": "/dev/sda1",
  }, () => false);
  assert.throws(() => nonBlock.resolve("/var/lib/nusa/state.sqlite"), /not a local block device/);
});

test("a relative state database path is rejected before topology lookup", () => {
  const fixture = topology({});
  assert.throws(() => fixture.resolve("var/lib/nusa/state.sqlite"), /must be absolute/);
  assert.equal(fixture.calls.length, 0);
});
