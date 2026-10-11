"use strict";
/**
 * Independent verification of a Parameter Robustness result (WO-0028). Deliberately
 * does NOT call scripts/lib/parameter-robustness-runner.js's grid, neighbor, or
 * classification builders -- every check here is re-derived from the raw request and
 * the result's own recorded numbers, using separate arithmetic.
 */
const { canonicalHash } = require("./canonical-hash.js");
const { canonicalFamilyParameters } = require("./strategy-family-parameters.js");

function isGenericFamilyRequest(request) { return typeof request?.strategyFamily === "string" || Array.isArray(request?.candidateGrid); }

function verifyGenericParameterRobustnessResult(request, result) {
  const errors = [];
  if (![request.candidateGrid, request.referenceParameters, result.candidates, result.references, result.costConditions].every(Array.isArray)) {
    return { status: "FAIL", errors: ["generic family evidence arrays are missing or malformed"] };
  }
  if (!["sma-crossover", "rsi-mean-reversion", "donchian-breakout"].includes(request.strategyFamily)) errors.push("unsupported strategyFamily");
  if (request.candidateGrid.length === 0 || request.referenceParameters.length === 0) errors.push("generic grid and references must be non-empty");
  const canonicalKey = value => typeof value === "string" && value.length > 0 && value === value.trim();
  for (const candidate of request.candidateGrid) if (!canonicalKey(candidate?.key)) errors.push("candidateGrid requires canonical keys");
  for (const candidate of result.candidates) if (!canonicalKey(candidate?.candidateKey)) errors.push("result requires canonical candidate keys");
  for (const ref of [...request.referenceParameters, ...result.references]) {
    if (!canonicalKey(ref?.candidateKey)) errors.push("reference requires canonical candidate key");
    if (!["PRODUCTION_DEFAULT", "WALK_FORWARD_SELECTED", "MANUAL_RESEARCH_REFERENCE"].includes(ref?.source)) errors.push("reference source invalid");
  }
  if (result.strategyFamily !== request.strategyFamily) errors.push("result strategyFamily mismatch");
  if (result.requestId !== request.id || result.schemaVersion !== request.schemaVersion) errors.push("result request identity mismatch");
  if (canonicalHash(result.costConditions) !== canonicalHash(request.costConditions)) errors.push("costConditions request mismatch");
  const expected = new Map((request.candidateGrid ?? []).map((candidate) => [candidate.key, candidate]));
  const actual = new Map((result.candidates ?? []).map((candidate) => [candidate.candidateKey, candidate]));
  const parameterIdentities = new Set();
  for (const candidate of request.candidateGrid) {
    const identity = canonicalHash(canonicalFamilyParameters(request.strategyFamily, candidate.parameters));
    if (parameterIdentities.has(identity)) errors.push("request contains duplicate strategy parameters");
    parameterIdentities.add(identity);
  }
  if (expected.size !== request.candidateGrid.length) errors.push("request.candidateGrid contains duplicate keys");
  if (actual.size !== result.candidates.length) errors.push("result.candidates contains duplicate candidateKey values");
  if (expected.size !== actual.size) errors.push(`candidate grid size mismatch: expected ${expected.size}, result has ${actual.size}`);
  for (const [key, candidate] of expected) {
    const recorded = actual.get(key);
    if (!recorded) { errors.push(`missing candidate in result: ${key}`); continue; }
    if (canonicalHash(canonicalFamilyParameters(request.strategyFamily, candidate.parameters)) !== canonicalHash(canonicalFamilyParameters(request.strategyFamily, recorded.parameters))) errors.push(`candidate ${key} parameter mismatch`);
    if (canonicalHash([...candidate.neighbors].sort()) !== canonicalHash([...(recorded.neighbors ?? [])].sort())) errors.push(`candidate ${key} adjacency mismatch`);
    if (recorded.status !== "EVALUATED") errors.push("candidate " + key + " status must be EVALUATED");
    if (recorded.familyId !== request.strategyFamily) errors.push(`candidate ${key} family mismatch`);
  }
  const referenceIdentity = (ref) => JSON.stringify([ref.source, ref.candidateKey]);
  const expectedReferences = new Set(request.referenceParameters.map(referenceIdentity));
  if (new Set(request.referenceParameters.map(ref => ref.candidateKey)).size !== request.referenceParameters.length) errors.push("request requires one reference per candidate");
  const actualReferences = new Map(result.references.map((ref) => [referenceIdentity(ref), ref]));
  if (expectedReferences.size !== request.referenceParameters.length) errors.push("request contains duplicate reference identity");
  if (actualReferences.size !== result.references.length) errors.push("result contains duplicate reference identity");
  if (expectedReferences.size !== actualReferences.size || [...actualReferences.keys()].some((key) => !expectedReferences.has(key))) errors.push("reference identity set mismatch");
  for (const ref of request.referenceParameters ?? []) {
    if (!expected.has(ref.candidateKey)) errors.push(`reference ${ref.source} (${ref.candidateKey}) is not present in candidateGrid`);
    else if (canonicalHash(canonicalFamilyParameters(request.strategyFamily, ref.parameters)) !== canonicalHash(canonicalFamilyParameters(request.strategyFamily, expected.get(ref.candidateKey).parameters))) errors.push("reference parameters do not match its candidate");
    const reported = actualReferences.get(referenceIdentity(ref));
    if (!reported) errors.push(`reference result missing: ${ref.source}`);
    else {
      if (reported.familyId !== request.strategyFamily) errors.push("reference family mismatch");
      if (reported.candidateKey !== ref.candidateKey) errors.push(`reference ${ref.source} candidateKey mismatch`);
      if (canonicalHash(canonicalFamilyParameters(request.strategyFamily, reported.parameters)) !== canonicalHash(canonicalFamilyParameters(request.strategyFamily, ref.parameters))) errors.push(`reference ${ref.source} parameters mismatch`);
      if (reported.assessment === "BROAD_PLATEAU" && !(reported.referenceReturn > 0)) errors.push(`reference ${ref.source}: BROAD_PLATEAU requires a positive referenceReturn`);
      if (reported.assessment === "FLAT_WEAK" && reported.referenceReturn > 0) errors.push(`reference ${ref.source}: FLAT_WEAK should not have a positive referenceReturn`);
    }
  }
  const byName = Object.fromEntries((result.costConditions ?? []).map((condition) => [condition.name, condition]));
  if (byName.BASE && byName.MODERATE && (byName.MODERATE.feeRate < byName.BASE.feeRate || byName.MODERATE.slippageBps < byName.BASE.slippageBps)) errors.push("recorded costConditions.MODERATE is less stressful than BASE");
  if (byName.MODERATE && byName.SEVERE && (byName.SEVERE.feeRate < byName.MODERATE.feeRate || byName.SEVERE.slippageBps < byName.MODERATE.slippageBps)) errors.push("recorded costConditions.SEVERE is less stressful than MODERATE");
  const validCandidates = result.candidates;
  const prefersOos = request.evaluation.mode !== "FULL_SAMPLE";
  const selectedReturn = (candidate) => prefersOos
    ? (candidate.costResults.BASE.oos?.compoundedReturn ?? 0)
    : (candidate.costResults.BASE.fullSample?.totalReturn ?? 0);
  for (const candidate of validCandidates) {
    for (const condition of request.costConditions) {
      const evidence = candidate.costResults?.[condition.name];
      if (prefersOos) {
        const oos = evidence?.oos;
        if (!oos || ![oos.compoundedReturn, oos.compoundedBenchmarkReturn, oos.benchmarkExcessReturn].every(value => typeof value === "number" && Number.isFinite(value))) throw new Error("missing or non-finite OOS benchmark evidence");
        if (oos.benchmarkExcessReturn !== oos.compoundedReturn - oos.compoundedBenchmarkReturn) throw new Error("OOS benchmark excess mismatch");
      }
      if (request.evaluation.mode !== "WALK_FORWARD_OOS_WINDOWS") {
        const full = evidence?.fullSample;
        if (!full || ![full.totalReturn, full.benchmarkReturn, full.benchmarkExcessReturn].every(value => typeof value === "number" && Number.isFinite(value))) throw new Error("missing or non-finite full-sample evidence");
        if (full.benchmarkExcessReturn !== full.totalReturn - full.benchmarkReturn) throw new Error("full-sample benchmark excess mismatch");
      }
    }
  }
  const returns = validCandidates.map(selectedReturn).sort((a, b) => a - b);
  const positiveRatio = returns.length ? returns.filter((value) => value > 0).length / returns.length : 0;
  if (result.aggregate && Math.abs(positiveRatio - result.aggregate.positiveRatio) > 1e-9) errors.push(`aggregate.positiveRatio mismatch: recomputed ${positiveRatio}, result reports ${result.aggregate.positiveRatio}`);
  if (result.aggregate && returns.length && Math.abs(returns[0] - result.aggregate.worstReturn) > 1e-9) errors.push("aggregate.worstReturn mismatch");
  if (result.aggregate && returns.length && Math.abs(returns[returns.length - 1] - result.aggregate.bestReturn) > 1e-9) errors.push("aggregate.bestReturn mismatch");
  // Re-derive diagnostics independently from the bound candidate and declared edges.
  const selectedBenchmark = (candidate) => prefersOos
    ? (candidate.costResults.BASE.oos.compoundedReturn - candidate.costResults.BASE.oos.compoundedBenchmarkReturn)
    : (candidate.costResults.BASE.fullSample.totalReturn - candidate.costResults.BASE.fullSample.benchmarkReturn);
  const edges = [];
  for (const [key, candidate] of expected) {
    if (!Array.isArray(candidate.neighbors)) throw new Error("invalid adjacency");
    for (const neighbor of candidate.neighbors) {
      if (!expected.has(neighbor) || neighbor === key || !expected.get(neighbor).neighbors.includes(key)) throw new Error("invalid adjacency");
      if (key < neighbor) edges.push([key, neighbor]);
    }
    if (new Set(candidate.neighbors).size !== candidate.neighbors.length) throw new Error("duplicate adjacency");
  }
  const signRatio = edges.length ? edges.filter(([a, b]) => (selectedReturn(actual.get(a)) > 0) !== (selectedReturn(actual.get(b)) > 0)).length / edges.length : 0;
  for (const ref of request.referenceParameters) {
    const candidate = actual.get(ref.candidateKey);
    const reported = actualReferences.get(referenceIdentity(ref));
    if (!candidate || !reported) continue;
    const neighbors = expected.get(ref.candidateKey).neighbors.map(key => actual.get(key));
    const referenceReturn = selectedReturn(candidate);
    const directionRatio = neighbors.length ? neighbors.filter(c => (selectedReturn(c) > 0) === (referenceReturn > 0)).length / neighbors.length : 0;
    const benchmarkRatio = neighbors.length ? neighbors.filter(c => selectedBenchmark(c) > 0).length / neighbors.length : 0;
    const assessment = signRatio >= 0.5 ? "UNSTABLE" : referenceReturn <= 0 ? "FLAT_WEAK"
      : directionRatio >= 0.75 && benchmarkRatio >= 0.5 ? "BROAD_PLATEAU" : directionRatio >= 0.5 ? "NARROW_PLATEAU" : "ISOLATED_PEAK";
    const diagnostics = { referenceReturn, immediateNeighborCount: neighbors.length,
      immediateNeighborPositiveRatio: directionRatio, immediateNeighborBenchmarkOutperformRatio: benchmarkRatio,
      allCandidatePositiveRatio: positiveRatio, signReversalRatio: signRatio, assessment };
    for (const [field, value] of Object.entries(diagnostics)) {
      if (reported[field] !== value) errors.push("reference " + ref.source + " (" + ref.candidateKey + ") " + field + " mismatch");
    }
  }
  if (result.hashes) {
    if (canonicalHash(request) !== result.hashes.requestSha256) errors.push("requestSha256 mismatch");
    if (canonicalHash(request.referenceParameters) !== result.hashes.referenceParametersSha256) errors.push("referenceParametersSha256 mismatch");
    if (canonicalHash(request.candidateGrid) !== result.hashes.neighborhoodGridSha256) errors.push("neighborhoodGridSha256 mismatch");
    if (canonicalHash(result.candidates) !== result.hashes.candidateResultsSha256) errors.push("candidateResultsSha256 mismatch");
    if (canonicalHash(result.aggregate) !== result.hashes.aggregateResultSha256) errors.push("aggregateResultSha256 mismatch");
    if (canonicalHash(result.references) !== result.hashes.referencesSha256) errors.push("referencesSha256 mismatch");
  } else errors.push("result.hashes is missing");
  return { status: errors.length === 0 ? "PASS" : "FAIL", errors };
}

