const { spawnSync } = require("node:child_process");

function main(args = process.argv.slice(2), spawn = spawnSync) {
  const [command, target, ...rest] = args;
  if (command !== "verify" || target !== "paper-runtime") {
    process.stderr.write("usage: nusa verify paper-runtime [--output <path>]\n");
    return 2;
  }
  const result = spawn(process.execPath, ["scripts/paper-runtime-evidence-harness.js", ...rest], {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: "inherit",
    shell: false,
    env: { ...process.env, NUSA_MODE: "PAPER", NUSA_LIVE_MUTATION: "PROHIBITED" },
  });
  return result.status ?? 1;
}

if (require.main === module) process.exitCode = main();

module.exports = { main };
