const { existsSync, readFileSync } = require("node:fs");
const { join, normalize } = require("node:path");

const REQUIRED_PATHS = Object.freeze([
  ".aipos/architecture.md",
  ".aipos/AI_HANDOFF_CONTRACT.md",
  ".aipos/aipos.yaml",
  ".aipos/state.yaml",
  "docs/NUSA_CORE_ARCHITECTURE_PRINCIPLE.md",
  "docs/NUSA_AI_ARCHITECTURE_V1.md"
]);

function scalar(source, key, indent = 0) {
  const prefix = " ".repeat(indent);
  const pattern = new RegExp(`^${prefix}${escapeRegex(key)}:\\s*(.*?)\\s*$`, "m");
  const match = source.match(pattern);
  if (!match) return undefined;
  return unquote(match[1]);
}

function block(source, key, indent = 0) {
  const lines = source.split(/\r?\n/);
  const prefix = " ".repeat(indent);
  const start = lines.findIndex((line) => line === `${prefix}${key}:`);
  if (start < 0) return "";
  const childIndent = indent + 2;
  const collected = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim()) {
      collected.push(line);
      continue;
    }
    const currentIndent = line.match(/^ */)[0].length;
    if (currentIndent < childIndent) break;
    collected.push(line.slice(childIndent));
  }
  return collected.join("\n");
}

function listValues(source, key, indent = 0) {
  return block(source, key, indent)
    .split(/\r?\n/)
    .map((line) => line.match(/^\s*-\s+(.*)$/)?.[1])
    .filter(Boolean)
    .map(unquote);
}

function unquote(value) {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function validateRepository(root = process.cwd()) {
  const failures = [];
  const read = (relativePath) => {
    const path = join(root, normalize(relativePath));
    if (!existsSync(path)) {
      failures.push(`MISSING_PATH:${relativePath}`);
      return "";
    }
    return readFileSync(path, "utf8");
  };

  for (const requiredPath of REQUIRED_PATHS) read(requiredPath);

  const aipos = read(".aipos/aipos.yaml");
  const state = read(".aipos/state.yaml");

  const expectedPathMappings = Object.freeze({
    architecture: ".aipos/architecture.md",
    core_architecture_principle: "docs/NUSA_CORE_ARCHITECTURE_PRINCIPLE.md",
    ai_architecture: "docs/NUSA_AI_ARCHITECTURE_V1.md",
    handoff_contract: ".aipos/AI_HANDOFF_CONTRACT.md",
    state: ".aipos/state.yaml",
    work_orders: ".aipos/work-orders"
  });
  const pathsBlock = block(aipos, "paths");
  for (const [key, expected] of Object.entries(expectedPathMappings)) {
    if (scalar(pathsBlock, key) !== expected) failures.push(`AIPOS_PATH_MISMATCH:${key}:${expected}`);
  }

  const sync = block(aipos, "architecture_sync");
  if (scalar(sync, "enabled") !== "true") failures.push("ARCHITECTURE_SYNC_DISABLED");
  if (scalar(sync, "direction") !== "architecture_to_aipos") failures.push("ARCHITECTURE_SYNC_DIRECTION_INVALID");
  if (scalar(sync, "silent_reverse_mutation") !== "prohibited") failures.push("SILENT_REVERSE_MUTATION_NOT_PROHIBITED");
  if (scalar(sync, "require_impact_analysis") !== "true") failures.push("ARCHITECTURE_IMPACT_ANALYSIS_NOT_REQUIRED");

  const activeBranch = scalar(state, "active_branch");
  const stateInProgress = listValues(state, "in_progress")
    .map((value) => value.match(/^id:\s*(.+)$/)?.[1])
    .filter(Boolean);
  const serializedGate = block(state, "serialized_human_environment_gate");
  const serializedGateId = scalar(serializedGate, "work_order");
  const nextBlock = block(state, "next");
  const workOrderPath = scalar(nextBlock, "work_order");

  if (!workOrderPath) {
    failures.push("STATE_NEXT_WORK_ORDER_MISSING");
    return { ok: failures.length === 0, failures };
  }

  const workOrder = read(workOrderPath);
  const workOrderId = scalar(workOrder, "id");
  const workOrderStatus = scalar(workOrder, "status");
  const implementationBranch = scalar(workOrder, "implementation_branch");

  if (!workOrderId) failures.push("WORK_ORDER_ID_MISSING");
  const activeWorkOrderRegistered = stateInProgress.includes(workOrderId);
  const serializedGatePreserved = !serializedGateId || stateInProgress.includes(serializedGateId);
  const validSingleWorkOrder = stateInProgress.length === 1 && activeWorkOrderRegistered;
  const validSuccessorWithGate = stateInProgress.length === 2
    && activeWorkOrderRegistered
    && serializedGateId
    && serializedGateId !== workOrderId
    && serializedGatePreserved;
  if ((!validSingleWorkOrder && !validSuccessorWithGate) || !serializedGatePreserved) {
    failures.push(`STATE_WORK_ORDER_ID_DRIFT:${stateInProgress.join(",") || "none"}:${workOrderId || "none"}`);
  }
  if (!new Set(["IN_PROGRESS", "VERIFYING"]).has(workOrderStatus)) {
    failures.push(`WORK_ORDER_STATUS_INVALID:${workOrderStatus || "missing"}`);
  }
  if (!activeBranch || activeBranch === "null" || activeBranch !== implementationBranch) {
    failures.push(`ACTIVE_BRANCH_DRIFT:${activeBranch || "missing"}:${implementationBranch || "missing"}`);
  }

  const impact = block(workOrder, "architecture_impact");
  if (scalar(impact, "acknowledged") !== "true") failures.push("ARCHITECTURE_IMPACT_NOT_ACKNOWLEDGED");
  if (!scalar(impact, "analysis")) failures.push("ARCHITECTURE_IMPACT_ANALYSIS_MISSING");
  const impactReferences = listValues(impact, "references");
  if (impactReferences.length === 0) failures.push("ARCHITECTURE_IMPACT_REFERENCES_MISSING");
  for (const reference of impactReferences) {
    if (!existsSync(join(root, normalize(reference)))) failures.push(`ARCHITECTURE_IMPACT_REFERENCE_MISSING:${reference}`);
  }

  return { ok: failures.length === 0, failures };
}

if (require.main === module) {
  const result = validateRepository();
  if (!result.ok) {
    console.error("Architecture/AIPOS drift validation FAILED");
    for (const failure of result.failures) console.error(`- ${failure}`);
    process.exit(1);
  }
  console.log("Architecture/AIPOS drift validation PASS");
}

module.exports = { REQUIRED_PATHS, block, listValues, scalar, validateRepository };
