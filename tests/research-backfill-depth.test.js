// Split from research-experiment-composition.test.js: that file already uses most of the 120 s per-file limit of scripts/run-tests-isolated.js on the Windows runner.
const test = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync } = require("node:fs");
const { join } = require("node:path");
const { tmpdir } = require("node:os");

const { SqliteDatabase, SqliteResearchCandleStore } = require("../dist/packages/storage/src/index.js");
const { composeResearchExperiments, readResearchExperimentSettings, RESEARCH_FLAG } = require("../dist/apps/cloud/src/researchExperimentComposition.js");

const M = 60_000;
const SHA = "b".repeat(40);
const env = (over = {}) => ({ [RESEARCH_FLAG]: "1", NUSA_SOURCE_COMMIT_SHA: SHA, ...over });
const open = () => new SqliteDatabase(join(mkdtempSync(join(tmpdir(), "nusa-compose-")), "c.db"));

test("NUSA_RESEARCH_BACKFILL_DAYS: unset is unchanged, plain integers 1..45 parse, anything else is IGNORED (never disables research), and identity-bearing settings never change", () => {
  const { researchTargetSpanMs, researchBackfillSpanMs, RESEARCH_BACKFILL_DAYS_MAX } = require("../dist/apps/cloud/src/researchExperimentComposition.js");
  const DAY = 86_400_000;
  const unset = readResearchExperimentSettings(env());
  assert.equal(unset.status, "ENABLED");
  assert.equal("backfillDays" in unset.settings, false, "unset adds no field: the settings object is what it was");
  assert.equal(researchBackfillSpanMs(unset.settings), researchTargetSpanMs(unset.settings), "unset: backfill span is the target span");
  assert.equal(readResearchExperimentSettings(env({ NUSA_RESEARCH_BACKFILL_DAYS: "  " })).settings.backfillDays, undefined, "blank is unset");
  for (const days of ["1", "12", "13", "45", " 45 "]) {
    const set = readResearchExperimentSettings(env({ NUSA_RESEARCH_BACKFILL_DAYS: days }));
    assert.equal(set.status, "ENABLED");
    const { backfillDays, ...rest } = set.settings;
    assert.equal(backfillDays, Number(days.trim()));
    assert.deepEqual(rest, unset.settings, "every other setting (windows, markets, commit, rolling mode ...) is identical");
    assert.equal(researchTargetSpanMs(set.settings), researchTargetSpanMs(unset.settings), "the experiment/manifest/gap-fill span never moves");
    assert.equal(researchBackfillSpanMs(set.settings), Math.max(12, Number(days.trim())) * DAY, "backfill span is max(target, days)");
  }
  assert.equal(RESEARCH_BACKFILL_DAYS_MAX, 45);
  for (const bad of ["0", "-1", "46", "60", "100", "1.5", "abc", "045", "1e1", "0x10", "+5", "４５", "9999999999999999999999"]) {
    const ignored = readResearchExperimentSettings(env({ NUSA_RESEARCH_BACKFILL_DAYS: bad }));
    assert.equal(ignored.status, "ENABLED", `${bad}: research stays on`);
    assert.equal("backfillDays" in ignored.settings, false, `${bad}: the default depth is kept`);
    assert.equal(ignored.settings.backfillDaysIgnored, true, `${bad}: flagged so the composition logs it`);
    const { backfillDaysIgnored, ...rest } = ignored.settings;
    assert.deepEqual(rest, unset.settings, `${bad}: every other setting is identical`);
  }
  assert.ok(RESEARCH_BACKFILL_DAYS_MAX * 1440 + 1 <= 100_000, "the ceiling stays inside the candle store's default 100,000-row cap");
  assert.equal(readResearchExperimentSettings({ NUSA_SOURCE_COMMIT_SHA: SHA, NUSA_RESEARCH_BACKFILL_DAYS: "999" }).status, "DISABLED", "research off stays off");
});

test("an ignored NUSA_RESEARCH_BACKFILL_DAYS is logged by the composition and research keeps running", () => {
  const db = open();
  const lines = [];
  const composition = composeResearchExperiments({ env: env({ NUSA_RESEARCH_BACKFILL_DAYS: "sixty", NUSA_RESEARCH_BACKFILL: "DISABLED" }), database: db, now: () => Date.UTC(2026, 9, 3, 6, 0, 30), log: (l) => lines.push(l) });
  try {
    assert.ok(composition !== undefined, "research stays enabled");
    assert.ok(lines.includes("[research-experiments] NUSA_RESEARCH_BACKFILL_DAYS ignored: expected a plain integer 1..45"), lines.join("\n"));
  } finally { composition?.stop?.(); db.close?.(); }
});

