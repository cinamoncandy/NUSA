"use strict";

// Input semantics shared by the runner and verifier, never performance calculations.
// Every value consumed by a strategy must be explicit in the precommitted request.
function canonicalFamilyParameters(familyId, value) {
  const fields = {
    "sma-crossover": ["shortPeriod", "longPeriod"],
    "rsi-mean-reversion": ["period", "oversold", "overbought"],
    "donchian-breakout": ["channelPeriod"],
  }[familyId];
  if (!Array.isArray(fields)) throw new Error("unsupported strategy family");
  if (value == null || typeof value !== "object" || Array.isArray(value)) throw new Error("strategy parameters must be an object");
  const normalized = {};
  for (const [name, parameter] of Object.entries(value)) {
    const field = familyId === "sma-crossover"
      ? ({ shortWindow: "shortPeriod", longWindow: "longPeriod" }[name] ?? name)
      : name;
    if (!fields.includes(field)) throw new Error(`unknown strategy parameter: ${name}`);
    if (Object.hasOwn(normalized, field)) throw new Error(`ambiguous strategy parameter: ${field}`);
    if (typeof parameter !== "number" || !Number.isFinite(parameter)) throw new Error(`non-finite strategy parameter: ${field}`);
    normalized[field] = parameter;
  }
  if (fields.some((field) => !Object.hasOwn(normalized, field))) throw new Error("missing explicit strategy parameters");
  return normalized;
}

module.exports = { canonicalFamilyParameters };
