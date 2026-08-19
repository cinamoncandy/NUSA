const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

/**
 * Whether this host can create a symlink at all.
 *
 * Creating one requires a privilege Windows withholds by default, so it is a property of the
 * machine rather than of the code under test. Tests that need a real symlink to set up their
 * scenario must skip that setup here rather than fail: an unprivileged host previously aborted the
 * isolated suite at the first such test, so no local run could reach the hundreds of tests that
 * follow it.
 *
 * This is capability detection, not a platform check -- a Windows host with Developer Mode enabled
 * can create symlinks and stays fully covered.
 */
let cached;
function canCreateSymlink() {
  if (cached !== undefined) return cached;
  const probe = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-symlink-probe-"));
  try {
    fs.symlinkSync(path.join(probe, "target"), path.join(probe, "link"), "dir");
    cached = true;
  } catch (error) {
    if (error.code === "EPERM" || error.code === "EACCES" || error.code === "ENOSYS") cached = false;
    else throw error;
  } finally {
    fs.rmSync(probe, { recursive: true, force: true });
  }
  return cached;
}

const SYMLINK_UNAVAILABLE = "symlink creation is unavailable on this host; this path is covered in CI";

module.exports = { SYMLINK_UNAVAILABLE, canCreateSymlink };
