"use strict";
/**
 * Strategy research scorecard and promotion gate (WO-0031).
 *
 * Consumes the WO-0025..WO-0030 research evidence WITHOUT recomputing or modifying any
 * of it, verifies hashes and linkage, evaluates ten dimensions, and derives a gate
 * decision.
 *
 * THREE RULES THAT MAKE THIS HONEST:
 *
 *   1. NO SINGLE NUMERIC SCORE. A weighted total lets a data-integrity failure be
 *      averaged away by a good return. Dimensions carry a status and confidence, and
 *      blocking conditions always outrank everything else.
 *   2. TECHNICAL EXECUTION IS NOT STRATEGY PERFORMANCE. `executionStatus` says whether
 *      the scorecard could be computed; `researchDecision` says what to do about the
 *      strategy. A clean run over weak evidence is PASS + a negative decision.
 *   3. SYNTHETIC EVIDENCE CANNOT PROMOTE. Evidence built from invented candles supports
 *      implementation-correctness dimensions only. It can never raise confidence to
 *      HIGH and can never satisfy a promotion gate.
 */
const { canonicalHash } = require("./canonical-hash.js");
const { loadEvidenceManifest, EVIDENCE_ORDER } = require("./strategy-research-evidence-manifest.js");

const DIMENSIONS = Object.freeze([
  { id: "D-001", name: "Data Integrity", evidence: "DATASET_QUALITY" },
  { id: "D-002", name: "Backtest Integrity", evidence: "BACKTEST_BASELINE" },
  { id: "D-003", name: "Cost Resilience", evidence: "COST_STRESS" },
  { id: "D-004", name: "Out-of-Sample Performance", evidence: "WALK_FORWARD" },
  { id: "D-005", name: "Parameter Robustness", evidence: "PARAMETER_ROBUSTNESS" },
  { id: "D-006", name: "Regime Robustness", evidence: "REGIME_ANALYSIS" },
  { id: "D-007", name: "Cross-Market Generalization", evidence: "CROSS_MARKET_VALIDATION" },
  { id: "D-008", name: "Sample Sufficiency", evidence: null },
  { id: "D-009", name: "Benchmark Competitiveness", evidence: null },
  { id: "D-010", name: "Operational Paper Safety", evidence: "PAPER_OPERATIONAL_SAFETY" }
]);

const isNonNegativeInteger = (v) => Number.isInteger(v) && v >= 0;

function validateRequest(request) {
  const errors = [];
  if (request == null || typeof request !== "object") return ["request must be an object"];
  if (request.schemaVersion !== 1) errors.push(`unsupported schemaVersion: ${request.schemaVersion}`);
  if (typeof request.requestId !== "string" || !request.requestId) errors.push("request.requestId must be a non-empty string");

  const strategy = request.strategy ?? {};
  if (strategy.kind !== "SMA_CROSSOVER") errors.push(`unsupported strategy.kind: ${strategy.kind}`);
  for (const key of ["shortWindow", "longWindow", "timeframeMs"]) {
    if (!Number.isInteger(strategy[key]) || strategy[key] <= 0) errors.push(`strategy.${key} must be a positive integer`);
  }
  if (typeof strategy.strategyFingerprint !== "string" || !strategy.strategyFingerprint) errors.push("strategy.strategyFingerprint must be a non-empty string");
  if (typeof strategy.symbolPolicy !== "string" || !strategy.symbolPolicy) errors.push("strategy.symbolPolicy must be a non-empty string");

  const policy = request.policy ?? {};
  for (const key of ["minimumMarketCount", "minimumPeriodCount", "minimumValidCellCount", "minimumOosWindowCount", "minimumCompletedTradeCount", "minimumRegimeSegmentCount"]) {
    if (!isNonNegativeInteger(policy[key])) errors.push(`policy.${key} must be a non-negative integer`);
  }
  if (policy.requireIndependentVerification !== true) errors.push("policy.requireIndependentVerification must be true");
  if (policy.requireOperationalPaperSafety !== true) errors.push("policy.requireOperationalPaperSafety must be true");

  if (request.manifest == null) errors.push("request.manifest is required");
  return errors;
}

