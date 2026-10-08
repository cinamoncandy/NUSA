import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { validatePaperCandidateExecutionBinding } from "./cioDecisionEngine";
import { evaluatePaperCandidateStrategy } from "./paperCandidateStrategy";
import {
  OWNER_BASELINE_CANDIDATE_ID,
  OWNER_BASELINE_CODE_IDENTITY,
  OWNER_BASELINE_IMPLEMENTATION_VERSION,
  OwnerBaselinePaperBindingProvider,
  ownerBaselineBinding,
  isOwnerBaselineSourceCommitSha,
  ownerBaselineStrategyEnabled,
} from "./ownerBaselinePaperStrategy";

const COMMIT = "a".repeat(40);
const GOLDEN_RISING = { action: "BUY", confidence: 0.75 };
const GOLDEN_FALLING = { action: "SELL", confidence: 0.75 };
const NOW = Date.UTC(2026, 8, 29, 4, 0, 0);

test("the baseline binding passes the canonical execution binding validator and stays PAPER-only", () => {
  const binding = ownerBaselineBinding("krw-btc", NOW, COMMIT);
  const validated = validatePaperCandidateExecutionBinding(binding, NOW);
  assert.equal(validated.candidateId, OWNER_BASELINE_CANDIDATE_ID);
  assert.equal(validated.authority, "PAPER_RESEARCH_ONLY");
  assert.equal(validated.liveAuthority, "NONE");
  assert.equal(validated.productionMutationAllowed, false);
  assert.equal(validated.candidateStrategy?.familyId, "sma-crossover");
  assert.deepEqual(validated.candidateStrategy?.parameters, { shortPeriod: 5, longPeriod: 20 });
});

test("the binding is deterministic within an Asia/Seoul day so a restart keeps the same strategy identity", () => {
  const first = ownerBaselineBinding("KRW-BTC", NOW, COMMIT);
  assert.deepEqual(ownerBaselineBinding("KRW-BTC", NOW + 60_000, COMMIT), first);
  assert.notEqual(ownerBaselineBinding("KRW-ETH", NOW, COMMIT).bindingFingerprintSha256, first.bindingFingerprintSha256);
  assert.ok(first.periodStartAt <= NOW);
});

test("the baseline strategy produces an actionable decision the execution boundary accepts", () => {
  const binding = ownerBaselineBinding("KRW-BTC", NOW, COMMIT);
  const observations = Array.from({ length: 30 }, (_, index) => ({
    id: `tick-${index}`, source: "CHART" as const, market: "KRW-BTC", price: 100 + index, sentiment: 0, confidence: 1,
    observedAt: binding.periodStartAt + 1_000 * (index + 1), expiresAt: NOW + 60_000, summary: "tick",
  }));
  const decision = evaluatePaperCandidateStrategy(binding.candidateStrategy!, observations as never, NOW, "KRW-BTC");
  assert.equal(decision.action, "BUY");
  assert.ok(decision.confidence >= 0.55, "the boundary requires confidence >= 0.55");
});

test("a bound challenger always takes precedence, and the baseline is off outside PAPER or when disabled", () => {
  const challengerBinding = { candidateId: "qualified-challenger" } as never;
  const withChallenger = new OwnerBaselinePaperBindingProvider({ challenger: { read: () => challengerBinding }, sourceCommitSha: COMMIT, enabled: true });
  assert.equal(withChallenger.read("KRW-BTC", NOW), challengerBinding);
  const idle = new OwnerBaselinePaperBindingProvider({ challenger: { read: () => undefined }, sourceCommitSha: COMMIT, enabled: true, baselineMarkets: ["KRW-BTC"] });
  assert.equal(idle.read("KRW-BTC", NOW)?.candidateId, OWNER_BASELINE_CANDIDATE_ID);
  assert.equal(new OwnerBaselinePaperBindingProvider({ sourceCommitSha: COMMIT, enabled: false }).read("KRW-BTC", NOW), undefined);
  assert.equal(new OwnerBaselinePaperBindingProvider({ sourceCommitSha: "not-a-commit", enabled: true }).read("KRW-BTC", NOW), undefined, "fails closed without an exact source identity");
  assert.equal(idle.read("KRW-ETH", NOW), undefined, "baseline never crosses its configured market boundary");
  assert.equal(isOwnerBaselineSourceCommitSha(COMMIT), true);
  assert.equal(isOwnerBaselineSourceCommitSha("not-a-commit"), false);
  assert.equal(ownerBaselineStrategyEnabled({ NUSA_MODE: "PAPER" }), true);
  assert.equal(ownerBaselineStrategyEnabled({ NUSA_MODE: "PAPER", NUSA_PAPER_OWNER_BASELINE_STRATEGY: "DISABLED" }), false);
  assert.equal(ownerBaselineStrategyEnabled({ NUSA_MODE: "PAPER", NUSA_PAPER_OWNER_BASELINE_STRATEGY: "enabled" }), false, "a typo fails closed");
  assert.equal(ownerBaselineStrategyEnabled({ NUSA_MODE: "LIVE" }), false);
});

