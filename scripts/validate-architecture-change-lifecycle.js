const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const STAGES = Object.freeze([
  "PROPOSAL",
  "IMPACT_ANALYSIS",
  "ARCHITECTURE_REVIEW",
  "MIGRATION_PLAN",
  "APPROVAL",
  "STAGED_ADOPTION",
  "VERIFICATION",
  "ROLLBACK"
]);
const STAGE_INDEX = new Map(STAGES.map((stage, index) => [stage, index]));

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function stringArray(value) {
  return Array.isArray(value) && value.length > 0 && value.every(nonEmpty);
}

function validateHistory(record, errors) {
  if (!Array.isArray(record.history) || record.history.length === 0) {
    errors.push("LIFECYCLE_HISTORY_MISSING");
    return;
  }
  let previousIndex = -1;
  let previousTime = -Infinity;
  const seen = new Set();
  for (const entry of record.history) {
    const index = STAGE_INDEX.get(entry && entry.stage);
    if (index == null) {
      errors.push("LIFECYCLE_HISTORY_STAGE_INVALID");
      continue;
    }
    if (seen.has(entry.stage)) errors.push("LIFECYCLE_HISTORY_STAGE_DUPLICATE");
    seen.add(entry.stage);
    if (index < previousIndex) errors.push("LIFECYCLE_HISTORY_REGRESSION");
    if (index > previousIndex + 1) errors.push("LIFECYCLE_HISTORY_STAGE_SKIPPED");
    previousIndex = index;
    const timestamp = Date.parse(entry.observed_at || entry.observedAt || "");
    if (!Number.isFinite(timestamp)) errors.push("LIFECYCLE_HISTORY_TIMESTAMP_INVALID");
    else if (timestamp < previousTime) errors.push("LIFECYCLE_HISTORY_TIME_REGRESSION");
    else previousTime = timestamp;
  }
  const currentIndex = STAGE_INDEX.get(record.stage);
  if (currentIndex != null) {
    for (let i = 0; i <= currentIndex; i += 1) {
      if (!seen.has(STAGES[i])) errors.push(`LIFECYCLE_HISTORY_MISSING_${STAGES[i]}`);
    }
  }
}