/** Confidence is a function of evidence quality and quantity only -- never of how good
 * the numbers look. Synthetic evidence caps confidence at LOW. */
function deriveConfidence(entry, sampleSufficient) {
  if (!entry || !entry.present) return "LOW";
  if (entry.trust === "VERIFIED_SYNTHETIC") return "LOW";
  if (entry.trust === "INVALID" || entry.trust === "UNVERIFIED_REAL") return "LOW";
  return sampleSufficient ? "HIGH" : "MEDIUM";
}

function dimensionShell(definition, entry) {
  return {
    id: definition.id,
    name: definition.name,
    evidenceType: definition.evidence,
    status: "NOT_RUN",
    confidence: "LOW",
    trust: entry ? entry.trust : "MISSING",
    metrics: {},
    strengths: [],
    weaknesses: [],
    blockers: [],
    warnings: [],
    notes: []
  };
}

function evaluateDimensions(manifest, request) {
  const policy = request.policy;
  const byType = manifest.byType;
  const results = [];

  const sample = byType.CROSS_MARKET_VALIDATION?.entry?.metrics ?? {};
  const oos = byType.WALK_FORWARD?.entry?.metrics ?? {};
  const regime = byType.REGIME_ANALYSIS?.entry?.metrics ?? {};

  const sampleChecks = {
    marketCount: { value: sample.marketCount ?? 0, minimum: policy.minimumMarketCount },
    periodCount: { value: sample.periodCount ?? 0, minimum: policy.minimumPeriodCount },
    validCellCount: { value: sample.validCellCount ?? 0, minimum: policy.minimumValidCellCount },
    oosWindowCount: { value: oos.oosWindowCount ?? 0, minimum: policy.minimumOosWindowCount },
    completedTradeCount: { value: sample.completedTradeCount ?? 0, minimum: policy.minimumCompletedTradeCount },
    regimeSegmentCount: { value: regime.segmentCount ?? 0, minimum: policy.minimumRegimeSegmentCount }
  };
  const sampleShortfalls = Object.entries(sampleChecks).filter(([, check]) => check.value < check.minimum).map(([key, check]) => `${key}: ${check.value} < ${check.minimum}`);
  const sampleSufficient = sampleShortfalls.length === 0;

  const DERIVED_TRUST_SOURCES = {
    "D-008": ["CROSS_MARKET_VALIDATION", "WALK_FORWARD", "REGIME_ANALYSIS"],
    "D-009": ["CROSS_MARKET_VALIDATION"]
  };
  const TRUST_RANK = { INVALID: 0, MISSING: 1, UNVERIFIED_REAL: 2, VERIFIED_SYNTHETIC: 3, VERIFIED_REAL: 4 };
  const inheritedTrust = (id) => {
    const sources = (DERIVED_TRUST_SOURCES[id] ?? []).map((type) => byType[type]?.trust ?? "MISSING");
    if (sources.length === 0) return "MISSING";
    return sources.reduce((worst, trust) => (TRUST_RANK[trust] < TRUST_RANK[worst] ? trust : worst));
  };

  for (const definition of DIMENSIONS) {
    const entry = definition.evidence ? byType[definition.evidence] : null;
    const dimension = dimensionShell(definition, entry);
    if (!definition.evidence) dimension.trust = inheritedTrust(definition.id);
    const metrics = entry?.entry?.metrics ?? {};
    const derivedConfidence = !sampleSufficient || ["VERIFIED_SYNTHETIC", "UNVERIFIED_REAL", "INVALID", "MISSING"].includes(dimension.trust) ? "LOW" : "MEDIUM";
    dimension.confidence = definition.evidence ? deriveConfidence(entry, sampleSufficient) : derivedConfidence;

    if (definition.evidence && (!entry || !entry.present)) {
      dimension.status = "NOT_RUN";
      dimension.blockers.push(`${definition.evidence} evidence is missing`);
      results.push(dimension);
      continue;
    }
    if (entry && entry.trust === "INVALID") {
      dimension.status = "INVALID";
      dimension.blockers.push(`${definition.evidence} evidence is INVALID (verifier failed or schema mismatch)`);
      results.push(dimension);
      continue;
    }
    const synthetic = entry ? entry.trust === "VERIFIED_SYNTHETIC" : false;

    switch (definition.id) {
      case "D-001": {
        const selectionBiasControlStatus = metrics.selectionBiasControlStatus ?? "UNVERIFIED";
        const survivorshipBiasControlStatus = metrics.survivorshipBiasControlStatus ?? "UNVERIFIED";
        dimension.metrics = {
          qualityStatus: metrics.qualityStatus ?? null,
          invalidOhlcCount: metrics.invalidOhlcCount ?? null,
          duplicateCount: metrics.duplicateCount ?? null,
          gapCount: metrics.gapCount ?? null,
          coverageRatio: metrics.coverageRatio ?? null,
          selectionBiasControlStatus,
          survivorshipBiasControlStatus
        };
        if (metrics.qualityStatus === "FAIL" || metrics.invalidOhlcCount > 0 || metrics.duplicateCount > 0) {
          dimension.status = "FAIL";
          dimension.blockers.push("dataset quality FAIL, invalid OHLC, or duplicate conflict");
        } else if (selectionBiasControlStatus !== "VERIFIED" || survivorshipBiasControlStatus !== "VERIFIED") {
          dimension.status = "INCONCLUSIVE";
          if (selectionBiasControlStatus !== "VERIFIED") dimension.blockers.push("selection-bias correction is missing, uncorrected, or unverified");
          if (survivorshipBiasControlStatus !== "VERIFIED") dimension.blockers.push("survivorship-bias correction is missing, uncorrected, or unverified");
          dimension.weaknesses.push("dataset bias controls are not independently established");
        } else if (synthetic) {
          dimension.status = "INCONCLUSIVE";
          dimension.notes.push("Only a synthetic dataset was supplied; data integrity of a real market dataset is unproven.");
        } else if (metrics.qualityStatus === "PASS" && (metrics.gapCount ?? 0) === 0 && (metrics.coverageRatio ?? 0) >= 0.99) {
          dimension.status = "STRONG";
          dimension.strengths.push("quality PASS with no gaps, full coverage, and verified selection/survivorship bias controls");
        } else {
          dimension.status = "ACCEPTABLE";
          dimension.weaknesses.push("quality PASS but with gaps or reduced coverage");
        }
        break;
      }
      case "D-002": {
        dimension.metrics = { closedCandlesOnly: metrics.closedCandlesOnly ?? null, lookAheadDetected: metrics.lookAheadDetected ?? null, deterministicRepeat: metrics.deterministicRepeat ?? null, benchmarkParity: metrics.benchmarkParity ?? null, sharedAccounting: metrics.sharedAccounting ?? null };
        if (metrics.lookAheadDetected === true) {
          dimension.status = "FAIL";
          dimension.blockers.push("look-ahead detected in the backtest path");
        } else if (metrics.closedCandlesOnly === true && metrics.deterministicRepeat === true && metrics.benchmarkParity === true && metrics.sharedAccounting === true) {
          dimension.status = "STRONG";
          dimension.strengths.push("closed candles only, deterministic repeat, benchmark parity, shared PaperBroker accounting");
        } else {
          dimension.status = "WEAK";
          dimension.weaknesses.push("one or more backtest integrity properties are unproven");
        }
        break;
      }
      case "D-003": {
        dimension.metrics = { baselinePositive: metrics.baselinePositive ?? null, moderateSurvival: metrics.moderateSurvivalRatio ?? null, severeSurvival: metrics.severeSurvivalRatio ?? null, costToGrossProfit: metrics.costToGrossProfitRatio ?? null };
        if (metrics.baselinePositive === false) {
          dimension.status = "FAIL";
          dimension.weaknesses.push("negative at the baseline cost assumption");
        } else if ((metrics.severeSurvivalRatio ?? 0) >= 0.5 && (metrics.moderateSurvivalRatio ?? 0) >= 0.7) {
          dimension.status = "STRONG";
        } else if ((metrics.moderateSurvivalRatio ?? 0) >= 0.5) {
          dimension.status = "ACCEPTABLE";
        } else {
          dimension.status = "WEAK";
          dimension.weaknesses.push("collapses quickly once costs rise above baseline");
        }
        dimension.notes.push("The cost model has no spread, market-impact, or partial-fill component beyond the configured constants.");
        break;
      }
      case "D-004": {
        dimension.metrics = { oosWindowCount: oos.oosWindowCount ?? 0, profitableWindowRatio: oos.profitableWindowRatio ?? null, compoundedOosReturn: oos.compoundedOosReturn ?? null, purgeApplied: oos.purgeApplied ?? null, embargoApplied: oos.embargoApplied ?? null };
        if ((oos.oosWindowCount ?? 0) < policy.minimumOosWindowCount) {
          dimension.status = "INCONCLUSIVE";
          dimension.weaknesses.push(`only ${oos.oosWindowCount ?? 0} OOS windows, policy requires ${policy.minimumOosWindowCount}`);
        } else if (oos.purgeApplied !== true || oos.embargoApplied !== true) {
          dimension.status = "WEAK";
          dimension.warnings.push("purge/embargo was not applied at the train/test boundary; OOS results may be optimistic");
        } else if ((oos.compoundedOosReturn ?? 0) <= 0) {
          dimension.status = "WEAK";
          dimension.weaknesses.push("out-of-sample compounded return is not positive");
        } else if ((oos.profitableWindowRatio ?? 0) >= 0.6) {
          dimension.status = "STRONG";
        } else {
          dimension.status = "ACCEPTABLE";
        }
        break;
      }
      case "D-005": {
        const classification = metrics.plateauClassification ?? null;
        dimension.metrics = { plateauClassification: classification, immediateNeighborPositiveRatio: metrics.immediateNeighborPositiveRatio ?? null };
        const map = { BROAD_PLATEAU: "STRONG", NARROW_PLATEAU: "ACCEPTABLE", ISOLATED_PEAK: "WEAK", FLAT_WEAK: "FAIL", UNSTABLE: "FAIL" };
        dimension.status = map[classification] ?? "INCONCLUSIVE";
        if (classification === "ISOLATED_PEAK") dimension.weaknesses.push("performance depends on one isolated parameter point");
        break;
      }
      case "D-006": {
        const dependency = metrics.strategyDependency ?? null;
        dimension.metrics = { strategyDependency: dependency, segmentCount: regime.segmentCount ?? 0, hostileRegimeCount: metrics.hostileRegimeCount ?? null, inconclusiveRegimeCount: metrics.inconclusiveRegimeCount ?? null };
        if ((regime.segmentCount ?? 0) < policy.minimumRegimeSegmentCount) {
          dimension.status = "INCONCLUSIVE";
          dimension.weaknesses.push("too few regime segments to judge regime robustness");
        } else if (dependency === "BROADLY_STABLE") {
          dimension.status = "STRONG";
        } else if (dependency === "BROADLY_WEAK" || dependency === "REGIME_UNSTABLE") {
          dimension.status = "FAIL";
        } else if (dependency) {
          dimension.status = "WEAK";
          dimension.weaknesses.push(`performance is ${dependency}`);
        } else {
          dimension.status = "INCONCLUSIVE";
        }
        break;
      }
      case "D-007": {
        const assessment = metrics.generalizationAssessment ?? null;
        dimension.metrics = { generalizationAssessment: assessment, marketCount: sample.marketCount ?? 0, periodCount: sample.periodCount ?? 0, validCellCount: sample.validCellCount ?? 0, sizingComparable: metrics.sizingComparable ?? null };
        const map = { BROADLY_GENERALIZABLE: "STRONG", MIXED: "ACCEPTABLE", MARKET_CONCENTRATED: "WEAK", PERIOD_CONCENTRATED: "WEAK", MARKET_AND_PERIOD_CONCENTRATED: "WEAK", BROADLY_WEAK: "FAIL", INCONSISTENT: "WEAK" };
        dimension.status = map[assessment] ?? "INCONCLUSIVE";
        if (metrics.sizingComparable === false) {
          dimension.status = "INCONCLUSIVE";
          dimension.warnings.push("cross-market sizing is not comparable, so market-to-market comparison is not meaningful");
        }
        break;
      }
      case "D-008": {
        dimension.metrics = sampleChecks;
        dimension.status = sampleSufficient ? "ACCEPTABLE" : "INCONCLUSIVE";
        for (const shortfall of sampleShortfalls) dimension.weaknesses.push(shortfall);
        break;
      }
      case "D-009": {
        const cross = byType.CROSS_MARKET_VALIDATION?.entry?.metrics ?? {};
        dimension.metrics = { cashOutperformRatio: cross.cashOutperformRatio ?? null, buyAndHoldOutperformRatio: cross.buyAndHoldOutperformRatio ?? null, fixed5x20OutperformRatio: cross.fixed5x20OutperformRatio ?? null };
        if (cross.buyAndHoldOutperformRatio == null) {
          dimension.status = "INCONCLUSIVE";
        } else if (cross.buyAndHoldOutperformRatio >= 0.6 && (cross.cashOutperformRatio ?? 0) >= 0.6) {
          dimension.status = "STRONG";
        } else if (cross.buyAndHoldOutperformRatio >= 0.4) {
          dimension.status = "ACCEPTABLE";
        } else {
          dimension.status = "WEAK";
          dimension.weaknesses.push("consistently underperforms buy-and-hold");
        }
        break;
      }
      case "D-010": {
        dimension.metrics = {
          persistenceAtomicity: metrics.persistenceAtomicity ?? null,
          killSwitch: metrics.killSwitch ?? null,
          duplicateProtection: metrics.duplicateProtection ?? null,
          restartAutoTradingOff: metrics.restartAutoTradingOff ?? null,
          liveCapabilityAbsent: metrics.liveCapabilityAbsent ?? null,
          independentRiskGatewayPresent: metrics.independentRiskGatewayPresent ?? null,
          actualPaperAcceptanceEvidence: metrics.actualPaperAcceptanceEvidence ?? null,
          operationalShadowEvidencePresent: metrics.operationalShadowEvidencePresent ?? false,
          operationalCanaryEvidencePresent: metrics.operationalCanaryEvidencePresent ?? false,
          shadowCriteriaMet: metrics.shadowCriteriaMet ?? false,
          canaryCriteriaMet: metrics.canaryCriteriaMet ?? false,
          pilotVerifierStatus: metrics.pilotVerifierStatus ?? null,
          evidenceFresh: metrics.evidenceFresh ?? false,
          ownerReviewCompleted: metrics.ownerReviewCompleted ?? false,
          promotionStatus: metrics.promotionStatus ?? "OBSERVATION_INCOMPLETE",
          pilotEvidenceType: metrics.pilotEvidenceType ?? null
        };
        if (metrics.liveCapabilityAbsent === false) {
          dimension.status = "FAIL";
          dimension.blockers.push("a live-trading capability is present");
        } else if (metrics.persistenceAtomicity === false || metrics.killSwitch === false) {
          dimension.status = "FAIL";
          dimension.blockers.push("persistence atomicity or kill switch is failing");
        } else if (metrics.pilotVerifierStatus === "FAIL" || metrics.promotionStatus === "BLOCKED") {
          dimension.status = "FAIL";
          dimension.blockers.push("pilot verifier or promotion gate blocked operational Paper safety");
        } else if (metrics.independentRiskGatewayPresent !== true || metrics.actualPaperAcceptanceEvidence !== true) {
          dimension.status = "INCONCLUSIVE";
          dimension.weaknesses.push("no independent risk gateway and/or no real Paper acceptance evidence; operational safety for strategy trial is unproven");
        } else if (metrics.pilotEvidenceType === "PAPER_PILOT_OPERATIONAL_EVIDENCE" && (metrics.operationalShadowEvidencePresent !== true || metrics.operationalCanaryEvidencePresent !== true || metrics.shadowCriteriaMet !== true || metrics.canaryCriteriaMet !== true || metrics.evidenceFresh !== true)) {
          dimension.status = "INCONCLUSIVE";
          dimension.weaknesses.push("operational Shadow/Canary observation criteria are incomplete");
        } else if (metrics.pilotEvidenceType === "PAPER_PILOT_OPERATIONAL_EVIDENCE" && metrics.ownerReviewCompleted !== true) {
          dimension.status = "INCONCLUSIVE";
          dimension.weaknesses.push("operational criteria are present but independent owner review is required");
        } else {
          dimension.status = "ACCEPTABLE";
        }
        break;
      }
      default:
        break;
    }

    const syntheticInput = synthetic || dimension.trust === "VERIFIED_SYNTHETIC";
    if (syntheticInput && ["D-001", "D-003", "D-004", "D-005", "D-006", "D-007", "D-009"].includes(definition.id)) {
      if (["STRONG", "ACCEPTABLE"].includes(dimension.status)) {
        dimension.status = "INCONCLUSIVE";
        dimension.notes.push("Downgraded to INCONCLUSIVE: the underlying evidence is synthetic, which cannot establish market performance.");
      }
    }

    results.push(dimension);
  }

  return { dimensions: results, sampleChecks, sampleSufficient, sampleShortfalls };
}