test("the baseline binds every configured market, each with its own deterministic binding, and nothing else", () => {
  const multi = new OwnerBaselinePaperBindingProvider({ challenger: { read: () => undefined }, sourceCommitSha: COMMIT, enabled: true, baselineMarkets: ["KRW-XRP", "KRW-ADA", "krw-sui"] });
  const xrp = multi.read("KRW-XRP", NOW);
  const ada = multi.read("KRW-ADA", NOW);
  const sui = multi.read("KRW-SUI", NOW);
  assert.equal(xrp?.candidateId, OWNER_BASELINE_CANDIDATE_ID);
  assert.ok(xrp != null && ada != null && sui != null);
  assert.notEqual(xrp.bindingFingerprintSha256, ada.bindingFingerprintSha256, "bindings are market-specific");
  assert.equal(multi.read("KRW-XRP", NOW)?.bindingFingerprintSha256, xrp.bindingFingerprintSha256, "deterministic across calls");
  assert.equal(multi.read("KRW-BTC", NOW), undefined, "unconfigured markets stay unbound");
  assert.equal(new OwnerBaselinePaperBindingProvider({ challenger: { read: () => undefined }, sourceCommitSha: COMMIT, enabled: true, baselineMarkets: [] }).read("KRW-XRP", NOW), undefined);
  assert.equal(new OwnerBaselinePaperBindingProvider({ challenger: { read: () => undefined }, sourceCommitSha: COMMIT, enabled: false, baselineMarkets: ["KRW-XRP"] }).read("KRW-XRP", NOW), undefined);
});

test("the binding fingerprint does not depend on the deployed commit, so a deploy never mixes a period", () => {
  const a = ownerBaselineBinding("KRW-BTC", NOW, "a".repeat(40));
  const b = ownerBaselineBinding("KRW-BTC", NOW, "b".repeat(40));
  assert.equal(a.bindingFingerprintSha256, b.bindingFingerprintSha256);
  assert.equal(a.candidateStrategy?.codeSha, OWNER_BASELINE_CODE_IDENTITY);
  assert.notEqual(a.candidateStrategy?.codeSha, "a".repeat(40));
  assert.throws(() => ownerBaselineBinding("KRW-BTC", NOW, "not-a-commit"));
});

test("GOLDEN: the baseline decision is fixed; changing SMA behaviour requires bumping OWNER_BASELINE_IMPLEMENTATION_VERSION", () => {
  const binding = ownerBaselineBinding("KRW-BTC", NOW, COMMIT);
  const series = (price: (i: number) => number) => Array.from({ length: 30 }, (_, index) => ({
    id: `tick-${index}`, source: "CHART" as const, market: "KRW-BTC", price: price(index), sentiment: 0, confidence: 1,
    observedAt: binding.periodStartAt + 1_000 * (index + 1), expiresAt: NOW + 60_000, summary: "tick",
  }));
  const pick = (d: { action: string; confidence: number }) => ({ action: d.action, confidence: Number(d.confidence.toFixed(6)) });
  const rising = pick(evaluatePaperCandidateStrategy(binding.candidateStrategy!, series((i) => 100 + i) as never, NOW, "KRW-BTC"));
  const falling = pick(evaluatePaperCandidateStrategy(binding.candidateStrategy!, series((i) => 200 - i) as never, NOW, "KRW-BTC"));
  assert.deepEqual({ rising, falling }, { rising: GOLDEN_RISING, falling: GOLDEN_FALLING });
});

/** Source text of a top-level function, found by name with brace matching (no parser dependency). */
function functionSource(source: string, name: string): string {
  const start = source.search(new RegExp(`(export )?function ${name}\\b`));
  assert.ok(start >= 0, `function ${name} must exist`);
  const open = source.indexOf("{", source.indexOf(")", start));
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}" && (depth -= 1) === 0) return source.slice(start, index + 1);
  }
  throw new Error(`unterminated function ${name}`);
}

test("PIN: the SMA evaluation path is pinned to OWNER_BASELINE_IMPLEMENTATION_VERSION", () => {
  // If this fails you changed how the baseline decides. Bump OWNER_BASELINE_IMPLEMENTATION_VERSION
  // (a new identity, so fills before and after are never scored as one strategy) and update both pins.
  const source = readFileSync(resolve(__dirname, "../../../../apps/cloud/src/paperCandidateStrategy.ts"), "utf8");
  const sma = ["parseSmaParameters", "canonicalPrices", "evaluateSma", "evaluatePaperCandidateStrategy"].map((name) => functionSource(source, name)).join("\n").replace(/\s+/g, " ");
  const digest = createHash("sha256").update(sma).digest("hex");
  assert.deepEqual({ version: OWNER_BASELINE_IMPLEMENTATION_VERSION, digest }, { version: "owner-baseline-sma-5-20/implementation-1", digest: "727a482eb477b74710250c0af67e9a29a05921357409682837ed142075848beb" });
});
