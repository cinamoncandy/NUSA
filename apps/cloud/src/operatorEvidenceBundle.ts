import { createHash } from "node:crypto";
import {
  appendPaperScenarioEvent,
  replayPaperScenarioEvidence,
  type PaperScenarioEvent,
  type PaperScenarioRecord
} from "./paperScenarioEvidenceLedger";
import {
  buildScenarioPaperEvidenceBundle,
  scenarioObservationsFromLedger,
  type ScenarioResearchEvidence,
  type ScenarioPaperEvidenceBundle
} from "./scenarioEvidenceBundle";
import {
  allResearchGatesPassed,
  type ResearchRunManifest,
  type ResearchValidationReport
} from "./researchRunValidation";

export interface ScenarioEvidenceReader {
  loadScenarioEvents(): readonly PaperScenarioEvent[];
  loadResearchRunManifests?(): readonly ResearchRunManifest[];
  loadResearchValidationReports?(): readonly ResearchValidationReport[];
}

export interface OperatorEvidenceExportInput {
  readonly generatedAt: number;
  readonly applicationVersion: string;
  readonly codeVersion: string;
  readonly databaseIdentity: string;
  readonly validationProfile: "CALENDAR_30_DAY" | "SCENARIO_BASED";
  readonly targetStrategy: Readonly<{ strategyId: string; strategyVersion: string }>;
  readonly targetDataset: Readonly<{ datasetId: string; datasetChecksum: string }>;
  readonly researchManifests?: readonly ResearchRunManifest[];
  readonly researchReports?: readonly ResearchValidationReport[];
}

export interface OperatorEvidenceBundle {
  readonly bundleVersion: 1;
  readonly generatedAt: number;
  readonly applicationVersion: string;
  readonly codeVersion: string;
  readonly databaseIdentity: string;
  readonly validationProfile: "CALENDAR_30_DAY" | "SCENARIO_BASED";
  readonly targetStrategy: Readonly<{ strategyId: string; strategyVersion: string }>;
  readonly targetDataset: Readonly<{ datasetId: string; datasetChecksum: string }>;
  readonly events: readonly PaperScenarioEvent[];
  readonly eventChainHead: string | null;
  readonly derivedCounters: ReturnType<typeof replayPaperScenarioEvidence>;
  readonly representedRegimes: readonly string[];
  readonly passedFaultScenarios: readonly string[];
  readonly researchReports: readonly ResearchValidationReport[];
  readonly scenarioValidation: ScenarioPaperEvidenceBundle["validation"];
  readonly releaseReadiness: Readonly<{ status: "BLOCKED" | "READY_FOR_OWNER_REVIEW" | "APPROVED"; blockers: readonly string[]; ownerReviewRequired: true; liveTradingAllowed: false }>;
  readonly warnings: readonly string[];
  readonly bundleChecksum: string;
}

const faultScenarios = new Set(["PERSISTENCE_FAILURE", "WEBSOCKET_DISCONNECT", "PARTIAL_WRITE", "DUPLICATE_SIGNAL", "KILL_SWITCH"]);
const freeze = <T>(value: T): Readonly<T> => Object.freeze(value);
const canonical = (value: unknown): string => {
  if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
  }
  throw new Error("unsupported value in evidence canonicalization");
};
const checksum = (value: unknown): string => createHash("sha256").update(canonical(value), "utf8").digest("hex");

function replayEvents(events: readonly PaperScenarioEvent[]): readonly PaperScenarioRecord[] {
  let records: readonly PaperScenarioRecord[] = [];
  for (const event of events) records = appendPaperScenarioEvent(records, event);
  return records;
}

function validateResearchReports(input: OperatorEvidenceExportInput): { reports: readonly ResearchValidationReport[]; warnings: readonly string[] } {
  const warnings: string[] = [];
  const target = input.researchManifests.filter((manifest) =>
    manifest.strategyId === input.targetStrategy.strategyId &&
    manifest.strategyVersion === input.targetStrategy.strategyVersion &&
    manifest.datasetId === input.targetDataset.datasetId &&
    manifest.datasetChecksum === input.targetDataset.datasetChecksum
  );
  const targetIds = new Set(target.map((manifest) => manifest.runId));
  const reports = input.researchReports.filter((report) => targetIds.has(report.runId));
  if (reports.length !== input.researchReports.length) warnings.push("RESEARCH_REPORT_OUTSIDE_TARGET_IGNORED");
  for (const type of ["WALK_FORWARD", "COST_STRESS", "INTEGRITY_CHECK"] as const) {
    if (!reports.some((report) => report.runType === type && report.status === "PASS")) warnings.push(`RESEARCH_${type}_MISSING_OR_FAILED`);
  }
  return { reports: Object.freeze([...reports]), warnings: Object.freeze(warnings) };
}