function deriveBlockers(manifest, dimensions, request) {
  const blockers = [];
  for (const entry of manifest.entries) {
    if (!entry.present) blockers.push({ kind: "EVIDENCE", detail: `${entry.evidenceType} evidence is missing` });
    else if (entry.trust === "INVALID") blockers.push({ kind: "EVIDENCE", detail: `${entry.evidenceType} evidence is INVALID` });
    else if (entry.fileVerification === "HASH_MISMATCH") blockers.push({ kind: "EVIDENCE", detail: `${entry.evidenceType} result hash does not match the file on disk` });
  }
  for (const dimension of dimensions) {
    for (const blocker of dimension.blockers) blockers.push({ kind: "TECHNICAL", detail: `${dimension.id}: ${blocker}` });
    if (dimension.status === "FAIL") blockers.push({ kind: "RESEARCH", detail: `${dimension.id} ${dimension.name} is FAIL` });
  }
  const safety = dimensions.find((dimension) => dimension.id === "D-010");
  if (request.policy.requireOperationalPaperSafety && safety && !["ACCEPTABLE", "STRONG"].includes(safety.status)) {
    blockers.push({ kind: "OPERATIONAL", detail: "operational Paper safety is not established" });
  }
  if (manifest.entries.some((entry) => entry.present && entry.trust === "VERIFIED_SYNTHETIC")) {
    blockers.push({ kind: "EVIDENCE", detail: "at least one evidence source is synthetic; synthetic evidence cannot support promotion" });
  }
  return blockers;
}

