const { createHash } = require("node:crypto");
const { existsSync, readFileSync } = require("node:fs");
const { join, normalize } = require("node:path");
const { block, listValues, scalar } = require("./validate-aipos-drift.js");

const ADAPTERS = Object.freeze(["contract-reader", "line-reader", "handoff-reader"]);

function unquote(value) {
  if (value == null) return value;
  const trimmed = String(value).trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function scalarToValue(value) {
  const normalized = unquote(value);
  if (normalized === "null" || normalized === "") return null;
  if (/^-?\d+$/.test(normalized ?? "")) return Number(normalized);
  return normalized;
}

function lines(source) {
  return source.replace(/\r\n/g, "\n").split("\n");
}

function lineScalar(source, key, indent = 0) {
  const prefix = " ".repeat(indent) + key + ":";
  const line = lines(source).find((entry) => entry.startsWith(prefix));
  if (!line) return undefined;
  return unquote(line.slice(prefix.length).trim());
}

function lineSection(source, key, indent = 0) {
  const all = lines(source);
  const marker = " ".repeat(indent) + key + ":";
  const start = all.findIndex((entry) => entry === marker);
  if (start < 0) return "";
  const childIndent = indent + 2;
  const out = [];
  for (let index = start + 1; index < all.length; index += 1) {
    const entry = all[index];
    if (!entry.trim()) continue;
    const currentIndent = entry.match(/^ */)[0].length;
    if (currentIndent < childIndent) break;
    out.push(entry.slice(childIndent));
  }
  return out.join("\n");
}

function lineList(source, key, indent = 0) {
  const section = lineSection(source, key, indent);
  if (!section) return [];
  return lines(section)
    .map((entry) => entry.match(/^\s*-\s+(.*)$/)?.[1])
    .filter(Boolean)
    .map(unquote);
}

function anchoredScalar(source, sectionName, key) {
  const section = sectionName ? extractAnchoredSection(source, sectionName) : source;
  const match = section.match(new RegExp(`(?:^|\\n)\\s*${escapeRegex(key)}:\\s*([^\\n]*)`));
  return match ? unquote(match[1]) : undefined;
}

function extractAnchoredSection(source, key) {
  const normalized = source.replace(/\r\n/g, "\n");
  const marker = `${key}:\n`;
  const start = normalized.indexOf(marker);
  if (start < 0) return "";
  const contentStart = start + marker.length;
  const rest = normalized.slice(contentStart);
  const nextTop = rest.search(/\n[^ \n][^\n]*:\s*(?:\n|$)/);
  return nextTop < 0 ? rest : rest.slice(0, nextTop + 1);
}

function anchoredList(source, sectionName, key) {
  const section = extractAnchoredSection(source, sectionName);
  const keyIndex = section.indexOf(`${key}:\n`);
  if (keyIndex < 0) return [];
  const tail = section.slice(keyIndex + key.length + 2);
  const out = [];
  for (const entry of lines(tail)) {
    const match = entry.match(/^\s*-\s+(.+)$/);
    if (match) out.push(unquote(match[1]));
    else if (entry.trim() && !entry.startsWith(" ")) break;
  }
  return out;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function firstListId(values) {
  for (const value of values) {
    const match = String(value).match(/^id:\s*(.+)$/);
    if (match) return unquote(match[1]);
  }
  return undefined;
}

function baseSnapshot(fields) {
  return {
    project: fields.project,
    objective: fields.objective,
    phase: fields.phase,
    activeWorkOrder: {
      id: fields.activeWorkOrderId,
      status: fields.activeWorkOrderStatus,
      path: fields.activeWorkOrderPath,
    },
    verifiedState: {
      workOrder: fields.verifiedWorkOrder,
      status: fields.verifiedStatus,
      evidence: fields.verifiedEvidence,
    },
    repository: {
      baseBranch: fields.baseBranch,
      activeBranch: fields.activeBranch,
      activePullRequest: fields.activePullRequest,
    },
    safety: {
      liveTradingMutation: fields.liveTradingMutation,
      architectureOverride: fields.architectureOverride,
      priorChatDependency: fields.priorChatDependency,
      hiddenChainOfThoughtDependency: fields.hiddenChainOfThoughtDependency,
      providerPrivateContextDependency: fields.providerPrivateContextDependency,
    },
    blockers: fields.blockers,
    requiredVerification: fields.requiredVerification,
    nextPermittedAction: fields.nextPermittedAction,
  };
}

function contractReader(state, workOrder) {
  const claimed = block(state, "claimed_state");
  const verified = block(state, "verified_state");
  const next = block(state, "next");
  const safety = block(state, "human_authority");
  const continuity = block(state, "continuity");
  const verification = block(state, "verification");
  return baseSnapshot({
    project: scalar(state, "project"),
    objective: scalar(state, "objective"),
    phase: scalar(state, "phase"),
    activeWorkOrderId: scalar(claimed, "work_order") || firstListId(listValues(state, "in_progress")),
    activeWorkOrderStatus: scalar(workOrder, "status"),
    activeWorkOrderPath: scalar(next, "work_order"),
    verifiedWorkOrder: scalar(verified, "work_order"),
    verifiedStatus: scalar(verified, "status"),
    verifiedEvidence: scalar(verified, "evidence"),
    baseBranch: scalar(state, "base_branch"),
    activeBranch: scalar(state, "active_branch"),
    activePullRequest: scalarToValue(scalar(state, "active_pull_request")),
    liveTradingMutation: scalar(safety, "live_trading_mutation"),
    architectureOverride: scalar(safety, "architecture_override"),
    priorChatDependency: scalar(continuity, "prior_chat_dependency"),
    hiddenChainOfThoughtDependency: scalar(continuity, "hidden_chain_of_thought_dependency"),
    providerPrivateContextDependency: scalar(continuity, "provider_private_context_dependency"),
    blockers: listValues(state, "blocked"),
    requiredVerification: listValues(verification, "required"),
    nextPermittedAction: scalar(next, "reason"),
  });
}

function lineReader(state, workOrder) {
  const claimed = lineSection(state, "claimed_state");
  const verified = lineSection(state, "verified_state");
  const next = lineSection(state, "next");
  const authority = lineSection(state, "human_authority");
  const continuity = lineSection(state, "continuity");
  const verification = lineSection(state, "verification");
  return baseSnapshot({
    project: lineScalar(state, "project"),
    objective: lineScalar(state, "objective"),
    phase: lineScalar(state, "phase"),
    activeWorkOrderId: lineScalar(claimed, "work_order") || firstListId(lineList(state, "in_progress")),
    activeWorkOrderStatus: lineScalar(workOrder, "status"),
    activeWorkOrderPath: lineScalar(next, "work_order"),
    verifiedWorkOrder: lineScalar(verified, "work_order"),
    verifiedStatus: lineScalar(verified, "status"),
    verifiedEvidence: lineScalar(verified, "evidence"),
    baseBranch: lineScalar(state, "base_branch"),
    activeBranch: lineScalar(state, "active_branch"),
    activePullRequest: scalarToValue(lineScalar(state, "active_pull_request")),
    liveTradingMutation: lineScalar(authority, "live_trading_mutation"),
    architectureOverride: lineScalar(authority, "architecture_override"),
    priorChatDependency: lineScalar(continuity, "prior_chat_dependency"),
    hiddenChainOfThoughtDependency: lineScalar(continuity, "hidden_chain_of_thought_dependency"),
    providerPrivateContextDependency: lineScalar(continuity, "provider_private_context_dependency"),
    blockers: lineList(state, "blocked"),
    requiredVerification: lineList(verification, "required"),
    nextPermittedAction: lineScalar(next, "reason"),
  });
}

function handoffReader(state, workOrder) {
  return baseSnapshot({
    project: anchoredScalar(state, null, "project"),
    objective: anchoredScalar(state, null, "objective"),
    phase: anchoredScalar(state, null, "phase"),
    activeWorkOrderId: anchoredScalar(state, "claimed_state", "work_order") || firstListId(anchoredList(state, "in_progress", "in_progress")),
    activeWorkOrderStatus: anchoredScalar(workOrder, null, "status"),
    activeWorkOrderPath: anchoredScalar(state, "next", "work_order"),
    verifiedWorkOrder: anchoredScalar(state, "verified_state", "work_order"),
    verifiedStatus: anchoredScalar(state, "verified_state", "status"),
    verifiedEvidence: anchoredScalar(state, "verified_state", "evidence"),
    baseBranch: anchoredScalar(state, null, "base_branch"),
    activeBranch: anchoredScalar(state, null, "active_branch"),
    activePullRequest: scalarToValue(anchoredScalar(state, null, "active_pull_request")),
    liveTradingMutation: anchoredScalar(state, "human_authority", "live_trading_mutation"),
    architectureOverride: anchoredScalar(state, "human_authority", "architecture_override"),
    priorChatDependency: anchoredScalar(state, "continuity", "prior_chat_dependency"),
    hiddenChainOfThoughtDependency: anchoredScalar(state, "continuity", "hidden_chain_of_thought_dependency"),
    providerPrivateContextDependency: anchoredScalar(state, "continuity", "provider_private_context_dependency"),
    blockers: anchoredList(state, "blocked", "blocked"),
    requiredVerification: anchoredList(state, "verification", "required"),
    nextPermittedAction: anchoredScalar(state, "next", "reason"),
  });
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

function fingerprint(snapshot) {
  return createHash("sha256").update(JSON.stringify(canonicalize(snapshot))).digest("hex");
}

function validateSnapshot(snapshot, state, workOrder, root) {
  const failures = [];
  const requiredStrings = [
    ["PROJECT_MISSING", snapshot.project],
    ["OBJECTIVE_MISSING", snapshot.objective],
    ["PHASE_MISSING", snapshot.phase],
    ["ACTIVE_WORK_ORDER_MISSING", snapshot.activeWorkOrder.id],
    ["ACTIVE_WORK_ORDER_PATH_MISSING", snapshot.activeWorkOrder.path],
    ["ACTIVE_BRANCH_MISSING", snapshot.repository.activeBranch],
    ["VERIFIED_WORK_ORDER_MISSING", snapshot.verifiedState.workOrder],
    ["VERIFIED_EVIDENCE_MISSING", snapshot.verifiedState.evidence],
    ["NEXT_ACTION_MISSING", snapshot.nextPermittedAction],
  ];
  for (const [code, value] of requiredStrings) if (!value) failures.push(code);

  if (!new Set(["IN_PROGRESS", "VERIFYING"]).has(snapshot.activeWorkOrder.status)) {
    failures.push(`ACTIVE_WORK_ORDER_STATUS_INVALID:${snapshot.activeWorkOrder.status || "missing"}`);
  }
  if (snapshot.verifiedState.status !== "COMPLETED") failures.push(`VERIFIED_STATUS_INVALID:${snapshot.verifiedState.status || "missing"}`);
  if (scalar(workOrder, "id") !== snapshot.activeWorkOrder.id) failures.push("ACTIVE_WORK_ORDER_ID_CONTRADICTION");
  if (scalar(workOrder, "implementation_branch") !== snapshot.repository.activeBranch) failures.push("ACTIVE_BRANCH_CONTRADICTION");
  if (scalar(block(state, "claimed_state"), "work_order") !== snapshot.activeWorkOrder.id) failures.push("CLAIMED_STATE_CONTRADICTION");
  if (snapshot.requiredVerification.length === 0) failures.push("REQUIRED_VERIFICATION_MISSING");

  const prohibited = [
    ["LIVE_MUTATION_NOT_PROHIBITED", snapshot.safety.liveTradingMutation],
    ["PRIOR_CHAT_DEPENDENCY_NOT_PROHIBITED", snapshot.safety.priorChatDependency],
    ["HIDDEN_COT_DEPENDENCY_NOT_PROHIBITED", snapshot.safety.hiddenChainOfThoughtDependency],
    ["PROVIDER_PRIVATE_CONTEXT_NOT_PROHIBITED", snapshot.safety.providerPrivateContextDependency],
  ];
  for (const [code, value] of prohibited) if (value !== "prohibited") failures.push(code);

  if (snapshot.verifiedState.evidence) {
    const evidencePath = join(root, normalize(snapshot.verifiedState.evidence));
    if (!existsSync(evidencePath)) failures.push(`VERIFIED_EVIDENCE_PATH_MISSING:${snapshot.verifiedState.evidence}`);
    else {
      try {
        const evidence = JSON.parse(readFileSync(evidencePath, "utf8"));
        if (evidence?.subject?.id !== snapshot.verifiedState.workOrder) failures.push("VERIFIED_EVIDENCE_SUBJECT_CONTRADICTION");
        if (evidence?.result !== "PASS") failures.push("VERIFIED_EVIDENCE_NOT_PASS");
      } catch {
        failures.push("VERIFIED_EVIDENCE_MALFORMED");
      }
    }
  }
  return failures;
}

function runConformance(root = process.cwd()) {
  const statePath = join(root, ".aipos", "state.yaml");
  const failures = [];
  if (!existsSync(statePath)) return { version: 1, result: "FAIL", adapters: [], failures: ["STATE_MISSING"] };
  const state = readFileSync(statePath, "utf8");
  const workOrderPath = scalar(block(state, "next"), "work_order");
  if (!workOrderPath) return { version: 1, result: "FAIL", adapters: [], failures: ["NEXT_WORK_ORDER_MISSING"] };
  const absoluteWorkOrderPath = join(root, normalize(workOrderPath));
  if (!existsSync(absoluteWorkOrderPath)) return { version: 1, result: "FAIL", adapters: [], failures: [`WORK_ORDER_PATH_MISSING:${workOrderPath}`] };
  const workOrder = readFileSync(absoluteWorkOrderPath, "utf8");

  const snapshots = [contractReader(state, workOrder), lineReader(state, workOrder), handoffReader(state, workOrder)];
  const adapters = snapshots.map((snapshot, index) => ({ adapter: ADAPTERS[index], snapshot, fingerprint: fingerprint(snapshot) }));
  const unique = new Set(adapters.map((entry) => entry.fingerprint));
  if (unique.size !== 1) failures.push(`ADAPTER_DIVERGENCE:${adapters.map((entry) => `${entry.adapter}=${entry.fingerprint}`).join(",")}`);
  failures.push(...validateSnapshot(snapshots[0], state, workOrder, root));

  return {
    version: 1,
    result: failures.length === 0 ? "PASS" : "FAIL",
    canonicalFingerprint: unique.size === 1 ? adapters[0].fingerprint : undefined,
    adapters,
    failures,
  };
}

if (require.main === module) {
  const report = runConformance();
  console.log(JSON.stringify(report, null, 2));
  if (report.result !== "PASS") process.exit(1);
}

module.exports = {
  ADAPTERS,
  canonicalize,
  contractReader,
  fingerprint,
  handoffReader,
  lineReader,
  runConformance,
  validateSnapshot,
};
