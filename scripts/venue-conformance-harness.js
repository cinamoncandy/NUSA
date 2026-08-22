"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const DAY_SET = new Set(["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"]);

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object || {}, key);
}

function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function finitePositive(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function finiteNonNegative(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function explicitBoolean(value) {
  return value === true || value === false;
}

function stringArray(value) {
  return Array.isArray(value) && value.length > 0 && value.every(nonEmpty);
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

function sha256Json(value) {
  return `sha256:${crypto.createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex")}`;
}

function parseClock(value) {
  if (typeof value !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return null;
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

function validateWindow(window) {
  if (!window || !stringArray(window.days) || !window.days.every((day) => DAY_SET.has(day))) return false;
  if (!nonEmpty(window.timezone)) return false;
  const start = parseClock(window.start);
  const end = parseClock(window.end);
  return start !== null && end !== null && start < end;
}

function windowContained(required, allowed) {
  if (!validateWindow(required) || !validateWindow(allowed)) return false;
  if (required.timezone !== allowed.timezone) return false;
  const allowedDays = new Set(allowed.days);
  if (!required.days.every((day) => allowedDays.has(day))) return false;
  return parseClock(required.start) >= parseClock(allowed.start) && parseClock(required.end) <= parseClock(allowed.end);
}

function allWindowsContained(requiredWindows, allowedWindows) {
  return requiredWindows.every((required) => allowedWindows.some((allowed) => windowContained(required, allowed)));
}

function evaluateVenueConformance(input) {
  const strategy = input?.strategy || {};
  const venue = input?.venue || {};
  const account = input?.account || {};
  const checks = [];

  function add(id, status, reason, detail) {
    checks.push(Object.freeze({ id, status, reason, ...(detail ? { detail } : {}) }));
  }

  const identitiesValid =
    strategy.schemaVersion === 1 && venue.schemaVersion === 1 && account.schemaVersion === 1 &&
    nonEmpty(strategy.id) && nonEmpty(venue.id) && nonEmpty(account.id);
  add("identity", identitiesValid ? "PASS" : "UNKNOWN", identitiesValid ? "IDENTITY_BOUND" : "CONFORMANCE_IDENTITY_UNKNOWN");

  if (!hasOwn(venue, "tradingEnabled") || !explicitBoolean(venue.tradingEnabled)) {
    add("venue-enabled", "UNKNOWN", "VENUE_TRADING_STATE_UNKNOWN");
  } else if (!venue.tradingEnabled) {
    add("venue-enabled", "BLOCK", "VENUE_TRADING_DISABLED");
  } else {
    add("venue-enabled", "PASS", "VENUE_TRADING_ENABLED");
  }

  if (!hasOwn(account, "status") || !nonEmpty(account.status)) {
    add("account-status", "UNKNOWN", "ACCOUNT_STATUS_UNKNOWN");
  } else if (account.status !== "ACTIVE") {
    add("account-status", "BLOCK", "ACCOUNT_TRADING_NOT_ACTIVE", account.status);
  } else {
    add("account-status", "PASS", "ACCOUNT_ACTIVE");
  }

  if (!nonEmpty(strategy.instrument) || !stringArray(venue.supportedInstruments) || !stringArray(account.allowedInstruments)) {
    add("instrument", "UNKNOWN", "INSTRUMENT_POLICY_UNKNOWN");
  } else if (!venue.supportedInstruments.includes(strategy.instrument)) {
    add("instrument", "BLOCK", "VENUE_INSTRUMENT_UNSUPPORTED", strategy.instrument);
  } else if (!account.allowedInstruments.includes(strategy.instrument)) {
    add("instrument", "BLOCK", "ACCOUNT_INSTRUMENT_UNSUPPORTED", strategy.instrument);
  } else {
    add("instrument", "PASS", "INSTRUMENT_SUPPORTED", strategy.instrument);
  }

  if (!stringArray(strategy.orderTypes) || !stringArray(venue.supportedOrderTypes)) {
    add("order-types", "UNKNOWN", "ORDER_TYPE_POLICY_UNKNOWN");
  } else {
    const unsupported = strategy.orderTypes.filter((type) => !venue.supportedOrderTypes.includes(type));
    add(
      "order-types",
      unsupported.length ? "BLOCK" : "PASS",
      unsupported.length ? "VENUE_ORDER_TYPE_UNSUPPORTED" : "ORDER_TYPES_SUPPORTED",
      unsupported.join(",") || undefined,
    );
  }

  for (const [id, strategyKey, venueKey, accountKey, reason] of [
    ["overnight", "requiresOvernight", "allowsOvernight", "allowsOvernight", "OVERNIGHT_NOT_ALLOWED"],
    ["weekend", "requiresWeekend", "allowsWeekend", "allowsWeekend", "WEEKEND_NOT_ALLOWED"],
  ]) {
    const requirement = strategy[strategyKey];
    if (!explicitBoolean(requirement) || !explicitBoolean(venue[venueKey]) || !explicitBoolean(account[accountKey])) {
      add(id, "UNKNOWN", `${reason}_POLICY_UNKNOWN`);
    } else if (requirement && (!venue[venueKey] || !account[accountKey])) {
      add(id, "BLOCK", reason);
    } else {
      add(id, "PASS", `${id.toUpperCase()}_CONFORMANT`);
    }
  }

  for (const [id, strategyKey, venueKey, accountKey, reason] of [
    ["order-notional", "maxOrderNotional", "maxOrderNotional", "maxOrderNotional", "MAX_ORDER_NOTIONAL_EXCEEDED"],
    ["position-notional", "maxPositionNotional", "maxPositionNotional", "maxPositionNotional", "MAX_POSITION_NOTIONAL_EXCEEDED"],
  ]) {
    const requested = strategy[strategyKey];
    const venueLimit = venue[venueKey];
    const accountLimit = account[accountKey];
    if (![requested, venueLimit, accountLimit].every(finitePositive)) {
      add(id, "UNKNOWN", `${reason}_POLICY_UNKNOWN`);
    } else if (requested > venueLimit || requested > accountLimit) {
      add(id, "BLOCK", reason, `requested=${requested}; venue=${venueLimit}; account=${accountLimit}`);
    } else {
      add(id, "PASS", `${id.toUpperCase().replace(/-/g, "_")}_CONFORMANT`);
    }
  }

  if (!finiteNonNegative(strategy.maxDailyLoss) || !finitePositive(account.dailyLossLimit)) {
    add("daily-loss", "UNKNOWN", "DAILY_LOSS_POLICY_UNKNOWN");
  } else if (strategy.maxDailyLoss > account.dailyLossLimit) {
    add("daily-loss", "BLOCK", "ACCOUNT_DAILY_LOSS_CONFLICT", `strategy=${strategy.maxDailyLoss}; account=${account.dailyLossLimit}`);
  } else {
    add("daily-loss", "PASS", "DAILY_LOSS_CONFORMANT");
  }

  if (!finiteNonNegative(strategy.maxTrailingDrawdown) || !finitePositive(account.trailingDrawdownLimit)) {
    add("trailing-drawdown", "UNKNOWN", "TRAILING_DRAWDOWN_POLICY_UNKNOWN");
  } else if (strategy.maxTrailingDrawdown > account.trailingDrawdownLimit) {
    add("trailing-drawdown", "BLOCK", "TRAILING_DRAWDOWN_CONFLICT", `strategy=${strategy.maxTrailingDrawdown}; account=${account.trailingDrawdownLimit}`);
  } else {
    add("trailing-drawdown", "PASS", "TRAILING_DRAWDOWN_CONFORMANT");
  }

  if (!explicitBoolean(strategy.tradesDuringRestrictedNews) || !explicitBoolean(account.newsTradingAllowed)) {
    add("news", "UNKNOWN", "NEWS_RESTRICTION_POLICY_UNKNOWN");
  } else if (strategy.tradesDuringRestrictedNews && !account.newsTradingAllowed) {
    add("news", "BLOCK", "NEWS_TRADING_RESTRICTION_CONFLICT");
  } else {
    add("news", "PASS", "NEWS_RESTRICTION_CONFORMANT");
  }

  if (!explicitBoolean(strategy.requiresMargin) || !explicitBoolean(venue.marginAllowed) || !explicitBoolean(account.marginAllowed)) {
    add("margin", "UNKNOWN", "MARGIN_POLICY_UNKNOWN");
  } else if (strategy.requiresMargin && (!venue.marginAllowed || !account.marginAllowed)) {
    add("margin", "BLOCK", "MARGIN_NOT_ALLOWED");
  } else {
    add("margin", "PASS", "MARGIN_CONFORMANT");
  }

  if (!finitePositive(strategy.maxLeverage) || !finitePositive(venue.maxLeverage) || !finitePositive(account.maxLeverage)) {
    add("leverage", "UNKNOWN", "LEVERAGE_POLICY_UNKNOWN");
  } else if (strategy.maxLeverage > venue.maxLeverage || strategy.maxLeverage > account.maxLeverage) {
    add("leverage", "BLOCK", "LEVERAGE_LIMIT_EXCEEDED", `strategy=${strategy.maxLeverage}; venue=${venue.maxLeverage}; account=${account.maxLeverage}`);
  } else {
    add("leverage", "PASS", "LEVERAGE_CONFORMANT");
  }

  const requiredWindows = strategy.tradingWindows;
  const venueWindows = venue.tradingWindows;
  const accountWindows = account.tradingWindows;
  if (!Array.isArray(requiredWindows) || requiredWindows.length === 0 || requiredWindows.some((window) => !validateWindow(window))) {
    add("trading-hours", "UNKNOWN", "STRATEGY_TRADING_HOURS_UNKNOWN");
  } else if (!Array.isArray(venueWindows) || venueWindows.length === 0 || venueWindows.some((window) => !validateWindow(window))) {
    add("trading-hours", "UNKNOWN", "VENUE_TRADING_HOURS_UNKNOWN");
  } else if (!(accountWindows === null || (Array.isArray(accountWindows) && accountWindows.length > 0 && accountWindows.every(validateWindow)))) {
    add("trading-hours", "UNKNOWN", "ACCOUNT_TRADING_HOURS_UNKNOWN");
  } else if (!allWindowsContained(requiredWindows, venueWindows)) {
    add("trading-hours", "BLOCK", "VENUE_TRADING_HOURS_CONFLICT");
  } else if (Array.isArray(accountWindows) && !allWindowsContained(requiredWindows, accountWindows)) {
    add("trading-hours", "BLOCK", "ACCOUNT_TRADING_HOURS_CONFLICT");
  } else {
    add("trading-hours", "PASS", "TRADING_HOURS_CONFORMANT");
  }

  const reasons = [...new Set(checks.filter((check) => check.status !== "PASS").map((check) => check.reason))].sort();
  const status = checks.some((check) => check.status === "BLOCK")
    ? "BLOCK"
    : checks.some((check) => check.status === "UNKNOWN")
      ? "UNKNOWN"
      : "PASS";

  return Object.freeze({
    status,
    deployable: status === "PASS",
    strategyId: nonEmpty(strategy.id) ? strategy.id : null,
    venueId: nonEmpty(venue.id) ? venue.id : null,
    accountId: nonEmpty(account.id) ? account.id : null,
    binding: Object.freeze({
      strategyHash: sha256Json(strategy),
      venuePolicyHash: sha256Json(venue),
      accountPolicyHash: sha256Json(account),
    }),
    reasons: Object.freeze(reasons),
    checks: Object.freeze(checks),
  });
}

function main() {
  const inputPath = process.argv[2];
  if (!inputPath) {
    console.error("Usage: node scripts/venue-conformance-harness.js <conformance-input.json>");
    process.exitCode = 64;
    return;
  }

  const absolutePath = path.resolve(process.cwd(), inputPath);
  const input = JSON.parse(fs.readFileSync(absolutePath, "utf8"));
  const result = evaluateVenueConformance(input);
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.status === "PASS" ? 0 : result.status === "BLOCK" ? 2 : 3;
}

if (require.main === module) main();

module.exports = { evaluateVenueConformance, sha256Json, validateWindow, windowContained };
