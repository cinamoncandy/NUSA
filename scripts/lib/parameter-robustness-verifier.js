"use strict";
/**
 * Independent verification of a Parameter Robustness result (WO-0028). Deliberately
 * does NOT call scripts/lib/parameter-robustness-runner.js's grid, neighbor, or
 * classification builders -- every check here is re-derived from the raw request and
 * the result's own recorded numbers, using separate arithmetic.
 */
const { canonicalHash } = require("./canonical-hash.js");

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
  if (result.status === "FAIL" && result.candidates.length === 0) return { status: "PASS", errors: [], note: "request-level validation failure; nothing further to verify" };

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
  const returns = validCandidates.map((c) => c.costResults.BASE.fullSample?.totalReturn ?? c.costResults.BASE.oos?.compoundedReturn ?? 0).sort((a, b) => a - b);
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
  } else {
    errors.push("result.hashes is missing");
  }

  return { status: errors.length === 0 ? "PASS" : "FAIL", errors };
}

module.exports = { verifyParameterRobustnessResult };