function validateRecord(record, governance) {
  const errors = [];
  if (!record || typeof record !== "object") return { ok: false, errors: ["RECORD_INVALID"] };
  if (record.version !== 1) errors.push("RECORD_VERSION_INVALID");
  if (!nonEmpty(record.id)) errors.push("RECORD_ID_MISSING");
  if (!nonEmpty(record.title)) errors.push("RECORD_TITLE_MISSING");
  const currentIndex = STAGE_INDEX.get(record.stage);
  if (currentIndex == null) errors.push("LIFECYCLE_STAGE_INVALID");

  const proposal = record.proposal || {};
  const impact = record.impact_analysis || record.impactAnalysis || {};
  const review = record.architecture_review || record.architectureReview || {};
  const migration = record.migration_plan || record.migrationPlan || {};
  const approval = record.approval || {};
  const adoption = record.staged_adoption || record.stagedAdoption || {};
  const verification = record.verification || {};
  const rollback = record.rollback || {};

  if (currentIndex != null && currentIndex >= STAGE_INDEX.get("PROPOSAL")) {
    if (proposal.status !== "COMPLETE" || !nonEmpty(proposal.summary)) errors.push("PROPOSAL_INCOMPLETE");
  }
  if (currentIndex != null && currentIndex >= STAGE_INDEX.get("IMPACT_ANALYSIS")) {
    if (impact.status !== "COMPLETE") errors.push("IMPACT_ANALYSIS_INCOMPLETE");
    if (!Array.isArray(impact.affected_paths || impact.affectedPaths)) errors.push("IMPACT_AFFECTED_PATHS_MISSING");
    if (!Array.isArray(impact.affected_capabilities || impact.affectedCapabilities)) errors.push("IMPACT_AFFECTED_CAPABILITIES_MISSING");
    if (typeof (impact.safety_sensitive ?? impact.safetySensitive) !== "boolean") errors.push("IMPACT_SAFETY_CLASSIFICATION_MISSING");
    if (typeof (impact.constitutional_change ?? impact.constitutionalChange) !== "boolean") errors.push("IMPACT_CONSTITUTIONAL_CLASSIFICATION_MISSING");
    if (!Array.isArray(impact.protected_boundaries || impact.protectedBoundaries)) errors.push("IMPACT_PROTECTED_BOUNDARIES_MISSING");
    if (!nonEmpty(impact.analysis)) errors.push("IMPACT_ANALYSIS_TEXT_MISSING");
  }
  if (currentIndex != null && currentIndex >= STAGE_INDEX.get("ARCHITECTURE_REVIEW")) {
    if (review.status !== "APPROVED" || review.decision !== "APPROVED") errors.push("ARCHITECTURE_REVIEW_NOT_APPROVED");
    if (!stringArray(review.reviewers)) errors.push("ARCHITECTURE_REVIEWERS_MISSING");
    if (!stringArray(review.evidence_refs || review.evidenceRefs)) errors.push("ARCHITECTURE_REVIEW_EVIDENCE_MISSING");
  }
  if (currentIndex != null && currentIndex >= STAGE_INDEX.get("MIGRATION_PLAN")) {
    if (migration.status !== "COMPLETE") errors.push("MIGRATION_PLAN_INCOMPLETE");
    if (!nonEmpty(migration.compatibility)) errors.push("MIGRATION_COMPATIBILITY_MISSING");
    if (!stringArray(migration.steps)) errors.push("MIGRATION_STEPS_MISSING");
  }
  if (currentIndex != null && currentIndex >= STAGE_INDEX.get("APPROVAL")) {
    if (approval.status !== "APPROVED") errors.push("APPROVAL_MISSING");
    if (!stringArray(approval.approved_by || approval.approvedBy)) errors.push("APPROVER_MISSING");
    if (!stringArray(approval.evidence_refs || approval.evidenceRefs)) errors.push("APPROVAL_EVIDENCE_MISSING");
    if (!stringArray(rollback.triggers) || !stringArray(rollback.procedure)) errors.push("ROLLBACK_PLAN_MISSING_BEFORE_APPROVAL");
    if (!["READY", "COMPLETE"].includes(rollback.status)) errors.push("ROLLBACK_NOT_READY_BEFORE_APPROVAL");

    const safetySensitive = impact.safety_sensitive ?? impact.safetySensitive;
    const constitutionalChange = impact.constitutional_change ?? impact.constitutionalChange;
    const protectedBoundaries = impact.protected_boundaries || impact.protectedBoundaries || [];
    if ((safetySensitive || constitutionalChange || protectedBoundaries.length > 0) && (approval.authority_type || approval.authorityType) !== "HUMAN") {
      errors.push("HUMAN_APPROVAL_REQUIRED");
    }
  }
  if (currentIndex != null && currentIndex >= STAGE_INDEX.get("STAGED_ADOPTION")) {
    if (adoption.status !== "COMPLETE" || !stringArray(adoption.stages)) errors.push("STAGED_ADOPTION_INCOMPLETE");
  }
  if (currentIndex != null && currentIndex >= STAGE_INDEX.get("VERIFICATION")) {
    if (verification.status !== "PASS") errors.push("VERIFICATION_NOT_PASS");
    if (!stringArray(verification.criteria)) errors.push("VERIFICATION_CRITERIA_MISSING");
    if (!stringArray(verification.evidence_refs || verification.evidenceRefs)) errors.push("VERIFICATION_EVIDENCE_MISSING");
  }
  if (currentIndex != null && currentIndex >= STAGE_INDEX.get("ROLLBACK")) {
    if (!['READY', 'COMPLETE'].includes(rollback.status)) errors.push("ROLLBACK_STATUS_INVALID");
  }

  const affectedPaths = impact.affected_paths || impact.affectedPaths || [];
  const constitutionalPaths = new Set((governance && governance.constitutional_paths) || []);
  if (affectedPaths.some((item) => constitutionalPaths.has(item)) && !(impact.constitutional_change ?? impact.constitutionalChange)) {
    errors.push("CONSTITUTIONAL_PATH_NOT_CLASSIFIED");
  }

  validateHistory(record, errors);
  return { ok: errors.length === 0, errors: [...new Set(errors)] };
}

function listRecords(repoRoot) {
  const dir = path.join(repoRoot, ".aipos", "architecture-changes");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((name) => name.endsWith(".json") && !name.startsWith("TEMPLATE"))
    .sort()
    .map((name) => ({ path: path.posix.join(".aipos", "architecture-changes", name), record: readJson(path.join(dir, name)) }));
}

function resolveBaseRef(repoRoot, explicitBaseRef) {
  if (explicitBaseRef) return explicitBaseRef;
  if (process.env.GITHUB_BASE_REF) return `origin/${process.env.GITHUB_BASE_REF}`;
  if (process.env.GITHUB_EVENT_NAME === "push") return "HEAD^";
  return null;
}

