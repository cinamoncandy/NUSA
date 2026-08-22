const { readEvidenceStatus } = require("../dist/apps/desktop/src/evidence/evidenceOperator.js");
const { formatEvidenceChecklist } = require("../dist/apps/desktop/src/evidence/evidenceChecklist.js");

function value(args, name) {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const result = args[index + 1];
  if (!result || result.startsWith("-")) throw new Error(`missing value for ${name}`);
  return result;
}

const args = process.argv.slice(2);
try {
  const status = readEvidenceStatus(value(args, "--db"));
  process.stdout.write(`${formatEvidenceChecklist(status)}\n`);
} catch {
  process.stderr.write("evidence checklist failed\n");
  process.exitCode = 1;
}
