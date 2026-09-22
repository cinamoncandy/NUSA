const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (relative) => fs.readFileSync(relative, "utf8");
const ASSET_DIR = "apps/mobile/assets/master";

/**
 * Metro reads an image's intrinsic size at bundle time, so an asset that cannot be decoded fails
 * the Android build outright rather than degrading at runtime. Returns the pixel dimensions, or a
 * reason the file is not a usable image.
 */
function decodeImage(file) {
  const data = fs.readFileSync(file);
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    if (data.length < 24 || data.subarray(12, 16).toString("latin1") !== "IHDR") return { reason: "PNG has no IHDR chunk" };
    return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
  }
  if (!(data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff)) {
    return { reason: `not a JPEG or PNG (starts with ${data.subarray(0, 3).toString("hex")})` };
  }
  const FRAME = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  let offset = 2;
  while (offset < data.length - 1) {
    if (data[offset] !== 0xff) { offset += 1; continue; }
    const marker = data[offset + 1];
    if (FRAME.has(marker)) {
      if (offset + 9 > data.length) return { reason: "JPEG frame header is truncated" };
      return { height: data.readUInt16BE(offset + 5), width: data.readUInt16BE(offset + 7) };
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { offset += 2; continue; }
    if (offset + 4 > data.length) break;
    offset += 2 + data.readUInt16BE(offset + 2);
  }
  return { reason: "JPEG has no SOF segment, so it carries no frame and no dimensions" };
}

test("every registered MASTER hero asset is an image the bundler can actually read", () => {
  // The previous form of this test asserted only that the registry named each file. home-planet.jpg
  // was named, and was a JPEG by magic number and by `file`, but carried no SOF segment — so this
  // test stayed green while Metro failed with "Invalid jpg image asset" and no Android bundle could
  // be produced at all. Naming a file is not the same as it being usable.
  const registry = read("apps/mobile/src/masterHeroAssets.ts");
  const registered = [...registry.matchAll(/require\("\.\.\/assets\/master\/([^"]+)"\)/g)].map((match) => match[1]);
  assert.ok(registered.length > 0, "the registry must register at least one asset");

  const broken = [];
  for (const name of registered) {
    const file = path.join(ASSET_DIR, name);
    if (!fs.existsSync(file)) { broken.push(`${name}: file is missing`); continue; }
    const decoded = decodeImage(file);
    if (decoded.reason) { broken.push(`${name}: ${decoded.reason}`); continue; }
    if (!(decoded.width > 0 && decoded.height > 0)) broken.push(`${name}: decoded to ${decoded.width}x${decoded.height}`);
  }
  assert.deepEqual(broken, [], "a registered asset that cannot be decoded breaks the Android bundle");
});

test("MASTER decorative hero assets stay semantically neutral", () => {
  const registry = read("apps/mobile/src/masterHeroAssets.ts");
  for (const name of ["market-globe.jpg", "signal-terrain.jpg", "signal-detail.jpg", "risk-sphere.jpg", "more-landscape.jpg"]) {
    assert.match(registry, new RegExp(name.replace(".", "\\.")));
  }
  assert.match(registry, /no market or authority semantics/);
});

test("every rendered hero asset is one the registry actually provides", () => {
  const registry = read("apps/mobile/src/masterHeroAssets.ts");
  const registered = new Set([...registry.matchAll(/^\s{2}(\w+): require\(/gm)].map((match) => match[1]));
  const sources = fs.readdirSync("apps/mobile/src").filter((file) => file.endsWith(".tsx"));
  for (const file of sources) {
    for (const used of read(path.join("apps/mobile/src", file)).matchAll(/MasterHeroImage asset="(\w+)"/g)) {
      assert.ok(registered.has(used[1]), `${file} renders asset "${used[1]}", which the registry does not provide`);
    }
  }
});

test("Risk and More render MASTER imagery without fabricating metrics or authority", () => {
  const risk = read("apps/mobile/src/riskView.tsx");
  const more = read("apps/mobile/src/moreMenuView.tsx");
  assert.match(risk, /MasterHeroImage asset="riskSphere"/);
  assert.match(risk, /PORTFOLIO VAR" value="—"/);
  assert.match(risk, /MAX DRAWDOWN" value="—"/);
  assert.match(risk, /SHARPE \(ANN\.\)" value="—"/);
  assert.match(more, /MasterHeroImage asset="moreLandscape"/);
  assert.match(more, /PAPER ONLY/);
  assert.match(more, /AI ZERO AUTHORITY/);
  assert.match(more, /REAL DATA ONLY/);
});
