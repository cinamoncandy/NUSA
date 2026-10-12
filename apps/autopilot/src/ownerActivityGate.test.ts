import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  decideOwnerActivityGate,
  evaluateOwnerGateForEnv,
  parseOwnerCommand,
  readOwnerActivity,
  readOwnerGateConfig,
  type OwnerActivityEvent,
  type OwnerCommentEvent,
} from "./ownerActivityGate";

const NOW = Date.parse("2026-10-13T12:00:00Z");
const MIN = 60_000;
const HOUR = 60 * MIN;
const policy = { ownerLogin: "mainacct", quietMs: 60 * MIN };
const push = (login: string, agoMs: number): OwnerActivityEvent => ({ type: "PushEvent", actorLogin: login, createdAtMs: NOW - agoMs });
const comment = (login: string, agoMs: number, body: string): OwnerCommentEvent => ({ authorLogin: login, createdAtMs: NOW - agoMs, body });
const decide = (activity: OwnerActivityEvent[] | null, comments: OwnerCommentEvent[] | null) => decideOwnerActivityGate({ activity, comments, nowMs: NOW }, policy);

describe("parseOwnerCommand", () => {
  it("accepts only the exact commands", () => {
    assert.deepEqual(parseOwnerCommand("/autopilot pause 3h"), { kind: "pause", hours: 3 });
    assert.deepEqual(parseOwnerCommand("  /autopilot pause 24h \n"), { kind: "pause", hours: 24 });
    assert.deepEqual(parseOwnerCommand("/autopilot resume"), { kind: "resume" });
    for (const bad of ["/autopilot pause 0h", "/autopilot pause 25h", "/autopilot pause 3", "/autopilot pause 3h please", "please /autopilot pause 3h", "/autopilot pause -1h", "/autopilot pause 1.5h", "/autopilot  pause 3h", "/AUTOPILOT pause 3h", "/autopilot resume now", ""]) {
      assert.equal(parseOwnerCommand(bad), null, bad);
    }
  });
});

describe("decideOwnerActivityGate", () => {
  it("opens when the watched account has been quiet and ignores other accounts", () => {
    assert.deepEqual(decide([push("assistant", 1 * MIN), push("mainacct", 61 * MIN)], []), { open: true, reason: "OWNER_QUIET" });
    assert.deepEqual(decide([], []), { open: true, reason: "OWNER_QUIET" });
  });

  it("closes while the watched account was active within the quiet window, exact boundary included", () => {
    assert.deepEqual(decide([push("mainacct", 59 * MIN + 59_000)], []), { open: false, reason: "OWNER_ACTIVE" });
    assert.deepEqual(decide([push("MainAcct", 1_000)], []), { open: false, reason: "OWNER_ACTIVE" });
    assert.equal(decide([push("mainacct", 60 * MIN)], []).open, true);
  });

  it("honors an active pause, expires it, and lets a later resume cancel it", () => {
    assert.deepEqual(decide([], [comment("mainacct", 90 * MIN, "/autopilot pause 3h")]), { open: false, reason: "OWNER_PAUSED" });
    assert.equal(decide([], [comment("mainacct", 4 * HOUR, "/autopilot pause 3h")]).open, true);
    assert.equal(decide([], [comment("mainacct", 2 * HOUR, "/autopilot pause 5h"), comment("mainacct", 1 * HOUR, "/autopilot resume")]).open, true);
    assert.deepEqual(decide([], [comment("mainacct", 2 * HOUR, "/autopilot resume"), comment("mainacct", 1 * HOUR, "/autopilot pause 5h")]), { open: false, reason: "OWNER_PAUSED" });
  });

  it("ignores pause commands from other accounts and malformed commands", () => {
    assert.equal(decide([], [comment("assistant", 10 * MIN, "/autopilot pause 24h")]).open, true);
    assert.equal(decide([], [comment("mainacct", 10 * MIN, "/autopilot pause 99h")]).open, true);
    assert.equal(decide([], [comment("mainacct", 10 * MIN, "I might /autopilot pause 3h later")]).open, true);
  });

  it("closes on missing evidence, clock anomalies and invalid policy", () => {
    assert.deepEqual(decide(null, []), { open: false, reason: "OWNER_ACTIVITY_UNAVAILABLE" });
    assert.deepEqual(decide([], null), { open: false, reason: "OWNER_ACTIVITY_UNAVAILABLE" });
    assert.deepEqual(decide([push("mainacct", -10 * MIN)], []), { open: false, reason: "OWNER_CLOCK_ANOMALY" });
    assert.deepEqual(decide([], [comment("mainacct", -10 * MIN, "/autopilot pause 1h")]), { open: false, reason: "OWNER_CLOCK_ANOMALY" });
    for (const bad of [{ ownerLogin: "", quietMs: 3_600_000 }, { ownerLogin: "bad login", quietMs: 3_600_000 }, { ownerLogin: "mainacct", quietMs: 0 }, { ownerLogin: "mainacct", quietMs: Number.NaN }, { ownerLogin: "mainacct", quietMs: 25 * HOUR }]) {
      assert.deepEqual(decideOwnerActivityGate({ activity: [], comments: [], nowMs: NOW }, bad), { open: false, reason: "OWNER_GATE_MISCONFIGURED" });
    }
  });
});

