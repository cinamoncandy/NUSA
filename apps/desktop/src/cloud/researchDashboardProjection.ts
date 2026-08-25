import { allResearchGatesPassed, validateResearchRunManifest, type ResearchRunManifest, type ResearchRunType, type ResearchValidationReport } from "../../../cloud/src/researchRunValidation";
import type { ResearchDashboardSection } from "../../../cloud/src/dashboardAggregator";

const REQUIRED_TYPES = new Set<ResearchRunType>(["WALK_FORWARD", "COST_STRESS", "MONTE_CARLO", "INTEGRITY_CHECK"]);
const SHA256 = /^[a-f0-9]{64}$/i;

export interface PersistedResearchDashboardInput {
  readonly manifests: readonly ResearchRunManifest[];
  readonly reports: readonly ResearchValidationReport[];
  readonly generatedAt: number;
}

const freeze = (section: ResearchDashboardSection): ResearchDashboardSection => Object.freeze({
  ...section,
  reasons: Object.freeze([...new Set(section.reasons)].sort())
});

const unavailable = (generatedAt: number, reason: string): ResearchDashboardSection => freeze({
  status: "BLOCKED",
  availability: "UNAVAILABLE",
  generatedAt,
  reasons: [reason],
  walkForwardPassed: false,
  monteCarloPassed: false,
  costStressPassed: false,
  paperPromotionEligible: false
});

function assertTime(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("research dashboard generatedAt is invalid");
}

function assertReport(report: ResearchValidationReport, generatedAt: number): void {
  if (!report.runId.trim() || !REQUIRED_TYPES.has(report.runType)) throw new Error("research validation report identity is invalid");
  if (report.status !== "PASS" && report.status !== "FAIL") throw new Error("research validation report status is invalid");
  const checkedAt = Date.parse(report.checkedAt);
  if (!Number.isFinite(checkedAt) || checkedAt > generatedAt || !SHA256.test(report.resultChecksum)) {
    throw new Error("research validation report provenance is invalid");
  }
  if (report.reasons.some((reason) => !reason.trim())) throw new Error("research validation report reason is invalid");
}

function assertManifest(manifest: ResearchRunManifest): void {
  if (!manifest.runId.trim() || !REQUIRED_TYPES.has(manifest.runType) || !SHA256.test(manifest.resultChecksum) || !SHA256.test(manifest.manifestChecksum)) {
    throw new Error("research manifest provenance is invalid");
  }
  validateResearchRunManifest(manifest);
}

export function buildPersistedResearchDashboardSection(input: PersistedResearchDashboardInput): ResearchDashboardSection {
  assertTime(input.generatedAt);
  if (input.reports.length === 0) return unavailable(input.generatedAt, "NO_PERSISTED_RESEARCH_VALIDATION");

  const manifestsByRun = new Map<string, ResearchRunManifest>();
  for (const manifest of input.manifests) {
    assertManifest(manifest);
    if (manifestsByRun.has(manifest.runId)) throw new Error("duplicate persisted research manifest");
    manifestsByRun.set(manifest.runId, manifest);
  }

  const reportsByType = new Map<ResearchRunType, ResearchValidationReport>();
  for (const report of input.reports) {
    assertReport(report, input.generatedAt);
    if (reportsByType.has(report.runType)) throw new Error("duplicate persisted research validation report type");
    const manifest = manifestsByRun.get(report.runId);
    if (!manifest || manifest.runType !== report.runType || manifest.resultChecksum !== report.resultChecksum) {
      throw new Error("research validation report does not match a persisted manifest");
    }
    reportsByType.set(report.runType, report);
  }

  const reports = [...reportsByType.values()];
  const walkForwardPassed = reportsByType.get("WALK_FORWARD")?.status === "PASS";
  const costStressPassed = reportsByType.get("COST_STRESS")?.status === "PASS";
  const integrityPassed = reportsByType.get("INTEGRITY_CHECK")?.status === "PASS";
  const monteCarloPassed = reportsByType.get("MONTE_CARLO")?.status === "PASS";
  const paperPromotionEligible = allResearchGatesPassed(reports);
  const reasons = reports.flatMap((report) => report.status === "PASS" ? [] : [
    `RESEARCH_${report.runType}_FAILED`,
    ...report.reasons.map((reason) => `RESEARCH_${report.runType}_${reason}`)
  ]);

  if (!walkForwardPassed) reasons.push("WALK_FORWARD_NOT_PASSED");
  if (!costStressPassed) reasons.push("COST_STRESS_NOT_PASSED");
  if (!integrityPassed) reasons.push("INTEGRITY_CHECK_NOT_PASSED");
  if (!monteCarloPassed) reasons.push("MONTE_CARLO_NOT_PASSED");
  if (!paperPromotionEligible) reasons.push("RESEARCH_GATE_NOT_PASSED");

  return freeze({
    status: paperPromotionEligible ? "HEALTHY" : "BLOCKED",
    availability: "AVAILABLE",
    generatedAt: input.generatedAt,
    reasons,
    walkForwardPassed,
    monteCarloPassed,
    costStressPassed,
    paperPromotionEligible
  });
}
