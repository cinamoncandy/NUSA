#!/usr/bin/env node
"use strict";
/**
 * Writes the Android vector icons for the NUSA island mark (owner-approved 2026-10-28; NUSA means "island"): five nested island
 * contours over a horizon line, two sea ripples and a summit light, stroked violet to blue to cyan on near-black.
 * Usage: node scripts/generate-island-icon.js  (rewrites the drawables listed below; PNG fallbacks are rendered separately).
 */
const { writeFileSync } = require("node:fs");
const { join } = require("node:path");

const RES = join(__dirname, "..", "apps", "mobile", "android", "app", "src", "main", "res");
const COMMENT = "NUSA island mark (owner-approved 2026-10-28; NUSA means island): nested island contours over a horizon and sea ripples, stroked violet to blue to cyan (#7C54FF, #4F7BFF, #46D7FF).";
const f = (n) => n.toFixed(2);

/** Mark geometry inside a square of side s at (ox, oy). Returns strokes {d, w, alpha} and the summit light. */
function mark(ox, oy, s, weight, contours = 5) {
  const c = ox + s / 2, hy = oy + s * 0.64, strokes = [];
  for (let i = 0; i < contours; i += 1) {
    // Nested domes scaled about the shore point: the outer line is the island's outline, each inner one a higher contour.
    const t = 1 - i * (0.62 / Math.max(1, contours - 1)), y = hy - s * 0.035, hg = s * 0.34 * t, w = s * 0.36 * t, x0 = c - w, x1 = c + w;
    strokes.push({ d: `M${f(x0)},${f(y)} C${f(c - w * 0.42)},${f(y)} ${f(c - w * 0.34)},${f(y - hg)} ${f(c)},${f(y - hg)} C${f(c + w * 0.34)},${f(y - hg)} ${f(c + w * 0.42)},${f(y)} ${f(x1)},${f(y)}`, w: s * (0.03 - 0.008 * (1 - t)) * weight, alpha: 0.45 + 0.55 * t });
  }
  strokes.push({ d: `M${f(ox + s * 0.12)},${f(hy)} L${f(ox + s * 0.88)},${f(hy)}`, w: s * 0.02 * weight, alpha: 0.9 });
  for (const [yy, hw, a] of [[0.74, 0.26, 0.6], [0.82, 0.16, 0.38]]) strokes.push({ d: `M${f(c - s * hw)},${f(oy + s * yy)} L${f(c + s * hw)},${f(oy + s * yy)}`, w: s * 0.016 * weight, alpha: a });
  return { strokes, summit: { x: c, y: hy - s * 0.035 - s * 0.34 - s * 0.075, r: s * 0.032 } };
}

const hexA = (a) => Math.round(a * 255).toString(16).padStart(2, "0").toUpperCase();
function colourPaths(m, x0, x1) {
  return m.strokes.map((p) => `    <path android:strokeWidth="${f(p.w)}" android:strokeLineCap="round" android:strokeLineJoin="round" android:fillColor="#00000000" android:pathData="${p.d}">
        <aapt:attr name="android:strokeColor">
            <gradient android:type="linear" android:startX="${f(x0)}" android:startY="0" android:endX="${f(x1)}" android:endY="0">
                <item android:offset="0" android:color="#${hexA(p.alpha)}7C54FF" />
                <item android:offset="0.5" android:color="#${hexA(p.alpha)}4F7BFF" />
                <item android:offset="1" android:color="#${hexA(p.alpha)}46D7FF" />
            </gradient>
        </aapt:attr>
    </path>`).join("\n") + `\n    <path android:fillColor="#FFFFFFFF" android:pathData="M${f(m.summit.x - m.summit.r)},${f(m.summit.y)} a${f(m.summit.r)},${f(m.summit.r)} 0 1,0 ${f(2 * m.summit.r)},0 a${f(m.summit.r)},${f(m.summit.r)} 0 1,0 ${f(-2 * m.summit.r)},0z" />`;
}
const monoPaths = (m) => m.strokes.map((p) => `    <path android:strokeColor="#FFFFFFFF" android:strokeWidth="${f(p.w)}" android:strokeLineCap="round" android:strokeLineJoin="round" android:fillColor="#00000000" android:pathData="${p.d}" />`).join("\n")
  + `\n    <path android:fillColor="#FFFFFFFF" android:pathData="M${f(m.summit.x - m.summit.r)},${f(m.summit.y)} a${f(m.summit.r)},${f(m.summit.r)} 0 1,0 ${f(2 * m.summit.r)},0 a${f(m.summit.r)},${f(m.summit.r)} 0 1,0 ${f(-2 * m.summit.r)},0z" />`;
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

// Adaptive foreground and splash: the mark inside the 66 dp safe zone. Full icons: inside the rounded square or circle.
const safe = mark(19, 19, 70, 1.0);
const full = mark(16, 14, 76, 1.0);
const round = mark(20, 18, 68, 1.0);
const out = {
  "drawable/ic_nusa_logo_foreground.xml": vector(108, 108, `    <!-- ${COMMENT} -->\n${colourPaths(safe, 19, 89)}`, true),
  "drawable/ic_nusa_splash.xml": vector(108, 108, `    <!-- ${COMMENT} -->\n${colourPaths(safe, 19, 89)}`, true),
  "drawable/ic_nusa_logo.xml": vector(108, 108, `    <!-- ${COMMENT} -->\n${SQUARE}\n${colourPaths(full, 16, 92)}`, true),
  "mipmap-anydpi-v24/ic_launcher.xml": vector(108, 108, `    <!-- ${COMMENT} -->\n${SQUARE}\n${colourPaths(full, 16, 92)}`, true),
  "mipmap-anydpi-v24/ic_launcher_round.xml": vector(108, 108, `    <!-- ${COMMENT} -->\n${ROUND}\n${colourPaths(round, 20, 88)}`, true),
  "drawable/ic_nusa_logo_monochrome.xml": vector(108, 108, `    <!-- ${COMMENT.replace(/, stroked.*$/, ". Monochrome.")} -->\n${monoPaths(safe)}`, false),
  "drawable/ic_nusa_notification.xml": vector(24, 24, `    <!-- ${COMMENT.replace(/, stroked.*$/, ". Notification (monochrome).")} -->\n${monoPaths(mark(1, 1, 22, 1.9, 3))}`, false),
};
for (const [file, xml] of Object.entries(out)) writeFileSync(join(RES, file), xml);
console.log(`wrote ${Object.keys(out).length} icon drawables`);
