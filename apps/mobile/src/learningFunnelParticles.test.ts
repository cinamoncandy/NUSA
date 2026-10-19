import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FUNNEL_GATE_Y, FUNNEL_MAX_PARTICLES, FUNNEL_SIEVE_Y, createFunnelField, funnelCounts, funnelParticlePoint, stepFunnelField, warmFunnelField } from "./learningFunnelParticles";

const G = { width: 360, height: 300 };
const tiers = (f: ReturnType<typeof createFunnelField>) => [0, 1, 2].map((t) => Array.from(f.tier).filter((x) => x === t).length);

describe("learning funnel particles", () => {
  it("scales the real counts without inventing or losing a stage", () => {
    assert.deepEqual(funnelCounts(418, 15, 0), { total: 418, discovery: 15, holdout: 0 });
    assert.deepEqual(funnelCounts(5000, 100, 3), { total: FUNNEL_MAX_PARTICLES, discovery: 10, holdout: 1 }, "a nonzero count keeps one particle");
    assert.deepEqual(funnelCounts(5000, 0, 0), { total: FUNNEL_MAX_PARTICLES, discovery: 0, holdout: 0 }, "a zero count stays zero");
    assert.deepEqual(funnelCounts(0, 0, 0), { total: 0, discovery: 0, holdout: 0 });
  });

  it("assigns exactly the passers to each tier", () => {
    const f = createFunnelField(funnelCounts(418, 15, 0), 11);
    assert.deepEqual(tiers(f), [403, 15, 0]);
    const g = createFunnelField(funnelCounts(418, 15, 3), 11);
    assert.deepEqual(tiers(g), [403, 12, 3]);
  });

  it("with zero holdout passers nothing is ever drawn below the last gate", () => {
    const f = createFunnelField(funnelCounts(418, 15, 0), 11);
    for (let s = 0; s < 1200; s += 1) {
      stepFunnelField(f, 0.04);
      for (let i = 0; i < f.count; i += 1) assert.ok(funnelParticlePoint(f, i, G).y <= FUNNEL_GATE_Y * G.height, "particle below the last gate");
    }
  });

  it("rejected particles never get past the first sieve, and a holdout passer does reach the bottom", () => {
    const f = createFunnelField(funnelCounts(418, 15, 3), 11);
    let bottom = 0;
    for (let s = 0; s < 1200; s += 1) {
      stepFunnelField(f, 0.04);
      for (let i = 0; i < f.count; i += 1) {
        const p = funnelParticlePoint(f, i, G);
        if (f.tier[i] === 0 && p.alpha > 0.02) assert.ok(p.y <= FUNNEL_SIEVE_Y * G.height + (G.height * 0.16 * 0.35) + 1e-6, "rejected particle fell past the sieve");
        if (f.tier[i] === 2 && p.y > FUNNEL_GATE_Y * G.height + 20 && p.alpha > 0.1) bottom += 1;
      }
    }
    assert.ok(bottom > 0, "a holdout passer is drawn below the last gate");
  });

  it("is deterministic for a seed and stays inside the scene", () => {
    const a = createFunnelField(funnelCounts(418, 15, 0), 11), b = createFunnelField(funnelCounts(418, 15, 0), 11);
    warmFunnelField(a, 5); warmFunnelField(b, 5);
    assert.deepEqual(Array.from(a.t), Array.from(b.t));
    for (let i = 0; i < a.count; i += 1) { const p = funnelParticlePoint(a, i, G); assert.ok(p.x > -60 && p.x < G.width + 60); }
  });
});
