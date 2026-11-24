"use strict";
/**
 * Broad-universe step 4 tooling (docs/RESEARCH_BROAD_UNIVERSE_DISCOVERY_DESIGN_2026-11-24.md section 5 items 3 and 4). Turns the two fetched group directories
 * (the workflow artifacts of scripts/fetch-upbit-60m-universe.js) into the inputs of scripts/run-broad-mining.js discover: a SQLite store with the DISCOVERY-window
 * candles only (hold-back files are hashed for the manifest check but never parsed or stored), the sorted market list, the merged listing map and the tier table of the committed 20 bp pool file.
 * Before anything is built every group is checked against the manifest hash COMMITTED in docs/research-data/broad-universe-fetch-manifests-2026-11-24.json:
 * the manifest hash is recomputed exactly as the fetch script prints it, every CSV must match its manifest sha256, no CSV may be missing or extra, no market may be
 * excluded, and the union of markets must equal the committed discovery pool. Any difference throws (fail closed). Prints counts only, never a price.
 * Not run by this PR: the run is a later step on a GitHub-hosted runner.
 */
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const history = require("./fetch-upbit-60m-history.js");

const sha256 = (data) => crypto.createHash("sha256").update(data).digest("hex");
const MARKET_RE = /^KRW-[A-Z0-9]{1,15}$/;
const FILE_RE = /^(KRW-[A-Z0-9]{1,15})_(discovery|holdback)_60m\.csv$/;
const GROUP_RE = /^g[0-9]{1,2}$/;

/** The hash the fetch script prints as UNIVERSE_MANIFEST_SHA256 (files, excluded, listing). */
function manifestHash(manifest) {
  return sha256(JSON.stringify({ files: manifest.files, excluded: manifest.excluded, listing: manifest.listingFirstDailyMs }));
}

function readGroup(dir, groupName, committedHash) {
  if (!GROUP_RE.test(groupName)) throw new Error("group name invalid");
  if (!/^[0-9a-f]{64}$/.test(String(committedHash))) throw new Error(`no committed manifest hash for ${groupName}`);
  const manifestPath = path.join(dir, `manifest.${groupName}.json`);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (manifest.group !== groupName || manifest.schemaVersion !== 1) throw new Error(`manifest of ${groupName} has the wrong group or schema`);
  if (manifestHash(manifest) !== committedHash) throw new Error(`manifest hash of ${groupName} differs from the committed one`);
  if (!Array.isArray(manifest.excluded) || manifest.excluded.length !== 0) throw new Error(`${groupName} excludes a market`);
  const onDisk = fs.readdirSync(dir).filter((n) => n !== `manifest.${groupName}.json`).sort();
  const listed = Object.keys(manifest.files).sort();
  if (JSON.stringify(onDisk) !== JSON.stringify(listed)) throw new Error(`files of ${groupName} differ from the manifest`);
  const discovery = {};
  for (const name of listed) {
    if (!FILE_RE.test(name)) throw new Error(`unexpected file name in ${groupName}`);
    const buf = fs.readFileSync(path.join(dir, name));
    if (sha256(buf) !== manifest.files[name].sha256) throw new Error(`file ${name} differs from its manifest hash`);
    if (name.endsWith("_discovery_60m.csv")) discovery[name] = buf.toString("utf8");
  }
  return { manifest, discovery };
}

/** Builds the store and the input files. `committed` maps group name to its manifest hash; `pool` is the committed pool file (discoveryPool and tierTable). */
function build({ groupDirs, committed, pool, outDir }) {
  if (!Array.isArray(pool?.discoveryPool) || !pool.discoveryPool.every((m) => MARKET_RE.test(m)) || !Array.isArray(pool?.tierTable)) throw new Error("pool file invalid");
  const files = {}; const listing = {}; const markets = new Set();
  for (const [groupName, dir] of Object.entries(groupDirs)) {
    const { manifest, discovery } = readGroup(dir, groupName, committed?.[groupName]);
    Object.assign(files, discovery);
    for (const m of manifest.markets) { if (markets.has(m)) throw new Error("a market is in two groups"); markets.add(m); }
    for (const [m, ms] of Object.entries(manifest.listingFirstDailyMs)) { if (!MARKET_RE.test(m) || !Number.isFinite(ms)) throw new Error("listing map invalid"); listing[m] = ms; }
  }
  const sortedMarkets = [...markets].sort();
  if (JSON.stringify(sortedMarkets) !== JSON.stringify([...pool.discoveryPool].sort())) throw new Error("the markets of the groups differ from the committed discovery pool");
  for (const m of sortedMarkets) if (!files[`${m}_discovery_60m.csv`] || !Number.isFinite(listing[m])) throw new Error("a market has no discovery file or no listing day");
  if (fs.existsSync(outDir) && fs.readdirSync(outDir).length > 0) throw new Error("output directory is not empty");
  fs.mkdirSync(outDir, { recursive: true });
  history.buildStore(path.join(outDir, "store.sqlite"), files);
  fs.writeFileSync(path.join(outDir, "markets.json"), JSON.stringify(sortedMarkets));
  fs.writeFileSync(path.join(outDir, "listing.json"), JSON.stringify(Object.fromEntries(sortedMarkets.map((m) => [m, listing[m]]))));
  fs.writeFileSync(path.join(outDir, "tiers.json"), JSON.stringify(pool.tierTable));
  return { markets: sortedMarkets.length, discoveryFiles: Object.keys(files).length };
}

function main(argv) {
  const arg = (name) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };
  try {
    const record = JSON.parse(fs.readFileSync(arg("committed"), "utf8"));
    const pool = JSON.parse(fs.readFileSync(arg("pool"), "utf8"));
    const committed = Object.fromEntries(Object.entries(record.groups || {}).map(([g, v]) => [g, v.manifestSha256]));
    const result = build({ groupDirs: { g1: arg("g1"), g2: arg("g2") }, committed, pool, outDir: arg("out") });
    console.log(`BROAD_STORE_OK markets=${result.markets} discoveryFiles=${result.discoveryFiles}`);
    return 0;
  } catch (error) { console.error(`BROAD_STORE_ERROR ${String(error && error.message).slice(0, 120)}`); return 2; }
}

if (require.main === module) process.exit(main(process.argv.slice(2)));
module.exports = { build, readGroup, manifestHash };
