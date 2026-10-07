#!/usr/bin/env node
/**
 * Generates the NUSA app icon family from one deterministic design: the N monogram drawn as a bundle of hairline data streams that
 * funnel from a small cluster at the bottom-left into a glowing particle cluster at the top-right (the flow-field hero's language).
 *
 * Outputs (all derived from the same geometry):
 *  - Android vector drawables (adaptive foreground, themed monochrome, splash, tile logo and the API 24 fallbacks)
 *  - Android legacy launcher PNGs (square and round, five densities)
 *  - desktop build icons (SVG master, 512 and 1024 PNG, multi-size ICO)
 *
 * Usage: node build/generate-nusa-appicon.js   (needs Chromium through @playwright/test for the PNGs)
 */
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const RES = path.join(ROOT, "apps/mobile/android/app/src/main/res");
const LIME = "#B6F04B";
const GROUND = "#0B0C0E";

function seeded(seed) { let v = seed >>> 0; return () => { v = (v * 1664525 + 1013904223) >>> 0; return v / 4294967296; }; }
const gauss = (r) => (r() + r() + r() + r() - 2) / 2;
const f2 = (n) => n.toFixed(2);

// ---- Geometry, in the 108 x 108 adaptive-icon frame (the safe zone is the central 66 dp circle) ----------------------------------
const SPINE = [[34, 78], [34, 32], [74, 76], [74, 30]]; // the N centreline: bottom-left start -> top-right decision point
const START = SPINE[0], END = SPINE[3];
const STRANDS = 7; // odd: the middle strand is the N itself
const SPREAD = 2.2; // horizontal spacing of strands at the widest point

function samplePolyline(points, steps) {
  const lengths = [];
  let total = 0;
  for (let i = 1; i < points.length; i += 1) { const l = Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]); lengths.push(l); total += l; }
  const out = [];
  for (let s = 0; s <= steps; s += 1) {
    let d = (s / steps) * total, i = 0;
    while (i < lengths.length - 1 && d > lengths[i]) { d -= lengths[i]; i += 1; }
    const u = lengths[i] === 0 ? 0 : d / lengths[i];
    out.push({ t: s / steps, x: points[i][0] + (points[i + 1][0] - points[i][0]) * u, y: points[i][1] + (points[i + 1][1] - points[i][1]) * u });
  }
  return out;
}

/** Strands fan out from the start, are widest in the middle and funnel back into the end point. */
function strandPaths() {
  const base = samplePolyline(SPINE, 72);
  const mid = (STRANDS - 1) / 2;
  return Array.from({ length: STRANDS }, (_, k) => {
    const offset = (k - mid) * SPREAD;
    const pts = base.map((p) => ({ x: p.x + offset * Math.pow(Math.sin(Math.PI * p.t), 0.8), y: p.y }));
    const edge = Math.abs(k - mid) / mid; // 0 centre .. 1 outermost
    return { alpha: Number((1 - edge * 0.72).toFixed(2)), width: edge === 0 ? 1.05 : 0.6, d: pts.map((p, i) => `${i === 0 ? "M" : "L"}${f2(p.x)},${f2(p.y)}`).join(" ") };
  });
}

function clusterDots(center, count, sigma, seed, maxR) {
  const r = seeded(seed);
  return Array.from({ length: count }, () => {
    const x = center[0] + gauss(r) * sigma * 1.6, y = center[1] + gauss(r) * sigma * 1.6;
    const dist = Math.hypot(x - center[0], y - center[1]);
    const near = Math.max(0, 1 - dist / (sigma * 3));
    return { x, y, r: Number((0.22 + r() * maxR).toFixed(2)), alpha: Number((0.3 + near * 0.7).toFixed(2)) };
  });
}
const DOTS = [...clusterDots(END, 130, 3.4, 11, 0.5), ...clusterDots(START, 40, 2.3, 23, 0.4)];
const ringPath = (cx, cy, r) => `M${f2(cx - r)},${f2(cy)} a${r},${r} 0 1,0 ${f2(2 * r)},0 a${r},${r} 0 1,0 ${f2(-2 * r)},0Z`;
const dotSubpath = (d) => ringPath(d.x, d.y, d.r);

/** Bucket dots by alpha so the drawable stays small: one path per bucket. */
function dotBuckets() {
  const buckets = new Map();
  for (const d of DOTS) { const key = (Math.round(d.alpha * 4) / 4).toFixed(2); (buckets.get(key) ?? buckets.set(key, []).get(key)).push(d); }
  return [...buckets.entries()].sort((a, b) => Number(a[0]) - Number(b[0])).map(([alpha, dots]) => ({ alpha, d: dots.map(dotSubpath).join(" ") }));
}

// ---- Android vector drawables ---------------------------------------------------------------------------------------------------
const COMMENT = "NUSA N monogram mark, flow edition (2026-10-07): the N drawn as nine hairline data streams funnelling from a small cluster into a glowing decision-point cluster, lime on near-black";
const TILE = "M18,10h72a8,8 0,0 1,8 8v72a8,8 0,0 1,-8 8h-72a8,8 0,0 1,-8 -8v-72a8,8 0,0 1,8 -8z";