describe("readOwnerGateConfig", () => {
  it("is off unless exactly true, defaults to 60 minutes and never trusts a bad number", () => {
    assert.equal(readOwnerGateConfig({}).enabled, false);
    assert.equal(readOwnerGateConfig({ NUSA_AUTOPILOT_OWNER_GATE_ENABLED: "yes" }).enabled, false);
    assert.equal(readOwnerGateConfig({ NUSA_AUTOPILOT_OWNER_GATE_ENABLED: " TRUE " }).enabled, true);
    assert.equal(readOwnerGateConfig({}).quietMs, 60 * MIN);
    assert.ok(Number.isNaN(readOwnerGateConfig({ NUSA_AUTOPILOT_OWNER_QUIET_MINUTES: "abc" }).quietMs));
  });
});

type Route = (url: string) => Response | undefined;
const stubFetch = (route: Route): { fetchImpl: typeof fetch; urls: string[] } => {
  const urls: string[] = [];
  const fetchImpl = (async (input: string) => {
    const url = String(input);
    urls.push(url);
    const hit = route(url);
    if (!hit) throw new Error(`unexpected fetch ${url}`);
    return hit;
  }) as unknown as typeof fetch;
  return { fetchImpl, urls };
};
const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const iso = (agoMs: number) => new Date(NOW - agoMs).toISOString();
const baseRoute = (events: unknown[], comments: unknown[], me = "assistant"): Route => (url) => {
  if (url.endsWith("/user")) return ok({ login: me });
  if (url.includes("/events?")) return ok(events);
  if (url.includes("/issues/comments?")) return ok(comments);
  return undefined;
};
const cfg = { token: "t", repository: "cinamoncandy/NUSA" };

describe("readOwnerActivity", () => {
  it("reports the token account and parses events and comments", async () => {
    const { fetchImpl } = stubFetch(baseRoute(
      [{ type: "PushEvent", actor: { login: "mainacct" }, created_at: iso(10 * MIN) }, { type: "WatchEvent", actor: { login: "mainacct" }, created_at: iso(1 * MIN) }],
      [{ user: { login: "mainacct" }, created_at: iso(5 * MIN), body: "/autopilot pause 2h" }],
    ));
    const result = await readOwnerActivity(cfg, policy, NOW, fetchImpl);
    assert.equal(result.tokenIsOwner, false);
    assert.equal(result.activity?.length, 1);
    assert.equal(result.comments?.[0]?.body, "/autopilot pause 2h");
  });

  it("returns null for a possibly truncated event window, a failed lookup or malformed data", async () => {
    const fullPage = Array.from({ length: 100 }, () => ({ type: "PushEvent", actor: { login: "other" }, created_at: iso(5 * MIN) }));
    const truncated = await readOwnerActivity(cfg, policy, NOW, stubFetch(baseRoute(fullPage, [])).fetchImpl);
    assert.equal(truncated.activity, null);
    const failing = await readOwnerActivity(cfg, policy, NOW, stubFetch((url) => url.includes("/events?") ? new Response("{}", { status: 502 }) : baseRoute([], [])(url)).fetchImpl);
    assert.equal(failing.activity, null);
    const malformed = await readOwnerActivity(cfg, policy, NOW, stubFetch(baseRoute([{ type: "PushEvent", actor: null, created_at: "nope" }], [])).fetchImpl);
    assert.equal(malformed.activity, null);
    const commentsFull = Array.from({ length: 100 }, () => ({ user: { login: "x" }, created_at: iso(MIN), body: "hi" }));
    const incomplete = await readOwnerActivity(cfg, policy, NOW, stubFetch(baseRoute([], commentsFull)).fetchImpl);
    assert.equal(incomplete.comments, null);
  });

  it("returns nulls without calling GitHub when the token or repository is unusable", async () => {
    const { fetchImpl, urls } = stubFetch(() => undefined);
    assert.deepEqual(await readOwnerActivity({ repository: "cinamoncandy/NUSA" }, policy, NOW, fetchImpl), { activity: null, comments: null, tokenIsOwner: null });
    assert.deepEqual(await readOwnerActivity({ token: "t", repository: "bad repo" }, policy, NOW, fetchImpl), { activity: null, comments: null, tokenIsOwner: null });
    assert.equal(urls.length, 0);
  });
});

