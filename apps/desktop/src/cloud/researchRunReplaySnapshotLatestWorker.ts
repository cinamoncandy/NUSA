import { FileResearchRunReplaySnapshotStore } from "./researchRunReplaySnapshotStore";

function main(): void {
  const filename = process.argv[2]?.trim();
  if (!filename) throw new Error("research replay snapshot latest worker path is required");
  const identity = new FileResearchRunReplaySnapshotStore(filename).latestIdentity();
  if (identity == null) {
    process.stdout.write(`${JSON.stringify({ status: "NONE" })}\n`);
    return;
  }
  process.stdout.write(`${JSON.stringify({
    status: "FOUND",
    originalRunFingerprintSha256: identity.originalRunFingerprintSha256,
    generatedAt: identity.generatedAt,
  })}\n`);
}

try { main(); }
catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : "research replay snapshot latest worker failed"}\n`);
  process.exitCode = 1;
}