export function exportOperatorEvidenceBundle(reader: ScenarioEvidenceReader, input: OperatorEvidenceExportInput): OperatorEvidenceBundle {
  if (!Number.isSafeInteger(input.generatedAt) || input.generatedAt < 0) throw new Error("generatedAt is invalid");
  if (!input.applicationVersion.trim() || !input.codeVersion.trim() || !input.databaseIdentity.trim()) throw new Error("export identity is required");
  const events = Object.freeze([...reader.loadScenarioEvents()]);\n  const persistedManifests = reader.loadResearchRunManifests?.() ?? input.researchManifests ?? [];\n  const persistedReports = reader.loadResearchValidationReports?.() ?? input.researchReports ?? [];
  const records = replayEvents(events);
  const counters = replayPaperScenarioEvidence(records);
  const observations = scenarioObservationsFromLedger(records);
  const research = validateResearchReports({ ...input, researchManifests: persistedManifests, researchReports: persistedReports });
  const reportEvidence: ScenarioResearchEvidence = {
    walkForwardEvidenceId: research.reports.find((report) => report.runType === "WALK_FORWARD")?.runId ?? "MISSING",
    costStressEvidenceId: research.reports.find((report) => report.runType === "COST_STRESS")?.runId ?? "MISSING",
    integrityEvidenceId: research.reports.find((report) => report.runType === "INTEGRITY_CHECK")?.runId ?? "MISSING",
    walkForwardPassed: research.reports.some((report) => report.runType === "WALK_FORWARD" && report.status === "PASS"),
    costStressPassed: research.reports.some((report) => report.runType === "COST_STRESS" && report.status === "PASS"),
    integrityChecksPassed: research.reports.some((report) => report.runType === "INTEGRITY_CHECK" && report.status === "PASS")
  };
  const scenarioBundle = buildScenarioPaperEvidenceBundle(observations, reportEvidence, input.generatedAt);
  const passedFaultScenarios = counters.passedFaultScenarios.filter((scenario) => faultScenarios.has(scenario));
  const warnings = [...research.warnings];
  if (passedFaultScenarios.length !== counters.passedFaultScenarios.length) warnings.push("UNSUPPORTED_FAULT_SCENARIO_PRESENT");
  if (!allResearchGatesPassed(research.reports)) warnings.push("RESEARCH_GATES_INCOMPLETE");
  if (events.length === 0) warnings.push("NO_SCENARIO_EVENTS");
  const blockers = [
    ...warnings,
    ...(scenarioBundle.validation.status === "PASS" ? [] : scenarioBundle.validation.reasons),
    ...(allResearchGatesPassed(research.reports) ? [] : ["RESEARCH_VALIDATION_INCOMPLETE"])
  ];
  const releaseReadiness = {
    status: "BLOCKED" as const,
    blockers: Object.freeze([...new Set(blockers)].sort()),
    ownerReviewRequired: true as const,
    liveTradingAllowed: false as const
  };
  const unsigned = {
    bundleVersion: 1 as const,
    generatedAt: input.generatedAt,
    applicationVersion: input.applicationVersion,
    codeVersion: input.codeVersion,
    databaseIdentity: input.databaseIdentity,
    validationProfile: input.validationProfile,
    targetStrategy: input.targetStrategy,
    targetDataset: input.targetDataset,
    events,
    eventChainHead: records.at(-1)?.hash ?? null,
    derivedCounters: counters,
    representedRegimes: Object.freeze([...new Set(observations.flatMap((observation) => observation.marketRegime == null ? [] : [observation.marketRegime]))].sort()),
    passedFaultScenarios: Object.freeze([...new Set(passedFaultScenarios)].sort()),
    researchReports: research.reports,
    scenarioValidation: scenarioBundle.validation,
    releaseReadiness,
    warnings: Object.freeze([...new Set(warnings)].sort())
  };
  return freeze({ ...unsigned, bundleChecksum: checksum(unsigned) });
}

export function verifyOperatorEvidenceBundle(bundle: OperatorEvidenceBundle): OperatorEvidenceBundle {
  const { bundleChecksum, ...unsigned } = bundle;
  if (bundle.bundleVersion !== 1 || !/^[a-f0-9]{64}$/.test(bundleChecksum)) throw new Error("invalid evidence bundle identity");
  if (checksum(unsigned) !== bundleChecksum) throw new Error("evidence bundle checksum mismatch");
  const records = replayEvents(bundle.events);
  const replayed = replayPaperScenarioEvidence(records);
  if (canonical(replayed) !== canonical(bundle.derivedCounters)) throw new Error("evidence counter replay mismatch");
  if ((records.at(-1)?.hash ?? null) !== bundle.eventChainHead) throw new Error("evidence chain head mismatch");
  return freeze(bundle);
}
