const test = require("node:test");
const assert = require("node:assert/strict");
const { createTheme } = require("../dist/apps/mobile/src/designSystem.js");
const { initialHoloState, tickHolo, holoColor, easeOutCubic, isHoloQuiet, HOLO_COLORS, HOLO_BIRTH_MS } = require("../dist/apps/mobile/src/holoModel.js");

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const lum = (hex) => { const [r, g, b] = rgb(hex).map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contrast = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
const dist = (a, b) => Math.hypot(...rgb(a).map((v, i) => v - rgb(b)[i]));
const colors = createTheme("dark").colors;

test("Cold-future text and controls stay readable on the dark ground", () => {
  assert.ok(contrast(colors.text, colors.background) >= 12, "primary text");
  assert.ok(contrast(colors.textMuted, colors.background) >= 6, "secondary text");
  assert.ok(contrast(colors.textMuted, colors.surface) >= 6, "secondary text on cards");
  assert.ok(contrast(colors.primary, colors.background) >= 10, "primary control against the ground");
  assert.ok(contrast(colors.onPrimary, colors.primary) >= 10, "label on a primary button");
  assert.ok(contrast(colors.focus, colors.background) >= 7, "focus ring");
});

test("calm-v1: white is the normal tone; nothing else can be mistaken for attention or loss", () => {
  // In calm-v1 white is both the primary and the healthy/normal tone (owner-approved board), so only amber and red are alarm colours.
  const decorative = { primary: colors.primary, focus: colors.focus, info: colors.info, text: colors.text, neonPurple: colors.neonPurple, neonBlue: colors.neonBlue };
  const status = { warning: colors.warning, danger: colors.danger };
  assert.equal(colors.success, colors.text, "normal reads as plain white");
  for (const [dn, d] of Object.entries(decorative)) for (const [sn, s] of Object.entries(status)) assert.ok(dist(d, s) >= 90, `${dn} vs ${sn}`);
  assert.ok(dist(colors.success, colors.warning) >= 100);
  assert.ok(dist(colors.warning, colors.danger) >= 90);
  assert.ok(dist(colors.success, colors.danger) >= 150);
});

test("the sphere blooms from the core: eased, once, then quiet", () => {
  assert.equal(easeOutCubic(0), 0);
  assert.equal(easeOutCubic(1), 1);
  assert.ok(easeOutCubic(0.2) > 0.4, "fast start");
  assert.ok(easeOutCubic(2) === 1 && easeOutCubic(-1) === 0);
  let s = initialHoloState();
  assert.equal(s.birth, 0);
  assert.equal(isHoloQuiet(s), false, "not quiet while it is still opening");
  for (let t = 0; t < HOLO_BIRTH_MS + 200; t += 42) s = tickHolo(s, "normal", 42, 1000 + t);
  assert.equal(s.birth, 1);
  assert.equal(isHoloQuiet(s), true);
});

test("a status tint fades in and out smoothly instead of snapping", () => {
  let s = { ...initialHoloState(), birth: 1 };
  const seen = [];
  for (let i = 0; i < 200; i += 1) { s = tickHolo(s, "halt", 42, 1000 + i * 42); seen.push(s.tintMix); }
  assert.ok(seen[0] > 0 && seen[0] < 0.2, "starts gently");
  assert.ok(seen.every((v, i) => i === 0 || v >= seen[i - 1]), "monotonic");
  assert.equal(seen[seen.length - 1], 1);
  for (let i = 0; i < 240; i += 1) s = tickHolo(s, "normal", 42, 9000 + i * 42);
  assert.equal(s.tintMix, 0);
});

test("halt and hold keep their unmistakable colour at full tint, and normal never tints", () => {
  const mix = (tone, tintMix) => holoColor(0, 1, 0, tone, 0, HOLO_COLORS.cyan, tintMix);
  const normal = mix("normal", 1);
  const full = mix("halt", 1), none = mix("halt", 0);
  assert.deepEqual(none.map(Math.round), normal.map(Math.round), "no tint yet looks normal");
  assert.ok(full[0] > 220 && full[1] < 190, "halt reads red at full tint");
  const hold = mix("hold", 1);
  assert.ok(hold[0] > 220 && hold[1] > 160 && hold[2] < 170, "hold reads amber at full tint");
  assert.deepEqual(holoColor(0, 1, 0, "halt", 0, HOLO_COLORS.cyan).map(Math.round), full.map(Math.round), "default keeps the old fully tinted behaviour");
});

test("holo state advances by elapsed time, not by how often it is drawn", () => {
  const { initialHoloState, tickHolo, holoFrameBudgetMs, HOLO_QUIET_FRAME_MS, HOLO_ACTIVE_FRAME_MS } = require("../dist/apps/mobile/src/holoModel.js");
  assert.equal(holoFrameBudgetMs(true), HOLO_QUIET_FRAME_MS);
  assert.equal(holoFrameBudgetMs(false), HOLO_ACTIVE_FRAME_MS);
  assert.ok(HOLO_QUIET_FRAME_MS > HOLO_ACTIVE_FRAME_MS, "quiet frames are the cheaper ones");
  const run = (dt, tone) => { let s = { ...initialHoloState(), birth: 1 }; for (let t = 0; t < 4200; t += dt) s = tickHolo(s, tone, dt, 1000 + t); return s; };
  for (const [a, b] of [[42, 56], [42, 84]]) {
    assert.ok(Math.abs(run(a, "normal").spin - run(b, "normal").spin) / run(a, "normal").spin < 0.02, `spin matches at ${a} and ${b} ms`);
    assert.ok(Math.abs(run(a, "halt").tintMix - run(b, "halt").tintMix) < 0.03, `tint matches at ${a} and ${b} ms`);
  }
  assert.ok(run(56, "halt").spin < run(56, "normal").spin * 0.2, "halt nearly stops the spin");
});


test("the flow field is deterministic and stays inside the canvas", () => {
  const M = require("../dist/apps/mobile/src/holoModel.js");
  const a = M.buildFlowField(1), b = M.buildFlowField(1);
  assert.deepEqual(Array.from(a.points[0].slice(0, 16)), Array.from(b.points[0].slice(0, 16)), "same density, same field");
  assert.equal(a.points.length, M.FLOW_NODES.length);
  assert.ok(M.buildFlowField(0.2).points[1].length < a.points[1].length, "small marks draw fewer particles");
  assert.deepEqual(M.FLOW_NODES.map((n) => n.id), ["market", "research", "risk", "paper", "ledger"], "one cluster per stage, in chain order");
  for (const t of [0, 1.7, 40, 5000]) M.FLOW_EDGES.forEach((_, e) => a.strands[e].forEach((strand) => {
    const c = M.flowStrandCurve(e, strand, t);
    for (const u of [0, 0.5, 1]) { const p = M.flowStrandPoint(c, u); assert.ok(p.x > -0.2 && p.x < 1.2 && p.y > -0.2 && p.y < 1.2); }
    assert.ok(Math.abs(c.ex - M.FLOW_NODES[M.FLOW_EDGES[e][1]].x) < 0.25, "a stream ends in its target cluster");
  }));
  for (let i = 0; i < M.FLOW_NODES.length; i += 1) for (const k of [0, 5, 23]) {
    const p = M.flowClusterPoint(i, a.points[i], k, 1.3, 1);
    assert.ok(p.x > 0 && p.x < 1 && p.y > 0 && p.y < 1, "cluster particles stay inside the canvas");
  }
  for (const size of [220, 300, 360]) for (let i = 0; i < M.FLOW_NODES.length; i += 1) {
    const l = M.flowLabelPlacement(size, i, 70);
    assert.ok(l.left >= 0 && l.left + 70 <= size && l.top >= 0 && l.top + 16 <= size, "labels stay inside the canvas");
  }
});

test("a decision's pulse travels the chain in order, an order ignites paper, and a halt closes risk onward", () => {
  const M = require("../dist/apps/mobile/src/holoModel.js");
  const wave = M.waveFor(4, 1000);
  assert.equal(M.flowPulsePosition(wave, 999), null, "not before it is born");
  assert.equal(M.flowPulsePosition(wave, 1000 + M.HOLO_WAVE_MS), null, "gone after its lifetime");
  const early = M.flowPulsePosition(wave, 1000 + M.HOLO_WAVE_MS * 0.15), late = M.flowPulsePosition(wave, 1000 + M.HOLO_WAVE_MS * 0.85);
  assert.ok(M.flowNodeGlow(early, 0) > M.flowNodeGlow(early, 4), "early, the market lights before the ledger");
  assert.ok(M.flowNodeGlow(late, 4) > M.flowNodeGlow(late, 0), "late, the ledger lights after the market");
  assert.ok(M.flowEdgeGlow(early, 0) > M.flowEdgeGlow(early, 4), "streams light in chain order too");
  assert.deepEqual(M.flowNodeColor(1, "halt", 1), M.FLOW_NODES[1].color, "a halt does not recolour market or research");
  assert.notDeepEqual(M.flowNodeColor(2, "halt", 1), M.FLOW_NODES[2].color, "risk onward takes the halt tint");
  assert.deepEqual(M.flowNodeColor(2, "halt", 0), M.FLOW_NODES[2].color, "the tint eases in with tintMix, never snaps");
  assert.ok(M.flowEdgeOpen(3, "halt", 1) < 0.3 && M.flowEdgeOpen(1, "halt", 1) === 1 && M.flowEdgeOpen(3, "hold", 1) === 1, "a halt dims only the streams out of risk");
});

test("the renderer batches each stream and cluster, keeps tone ink, and reserves lime for the order", () => {
  const src = require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "apps", "mobile", "src", "holoSphere.tsx"), "utf8");
  assert.match(src, /const ink = holoInk\(tone, s\.tintMix\)/, "hold / halt tint the ink");
  assert.match(src, /const accent = tone === "normal" \? HOLO_COLORS\.lime : ink/, "no lime while held or halted");
  assert.ok(!/HOLO_COLORS\.lime/.test(src.replace(/const accent[^\n]*\n/, "")), "lime is used only for the accent");
  assert.match(src, /try \{ glow\.setMaskFilter/, "blur is guarded");
  assert.match(src, /if \(reducedMotion \|\| decisionCount == null\)/, "still figure contract");
  assert.ok(!/ridgeDepth|ridgeHeight|RIDGE_ROWS|flowLines|wallRows|burstStreaks|dustField/.test(src), "old figures are gone");
});