describe("evaluateOwnerGateForEnv", () => {
  const env = { NUSA_AUTOPILOT_OWNER_GATE_ENABLED: "true", NUSA_AUTOPILOT_OWNER_LOGIN: "mainacct", NUSA_GITHUB_TOKEN: "t" };

  it("does nothing and calls no API while the gate is disabled", async () => {
    const { fetchImpl, urls } = stubFetch(() => undefined);
    assert.equal(await evaluateOwnerGateForEnv({ NUSA_AUTOPILOT_OWNER_LOGIN: "mainacct", NUSA_GITHUB_TOKEN: "t" }, "cinamoncandy/NUSA", NOW, fetchImpl), null);
    assert.equal(urls.length, 0);
  });

  it("opens only when quiet, the token is a different account and nothing is paused", async () => {
    assert.equal(await evaluateOwnerGateForEnv(env, "cinamoncandy/NUSA", NOW, stubFetch(baseRoute([], [])).fetchImpl), null);
  });

  it("closes when the watched account was active or paused", async () => {
    const active = await evaluateOwnerGateForEnv(env, "cinamoncandy/NUSA", NOW, stubFetch(baseRoute([{ type: "PushEvent", actor: { login: "mainacct" }, created_at: iso(2 * MIN) }], [])).fetchImpl);
    assert.equal(active?.reason, "OWNER_ACTIVE");
    const paused = await evaluateOwnerGateForEnv(env, "cinamoncandy/NUSA", NOW, stubFetch(baseRoute([], [{ user: { login: "mainacct" }, created_at: iso(30 * MIN), body: "/autopilot pause 2h" }])).fetchImpl);
    assert.equal(paused?.reason, "OWNER_PAUSED");
  });

  it("closes when enabled but misconfigured, or when the Worker token is the watched account", async () => {
    const quiet = stubFetch(baseRoute([], [])).fetchImpl;
    assert.equal((await evaluateOwnerGateForEnv({ ...env, NUSA_AUTOPILOT_OWNER_LOGIN: "" }, "cinamoncandy/NUSA", NOW, quiet))?.reason, "OWNER_GATE_MISCONFIGURED");
    assert.equal((await evaluateOwnerGateForEnv({ ...env, NUSA_AUTOPILOT_OWNER_QUIET_MINUTES: "abc" }, "cinamoncandy/NUSA", NOW, quiet))?.reason, "OWNER_GATE_MISCONFIGURED");
    assert.equal((await evaluateOwnerGateForEnv(env, "cinamoncandy/NUSA", NOW, stubFetch(baseRoute([], [], "MainAcct")).fetchImpl))?.reason, "OWNER_GATE_MISCONFIGURED");
    assert.equal((await evaluateOwnerGateForEnv(env, "cinamoncandy/NUSA", NOW, stubFetch((url) => url.endsWith("/user") ? new Response("{}", { status: 401 }) : baseRoute([], [])(url)).fetchImpl))?.reason, "OWNER_GATE_MISCONFIGURED");
    assert.equal((await evaluateOwnerGateForEnv(env, "cinamoncandy/NUSA", NOW, stubFetch(() => undefined).fetchImpl))?.reason, "OWNER_GATE_MISCONFIGURED");
  });
});
