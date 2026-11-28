#!/usr/bin/env node
"use strict";
/**
 * Writes the Android vector icons for the NUSA lattice sphere mark (UI v8, owner 2026-11-27: the sphere replaced the island; the app
 * icon follows): the sphere outline and a geodesic lattice like the in-app sphere (front edges bright, back faint), nodes on the front
 * and one lit node, stroked white to ice blue on near-black. Same tilt as the in-app sphere (0.38 rad).
 * Usage: node scripts/generate-lattice-icon.js  (rewrites the drawables listed below; minSdk 24 uses these vectors, not the PNGs).
 */
const { writeFileSync } = require("node:fs");
const { join } = require("node:path");

const RES = join(__dirname, "..", "apps", "mobile", "android", "app", "src", "main", "res");
const COMMENT = "NUSA lattice sphere mark (UI v8, 2026-11-27; the sphere replaced the island): outline and a geodesic lattice with nodes, stroked white to ice blue (#F4F8FB, #BFE9FF, #8FD3F2).";
const f = (n) => n.toFixed(2);
const TILT = 0.38, D = Math.PI / 180;

/** A geodesic lattice like the in-app sphere: an icosahedron subdivided `level` times, vertices on the unit sphere. */
function icosphere(level) {
  const t = (1 + Math.sqrt(5)) / 2;
  let v = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]];
  let faces = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  const norm = (p) => { const l = Math.hypot(...p); return p.map((x) => x / l); };
  v = v.map(norm);
  for (let k = 0; k < level; k += 1) {
    const cache = new Map(), next = [];
    const mid = (a, b) => { const key = a < b ? `${a}-${b}` : `${b}-${a}`; if (!cache.has(key)) { v.push(norm(v[a].map((x, i) => (x + v[b][i]) / 2))); cache.set(key, v.length - 1); } return cache.get(key); };
    for (const [a, b, c] of faces) { const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a); next.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]); }
    faces = next;
  }
  const edges = new Set(); for (const [a, b, c] of faces) for (const [x, y] of [[a, b], [b, c], [c, a]]) edges.add(x < y ? `${x}-${y}` : `${y}-${x}`);
  return { v, edges: [...edges].map((e) => e.split("-").map(Number)) };
}
const YAW = -0.5;
function project(c, R, p) {
  const [x0, y0, z0] = p;
  const x = x0 * Math.cos(YAW) + z0 * Math.sin(YAW), z1 = -x0 * Math.sin(YAW) + z0 * Math.cos(YAW);
  const y = y0 * Math.cos(TILT) - z1 * Math.sin(TILT), z = y0 * Math.sin(TILT) + z1 * Math.cos(TILT);
  return { x: c.x + R * x, y: c.y - R * y, z };
}
function mark(ox, oy, s, weight, simple = false) {
  const c = { x: ox + s / 2, y: oy + s / 2 }, R = s * 0.4, strokes = [], dots = [];
  const outline = `M${f(c.x - R)},${f(c.y)} A${f(R)},${f(R)} 0 1,0 ${f(c.x + R)},${f(c.y)} A${f(R)},${f(R)} 0 1,0 ${f(c.x - R)},${f(c.y)}`;
  strokes.push({ d: outline, w: s * (simple ? 0.03 : 0.022) * weight, alpha: simple ? 1 : 0.9 });
  const g = icosphere(simple ? 0 : 1), P = g.v.map((p) => project(c, R, p));
  const front = [], back = [];
  for (const [a, b] of g.edges) { const z = (P[a].z + P[b].z) / 2; (z >= 0 ? front : back).push(`M${f(P[a].x)},${f(P[a].y)} L${f(P[b].x)},${f(P[b].y)}`); }
  if (!simple) strokes.push({ d: back.join(" "), w: s * 0.008 * weight, alpha: 0.3 });
  strokes.push({ d: front.join(" "), w: s * (simple ? 0.017 : 0.013) * weight, alpha: 0.85 });
  if (!simple) for (const p of P) if (p.z > 0.1) dots.push({ x: p.x, y: p.y, r: s * (0.011 + 0.013 * p.z), alpha: 0.55 + 0.45 * p.z });
  let lit = P[0]; for (const p of P) if (p.z > 0.55 && p.x < c.x && p.y < c.y && p.z > lit.z * 0) { lit = p; break; }
  return { strokes, dots, lit: { x: lit.x, y: lit.y, r: s * (simple ? 0.06 : 0.04) } };
}
const hexA = (a) => Math.round(a * 255).toString(16).padStart(2, "0").toUpperCase();
const circle = (x, y, r) => `M${f(x - r)},${f(y)} a${f(r)},${f(r)} 0 1,0 ${f(2 * r)},0 a${f(r)},${f(r)} 0 1,0 ${f(-2 * r)},0z`;
function colourPaths(m, x0, x1) {
  return m.strokes.map((p) => `    <path android:strokeWidth="${f(p.w)}" android:strokeLineCap="round" android:strokeLineJoin="round" android:fillColor="#00000000" android:pathData="${p.d}">
        <aapt:attr name="android:strokeColor">
            <gradient android:type="linear" android:startX="${f(x0)}" android:startY="${f(x0)}" android:endX="${f(x1)}" android:endY="${f(x1)}">
                <item android:offset="0" android:color="#${hexA(p.alpha)}F4F8FB" />
                <item android:offset="0.5" android:color="#${hexA(p.alpha)}BFE9FF" />
                <item android:offset="1" android:color="#${hexA(p.alpha)}8FD3F2" />
            </gradient>
        </aapt:attr>
    </path>`).join("\n")
    + "\n" + m.dots.map((d) => `    <path android:fillColor="#${hexA(d.alpha)}BFE9FF" android:pathData="${circle(d.x, d.y, d.r)}" />`).join("\n")
    + `\n    <path android:fillColor="#FFFFFFFF" android:pathData="${circle(m.lit.x, m.lit.y, m.lit.r)}" />`;
}
const monoPaths = (m) => m.strokes.filter((p) => p.alpha > 0.5).map((p) => `    <path android:strokeColor="#FFFFFFFF" android:strokeWidth="${f(p.w)}" android:strokeLineCap="round" android:strokeLineJoin="round" android:fillColor="#00000000" android:pathData="${p.d}" />`).join("\n")
  + `\n    <path android:fillColor="#FFFFFFFF" android:pathData="${circle(m.lit.x, m.lit.y, m.lit.r)}" />`;
