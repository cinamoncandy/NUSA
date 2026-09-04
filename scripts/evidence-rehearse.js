const { runEvidenceRehearsal } = require("../dist/apps/desktop/src/evidence/evidenceRehearsal.js");

const args = process.argv.slice(2);
const outputIndex = args.indexOf("--output");
const outputPath = outputIndex >= 0 ? args[outputIndex + 1] : undefined;
if (outputIndex >= 0 && (!outputPath || outputPath.startsWith("-"))) {
  console.error("invalid --output");
  process.exitCode = 2;
} else {
  try {
    const report = runEvidenceRehearsal({
      outputPath,
      codeVersion: "local-rehearsal",
      generatedAt: Date.now()
    });
    console.log(JSON.stringify({
      overallStatus: report.overallStatus,
      eligibleForRelease: report.eligibleForRelease,
      releaseStatus: report.actualStatuses[0] || "NOT_EVALUATED",
      checkCount: report.checks.length,
      mismatchCount: report.mismatches.length,
      gap: report.warnings
    }, null, 2));
    process.exitCode = report.overallStatus === "PASS" ? 0 : 1;
  } catch {
    console.error("evidence rehearsal failed");
    process.exitCode = 1;
  }
}
