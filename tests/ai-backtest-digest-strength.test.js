const test = require("node:test");
const assert = require("node:assert/strict");
const { stableDigest } = require("../dist/apps/mobile/src/aiBacktestEngine.js");

/**
 * aiBacktestEngine's integrityDigest used to be a single 32-bit FNV-1a hash, printed as
 * 8 hex characters, then REPEATED eight times to fill a 64-character field. Every one of
 * the eight blocks was identical, so the field carried exactly 32 bits of real entropy
 * behind what reads as a 256-bit digest. Two payloads that collide under ordinary 32-bit
 * FNV-1a -- expected within roughly 77,000 payloads by the birthday bound -- were
 * therefore indistinguishable to restoreBacktestReport's integrity check.
 *
 * These tests reimplement the OLD single-lane algorithm to find a genuine collision, then
 * confirm the fixed, multi-lane stableDigest tells the two colliding payloads apart.
 */

function oldSingleLaneDigest(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) { hash ^= value.charCodeAt(index); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0).toString(16).padStart(8, "0").repeat(8);
}

function findCollisionPair() {
  const seen = new Map();
  for (let counter = 0; counter < 500_000; counter += 1) {
    const candidate = `payload-${counter}`;
    const hash = oldSingleLaneDigest(candidate).slice(0, 8);
    const existing = seen.get(hash);
    if (existing !== undefined && existing !== candidate) return [existing, candidate];
    seen.set(hash, candidate);
  }
  throw new Error("no collision found within search budget");
}

test("a real 32-bit-FNV-1a collision existed under the old scheme (proves the vulnerability was real, not hypothetical)", () => {
  const [first, second] = findCollisionPair();
  assert.notEqual(first, second, "the two colliding payloads must actually be different content");
  assert.equal(oldSingleLaneDigest(first), oldSingleLaneDigest(second), "the old repeated-single-lane digest could not tell these apart");
});

test("the fixed stableDigest distinguishes payloads that collided under the old single-lane scheme", () => {
  const [first, second] = findCollisionPair();
  assert.notEqual(stableDigest(first), stableDigest(second), "independent lanes must not collide the same way the old single lane did");
});

test("stableDigest no longer tiles one 8-hex-char block eight times", () => {
  const digest = stableDigest("a-realistic-backtest-report-payload");
  const blocks = digest.match(/.{8}/g);
  assert.equal(blocks.length, 8);
  assert.ok(new Set(blocks).size > 1, "at least two of the eight lanes must differ, or this is the old repeat-tiling bug again");
});

test("stableDigest output shape is unchanged: 64 lowercase hex characters", () => {
  const digest = stableDigest("anything");
  assert.match(digest, /^[0-9a-f]{64}$/);
});

test("stableDigest is deterministic for the same input", () => {
  assert.equal(stableDigest("same-input"), stableDigest("same-input"));
});

test("stableDigest changes when the input changes", () => {
  assert.notEqual(stableDigest("input-a"), stableDigest("input-b"));
});
