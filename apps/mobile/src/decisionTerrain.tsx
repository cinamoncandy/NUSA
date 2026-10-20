import React, { useEffect, useMemo, useRef, useState } from "react";
import { PanResponder, StyleSheet, Text, View } from "react-native";
import { Canvas, PaintStyle, Picture, Skia, StrokeCap, StrokeJoin, createPicture, type SkCanvas, type SkPaint, type SkPicture } from "@shopify/react-native-skia";
import type { DecisionTerrainModel } from "./decisionTerrainModel";
import { TERRAIN_HEIGHT, TERRAIN_POINTS, TERRAIN_ROW_DZ, easeOutBack, easeOutCubic, projectTerrain, smoothTerrainRow, terrainCamera, terrainRowZ, type TerrainCamera } from "./decisionTerrainGeometry";
import { calmColors } from "./uiKitModel";
import { fieldFonts } from "./fieldFonts";
import { readableFont } from "./designSystem";

/**
 * The decision terrain, the main motion graphic of "지금" (owner-chosen 2026-10-20): today as a 3D hairline terrain, one ridge per
 * hour, the current hour written at the front edge. A new decision drops a needle there, an order stands as a lime beam, and when the
 * loss limit holds buying an amber gate drops in at the stop time. Presentation only; heights come from the server's decision trace.
 * Under reduce-motion it draws one settled frame and starts no loop.
 */
const FRAME_MS = 33;
const INTRO_S = 1.35;
const DROP_MS = 700;
const MAX_DROPS = 6;

type Tone = "live" | "limit" | "idle";
interface Drop { readonly born: number; readonly at: number }

