"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { createHash, randomUUID } = require("node:crypto");
const fingerprint = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const { runForwardStudy, SPEC_FINGERPRINT } = require("./regime-forward-runner");
const { prepareForwardInput } = require("./regime-forward-input");

function publishReceipt(target, result, io = fs) {
  const pending = `${target}.pending-${randomUUID()}`;
  let fd;
  try {
    fd = io.openSync(pending, "wx", 0o600);
    io.writeFileSync(fd, JSON.stringify({ fingerprint: fingerprint(result), result }));
    io.fsyncSync(fd); io.closeSync(fd); fd = undefined;
    // Same-directory hard link is atomic and cannot overwrite a concurrent final receipt.
    io.linkSync(pending, target);
  } finally {
    if (fd !== undefined) io.closeSync(fd);
    try { io.unlinkSync(pending); } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
}

async function runPersistedForwardStudy(options) {
  if (!options?.stateDb || !path.isAbsolute(options.stateDb)) throw new Error("FORWARD_EVIDENCE_PATH_INVALID");
  const target = path.join(path.dirname(options.stateDb), "regime-forward-final-v1.json");
  try {
    const envelope = JSON.parse(fs.readFileSync(target, "utf8"));
    const stored = envelope.result;
    if (!stored || fingerprint(stored) !== envelope.fingerprint) throw new Error("FORWARD_RECEIPT_INVALID");
    if (stored.specificationFingerprint !== SPEC_FINGERPRINT || !/^[a-f0-9]{40}$/.test(stored.executionSourceSha || "") ||
        !["INSUFFICIENT_DATA", "RESEARCH_SCREEN_PASS", "RESEARCH_SCREEN_FAIL"].includes(stored.status) ||
        prepareForwardInput(stored.datasetEvidence).status !== "VALIDATED_INPUT" ||
        stored.contentSha256 !== stored.datasetEvidence.manifest.contentSha256) throw new Error("FORWARD_RECEIPT_INVALID");
    return { ...stored, replayed: true };
  } catch (error) { if (error.code !== "ENOENT") throw error; }
  const result = await runForwardStudy(options);
  if (result.datasetEvidence != null) publishReceipt(target, result);
  return result;
}
module.exports = { runPersistedForwardStudy, publishReceipt };
