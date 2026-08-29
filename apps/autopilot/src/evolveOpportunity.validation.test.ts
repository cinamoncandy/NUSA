import assert from "node:assert/strict";
import test from "node:test";
import { validateEvolutionOpportunity } from "./evolveOpportunity";

test("rejects unknown lifecycle status instead of widening the canonical state model", () => {
  assert.throws(() => validateEvolutionOpportunity({
    id: "status-check",
    source: "github-actions",
    problem: "Malformed lifecycle status",
    evidence: [{ source: "github-actions", reference: "run/123", quality: 1 }],
    impact: 0.5,
    confidence: 0.5,
    risk: 0.2,
    reversibility: 0.8,
    status: "UNKNOWN_STATE",
    createdAt: "2026-08-29T06:00:00.000Z",
  }), /EVOLVE_OPPORTUNITY_STATUS_INVALID/);
});
