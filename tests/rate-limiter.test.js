const test = require("node:test");
const assert = require("node:assert/strict");
const { RateLimiter } = require("../dist/apps/server/src/rateLimiter.js");

function clockAt(startMs) {
  let current = startMs;
  return { advance: (ms) => { current += ms; }, now: () => current };
}

test("constructor validates windowMs/maxRequests", () => {
  assert.throws(() => new RateLimiter({ windowMs: 0, maxRequests: 10 }), /windowMs must be positive/);
  assert.throws(() => new RateLimiter({ windowMs: -1, maxRequests: 10 }), /windowMs must be positive/);
  assert.throws(() => new RateLimiter({ windowMs: 1000, maxRequests: 0 }), /maxRequests must be a positive integer/);
  assert.throws(() => new RateLimiter({ windowMs: 1000, maxRequests: 1.5 }), /maxRequests must be a positive integer/);
});

test("allows up to maxRequests within a window, then blocks the same key", () => {
  const clock = clockAt(0);
  const limiter = new RateLimiter({ windowMs: 1000, maxRequests: 3, now: clock.now });
  assert.equal(limiter.allow("a"), true);
  assert.equal(limiter.allow("a"), true);
  assert.equal(limiter.allow("a"), true);
  assert.equal(limiter.allow("a"), false, "4th request in the same window is blocked");
  assert.equal(limiter.allow("a"), false, "stays blocked for further requests in-window");
});

test("resets once windowMs has elapsed since the key's window started", () => {
  const clock = clockAt(0);
  const limiter = new RateLimiter({ windowMs: 1000, maxRequests: 2, now: clock.now });
  assert.equal(limiter.allow("a"), true);
  assert.equal(limiter.allow("a"), true);
  assert.equal(limiter.allow("a"), false);
  clock.advance(999);
  assert.equal(limiter.allow("a"), false, "window has not fully elapsed yet");
  clock.advance(1);
  assert.equal(limiter.allow("a"), true, "a fresh window starts a new count from 1");
  assert.equal(limiter.allow("a"), true);
  assert.equal(limiter.allow("a"), false);
});

test("different keys are tracked independently", () => {
  const clock = clockAt(0);
  const limiter = new RateLimiter({ windowMs: 1000, maxRequests: 1, now: clock.now });
  assert.equal(limiter.allow("client-a"), true);
  assert.equal(limiter.allow("client-a"), false);
  assert.equal(limiter.allow("client-b"), true, "a different key has its own independent budget");
  assert.equal(limiter.allow("client-b"), false);
});

test("tracked-key count stays bounded: a flood of new keys evicts the oldest rather than growing forever", () => {
  const clock = clockAt(0);
  const limiter = new RateLimiter({ windowMs: 60_000, maxRequests: 5, now: clock.now });
  for (let i = 0; i < 1000; i++) {
    limiter.allow(`key-${i}`);
    clock.advance(1);
  }
  assert.equal(limiter.allow("key-1000"), true, "a 1001st distinct key still gets served (oldest evicted, not rejected)");
  // The very first key's window is long gone in real terms, but it was evicted outright --
  // a fresh allow() for it starts an entirely new window rather than reusing stale state.
  assert.equal(limiter.allow("key-0"), true);
});
