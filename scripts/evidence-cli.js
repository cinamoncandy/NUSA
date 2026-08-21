const { readEvidenceStatus, exportEvidence, verifyEvidenceBundle } = require("../dist/apps/desktop/src/evidence/evidenceOperator.js");

function value(args, name) {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const result = args[index + 1];
  if (!result || result.startsWith("-")) throw new Error(`missing value for ${name}`);
  return result;
}

function required(args, name) {
  const result = value(args, name);
  if (!result) throw new Error(`missing ${name}`);
  return result;
}

function printSafe(valueToPrint) {
  process.stdout.write(`${JSON.stringify(valueToPrint, null, 2)}\n`);
}

const [command, ...args] = process.argv.slice(2);
try {
  if (command === "status") {
    printSafe(readEvidenceStatus(value(args, "--db"), value(args, "--bundle")));
  } else if (command === "export") {
    const bundle = exportEvidence({
      databasePath: required(args, "--db"),
      outputPath: required(args, "--output"),
      generatedAt: Date.now(),
      applicationVersion: value(args, "--application-version") || "operator-cli",
      codeVersion: required(args, "--code-version"),
      targetStrategy: { strategyId: required(args, "--strategy-id"), strategyVersion: required(args, "--strategy-version") },
      targetDataset: { datasetId: required(args, "--dataset-id"), datasetChecksum: required(args, "--dataset-checksum") }
    });
    printSafe({ status: bundle.releaseReadiness.status, bundleChecksum: bundle.bundleChecksum, releaseEligible: false });
  } else if (command === "verify") {
    const bundle = verifyEvidenceBundle(required(args, "--bundle"));
    printSafe({ status: "VALID", bundleChecksum: bundle.bundleChecksum, releaseStatus: bundle.releaseReadiness.status, releaseEligible: false });
  } else {
    throw new Error("usage: status | export | verify");
  }
} catch {
  process.stderr.write("evidence command failed\n");
  process.exitCode = 1;
}