function gitChangedPaths(repoRoot, baseRef) {
  if (!baseRef) return [];
  try {
    const output = execFileSync("git", ["diff", "--name-only", `${baseRef}...HEAD`], { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return output.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
  } catch (error) {
    const stderr = error && error.stderr ? String(error.stderr).trim() : "";
    throw new Error(`unable to compute architecture diff against ${baseRef}${stderr ? `: ${stderr}` : ""}`);
  }
}

function validateLifecycle({ repoRoot = process.cwd(), changedPaths, baseRef } = {}) {
  const governancePath = path.join(repoRoot, ".aipos", "architecture-governance.json");
  if (!fs.existsSync(governancePath)) return { ok: false, errors: ["ARCHITECTURE_GOVERNANCE_MISSING"] };
  let governance;
  try { governance = readJson(governancePath); } catch { return { ok: false, errors: ["ARCHITECTURE_GOVERNANCE_MALFORMED"] }; }
  const errors = [];
  if (JSON.stringify(governance.lifecycle) !== JSON.stringify(STAGES)) errors.push("LIFECYCLE_POLICY_ORDER_INVALID");
  if (governance.minimum_stage_for_governing_architecture_mutation !== "APPROVAL") errors.push("MINIMUM_MUTATION_STAGE_INVALID");
  if (!Array.isArray(governance.governed_paths) || governance.governed_paths.length === 0) errors.push("GOVERNED_PATHS_MISSING");
  if (!governance.rules || governance.rules.architecture_to_aipos_only !== true) errors.push("ARCHITECTURE_DIRECTION_INVALID");
  if (!governance.rules || governance.rules.missing_or_invalid_change_record_fails_closed !== true) errors.push("FAIL_CLOSED_POLICY_MISSING");

  const records = listRecords(repoRoot);
  const validRecords = [];
  const ids = new Set();
  for (const entry of records) {
    if (ids.has(entry.record.id)) errors.push("ARCHITECTURE_CHANGE_ID_DUPLICATE");
    ids.add(entry.record.id);
    const result = validateRecord(entry.record, governance);
    if (!result.ok) errors.push(...result.errors.map((code) => `${entry.record.id || entry.path}:${code}`));
    else validRecords.push(entry.record);
  }

  const actualChangedPaths = changedPaths || gitChangedPaths(repoRoot, resolveBaseRef(repoRoot, baseRef));
  const governedSet = new Set(governance.governed_paths || []);
  const governedChanges = actualChangedPaths.filter((item) => governedSet.has(item));
  const minimumIndex = STAGE_INDEX.get(governance.minimum_stage_for_governing_architecture_mutation);
  for (const changedPath of governedChanges) {
    const covering = validRecords.filter((record) => {
      const impact = record.impact_analysis || record.impactAnalysis || {};
      const affected = impact.affected_paths || impact.affectedPaths || [];
      return affected.includes(changedPath) && STAGE_INDEX.get(record.stage) >= minimumIndex && record.approval && record.approval.status === "APPROVED";
    });
    if (covering.length === 0) errors.push(`GOVERNED_PATH_CHANGE_WITHOUT_APPROVAL:${changedPath}`);
    if (covering.length > 1) errors.push(`GOVERNED_PATH_CHANGE_AMBIGUOUS:${changedPath}`);
  }

  return { ok: errors.length === 0, errors: [...new Set(errors)], governedChanges, recordCount: records.length };
}

function main() {
  const baseArgIndex = process.argv.indexOf("--base-ref");
  const baseRef = baseArgIndex >= 0 ? process.argv[baseArgIndex + 1] : undefined;
  let result;
  try { result = validateLifecycle({ baseRef }); }
  catch (error) {
    console.error("Architecture change lifecycle validation FAILED");
    console.error(`- DIFF_RESOLUTION_FAILED: ${error.message}`);
    process.exitCode = 1;
    return;
  }
  if (!result.ok) {
    console.error("Architecture change lifecycle validation FAILED");
    for (const error of result.errors) console.error(`- ${error}`);
    process.exitCode = 1;
    return;
  }
  console.log(`Architecture change lifecycle validation PASS (${result.recordCount} records, ${result.governedChanges.length} governed path changes)`);
}

if (require.main === module) main();

module.exports = { STAGES, validateRecord, validateLifecycle, gitChangedPaths, resolveBaseRef };
