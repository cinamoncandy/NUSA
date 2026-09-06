import { FileResearchRunReplaySnapshotStore } from "./researchRunReplaySnapshotStore";

function main(): void {
  const filename = process.argv[2]?.trim();
  if (!filename) throw new Error("research replay snapshot latest worker path is required");
  const snapshot = new FileResearchRunReplaySnapshotStore(filename).latest();
  if (snapshot == null) {
    process.stdout.write(`${JSON.stringify({ status: "NONE" })}\n`);
    return;
  }
  process.stdout.write(`${JSON.stringify({
    status: "FOUND",
    originalRunFingerprintSha256: snapshot.originalRunFingerprintSha256,
    generatedAt: snapshot.options.generatedAt,
  })}\n`);
}

try { main(); }
catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : "research replay snapshot latest worker failed"}\n`);
  process.exitCode = 1;
}