export function DecisionTerrain({ model, tone, decisionCount, width, reducedMotion, testID = "now-terrain" }: {
  readonly model: DecisionTerrainModel;
  readonly tone: Tone;
  /** Today's decision count; each increase drops needles at the write head. */
  readonly decisionCount: number | null;
  readonly width: number;
  readonly reducedMotion: boolean | null;
  readonly testID?: string;
}) {
  const height = Math.round(width * 0.92);
  const [picture, setPicture] = useState<SkPicture | null>(null);
  const born = useRef(Date.now());
  const gateBorn = useRef<number | null>(null);
  const drops = useRef<Drop[]>([]);
  const lastCount = useRef<number | null>(decisionCount);
  const yawDrag = useRef(0);
  const lastDrag = useRef(0);
  const modelRef = useRef(model);
  modelRef.current = model;
  const toneRef = useRef(tone);
  toneRef.current = tone;

  const paints = useMemo(() => {
    const stroke = Skia.Paint(); stroke.setAntiAlias(true); stroke.setStyle(PaintStyle.Stroke); stroke.setStrokeJoin(StrokeJoin.Round); stroke.setStrokeCap(StrokeCap.Round);
    const dashed = stroke.copy(); dashed.setPathEffect(Skia.PathEffect.MakeDash([2, 4], 0));
    const fill = Skia.Paint(); fill.setAntiAlias(true); fill.setStyle(PaintStyle.Fill);
    return { stroke, dashed, fill };
  }, []);
  const colors = useMemo(() => ({ ink: Skia.Color(calmColors.text), muted: Skia.Color(calmColors.muted), line: Skia.Color(calmColors.line), ground: Skia.Color(calmColors.ground), order: Skia.Color(calmColors.order), amber: Skia.Color(calmColors.attention) }), []);

  // New decisions since the last snapshot drop needles at the write head (a few at most, staggered).
  useEffect(() => {
    const prev = lastCount.current;
    lastCount.current = decisionCount;
    if (reducedMotion !== false || prev == null || decisionCount == null || decisionCount <= prev) return;
    const n = Math.min(MAX_DROPS, decisionCount - prev), now = Date.now();
    for (let i = 0; i < n; i += 1) drops.current.push({ born: now + i * 90, at: Math.max(0, modelRef.current.progress - i * 0.004) });
  }, [decisionCount, reducedMotion]);

  useEffect(() => { gateBorn.current = tone === "limit" ? Date.now() : null; }, [tone]);

  const pan = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 8 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
    onPanResponderGrant: () => { lastDrag.current = Date.now(); },
    onPanResponderMove: (_e, g) => { yawDrag.current = Math.max(-0.7, Math.min(0.7, g.dx * 0.005)); lastDrag.current = Date.now(); },
    onPanResponderRelease: () => { lastDrag.current = Date.now(); },
    onPanResponderTerminationRequest: () => true,
  }), []);

  useEffect(() => {
    if (width <= 0) return undefined;
    const draw = (nowMs: number, still: boolean) => {
      const m = modelRef.current, t = still ? 99 : (nowMs - born.current) / 1000;
      const sinceDrag = (nowMs - lastDrag.current) / 1000;
      if (!still && sinceDrag > 1.5) yawDrag.current *= 0.94;
      const drift = still ? 0 : Math.sin(t * 0.21) * 0.26;
      const cam = terrainCamera(width, height, -0.32 + drift + yawDrag.current, still ? 1 : Math.min(1, t / INTRO_S));
      drops.current = drops.current.filter((d) => nowMs - d.born < DROP_MS);
      setPicture(createPicture((canvas) => renderTerrain(canvas, { model: m, tone: toneRef.current, cam, t, nowMs, still, drops: drops.current, gateBorn: gateBorn.current, paints, colors })));
    };
    if (reducedMotion !== false) { draw(Date.now(), true); return undefined; }
    born.current = Date.now();
    let alive = true, last = 0, frame = 0;
    const loop = (ts: number) => {
      if (!alive) return;
      if (ts - last >= FRAME_MS) { last = ts; draw(Date.now(), false); }
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => { alive = false; cancelAnimationFrame(frame); };
  }, [width, height, reducedMotion, paints, colors]);

  // A settled frame also redraws when the data changes under reduce-motion.
  useEffect(() => {
    if (reducedMotion === false || width <= 0) return;
    const cam = terrainCamera(width, height, -0.32, 1);
    setPicture(createPicture((canvas) => renderTerrain(canvas, { model, tone, cam, t: 99, nowMs: Date.now(), still: true, drops: [], gateBorn: null, paints, colors })));
  }, [model, tone, reducedMotion, width, height, paints, colors]);

  const firstHour = model.rows[0]?.hour ?? 9;
  const chip = tone === "limit" ? "HOLD" : tone === "live" ? "LIVE" : "—";
  const label = model.hasTrace
    ? `오늘 판단 지형. ${String(firstHour).padStart(2, "0")}시부터 지금까지 한 시간에 한 줄. 이번 시간 판단 ${model.thisHour ?? 0}번${tone === "limit" ? ". 손실 한도로 새 매수 멈춤" : ""}`
    : "오늘 판단 지형. 아직 기록을 받지 못했어요";
  return <View style={{ width, height }} testID={testID} accessible accessibilityLabel={label} {...pan.panHandlers}>
    <Canvas style={{ width, height }} pointerEvents="none">{picture ? <Picture picture={picture} /> : null}</Canvas>
    <View pointerEvents="none" style={[styles.hud, styles.top]} importantForAccessibility="no-hide-descendants">
      <Text style={[fieldFonts.mono, styles.hudText]}>{String(firstHour).padStart(2, "0")}시 → 지금</Text>
      <Text style={[fieldFonts.mono, styles.hudText]}>이번 시간 <Text style={styles.hudValue}>{model.thisHour == null ? "—" : model.thisHour.toLocaleString("en-US")}</Text></Text>
    </View>
    <View pointerEvents="none" style={[styles.hud, styles.bottom]} importantForAccessibility="no-hide-descendants">
      <Text style={[fieldFonts.mono, styles.hudText]}>{model.hasTrace ? "옆으로 밀어 돌려보기" : "기록을 모으는 중이에요"}</Text>
      <Text style={[fieldFonts.mono, styles.chip, { color: tone === "limit" ? calmColors.attention : tone === "live" ? calmColors.text : calmColors.muted, borderColor: tone === "limit" ? calmColors.attention : calmColors.line }]}>{chip}</Text>
    </View>
  </View>;
}

interface RenderInput {
  readonly model: DecisionTerrainModel; readonly tone: Tone; readonly cam: TerrainCamera; readonly t: number; readonly nowMs: number; readonly still: boolean;
  readonly drops: readonly Drop[]; readonly gateBorn: number | null;
  readonly paints: { readonly stroke: SkPaint; readonly dashed: SkPaint; readonly fill: SkPaint };
  readonly colors: { readonly ink: Float32Array; readonly muted: Float32Array; readonly line: Float32Array; readonly ground: Float32Array; readonly order: Float32Array; readonly amber: Float32Array };
}

