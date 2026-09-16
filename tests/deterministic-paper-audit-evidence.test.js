const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const test = require("node:test");
const { validateEvidence } = require("../scripts/validate-deterministic-paper-audit-evidence.js");

const HEAD = "a".repeat(40);
const metadata = {
  requestedHead: HEAD,
  runId: 123,
  artifactId: 456,
  artifactName: `wo-0059-actual-paper-runtime-evidence-${HEAD}`,
  artifactDigest: `sha256:${"b".repeat(64)}`,
};

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function withHash(payload) {
  return {
    ...payload,
    artifact_hash: {
      algorithm: "sha256",
      value: createHash("sha256").update(canonical(payload)).digest("hex"),
    },
  };
}

function evidence({ complete = false } = {}) {
  const status = complete
    ? "COMPLETE_AUTONOMOUS_EXECUTION_OBSERVED"
    : "INCOMPLETE_NO_AUTONOMOUS_ORDER_FILL_PNL";
  return withHash({
    schema_version: 1,
    evidence_type: "nusa.actual-paper-runtime-e2e",
    result: complete ? "PASS" : "INCOMPLETE",
    source_commit: HEAD,
    authority: {
      mode: "PAPER_ONLY",
      liveAuthority: "NONE",
      productionMutationAllowed: false,
      aiAuthority: "ZERO_AUTHORITY",
    },
    market_data: {
      provider: "UPBIT",
      channel: "PUBLIC_TICKER",
      private_credentials_used: false,
    },
    prohibited_capabilities: {
      upbit_private_credentials: false,
      live_order_endpoint: false,
      withdrawal_transfer: false,
      real_money_mutation: false,
    },
    runtime_safety_smoke: {
      status: "PASS",
      public_market_runtime_observed: true,
      live_authority: "NONE",
      production_mutation_allowed: false,
    },
    autonomous_trading_certification: {
      status,
      automatic_order_observed: complete,
      automatic_fill_observed: complete,
      account_or_pnl_change_observed: complete,
    },
    production_readiness: {
      status,
      runtime_safety_smoke_passed: true,
      automatic_order_observed: complete,
      automatic_fill_observed: complete,
      account_or_pnl_change_observed: complete,
      live_mutation_observed: false,
      completion_claim_allowed: complete,
    },
  });
}

function rehash(value) {
  const { artifact_hash: _ignored, ...payload } = value;
  return withHash(payload);
}

test("safe exact-head PAPER evidence may remain incomplete without blocking ordinary Release", () => {
  const result = validateEvidence(evidence(), metadata);
  assert.equal(result.status, "EXACT_HEAD_PAPER_SAFETY_PASS");
  assert.equal(result.certification_status, "INCOMPLETE_NO_AUTONOMOUS_ORDER_FILL_PNL");
  assert.equal(result.completion_claim_allowed, false);
  assert.equal(result.liveAuthority, "NONE");
  assert.equal(result.productionMutationAllowed, false);
  assert.equal(result.aiAuthority, "ZERO_AUTHORITY");
});

test("complete autonomous PAPER evidence remains a valid stronger certification", () => {
  const result = validateEvidence(evidence({ complete: true }), metadata);
  assert.equal(result.certification_status, "COMPLETE_AUTONOMOUS_EXECUTION_OBSERVED");
  assert.equal(result.completion_claim_allowed, true);
});

test("incomplete evidence cannot claim autonomous completion", () => {
  const invalid = evidence();
  invalid.production_readiness.completion_claim_allowed = true;
  assert.throws(
    () => validateEvidence(rehash(invalid), metadata),
    /INCOMPLETE_COMPLETION_CLAIM_ALLOWED/,
  );
});

test("PAPER authority violations still fail closed", () => {
  const invalid = evidence();
  invalid.authority.liveAuthority = "BROKER";
  assert.throws(
    () => validateEvidence(rehash(invalid), metadata),
    /LIVE_AUTHORITY_NOT_NONE/,
  );
});

test("incomplete classification cannot be relabeled PASS", () => {
  const invalid = evidence();
  invalid.result = "PASS";
  assert.throws(
    () => validateEvidence(rehash(invalid), metadata),
    /INCOMPLETE_RESULT_MISMATCH/,
  );
});

test("artifact hash and exact-head provenance remain mandatory", () => {
  const wrongHead = evidence();
  wrongHead.source_commit = "c".repeat(40);
  assert.throws(
    () => validateEvidence(rehash(wrongHead), metadata),
    /SOURCE_COMMIT_MISMATCH/,
  );

  const tampered = evidence();
  tampered.market_data.channel = "PRIVATE";
  assert.throws(
    () => validateEvidence(tampered, metadata),
    /EVIDENCE_HASH_MISMATCH/,
  );
});
