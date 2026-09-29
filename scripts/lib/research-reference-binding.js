"use strict";

const { canonicalHash } = require("./canonical-hash.js");

const BINDING_FIELDS = ["familyId", "candidateKey", "parameters"];
// Checked independently of the caller's candidateIdFor, so a faulty key generator cannot vouch for itself.
const smaCandidateKey = (shortWindow, longWindow) => `sma-${shortWindow}-${longWindow}`;

/**
 * Binds legacy SMA parameter-robustness references (shortWindow/longWindow) to their precommitted
 * candidate identity, and authenticates the result against the independently verified raw digest.
 *
 * The robustness finalizer stores and hashes the bound form, so the digest has to be re-sealed
 * after binding. That re-seal is only allowed when stripping exactly the added binding fields
 * reproduces the verified raw references byte-for-byte, and every added identity is the
 * deterministic function of the verified windows. A binding regression therefore fails the run
 * instead of being sealed as VERIFIED.
 */
function bindLegacySmaReferences({ references, verifiedReferencesSha256, familyId, smaFamilyId, candidateIdFor }) {
  if (!Array.isArray(references)) throw new Error("parameter robustness references are required");
  if (canonicalHash(references) !== verifiedReferencesSha256) {
    throw new Error("parameter robustness references do not match the independently verified digest");
  }
  const bound = references.map((reference) => {
    if (reference.candidateKey != null) return reference;
    if (familyId !== smaFamilyId || !Number.isFinite(reference.shortWindow) || !Number.isFinite(reference.longWindow)) return reference;
    const parameters = { shortPeriod: reference.shortWindow, longPeriod: reference.longWindow };
    return { ...reference, familyId, candidateKey: candidateIdFor(familyId, parameters), parameters };
  });
  const stripped = bound.map((reference, index) => {
    if (reference === references[index]) return reference;
    const rest = { ...reference };
    for (const field of BINDING_FIELDS) delete rest[field];
    return rest;
  });
  const identitiesDeterministic = bound.every((reference, index) => reference === references[index] || (
    reference.familyId === familyId
    && reference.parameters.shortPeriod === references[index].shortWindow
    && reference.parameters.longPeriod === references[index].longWindow
    && reference.candidateKey === smaCandidateKey(references[index].shortWindow, references[index].longWindow)
  ));
  if (canonicalHash(stripped) !== verifiedReferencesSha256 || !identitiesDeterministic) {
    throw new Error("parameter robustness candidate binding does not derive from the verified references");
  }
  return bound;
}

module.exports = { bindLegacySmaReferences };