test("backfill retry rule: unchanged without the depth setting; with it only a rate limit or an error retries, an INCOMPLETE hole is final", () => {
  const { shouldRetryBackfill } = require("../dist/apps/cloud/src/researchExperimentComposition.js");
  const r = (...statuses) => statuses.map((status) => ({ status }));
  // unset: today's rule, any market that is not COMPLETE retries
  assert.equal(shouldRetryBackfill(r("COMPLETE", "COMPLETE"), 2, false), false);
  assert.equal(shouldRetryBackfill(r("COMPLETE", "INCOMPLETE"), 2, false), true);
  assert.equal(shouldRetryBackfill(r("RATE_LIMITED"), 2, false), true);
  assert.equal(shouldRetryBackfill([], 2, false), true);
  // deeper backfill: a hole (INCOMPLETE) would re-request every page and re-hash the window without healing
  assert.equal(shouldRetryBackfill(r("COMPLETE", "COMPLETE"), 2, true), false);
  assert.equal(shouldRetryBackfill(r("COMPLETE", "INCOMPLETE"), 2, true), false);
  assert.equal(shouldRetryBackfill(r("INCOMPLETE", "INCOMPLETE"), 2, true), false);
  assert.equal(shouldRetryBackfill(r("COMPLETE", "RATE_LIMITED"), 2, true), true);
  assert.equal(shouldRetryBackfill(r("ERROR"), 1, true), true);
  assert.equal(shouldRetryBackfill(r("COMPLETE"), 2, true), true, "the run stopped before every market was tried");
});

const backfillRun = async (extra) => {
  const now = Date.UTC(2026, 9, 3, 6, 0, 30);
  const anchor = Math.floor(now / M) * M;
  const db = open();
  let requests = 0;
  const fetchImpl = async (url) => {
    requests += 1;
    const to = new URL(url).searchParams.get("to");
    const upper = to == null ? anchor + M : Date.parse(to);
    const page = [];
    for (let start = upper - M; page.length < 200; start -= M) page.push({ market: "KRW-XRP", candle_date_time_utc: new Date(start).toISOString().slice(0, 19), opening_price: 1000, high_price: 1001, low_price: 999, trade_price: 1000.5 });
    return { status: 200, ok: true, json: async () => page };
  };
  const composition = composeResearchExperiments({ env: env({ NUSA_RESEARCH_MARKETS: "KRW-XRP", ...extra }), database: db, now: () => now, log: () => undefined, fetchImpl, sleep: async () => undefined });
  try {
    const results = await composition.backfill();
    const progress = composition.orchestrator.collectionProgress();
    const first = requests;
    const second = await composition.backfill();
    const rows = new SqliteResearchCandleStore(db).read("KRW-XRP", M, 0, anchor + M).length;
    return { results, progress, requests: first, second, rows };
  } finally { composition.stop(); db.close(); }
};

test("a deeper backfill reaches further only in the backfill; required history and a second run are unaffected", async () => {
  const base = await backfillRun({});
  const deep = await backfillRun({ NUSA_RESEARCH_BACKFILL_DAYS: "30" });
  const sameSpan = await backfillRun({ NUSA_RESEARCH_BACKFILL_DAYS: "5" });
  assert.deepEqual(base.results.map((r) => r.status), ["COMPLETE"]);
  assert.deepEqual(deep.results.map((r) => r.status), ["COMPLETE"]);
  assert.ok(base.requests <= 100, "unset: about 12 days of pages");
  assert.ok(deep.requests > 200 && deep.requests <= Math.ceil(30 * 1440 / 200) + 10, `deep: about 30 days of pages, bounded (${deep.requests})`);
  assert.ok(deep.rows >= 30 * 1440, "30 days stored");
  assert.ok(base.rows < 13 * 1440 + 200, "unset: about 12 days stored");
  assert.equal(deep.progress.requiredCandles, base.progress.requiredCandles, "required history (experiment window) is unchanged");
  assert.equal(sameSpan.requests, base.requests, "days below the target span change nothing");
  assert.deepEqual(deep.second.map((r) => r.status), ["COMPLETE"], "a second run is a no-op");
});

test("the largest allowed backfill (45 days) stays inside the candle store's default row cap and is bounded in pages", async () => {
  const deep = await backfillRun({ NUSA_RESEARCH_BACKFILL_DAYS: "45" });
  assert.deepEqual(deep.results.map((r) => r.status), ["COMPLETE"]);
  assert.ok(deep.requests <= Math.ceil(45 * 1440 / 200) + 10, `page budget holds (${deep.requests})`);
  assert.equal(deep.rows, 45 * 1440);
  assert.ok(deep.rows <= 100_000 - 20 * 1440, "leaves at least 20 days of live growth before the retention cap trims the oldest rows");
});