const vector = (size, view, body, aapt) => `<vector xmlns:android="http://schemas.android.com/apk/res/android"${aapt ? '\n    xmlns:aapt="http://schemas.android.com/aapt"' : ""}
    android:width="${size}dp"
    android:height="${size}dp"
    android:viewportWidth="${view}"
    android:viewportHeight="${view}">
${body}
</vector>
`;
const SQUARE = '    <path android:fillColor="#0B0C0E" android:pathData="M18,10h72a8,8 0,0 1,8 8v72a8,8 0,0 1,-8 8h-72a8,8 0,0 1,-8 -8v-72a8,8 0,0 1,8 -8z" />';
const ROUND = '    <path android:fillColor="#0B0C0E" android:pathData="M54,10 a44,44 0 1,0 0.01,0z" />';

// Adaptive foreground and splash: the sphere inside the 66 dp safe zone. Full icons: inside the rounded square or circle.
const safe = mark(21, 21, 66, 1.0);
const full = mark(18, 18, 72, 1.0);
const round = mark(22, 22, 64, 1.0);
const out = {
  "drawable/ic_nusa_logo_foreground.xml": vector(108, 108, `    <!-- ${COMMENT} -->\n${colourPaths(safe, 21, 87)}`, true),
  "drawable/ic_nusa_splash.xml": vector(108, 108, `    <!-- ${COMMENT} -->\n${colourPaths(safe, 21, 87)}`, true),
  "drawable/ic_nusa_logo.xml": vector(108, 108, `    <!-- ${COMMENT} -->\n${SQUARE}\n${colourPaths(full, 18, 90)}`, true),
  "mipmap-anydpi-v24/ic_launcher.xml": vector(108, 108, `    <!-- ${COMMENT} -->\n${SQUARE}\n${colourPaths(full, 18, 90)}`, true),
  "mipmap-anydpi-v24/ic_launcher_round.xml": vector(108, 108, `    <!-- ${COMMENT} -->\n${ROUND}\n${colourPaths(round, 22, 86)}`, true),
  "drawable/ic_nusa_logo_monochrome.xml": vector(108, 108, `    <!-- ${COMMENT.replace(/, stroked.*$/, ". Monochrome.")} -->\n${monoPaths(safe)}`, false),
  "drawable/ic_nusa_notification.xml": vector(24, 24, `    <!-- ${COMMENT.replace(/, stroked.*$/, ". Notification (monochrome).")} -->\n${monoPaths(mark(1, 1, 22, 2.2, true))}`, false),
};
for (const [file, xml] of Object.entries(out)) writeFileSync(join(RES, file), xml);
console.log(`wrote ${Object.keys(out).length} icon drawables`);
