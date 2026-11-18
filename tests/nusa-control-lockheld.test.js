"use strict";
// lockHeldBy (the start gate's proof that the release owner holds the controller lock). The first real release on the host (2026-11-18) was
// denied with RELEASE_OWNER_NOT_HOLDING_LOCK: the wrapper locks with the external `flock` binary, so /proc/locks names the pid of the exited
// flock process, not the controller. The proof is now the owner's own open file (/proc/<pid>/fdinfo/<fd>).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { lockHeldBy } = require("../deploy/control/nusa-control.js");

const posixOnly = process.platform === "linux" ? {} : { skip: "needs /proc and flock on Linux" };
const INO = 424242;
const statIno = () => INO;
const lockLine = (pid, ino) => `1: FLOCK  ADVISORY  WRITE ${pid} fd:01:${ino} 0 EOF`;

test("the owner's fdinfo lock line proves the lock even when /proc/locks names another (exited) pid", () => {
  const readLocks = () => `${lockLine(999999, INO)}\n`;
  const readFdinfo = (p, fd) => (fd === "9" ? `pos:\t0\nflags:\t02100001\nmnt_id:\t30\nino:\t${INO}\nlock:\t${lockLine(999999, INO)}\n` : "pos:\t0\nflags:\t02\n");
  assert.equal(lockHeldBy(4001, "/x/lock", readLocks, statIno, () => ["0", "1", "9"], readFdinfo), true);
});

test("no lock line in the owner's fdinfo and another pid in /proc/locks is NOT proof", () => {
  assert.equal(lockHeldBy(4001, "/x/lock", () => `${lockLine(999999, INO)}\n`, statIno, () => ["0", "9"], () => "pos:\t0\nflags:\t02\n"), false);
});

test("a lock on another file, or a shared (read) lock, is not proof", () => {
  assert.equal(lockHeldBy(4001, "/x/lock", () => "", statIno, () => ["9"], () => `lock:\t${lockLine(1, INO + 1)}\n`), false);
  assert.equal(lockHeldBy(4001, "/x/lock", () => "", statIno, () => ["9"], () => `lock:\t1: FLOCK  ADVISORY  READ 1 fd:01:${INO} 0 EOF\n`), false);
  assert.equal(lockHeldBy(4001, "/x/lock", () => "", statIno, () => ["9"], () => `lock:\t1: POSIX  ADVISORY  WRITE 1 fd:01:${INO} 0 EOF\n`), false);
});

test("the old proof stays accepted: the pid itself in /proc/locks", () => {
  assert.equal(lockHeldBy(4001, "/x/lock", () => `${lockLine(4001, INO)}\n`, statIno, () => { throw new Error("no fd list"); }, () => ""), true);
});

test("an unreadable /proc/<pid>/fd fails closed", () => {
  assert.equal(lockHeldBy(4001, "/x/lock", () => `${lockLine(999999, INO)}\n`, statIno, () => { throw new Error("EACCES"); }, () => ""), false);
});

test("REAL kernel: a process that exec'd after the external flock binary locked fd 9 is the holder; one without the lock is not", posixOnly, () => {
  const probe = spawnSync("flock", ["--version"], { encoding: "utf8" });
  if (probe.error) return; // no flock binary here: the fake-data tests above cover the logic
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-lockheld-"));
  const lock = path.join(dir, "lock");
  const script = path.join(dir, "probe.js");
  const controller = path.resolve(__dirname, "../deploy/control/nusa-control.js");
  fs.writeFileSync(script, `const { lockHeldBy } = require(${JSON.stringify(controller)}); process.stdout.write(JSON.stringify({ held: lockHeldBy(process.pid, process.argv[2]) }));\n`);
  try {
    // exactly what deploy/control/nusa-control.sh does: open fd 9, lock it with the external flock, exec the controller
    const held = spawnSync("bash", ["-c", 'exec 9>>"$1"; flock -w 5 9 || exit 3; exec node "$2" "$1"', "wrapper", lock, script], { encoding: "utf8" });
    assert.equal(held.status, 0, held.stderr);
    assert.deepEqual(JSON.parse(held.stdout), { held: true });
    // a process that has the file open but holds no lock
    const free = spawnSync("bash", ["-c", 'exec 9>>"$1"; exec node "$2" "$1"', "wrapper", lock, script], { encoding: "utf8" });
    assert.equal(free.status, 0, free.stderr);
    assert.deepEqual(JSON.parse(free.stdout), { held: false });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