function decide(dimensions, blockers, manifest, sampleSufficient) {
  const byId = Object.fromEntries(dimensions.map((dimension) => [dimension.id, dimension]));
  const anyInvalid = dimensions.some((dimension) => dimension.status === "INVALID") || manifest.entries.some((entry) => entry.present && entry.trust === "INVALID");
  const missing = manifest.entries.filter((entry) => !entry.present);

  if (anyInvalid) return { decision: "INVALID", reasons: ["at least one evidence source is INVALID or failed independent verification"] };
  if (byId["D-002"].status === "FAIL") return { decision: "INVALID", reasons: ["backtest integrity failed; no performance result can be trusted"] };
  if (byId["D-010"].status === "FAIL") return { decision: "INVALID", reasons: ["operational Paper safety FAILED (live capability present, kill switch failing, or persistence not atomic); this is a hard stop"] };
  if (missing.length > 0) return { decision: "INSUFFICIENT_EVIDENCE", reasons: [`missing evidence: ${missing.map((entry) => entry.evidenceType).join(", ")}`] };
  if (!sampleSufficient) return { decision: "INSUFFICIENT_EVIDENCE", reasons: ["declared minimum sample thresholds are not met"] };

  const structurallyWeak = ["D-003", "D-004", "D-005", "D-006", "D-007"].filter((id) => byId[id].status === "FAIL");
  if (structurallyWeak.length >= 2) return { decision: "REJECT_STRATEGY", reasons: [`structural failure across ${structurallyWeak.join(", ")}`] };
  if (structurallyWeak.length === 1) return { decision: "REVISE_STRATEGY", reasons: [`${structurallyWeak[0]} is FAIL`] };

  const inconclusive = dimensions.filter((dimension) => dimension.status === "INCONCLUSIVE");
  if (blockers.length > 0) {
    return inconclusive.length > 0
      ? { decision: "CONTINUE_RESEARCH", reasons: ["blocking conditions remain and several dimensions are inconclusive"] }
      : { decision: "HOLD", reasons: ["blocking conditions remain despite otherwise adequate evidence"] };
  }
  if (inconclusive.length > 0) return { decision: "CONTINUE_RESEARCH", reasons: [`inconclusive dimensions: ${inconclusive.map((d) => d.id).join(", ")}`] };

  return { decision: "PROMOTE_TO_EXTENDED_PAPER_REVIEW", reasons: ["every dimension is ACCEPTABLE or STRONG with no blockers"] };
}