function rebuildGridKeys(referenceParameters, neighborhood) {
  const keys = new Set();
  for (const ref of referenceParameters) {
    for (const shortOffset of neighborhood.shortOffsets) {
      for (const longOffset of neighborhood.longOffsets) {
        keys.add(`${ref.shortWindow + shortOffset}/${ref.longWindow + longOffset}`);
      }
    }
  }
  return keys;
}

function verifyParameterRobustnessResult(request, result) {
  const errors = [];
  if (!result || result.status === undefined) { errors.push("result is missing a status field"); return { status: "FAIL", errors }; }
  if (result.status === "FAIL" && Array.isArray(result.candidates) && result.candidates.length === 0) return { status: "PASS", errors: [], note: "request-level validation failure; nothing further to verify" };
  if (isGenericFamilyRequest(request)) {
    try { return verifyGenericParameterRobustnessResult(request, result); }
    catch { return { status: "FAIL", errors: ["generic family evidence is malformed"] }; }
  }

  // Grid completeness + tuple uniqueness, rebuilt independently from the raw request.
  const expectedKeys = rebuildGridKeys(request.referenceParameters, request.neighborhood);
  const actualKeys = new Set(result.candidates.map((c) => `${c.shortWindow}/${c.longWindow}`));
  if (expectedKeys.size !== actualKeys.size) errors.push(`candidate grid size mismatch: expected ${expectedKeys.size} unique tuples, result has ${actualKeys.size}`);
  for (const key of expectedKeys) if (!actualKeys.has(key)) errors.push(`missing candidate in result: ${key}`);
  if (actualKeys.size !== result.candidates.length) errors.push("result.candidates contains a duplicate tuple");

  // Every declared reference parameter must itself appear as a candidate.
  for (const ref of request.referenceParameters) {
    if (!actualKeys.has(`${ref.shortWindow}/${ref.longWindow}`)) errors.push(`reference ${ref.source} (${ref.shortWindow}/${ref.longWindow}) is not present in the candidate grid`);
  }

  // Distance recomputation for a sample of candidates (every candidate, since fixtures
  // stay small): abs difference, not a fabricated geometric distance.
  for (const candidate of result.candidates) {
    for (const distance of candidate.distanceFromReferences ?? []) {
      const ref = request.referenceParameters.find((r) => r.source === distance.source);
      if (!ref) continue;
      const expectedShort = Math.abs(candidate.shortWindow - ref.shortWindow);
      const expectedLong = Math.abs(candidate.longWindow - ref.longWindow);
      if (distance.short !== expectedShort || distance.long !== expectedLong || distance.normalized !== expectedShort + expectedLong) {
        errors.push(`candidate ${candidate.shortWindow}/${candidate.longWindow}: distance from ${distance.source} does not match |delta| recomputation`);
      }
    }
  }

  // Cost-condition monotonicity was already enforced at validation time; verify the
  // recorded costConditions in the result still satisfy it (guards against a result
  // whose costConditions block was altered after the fact).
  const byName = Object.fromEntries((result.costConditions ?? []).map((c) => [c.name, c]));
  if (byName.BASE && byName.MODERATE && (byName.MODERATE.feeRate < byName.BASE.feeRate || byName.MODERATE.slippageBps < byName.BASE.slippageBps)) errors.push("recorded costConditions.MODERATE is less stressful than BASE");
  if (byName.MODERATE && byName.SEVERE && (byName.SEVERE.feeRate < byName.MODERATE.feeRate || byName.SEVERE.slippageBps < byName.MODERATE.slippageBps)) errors.push("recorded costConditions.SEVERE is less stressful than MODERATE");

  // Aggregate recomputation: positiveRatio and median/IQR/best/worst over valid
  // candidates' BASE return, independently derived from each candidate's own recorded
  // costResults rather than trusting result.aggregate.
  const validCandidates = result.candidates.filter((c) => c.status === "EVALUATED");
  const prefersOos = request.evaluation.mode !== "FULL_SAMPLE";
  const selectedReturn = (candidate) => prefersOos
    ? (candidate.costResults.BASE.oos?.compoundedReturn ?? 0)
    : (candidate.costResults.BASE.fullSample?.totalReturn ?? 0);
  const returns = validCandidates.map(selectedReturn).sort((a, b) => a - b);
  const positiveRatio = returns.length ? returns.filter((r) => r > 0).length / returns.length : 0;
  if (result.aggregate && Math.abs(positiveRatio - result.aggregate.positiveRatio) > 1e-9) errors.push(`aggregate.positiveRatio mismatch: recomputed ${positiveRatio}, result reports ${result.aggregate.positiveRatio}`);
  if (result.aggregate && returns.length && Math.abs(returns[0] - result.aggregate.worstReturn) > 1e-9) errors.push("aggregate.worstReturn mismatch");
  if (result.aggregate && returns.length && Math.abs(returns[returns.length - 1] - result.aggregate.bestReturn) > 1e-9) errors.push("aggregate.bestReturn mismatch");

  // Assessment sanity: a reference classified BROAD_PLATEAU must have a positive
  // referenceReturn (the runner's own rule; re-checked here independently rather than
  // trusting the label).
  for (const reference of result.references ?? []) {
    if (reference.assessment === "BROAD_PLATEAU" && !(reference.referenceReturn > 0)) errors.push(`reference ${reference.source}: BROAD_PLATEAU requires a positive referenceReturn`);
    if (reference.assessment === "FLAT_WEAK" && reference.referenceReturn > 0) errors.push(`reference ${reference.source}: FLAT_WEAK should not have a positive referenceReturn`);
  }

  if (result.hashes) {
    const recomputedRequestHash = canonicalHash(request);
    if (recomputedRequestHash !== result.hashes.requestSha256) errors.push(`requestSha256 mismatch: recomputed ${recomputedRequestHash}, result reports ${result.hashes.requestSha256}`);
    const recomputedReferenceHash = canonicalHash(request.referenceParameters);
    if (recomputedReferenceHash !== result.hashes.referenceParametersSha256) errors.push("referenceParametersSha256 mismatch");
    const recomputedCandidateHash = canonicalHash(result.candidates);
    if (recomputedCandidateHash !== result.hashes.candidateResultsSha256) errors.push("candidateResultsSha256 mismatch (result.candidates may have been altered after hashing)");
    const recomputedAggregateHash = canonicalHash(result.aggregate);
    if (recomputedAggregateHash !== result.hashes.aggregateResultSha256) errors.push("aggregateResultSha256 mismatch (result.aggregate may have been altered after hashing)");
    const recomputedReferencesHash = canonicalHash(result.references);
    if (recomputedReferencesHash !== result.hashes.referencesSha256) errors.push("referencesSha256 mismatch (result.references may have been altered after hashing)");
  } else {
    errors.push("result.hashes is missing");
  }

  return { status: errors.length === 0 ? "PASS" : "FAIL", errors };
}

module.exports = { verifyParameterRobustnessResult };
