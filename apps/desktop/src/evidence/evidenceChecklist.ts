import type { EvidenceStatus } from "./evidenceOperator";

function progressLine(label: string, current: number, required: number): string {
  const mark = current >= required ? "x" : " ";
  return `[${mark}] ${label.padEnd(28)} ${String(current).padStart(3)} / ${required}`;
}

function reportLine(label: string, status: "PASS" | "FAIL" | "NOT_EVALUATED"): string {
  const mark = status === "PASS" ? "x" : " ";
  return `[${mark}] ${label.padEnd(28)} ${status}`;
}

/**
 * Renders EvidenceStatus as a plain-text checklist for a human operator running the
 * real Paper app, so scenario-evidence progress toward the SCENARIO_BASED targets is
 * legible without reading raw JSON. Pure formatting only: it does not evaluate,
 * approve, or infer anything readEvidenceStatus did not already determine.
 */
export function formatEvidenceChecklist(status: EvidenceStatus): string {
  const lines: string[] = [];
  lines.push("NUSA Paper Trading -- Release Evidence Checklist");
  lines.push("=".repeat(53));
  lines.push(`Database: ${status.database}`);
  lines.push("");
  lines.push("Scenario coverage:");
  lines.push(progressLine("Observed sessions", status.observedSessions.current, status.observedSessions.required));
  lines.push(progressLine("Completed orders", status.completedOrders.current, status.completedOrders.required));
  lines.push(progressLine("Represented regimes", status.representedRegimes.current, status.representedRegimes.required));
  lines.push(progressLine("Restart recovery passes", status.restartRecoveryPasses.current, status.restartRecoveryPasses.required));
  lines.push(progressLine("Duplicate checks", status.duplicateChecks.current, status.duplicateChecks.required));
  lines.push("");
  lines.push("Fault-drill scenarios passed:");
  if (status.faultScenarios === "NOT_EVALUATED") {
    lines.push("  NOT_EVALUATED");
  } else if (status.faultScenarios.length === 0) {
    lines.push("  (none yet)");
  } else {
    for (const scenario of status.faultScenarios) lines.push(`  - ${scenario}`);
  }
  lines.push("");
  lines.push("Research validation reports:");
  lines.push(reportLine("Walk-Forward", status.walkForward));
  lines.push(reportLine("Cost Stress", status.costStress));
  lines.push(reportLine("Monte Carlo", status.monteCarlo));
  lines.push(reportLine("Integrity", status.integrity));
  lines.push("");
  lines.push(`Evidence bundle exported and verified: ${status.bundle}`);
  lines.push(`Owner review: ${status.ownerReview}`);
  lines.push("");
  lines.push(`Release status: ${status.releaseStatus}`);
  if (status.blockingReasons.length > 0) {
    lines.push("Blocking reasons:");
    for (const reason of status.blockingReasons) lines.push(`  - ${reason}`);
  }
  lines.push("");
  lines.push(
    status.releaseStatus === "APPROVED"
      ? "All required evidence rows are complete and owner-reviewed."
      : "This checklist only reflects durable evidence already recorded in the database above."
        + " It cannot itself satisfy any unmet row -- keep running the real app, the recovery/duplicate/fault"
        + " drills, and the research validations above until every box is checked, then request owner review."
  );
  return lines.join("\n");
}