/** Maps an adaptive-frame coordinate into the tile frame the logo and legacy fallbacks use (scale 1.15, offset -8.1). */
const tileScale = (n) => n * 1.15 - 8.1;
function transformPathData(d, scale) {
  if (!scale) return d;
  return d.replace(/([ML])([\d.]+),([\d.]+)/g, (_, c, x, y) => `${c}${f2(tileScale(Number(x)))},${f2(tileScale(Number(y)))}`)
    .replace(/a([\d.]+),([\d.]+) 0 1,0 (-?[\d.]+),0/g, (_, rx, ry, dx) => `a${f2(Number(rx) * 1.15)},${f2(Number(ry) * 1.15)} 0 1,0 ${f2(Number(dx) * 1.15)},0`)
    .replace(/M([\d.]+),([\d.]+) a/g, (_, x, y) => `M${f2(tileScale(Number(x)))},${f2(tileScale(Number(y)))} a`);
}

function dotsAsTile(buckets) {
  // Dots are circles: rebuild them in the tile frame from the source dots instead of transforming path text.
  const byBucket = new Map();
  for (const d of DOTS) { const key = (Math.round(d.alpha * 4) / 4).toFixed(2); (byBucket.get(key) ?? byBucket.set(key, []).get(key)).push(d); }
  return [...byBucket.entries()].sort((a, b) => Number(a[0]) - Number(b[0])).map(([alpha, dots]) => ({ alpha, d: dots.map((d) => ringPath(tileScale(d.x), tileScale(d.y), d.r * 1.15)).join(" ") }));
}

function markElements({ color, tile, mono }) {
  const k = tile ? 1.15 : 1;
  const lines = [];
  for (const s of strandPaths()) {
    const d = tile ? s.d.replace(/([ML])([\d.]+),([\d.]+)/g, (_, c, x, y) => `${c}${f2(tileScale(Number(x)))},${f2(tileScale(Number(y)))}`) : s.d;
    lines.push(`    <path android:strokeColor="${color}" android:strokeAlpha="${s.alpha}" android:strokeWidth="${f2(s.width * k)}" android:strokeLineCap="round" android:strokeLineJoin="round" android:fillColor="#00000000" android:pathData="${d}" />`);
  }
  for (const b of tile ? dotsAsTile() : dotBuckets()) lines.push(`    <path android:fillColor="${color}" android:fillAlpha="${b.alpha}" android:pathData="${b.d}" />`);
  const cx = tile ? tileScale(END[0]) : END[0], cy = tile ? tileScale(END[1]) : END[1];
  lines.push(`    <path android:strokeColor="${color}" android:strokeAlpha="0.4" android:strokeWidth="${f2(0.7 * k)}" android:fillColor="#00000000" android:pathData="${ringPath(cx, cy, 5.2 * k)}" />`);
  lines.push(`    <path android:fillColor="${color}" android:pathData="${ringPath(cx, cy, 1.9 * k)}" />`);
  void mono;
  return lines.join("\n");
}

function vector({ color, tile, withTile }) {
  return `<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp"
    android:height="108dp"
    android:viewportWidth="108"
    android:viewportHeight="108">
    <!-- ${COMMENT}.${color === "#FFFFFFFF" ? " Monochrome." : ""} -->
${withTile ? `    <path android:fillColor="${GROUND}" android:pathData="${TILE}" />\n` : ""}${markElements({ color, tile })}
</vector>
`;
}

// ---- SVG master and PNGs ----------------------------------------------------------------------------------------------------------
/** Full-bleed SVG (256 px): the OS applies its own mask. A soft glow sits behind the decision cluster. */
function svgMaster(shape) {
  const k = 256 / 108;
  const strands = strandPaths().map((s) => `<path d="${s.d}" fill="none" stroke="${LIME}" stroke-opacity="${s.alpha}" stroke-width="${f2(s.width)}" stroke-linecap="round" stroke-linejoin="round"/>`).join("\n    ");
  const dots = DOTS.map((d) => `<circle cx="${f2(d.x)}" cy="${f2(d.y)}" r="${d.r}" fill="${LIME}" fill-opacity="${d.alpha}"/>`).join("\n    ");
  const bg = shape === "round" ? `<clipPath id="c"><circle cx="128" cy="128" r="128"/></clipPath><g clip-path="url(#c)"><rect width="256" height="256" fill="${GROUND}"/>` : shape === "square-rounded" ? `<clipPath id="c"><rect width="256" height="256" rx="46"/></clipPath><g clip-path="url(#c)"><rect width="256" height="256" fill="${GROUND}"/>` : `<g><rect width="256" height="256" fill="${GROUND}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256">
  <title>NUSA app icon: the N monogram as hairline data streams funnelling into a glowing decision cluster (full-bleed unless noted; let the OS apply its own mask)</title>
  <defs>
    <filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2.6"/></filter>
    <radialGradient id="halo" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="${LIME}" stop-opacity="0.55"/><stop offset="1" stop-color="${LIME}" stop-opacity="0"/></radialGradient>
  </defs>
  ${bg}
  <g transform="scale(${f2(k)}) translate(0,0)">
    <circle cx="${END[0]}" cy="${END[1]}" r="15" fill="url(#halo)"/>
    <circle cx="${START[0]}" cy="${START[1]}" r="7" fill="url(#halo)" opacity="0.5"/>
    <g filter="url(#glow)" opacity="0.5">
    ${strands}
    </g>
    ${strands}
    ${dots}
    <circle cx="${END[0]}" cy="${END[1]}" r="5.2" fill="none" stroke="${LIME}" stroke-opacity="0.4" stroke-width="0.7"/>
    <circle cx="${END[0]}" cy="${END[1]}" r="1.9" fill="${LIME}"/>
  </g>
  </g>
</svg>
`;
}

