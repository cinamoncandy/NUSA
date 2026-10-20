import React, { useEffect, useMemo, useRef, useState } from "react";
import { PanResponder, StyleSheet, Text, View } from "react-native";
import { Canvas, PaintStyle, Picture, Skia, StrokeCap, StrokeJoin, createPicture, type SkCanvas, type SkPaint, type SkPicture } from "@shopify/react-native-skia";
import type { DecisionTerrainModel } from "./decisionTerrainModel";
import { TERRAIN_POINTS, easeOutCubic, smoothTerrainRow } from "./decisionTerrainGeometry";
import { calmColors } from "./uiKitModel";
import { fieldFonts } from "./fieldFonts";
import { readableFont } from "./designSystem";

/**
 * The decision ridgeline, the main motion graphic of "지금" (owner-chosen 2026-10-20): today as stacked hairline ridges, one line per
 * hour, taller where that hour made more decisions. The newest line is alive: a bright scan runs along it and every new decision lifts
 * it where it happens. Orders stand on their ridge as lime points, and when the loss limit holds buying the lines from the stop hour on
 * turn amber. Presentation only; heights come from the server's decision trace. Under reduce-motion it draws one settled frame.
 */
const FRAME_MS = 33;
const LABEL_W = 30;
const DROP_MS = 900;
const MAX_DROPS = 6;
const SCAN_POINTS = 10;

type Tone = "live" | "limit" | "idle";
interface Drop { readonly born: number; readonly at: number }
type Smooth = readonly (readonly { readonly h: number; readonly seen: boolean }[])[];

/** The write head follows the clock between snapshots (it never moves backwards inside a snapshot). */
function liveProgress(model: DecisionTerrainModel, nowMs: number): number {
  const live = (nowMs % 3_600_000) / 3_600_000;
  return live >= model.progress ? live : model.progress;
}

