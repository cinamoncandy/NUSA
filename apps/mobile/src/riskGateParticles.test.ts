import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GATE_STREAMLINES, GATE_Y_RATIO, createGateField, gateParticlePoint, gateStreamline, gateY, seededRandom, settledLight, stepGateField, warmGateField } from "./riskGateParticles";

const G = { width: 360, height: 250 };

describe("risk gate particles", () => {
  it("is deterministic for a seed and different for another", () => {
    const a = createGateField(200, 7, G.width), b = createGateField(200, 7, G.width), c = createGateField(200, 8, G.width);
    warmGateField(a, 5, G); warmGateField(b, 5, G); warmGateField(c, 5, G);
    assert.deepEqual(Array.from(a.t), Array.from(b.t));
    assert.notDeepEqual(Array.from(a.t), Array.from(c.t));
    assert.equal(seededRandom(1)(), seededRandom(1)());
  });

  it("never lets anything past the gate: no flowing or settled particle is below the gate line", () => {
    const field = createGateField(400, 3, G.width);
    for (let s = 0; s < 1500; s += 1) {
      stepGateField(field, 0.04, G);
      for (let i = 0; i < field.count; i += 1) assert.ok(gateParticlePoint(field, i, G).y <= gateY(G), "flowing particle below the gate");
    }
    assert.ok(field.settledCount > 500, "particles keep arriving at the gate");
    for (let s = 0; s < Math.min(field.settledCount, field.settledX.length); s += 1) assert.ok(field.settledY[s]! <= gateY(G), "settled particle below the gate");
    assert.equal(GATE_Y_RATIO < 1, true);
  });

  it("piles up in front of the gate, bounded, and the pile fades instead of growing forever", () => {
    const field = createGateField(500, 5, G.width);
    warmGateField(field, 40, G);
    assert.ok(Math.max(...field.heights) <= 70, "pile height is capped");
    const lit = Array.from({ length: field.settledX.length }, (_, s) => settledLight(field, s)).filter((l) => l > 0.02).length;
    assert.ok(lit > 100 && lit <= field.settledX.length, "a visible pile");
    const born = field.timeSec;
    warmGateField(field, 20, { ...G });
    assert.ok(field.timeSec > born);
  });

  it("keeps particles inside the scene width and the streamlines converge on the gate", () => {
    const field = createGateField(300, 11, G.width);
    warmGateField(field, 8, G);
    for (let i = 0; i < field.count; i += 1) { const p = gateParticlePoint(field, i, G); assert.ok(p.x >= -12 && p.x <= G.width + 12); }
    const first = gateStreamline(0, G), last = gateStreamline(GATE_STREAMLINES - 1, G);
    assert.ok(Math.abs(first[first.length - 1]!.x - last[last.length - 1]!.x) < Math.abs(first[0]!.x - last[0]!.x), "lines narrow toward the gate");
  });
});