function icoFromPngs(entries) {
  const header = Buffer.alloc(6); header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(entries.length, 4);
  let offset = 6 + 16 * entries.length;
  const dirs = [], data = [];
  for (const { size, png } of entries) {
    const dir = Buffer.alloc(16);
    dir.writeUInt8(size >= 256 ? 0 : size, 0); dir.writeUInt8(size >= 256 ? 0 : size, 1); dir.writeUInt8(0, 2); dir.writeUInt8(0, 3);
    dir.writeUInt16LE(1, 4); dir.writeUInt16LE(32, 6); dir.writeUInt32LE(png.length, 8); dir.writeUInt32LE(offset, 12);
    dirs.push(dir); data.push(png); offset += png.length;
  }
  return Buffer.concat([header, ...dirs, ...data]);
}

async function main() {
  const preview = process.env.PREVIEW === "1";
  const out = process.argv[2] ? path.resolve(process.argv[2]) : null; // optional preview directory: write nothing into the repo
  const write = (rel, content) => { const target = out ? path.join(out, rel.replace(/[\\/]/g, "__")) : path.join(ROOT, rel); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, content); };

  // Android vectors
  const drawable = (name) => `apps/mobile/android/app/src/main/res/drawable/${name}.xml`;
  write(drawable("ic_nusa_logo_foreground"), vector({ color: LIME, tile: false, withTile: false }));
  write(drawable("ic_nusa_logo_monochrome"), vector({ color: "#FFFFFFFF", tile: false, withTile: false }));
  write(drawable("ic_nusa_splash"), vector({ color: LIME, tile: false, withTile: false }));
  write(drawable("ic_nusa_logo"), vector({ color: LIME, tile: true, withTile: true }));
  for (const name of ["ic_launcher", "ic_launcher_round"]) write(`apps/mobile/android/app/src/main/res/mipmap-anydpi-v24/${name}.xml`, vector({ color: LIME, tile: true, withTile: true }));

  // PNGs
  const { chromium } = require("@playwright/test");
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const png = async (shape, size) => {
    // A fresh page per image: reusing one page stalled on the second capture in a sandboxed headless Chromium.
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    await page.setContent(`<html><body style="margin:0;background:transparent">${svgMaster(shape).replace('width="256" height="256"', `width="${size}" height="${size}"`)}</body></html>`, { waitUntil: "domcontentloaded" });
    // The icon has no text, so capture through the DevTools protocol: page.screenshot waits for fonts, which can stall headless Chromium in sandboxed hosts.
    const client = await page.context().newCDPSession(page);
    await client.send("Emulation.setDefaultBackgroundColorOverride", { color: { r: 0, g: 0, b: 0, a: 0 } });
    const { data } = await client.send("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: size, height: size, scale: 1 }, fromSurface: true });
    await client.detach();
    await page.close();
    return Buffer.from(data, "base64");
  };
  if (preview) { write("preview-1024.png", await png("full-bleed", 1024)); write("preview-192.png", await png("square-rounded", 192)); write("preview-48.png", await png("round", 48)); await browser.close(); return; }
  if (process.env.ONLY_ICO === "1") {
    const only = [];
    for (const size of [16, 24, 32, 48, 64, 128, 256]) only.push({ size, png: await png("square-rounded", size) });
    write("build/nusa-a4p.ico", icoFromPngs(only));
    await browser.close();
    return;
  }
  const densities = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
  for (const [dpi, size] of Object.entries(densities)) {
    write(`apps/mobile/android/app/src/main/res/mipmap-${dpi}/ic_launcher.png`, await png("square-rounded", size));
    write(`apps/mobile/android/app/src/main/res/mipmap-${dpi}/ic_launcher_round.png`, await png("round", size));
  }
  write("build/nusa-appicon.svg", svgMaster("full-bleed"));
  write("build/icon-1024.png", await png("full-bleed", 1024));
  write("build/icon.png", await png("full-bleed", 512));
  // One page at a time: opening the sizes concurrently stalled headless Chromium in a sandboxed host.
  const icoEntries = [];
  for (const size of [16, 24, 32, 48, 64, 128, 256]) icoEntries.push({ size, png: await png("square-rounded", size) });
  write("build/nusa-a4p.ico", icoFromPngs(icoEntries));
  await browser.close();
}

main().catch((error) => { console.error(error); process.exit(1); });