export function DecisionRidge({ model, tone, decisionCount, width, reducedMotion, testID = "now-terrain", selectedRow = null, onSelectRow }: {
  readonly model: DecisionTerrainModel;
  readonly tone: Tone;
  /** Today's decision count; each increase lifts the live line at the write head. */
  readonly decisionCount: number | null;
  readonly width: number;
  readonly reducedMotion: boolean | null;
  readonly testID?: string;
  /** Records: the picked hour row (0 = oldest visible) is drawn brighter inside a hairline band; tapping a line calls onSelectRow. */
  readonly selectedRow?: number | null;
  readonly onSelectRow?: (row: number) => void;
}) {
  const rowCount = model.rows.length;
  const height = Math.round(width * 0.86);
  const [picture, setPicture] = useState<SkPicture | null>(null);
  const born = useRef(Date.now());
  const drops = useRef<Drop[]>([]);
  const lastCount = useRef<number | null>(decisionCount);
  const tiltDrag = useRef(0);
  const dragBase = useRef(0);
  const lastDrag = useRef(0);
  const modelRef = useRef(model);
  modelRef.current = model;
  const smoothRef = useRef<Smooth>([]);
  smoothRef.current = useMemo(() => model.rows.map((r) => smoothTerrainRow(r.values)), [model]);
  const toneRef = useRef(tone);
  toneRef.current = tone;
  const selectedRef = useRef<number | null>(selectedRow);
  selectedRef.current = selectedRow;
  const selectRef = useRef(onSelectRow);
  selectRef.current = onSelectRow;
  const heightRef = useRef(0);
  heightRef.current = height;

  const paints = useMemo(() => {
    const stroke = Skia.Paint(); stroke.setAntiAlias(true); stroke.setStyle(PaintStyle.Stroke); stroke.setStrokeJoin(StrokeJoin.Round); stroke.setStrokeCap(StrokeCap.Round);
    const dashed = stroke.copy(); dashed.setPathEffect(Skia.PathEffect.MakeDash([2, 4], 0));
    const fill = Skia.Paint(); fill.setAntiAlias(true); fill.setStyle(PaintStyle.Fill);
    return { stroke, dashed, fill };
  }, []);
  const colors = useMemo(() => ({ ink: Skia.Color(calmColors.text), ground: Skia.Color(calmColors.ground), order: Skia.Color(calmColors.order), amber: Skia.Color(calmColors.attention) }), []);

  // New decisions since the last snapshot lift the live line at the write head (a few at most, staggered).
  useEffect(() => {
    const prev = lastCount.current;
    lastCount.current = decisionCount;
    if (reducedMotion !== false || prev == null || decisionCount == null || decisionCount <= prev) return;
    const n = Math.min(MAX_DROPS, decisionCount - prev), now = Date.now(), head = liveProgress(modelRef.current, now);
    for (let i = 0; i < n; i += 1) drops.current.push({ born: now + i * 90, at: Math.max(0, head - i * 0.004) });
  }, [decisionCount, reducedMotion]);

  const pan = useMemo(() => PanResponder.create({
    // A tap picks a line (Records only); a horizontal drag still tilts the ridges, a vertical one scrolls the page.
    onStartShouldSetPanResponder: () => selectRef.current != null,
    onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 8 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
    onPanResponderGrant: () => { dragBase.current = tiltDrag.current; lastDrag.current = Date.now(); },
    onPanResponderMove: (_e, g) => { tiltDrag.current = Math.max(-1, Math.min(1, dragBase.current + g.dx / 160)); lastDrag.current = Date.now(); },
    onPanResponderRelease: (e, g) => {
      lastDrag.current = Date.now();
      const pick = selectRef.current, m = modelRef.current;
      if (pick == null || Math.abs(g.dx) > 8 || Math.abs(g.dy) > 8 || m.rows.length === 0) return;
      const { top, gap } = ridgeLayout(m, heightRef.current);
      pick(gap === 0 ? 0 : Math.max(0, Math.min(m.rows.length - 1, Math.round((e.nativeEvent.locationY - top) / gap))));
    },
    onPanResponderTerminate: () => { lastDrag.current = Date.now(); },
    onPanResponderTerminationRequest: () => true,
  }), []);

  useEffect(() => {
    if (width <= 0) return undefined;
    const draw = (nowMs: number, still: boolean) => {
      const t = still ? 99 : (nowMs - born.current) / 1000;
      if (!still && (nowMs - lastDrag.current) / 1000 > 1.5) tiltDrag.current *= 0.94;
      const tilt = still ? 0 : tiltDrag.current + Math.sin(t * 0.25) * 0.12;
      drops.current = drops.current.filter((d) => nowMs - d.born < DROP_MS);
      setPicture(createPicture((canvas) => renderRidge(canvas, { model: modelRef.current, smooth: smoothRef.current, progress: still ? modelRef.current.progress : liveProgress(modelRef.current, nowMs), tone: toneRef.current, selected: selectedRef.current, width, height, tilt, t, nowMs, still, drops: drops.current, paints, colors })));
    };
    if (reducedMotion !== false) return undefined; // the settled-frame effect below draws
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
    const smooth = model.rows.map((r) => smoothTerrainRow(r.values));
    setPicture(createPicture((canvas) => renderRidge(canvas, { model, smooth, progress: model.progress, tone, selected: selectedRow, width, height, tilt: 0, t: 99, nowMs: Date.now(), still: true, drops: [], paints, colors })));
  }, [model, tone, selectedRow, reducedMotion, width, height, paints, colors]);

  const layout = ridgeLayout(model, height);
  const chip = tone === "limit" ? "HOLD" : tone === "live" ? "LIVE" : "—";
  const label = model.hasTrace
    ? `오늘 판단 능선. 한 시간에 한 줄, 높을수록 판단이 많았어요. 이번 시간 판단 ${model.thisHour ?? 0}번${tone === "limit" ? ". 손실 한도로 새 매수 멈춤" : ""}`
    : "오늘 판단 능선. 아직 기록을 받지 못했어요";
  return <View style={{ width, height }} testID={testID} accessible accessibilityLabel={label} {...pan.panHandlers}>
    <Canvas style={{ width, height }} pointerEvents="none">{picture ? <Picture picture={picture} /> : null}</Canvas>
    <View pointerEvents="none" style={StyleSheet.absoluteFill} importantForAccessibility="no-hide-descendants">
      {model.rows.map((row, k) => ((row.hour % 3 === 0 && k < rowCount - 2) || k === rowCount - 1)
        ? <Text key={`${row.hour}-${k}`} style={[fieldFonts.mono, styles.hour, { top: layout.y0(k) - 7 }, k === rowCount - 1 ? styles.hourNow : null]}>{String(row.hour).padStart(2, "0")}</Text>
        : null)}
      {tone === "limit" && model.stop != null ? <Text style={[fieldFonts.mono, styles.limit, { top: layout.y0(model.stop.row) - 18 }]}>LIMIT</Text> : null}
      <Text style={[fieldFonts.mono, styles.chip, { color: tone === "limit" ? calmColors.attention : tone === "live" ? calmColors.text : calmColors.muted, borderColor: tone === "limit" ? calmColors.attention : calmColors.line }]}>{chip}</Text>
    </View>
  </View>;
}