const PROHIBITED_ALWAYS = Object.freeze([
  "Enable Live Trading",
  "Place real orders",
  "Use the Upbit private API",
  "Store credentials",
  "Change the production strategy parameters automatically",
  "Change the production symbol automatically",
  "Start automatic Paper trading automatically",
  "Transition the pull request to Ready automatically",
  "Merge automatically"
]);

const PERMITTED_BY_DECISION = Object.freeze({
  PROMOTE_TO_EXTENDED_PAPER_REVIEW: ["Implement WO-0032 independent risk gateway", "Prepare Shadow/Canary policy", "Plan real Paper evidence collection", "Request owner safety review"],
  CONTINUE_RESEARCH: ["Add markets", "Extend periods", "Increase out-of-sample windows", "Strengthen the cost model", "Expand regime samples"],
  REVISE_STRATEGY: ["Study exit rules", "Study risk-based sizing", "Study cooldown", "Study a regime filter", "Compare against an alternative baseline"],
  HOLD: ["Collect the missing evidence", "Repair the manifest", "Complete independent verification", "Request owner review"],
  REJECT_STRATEGY: ["Stop promoting the SMA strategy", "Keep it as a research baseline only", "Open a separate work order for an alternative strategy"],
  INSUFFICIENT_EVIDENCE: ["Produce the missing research evidence", "Meet the declared minimum sample thresholds"],
  INVALID: ["Re-run the failed analyses", "Repair hash linkage", "Re-run independent verification"]
});