function renderTerrain(canvas: SkCanvas, { model, tone, cam, t, nowMs, still, drops, gateBorn, paints, colors }: RenderInput): void {
  const { stroke, dashed, fill } = paints;
  const P = (x: number, y: number, z: number) => projectTerrain(x, y, z, cam);
  const rows = model.rows, R = rows.length;
  if (R === 0) return;
  const zOf = (k: number) => terrainRowZ(k, R);
  const xOf = (i: number) => -1 + (2 * i) / (TERRAIN_POINTS - 1);
  const limited = tone === "limit" && model.stop != null;
  const line = (a: { x: number; y: number }, b: { x: number; y: number }, paint: SkPaint) => canvas.drawLine(a.x, a.y, b.x, b.y, paint);

  // Floor: lengthwise hairlines under the terrain and a short runway in front of the write head.
  stroke.setColor(colors.line); stroke.setStrokeWidth(1); stroke.setAlphaf(0.9);
  for (let gx = -1; gx <= 1.001; gx += 0.25) line(P(gx, 0, zOf(0)), P(gx, 0, -0.7), stroke);
  for (let z = -0.1; z > -0.71; z -= 0.15) line(P(-1, 0, z), P(1, 0, z), stroke);

  // Transient lift at the write head while new needles land, so the front edge answers at once.
  const lift = (i: number): number => {
    let h = 0;
    for (const d of drops) {
      const age = (nowMs - d.born) / 1000;
      if (age < 0.15) continue;
      const k = (i / (TERRAIN_POINTS - 1) - d.at) * 24;
      h += 0.18 * Math.exp(-k * k) * Math.max(0, 1 - (age - 0.15) / 1.2);
    }
    return h;
  };

  const gate = (k: number) => {
    if (!limited || model.stop!.row !== k) return;
    const age = gateBorn == null || still ? 1 : (nowMs - gateBorn) / 550;
    const off = (1 - easeOutBack(age)) * 1.4, zg = zOf(k) + TERRAIN_ROW_DZ * 0.5, y0 = off, y1 = 0.6 + off;
    const q = [P(-1.08, y0, zg), P(1.08, y0, zg), P(1.08, y1, zg), P(-1.08, y1, zg)];
    const path = Skia.Path.Make(); path.moveTo(q[0]!.x, q[0]!.y); for (const p of q.slice(1)) path.lineTo(p.x, p.y); path.close();
    fill.setColor(colors.amber); fill.setAlphaf(0.06); canvas.drawPath(path, fill);
    stroke.setColor(colors.amber); stroke.setStrokeWidth(1); stroke.setAlphaf(0.22);
    for (let y = y0 + 0.08; y < y1; y += 0.08) line(P(-1.08, y, zg), P(1.08, y, zg), stroke);
    stroke.setAlphaf(1); stroke.setStrokeWidth(1.5); canvas.drawPath(path, stroke);
  };

  for (let k = 0; k < R; k += 1) {
    gate(k);
    const row = rows[k]!, z = zOf(k), isNow = k === R - 1;
    const fog = Math.pow(1 - Math.min(1, z / (TERRAIN_ROW_DZ * Math.max(1, R - 1) + 1e-6)), 1.15);
    const grow = still ? 1 : easeOutCubic((t - 0.25 - k * 0.035) / 0.6);
    const smooth = smoothTerrainRow(row.values);
    const pts = smooth.map((s, i) => {
      let h = s.h * TERRAIN_HEIGHT * grow;
      if (isNow && !still) { h += lift(i); if (i / (TERRAIN_POINTS - 1) <= model.progress) h += Math.sin(i * 0.55 - nowMs * 0.006) * 0.006; }
      return P(xOf(i), h, z);
    });
    const g0 = P(1, 0, z), g1 = P(-1, 0, z);
    const skirt = Skia.Path.Make(); skirt.moveTo(pts[0]!.x, pts[0]!.y); for (const p of pts) skirt.lineTo(p.x, p.y); skirt.lineTo(g0.x, g0.y); skirt.lineTo(g1.x, g1.y); skirt.close();
    fill.setColor(colors.ground); fill.setAlphaf(1); canvas.drawPath(skirt, fill);
    const amberRow = limited && k >= model.stop!.row;
    const color = amberRow ? colors.amber : colors.ink;
    const seenAny = smooth.some((s) => s.seen);
    if (isNow) {
      const cut = Math.max(1, Math.floor(model.progress * (TERRAIN_POINTS - 1)));
      const solid = Skia.Path.Make(); solid.moveTo(pts[0]!.x, pts[0]!.y); for (let i = 1; i <= cut; i += 1) solid.lineTo(pts[i]!.x, pts[i]!.y);
      stroke.setColor(color); stroke.setStrokeWidth(1.8); stroke.setAlphaf(seenAny ? 1 : 0.5); canvas.drawPath(solid, stroke);
      const rest = Skia.Path.Make(); rest.moveTo(pts[cut]!.x, pts[cut]!.y); for (let i = cut + 1; i < TERRAIN_POINTS; i += 1) rest.lineTo(pts[i]!.x, pts[i]!.y);
      dashed.setColor(color); dashed.setStrokeWidth(1); dashed.setAlphaf(0.35); canvas.drawPath(rest, dashed);
    } else {
      const ridge = Skia.Path.Make(); ridge.moveTo(pts[0]!.x, pts[0]!.y); for (const p of pts.slice(1)) ridge.lineTo(p.x, p.y);
      const p = seenAny ? stroke : dashed;
      p.setColor(color); p.setStrokeWidth(1); p.setAlphaf((0.16 + 0.7 * fog) * (seenAny ? 1 : 0.6)); canvas.drawPath(ridge, p);
    }
    // PAPER orders stand on their ridge as lime beams.
    for (const at of row.orders) {
      const i = Math.round(at * (TERRAIN_POINTS - 1)), base = pts[i]!, h = smooth[i]!.h * TERRAIN_HEIGHT * grow;
      const top = P(xOf(i), h + 0.7 * grow, z);
      stroke.setColor(colors.order); stroke.setStrokeWidth(1.5); stroke.setAlphaf(isNow ? 1 : 0.35 + 0.6 * fog); line(base, top, stroke);
      fill.setColor(colors.order); fill.setAlphaf(isNow ? 1 : 0.35 + 0.6 * fog);
      canvas.save(); canvas.translate(top.x, top.y); canvas.rotate(45, 0, 0); canvas.drawRect(Skia.XYWHRect(-3, -3, 6, 6), fill); canvas.restore();
    }
  }

  // The write head: a hairline post, a dot on the ridge, and the needles of new decisions landing on it.
  const z0 = zOf(R - 1), cx = -1 + 2 * model.progress;
  const head = limited ? colors.amber : colors.ink;
  const ci = Math.min(TERRAIN_POINTS - 1, Math.round(model.progress * (TERRAIN_POINTS - 1)));
  const ridgeH = (smoothTerrainRow(rows[R - 1]!.values)[ci]?.h ?? 0) * TERRAIN_HEIGHT;
  stroke.setColor(head); stroke.setStrokeWidth(1); stroke.setAlphaf(0.35); line(P(cx, 0, z0), P(cx, 0.95, z0), stroke);
  const dot = P(cx, ridgeH, z0); fill.setColor(head); fill.setAlphaf(1); canvas.drawCircle(dot.x, dot.y, 3, fill);
  for (const d of drops) {
    const age = (nowMs - d.born) / 1000;
    if (age < 0) continue;
    const x = -1 + 2 * d.at;
    stroke.setColor(limited ? colors.amber : colors.ink);
    if (age < 0.15) {
      const y = 0.95 - (age / 0.15) * (0.95 - ridgeH);
      stroke.setStrokeWidth(1.5); stroke.setAlphaf(1); line(P(x, y + 0.12, z0), P(x, y, z0), stroke);
    } else {
      const k = (age - 0.15) / 0.55, r = 0.02 + k * 0.16;
      const ring = Skia.Path.Make();
      for (let a = 0; a <= 32; a += 1) { const th = (a / 32) * Math.PI * 2, q = P(x + Math.cos(th) * r, 0, z0 + Math.sin(th) * r * 0.6); if (a === 0) ring.moveTo(q.x, q.y); else ring.lineTo(q.x, q.y); }
      stroke.setStrokeWidth(1); stroke.setAlphaf(Math.max(0, 1 - k) * 0.7); canvas.drawPath(ring, stroke);
    }
  }
}

const styles = StyleSheet.create({
  hud: { position: "absolute", left: 0, right: 0, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  top: { top: 0 },
  bottom: { bottom: 0 },
  hudText: { color: calmColors.muted, fontSize: readableFont(10), letterSpacing: 1.2 },
  hudValue: { color: calmColors.text },
  chip: { fontSize: readableFont(10), letterSpacing: 1.2, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 6, paddingVertical: 1 },
});