function ridgeLayout(model: DecisionTerrainModel, height: number) {
  const R = Math.max(1, model.rows.length), top = Math.round(height * 0.22), bottom = height - 14;
  const gap = R > 1 ? (bottom - top) / (R - 1) : 0;
  // Peaks may rise into the headroom above the first line but never past it; with few rows the gap is large, so cap by headroom too.
  const headroom = Math.max(24, top - 6);
  return { top, bottom, gap, amp: Math.min(headroom / 1.25, Math.max(24, gap * 5.2)), y0: (k: number) => top + k * gap };
}

interface RenderInput {
  readonly model: DecisionTerrainModel; readonly smooth: Smooth; readonly progress: number; readonly tone: Tone; readonly selected: number | null;
  readonly width: number; readonly height: number; readonly tilt: number; readonly t: number; readonly nowMs: number; readonly still: boolean; readonly drops: readonly Drop[];
  readonly paints: { readonly stroke: SkPaint; readonly dashed: SkPaint; readonly fill: SkPaint };
  readonly colors: { readonly ink: Float32Array; readonly ground: Float32Array; readonly order: Float32Array; readonly amber: Float32Array };
}

function renderRidge(canvas: SkCanvas, { model, smooth: smoothRows, progress, tone, selected, width, height, tilt, t, nowMs, still, drops, paints, colors }: RenderInput): void {
  const { stroke, dashed, fill } = paints;
  const rows = model.rows, R = rows.length;
  if (R === 0) return;
  const { gap, amp, y0 } = ridgeLayout(model, height);
  const left = LABEL_W, right = width - 4, span = right - left;
  const limited = tone === "limit" && model.stop != null;
  const xAt = (i: number, k: number) => left + 12 + ((span - 24) * i) / (TERRAIN_POINTS - 1) + Math.max(-1, Math.min(1, tilt)) * (k - R / 2) * Math.min(1.6, 19 / Math.max(1, R));
  const markers: { x: number; y: number; base: number; now: boolean }[] = [];

  for (let k = 0; k < R; k += 1) {
    const row = rows[k]!, isNow = k === R - 1, base = y0(k);
    const smooth = smoothRows[k] ?? smoothTerrainRow(row.values);
    const grow = still ? 1 : easeOutCubic((t - k * 0.035) / 0.5);
    const seenAny = smooth.some((s) => s.seen);
    const amber = limited && k >= model.stop!.row;
    const ys: number[] = [], xs: number[] = [];
    for (let i = 0; i < TERRAIN_POINTS; i += 1) {
      const x01 = i / (TERRAIN_POINTS - 1);
      // The whole range breathes: a slow swell rolls from the newest line back through the older ones, with a livelier ripple on top.
      const swell = still ? 1 : 1 + 0.1 * Math.sin(t * 0.9 - (R - 1 - k) * 0.55);
      let h = smooth[i]!.h * amp * grow * swell;
      if (!still && seenAny) h += Math.sin(x01 * 12 - t * 1.4 + k * 0.7) * 2 * Math.min(1, smooth[i]!.h * 3 + 0.2);
      if (isNow && !still) for (const d of drops) {
        const age = (nowMs - d.born) / 1000;
        if (age < 0) continue;
        const dx = (x01 - d.at) * 22;
        h += Math.min(gap * 1.6, amp * 0.6) * Math.exp(-dx * dx) * Math.max(0, 1 - age / (DROP_MS / 1000));
      }
      xs.push(xAt(i, k)); ys.push(base - h);
    }
    // Everything behind the line is ground, so nearer ridges hide the farther ones.
    const skirt = Skia.Path.Make(); skirt.moveTo(xs[0]!, ys[0]!);
    for (let i = 1; i < TERRAIN_POINTS; i += 1) skirt.lineTo(xs[i]!, ys[i]!);
    skirt.lineTo(xs[TERRAIN_POINTS - 1]!, base + 2); skirt.lineTo(xs[0]!, base + 2); skirt.close();
    fill.setColor(colors.ground); fill.setAlphaf(1); canvas.drawPath(skirt, fill);

    const color = amber ? colors.amber : colors.ink;
    const recency = R > 1 ? k / (R - 1) : 1;
    if (isNow) {
      const cut = Math.max(1, Math.min(TERRAIN_POINTS - 1, Math.floor(progress * (TERRAIN_POINTS - 1))));
      const solid = Skia.Path.Make(); solid.moveTo(xs[0]!, ys[0]!); for (let i = 1; i <= cut; i += 1) solid.lineTo(xs[i]!, ys[i]!);
      stroke.setColor(color); stroke.setStrokeWidth(1.8); stroke.setAlphaf(seenAny ? 1 : 0.5); canvas.drawPath(solid, stroke);
      const rest = Skia.Path.Make(); rest.moveTo(xs[cut]!, ys[cut]!); for (let i = cut + 1; i < TERRAIN_POINTS; i += 1) rest.lineTo(xs[i]!, ys[i]!);
      dashed.setColor(color); dashed.setStrokeWidth(1); dashed.setAlphaf(0.35); canvas.drawPath(rest, dashed);
      if (!still && seenAny && !amber) {
        // A bright scan runs along the written part of the live line.
        const head = Math.floor(((t * 0.5) % 1) * cut);
        for (let j = 0; j < SCAN_POINTS; j += 1) {
          const a = head - j;
          if (a < 1) break;
          stroke.setColor(colors.ink); stroke.setStrokeWidth(2.6); stroke.setAlphaf((1 - j / SCAN_POINTS) * 0.9);
          canvas.drawLine(xs[a - 1]!, ys[a - 1]!, xs[a]!, ys[a]!, stroke);
        }
      }
      // The write head: a dot on the line where the hour is being written now.
      const hi = Math.min(TERRAIN_POINTS - 1, Math.round(progress * (TERRAIN_POINTS - 1)));
      fill.setColor(color); fill.setAlphaf(1); canvas.drawCircle(xs[hi]!, ys[hi]!, 3, fill);
    } else {
      const ridge = Skia.Path.Make(); ridge.moveTo(xs[0]!, ys[0]!); for (let i = 1; i < TERRAIN_POINTS; i += 1) ridge.lineTo(xs[i]!, ys[i]!);
      const p = seenAny ? stroke : dashed;
      const picked = selected === k;
      p.setColor(color); p.setStrokeWidth(picked ? 2 : 1); p.setAlphaf(picked ? 1 : (amber ? 0.85 : 0.3 + 0.55 * recency) * (seenAny ? 1 : 0.5)); canvas.drawPath(ridge, p);
    }
    for (const at of row.orders) {
      const i = Math.round(at * (TERRAIN_POINTS - 1));
      markers.push({ x: xs[i]!, y: ys[i]!, base, now: isNow });
    }
  }

  // The picked hour sits in a hairline band, drawn after every ridge so a taller line in front cannot cover it.
  if (selected != null && selected >= 0 && selected < R) {
    stroke.setColor(colors.ink); stroke.setStrokeWidth(1); stroke.setAlphaf(0.25);
    canvas.drawRect(Skia.XYWHRect(left - 4, y0(selected) - Math.max(gap, 10) * 0.75, width - left + 2, Math.max(gap, 10) * 1.1), stroke);
  }

  // Orders last, so no ridge hides them: a lime point on a stem.
  for (const m of markers) {
    stroke.setColor(colors.order); stroke.setStrokeWidth(1); stroke.setAlphaf(0.9); canvas.drawLine(m.x, m.y, m.x, m.base + 1, stroke);
    fill.setColor(colors.order); fill.setAlphaf(1); canvas.drawCircle(m.x, m.y, m.now ? 3.6 : 3, fill);
  }
}

const styles = StyleSheet.create({
  hour: { position: "absolute", left: 0, color: calmColors.muted, fontSize: readableFont(10) },
  hourNow: { color: calmColors.text },
  limit: { position: "absolute", right: 2, color: calmColors.attention, fontSize: readableFont(10), letterSpacing: 1.2 },
  chip: { position: "absolute", right: 0, top: 0, fontSize: readableFont(10), letterSpacing: 1.2, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 6, paddingVertical: 1 },
});