function runStrategyResearchScorecard(request, options = {}) {
  const requestErrors = validateRequest(request);
  if (requestErrors.length > 0) {
    return { schemaVersion: 1, requestId: request && request.requestId, executionStatus: "INVALID", researchDecision: "INVALID", decisionReasons: requestErrors, evidenceManifest: [], dimensions: [], blockers: [], warnings: [], limitations: [], strengths: [], weaknesses: [], permittedNextActions: [], prohibitedActions: [...PROHIBITED_ALWAYS], ownerReview: null, hashes: null };
  }

  const manifest = loadEvidenceManifest(request.manifest, { evidenceRoot: options.evidenceRoot });
  const { dimensions, sampleChecks, sampleSufficient } = evaluateDimensions(manifest, request);
  const blockers = deriveBlockers(manifest, dimensions, request);
  const { decision, reasons } = decide(dimensions, blockers, manifest, sampleSufficient);

  const executionStatus = manifest.errors.length > 0 ? "BLOCKED" : "PASS";
  const strengths = dimensions.flatMap((dimension) => dimension.strengths.map((text) => ({ dimension: dimension.id, detail: text })));
  const weaknesses = dimensions.flatMap((dimension) => dimension.weaknesses.map((text) => ({ dimension: dimension.id, detail: text })));
  const warnings = dimensions.flatMap((dimension) => dimension.warnings.map((text) => ({ dimension: dimension.id, detail: text })));

  const result = {
    schemaVersion: 1,
    requestId: request.requestId,
    strategy: { ...request.strategy },
    evidenceManifest: manifest.entries.map((entry) => ({
      evidenceType: entry.evidenceType, present: entry.present, trust: entry.trust,
      fileVerification: entry.fileVerification,
      requestId: entry.entry?.requestId ?? null, resultPath: entry.entry?.resultPath ?? null,
      resultSha256: entry.entry?.resultSha256 ?? null,
      executionStatus: entry.entry?.executionStatus ?? null,
      researchAssessment: entry.entry?.researchAssessment ?? null,
      independentVerificationStatus: entry.entry?.independentVerificationStatus ?? null,
      dataProvenance: entry.entry?.dataProvenance ?? null
    })),
    manifestErrors: manifest.errors,
    dimensions,
    sampleChecks,
    strengths,
    weaknesses,
    blockers,
    warnings,
    limitations: [
      "Selection and survivorship bias controls must be explicitly VERIFIED in DATASET_QUALITY evidence; residual methodology risk remains even when verified.",
      "Market coverage is limited and may be KRW-only.",
      "Listing-history differences shorten some symbols' usable range.",
      "The cost model omits spread, market impact, and partial fills beyond the configured constants.",
      "Fills occur at the same candle's close, not at the next candle's open.",
      "Cross-market sizing comparability constrains any net-PnL comparison.",
      "Paper fills differ from real exchange fills.",
      "No real Shadow/Canary Paper operation has been completed.",
      "Nothing here is evidence for Live Trading."
    ],
    executionStatus,
    researchDecision: decision,
    decisionReasons: reasons,
    permittedNextActions: [...(PERMITTED_BY_DECISION[decision] ?? [])],
    prohibitedActions: [...PROHIBITED_ALWAYS, ...(["INVALID", "REJECT_STRATEGY"].includes(decision) ? ["Reuse the existing research results", "Promote the strategy", "Publish any profitability claim"] : [])],
    ownerReview: {
      status: "PENDING",
      reviewedManifestSha256: null,
      approvedBy: null,
      approvedAt: null,
      conditions: []
    }
  };
  result.hashes = {
    requestSha256: canonicalHash(request),
    evidenceManifestSha256: manifest.manifestSha256,
    strategyFingerprint: request.strategy.strategyFingerprint,
    dimensionsSha256: canonicalHash(dimensions),
    blockersSha256: canonicalHash(blockers),
    decisionSha256: canonicalHash({ decision, reasons }),
    finalResultSha256: canonicalHash({ dimensions, blockers, decision, executionStatus })
  };
  return result;
}

module.exports = { runStrategyResearchScorecard, validateRequest, evaluateDimensions, decide, deriveConfidence, DIMENSIONS, EVIDENCE_ORDER, PROHIBITED_ALWAYS };
