const test = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync, mkdirSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { dirname, join } = require("node:path");
const { canonical, gitBlobSha1, sha256, validateRepository } = require("../scripts/validate-aipos-evidence.js");

function write(root, relativePath, content) {
  const path = join(root, relativePath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function fixture(options = {}) {
  const root = mkdtempSync(join(tmpdir(), "nusa-aipos-evidence-"));
  const workOrderPath = ".aipos/work-orders/WO-0020.yaml";
  const evidencePath = ".aipos/evidence/WO-0020.json";
  const canonicalWorkOrder = `id: WO-0020\nstatus: COMPLETED\nmerge_commit: 99d7ce07d3fd8d19094690b9fd13f1a37312a0e3\n`;
  const workOrder = options.crlfWorkOrder ? canonicalWorkOrder.replace(/\n/g, "\r\n") : canonicalWorkOrder;
  const snapshot = { architecture_sync: "architecture_to_aipos", live_trading_mutation: "prohibited" };
  const evidence = {
    version: 1,
    id: "evidence-wo-0020",
    subject: {
      type: "work_order",
      id: options.subjectId || "WO-0020",
      path: workOrderPath,
      hash: { algorithm: "git-blob-sha1", value: gitBlobSha1(canonicalWorkOrder) },
    },
    producer: {
      kind: "github-actions",
      id: "CI",
      code_revision: "99d7ce07d3fd8d19094690b9fd13f1a37312a0e3",
    },
    configuration: {
      snapshot,
      hash: { algorithm: "sha256", value: sha256(canonical(snapshot)) },
    },
    observed_at: "2026-08-07T13:47:05+09:00",
    provenance: ["github:pull/133", "github:actions/run/31147330756"],
    result: "PASS",
    assertions: [{ name: "official_ci", status: "PASS" }],
  };
  if (options.badSubjectHash) evidence.subject.hash.value = "0".repeat(40);

  const state = `claimed_state:\n  work_order: ${options.claimedWorkOrder || "WO-0021"}\n  status: ${options.claimedStatus || "IN_PROGRESS"}\nverified_state:\n  work_order: WO-0020\n  status: COMPLETED\n${options.omitEvidenceRef ? "" : `  evidence: ${evidencePath}\n`}`;

  write(root, ".aipos/state.yaml", state);
  write(root, workOrderPath, workOrder);
  if (!options.missingEvidenceFile) {
    write(root, evidencePath, options.malformedEvidence ? "{not-json" : `${JSON.stringify(evidence, null, 2)}\n`);
  }
  return root;
}

function withFixture(options, callback) {
  const root = fixture(options);
  try {
    callback(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("evidence-backed verified state passes", () => {
  withFixture({}, (root) => {
    const result = validateRepository(root);
    assert.equal(result.ok, true, result.failures.join("\n"));
    assert.deepEqual(result.failures, []);
  });
});

test("Windows CRLF checkout preserves canonical Git blob evidence hash", () => {
  withFixture({ crlfWorkOrder: true }, (root) => {
    const result = validateRepository(root);
    assert.equal(result.ok, true, result.failures.join("\n"));
  });
});

test("verified completion without evidence reference fails closed", () => {
  withFixture({ omitEvidenceRef: true }, (root) => {
    const result = validateRepository(root);
    assert.ok(result.failures.includes("VERIFIED_STATE_EVIDENCE_MISSING"));
  });
});

test("missing evidence file fails closed", () => {
  withFixture({ missingEvidenceFile: true }, (root) => {
    const result = validateRepository(root);
    assert.ok(result.failures.some((failure) => failure.startsWith("EVIDENCE_MISSING:")));
  });
});

test("evidence bound to a different work order fails", () => {
  withFixture({ subjectId: "WO-9999" }, (root) => {
    const result = validateRepository(root);
    assert.ok(result.failures.includes("EVIDENCE_SUBJECT_MISMATCH:WO-9999:WO-0020"));
  });
});

test("malformed evidence JSON fails closed", () => {
  withFixture({ malformedEvidence: true }, (root) => {
    const result = validateRepository(root);
    assert.ok(result.failures.some((failure) => failure.startsWith("EVIDENCE_MALFORMED_JSON:")));
  });
});

test("subject hash mismatch fails closed", () => {
  withFixture({ badSubjectHash: true }, (root) => {
    const result = validateRepository(root);
    assert.ok(result.failures.includes("EVIDENCE_SUBJECT_HASH_MISMATCH"));
  });
});

test("claimed completion cannot outrun verified work order", () => {
  withFixture({ claimedWorkOrder: "WO-0021", claimedStatus: "COMPLETED" }, (root) => {
    const result = validateRepository(root);
    assert.ok(result.failures.includes("CLAIM_OUTRUNS_VERIFIED_STATE:WO-0021:WO-0020"));
  });
});
