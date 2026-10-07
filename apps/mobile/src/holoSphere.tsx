import React, { useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { BlendMode, BlurStyle, Canvas, PaintStyle, Picture, Skia, StrokeCap, StrokeJoin, createPicture, type SkPicture } from "@shopify/react-native-skia";
import { calmPalette } from "./designSystem";
import { HOLO_COLORS, RIDGE_COLS, RIDGE_NEON, RIDGE_ROWS, easeOutCubic, flowClockSec, holoFillMarker, holoFrameBudgetMs, holoInk, initialHoloState, isHoloQuiet, observeHolo, ridgeBaseY, ridgeDepth, ridgeHeight, ridgeGlowsRow, ridgeHorizonGlow, ridgeNeonInk, ridgeOrderMix, ridgeRowAlpha, ridgeSway, ridgeWaveGlow, ridgeX, tickHolo, type HoloTone } from "./holoModel";

export interface HoloSphereProps {
  /** Real runtime decision count; each increase sends a bright wave from the horizon through the ridges. Null draws it still. */
  readonly decisionCount: number | null;
  /** Real PAPER order count; each increase raises a peak with a lime light beam, then it settles. */
  readonly fillCount: number | null;
  readonly tone: HoloTone;
  /** Still figure: reduce-motion, or a secondary-tab mark. */
  readonly reducedMotion: boolean;
  readonly size: number;
  /** Detail level: below 600 the landscape is drawn as a small mark (fewer ridges and columns). */
  readonly points?: number;
  readonly testID?: string;
}

/**
 * NUSA "능선" (Ridge) hero, chosen by the owner on 2026-10-06: a receding landscape of hairline ridges flowing toward the viewer.
 * A runtime decision sends a bright wave rolling forward from the horizon; a PAPER order raises a peak with a lime beam and its
 * ridge glows lime. A held / halted runtime tints the white ink amber / red and the halt nearly stops the flow (holoModel.ts).
 * Rows are drawn far to near; each row first fills the ground below its line, so nearer ridges hide farther ones.
 * The component name is kept for its callers.
 */
export function HoloSphere({ decisionCount, fillCount, tone, reducedMotion, size, points = 1600, testID = "holo-sphere" }: HoloSphereProps) {
  const state = useRef(initialHoloState());
  const stillDrawn = useRef(false);
  const detail = points >= 600 ? 1 : 0;
  const rows = detail === 1 ? RIDGE_ROWS : 16;
  const cols = detail === 1 ? RIDGE_COLS : 28;
  const paints = useMemo(() => {
    const line = Skia.Paint(); line.setAntiAlias(true); line.setStyle(PaintStyle.Stroke); line.setStrokeCap(StrokeCap.Round); line.setStrokeJoin(StrokeJoin.Round);
    const ground = Skia.Paint(); ground.setAntiAlias(true); ground.setColor(Skia.Color(calmPalette.ground));
    const glow = Skia.Paint(); glow.setAntiAlias(true); glow.setBlendMode(BlendMode.Plus);
    // A soft bloom when the renderer supports a blur mask; without it the beam still draws crisply.
    try { glow.setMaskFilter(Skia.MaskFilter.MakeBlur(BlurStyle.Normal, 10, true)); } catch { /* no blur */ }
    return { line, ground, glow };
  }, []);
  const rgba = useMemo(() => new Float32Array(4), []);
  const edges = useMemo(() => [[0, size * 0.16], [size, size * 0.84]].map(([x0, x1]) => {
    const paint = Skia.Paint();
    paint.setShader(Skia.Shader.MakeLinearGradient({ x: x0!, y: 0 }, { x: x1!, y: 0 }, [Skia.Color(calmPalette.ground), Skia.Color("transparent")], null, 0));
    return { paint, rect: Skia.XYWHRect(Math.min(x0!, x1!), 0, Math.abs(x1! - x0!), size) };
  }), [size]);
  const [picture, setPicture] = useState<SkPicture | null>(null);

  const render = (nowMs: number) => {
    const s = state.current, S = size;
    const grow = easeOutCubic(s.birth), tSec = reducedMotion ? 0 : flowClockSec(s);
    const ink = holoInk(tone, s.tintMix);
    const accent = tone === "normal" ? HOLO_COLORS.lime : ink;
    const set = (p: typeof paints.line, c: readonly [number, number, number], a: number) => { rgba[0] = c[0] / 255; rgba[1] = c[1] / 255; rgba[2] = c[2] / 255; rgba[3] = Math.max(0, Math.min(1, a)); p.setColor(rgba); };
    const waves = reducedMotion ? [] : s.waves;
    const burst = reducedMotion ? 0 : s.burst;
    setPicture(createPicture((canvas) => {
      // Horizon light: a soft band behind the farthest ridge that breathes with the flow clock.
      if (detail === 1) {
        const hy = ridgeBaseY(1) * S, strength = (reducedMotion ? 0.55 : ridgeHorizonGlow(tSec, burst)) * grow * (tone === "normal" ? 1 : 0.7);
        set(paints.glow, tone === "normal" ? RIDGE_NEON : ink, 0.1 * strength);
        paints.glow.setStyle(PaintStyle.Fill);
        canvas.drawRect(Skia.XYWHRect(S * 0.08, hy - S * 0.05, S * 0.84, S * 0.1), paints.glow);
      }
      for (let r = rows - 1; r >= 0; r -= 1) {
        const depth = ridgeDepth(r, rows, tSec);
        const base = ridgeBaseY(depth);
        const sway = reducedMotion ? 0 : ridgeSway(depth, tSec);
        const path = Skia.Path.Make();
        for (let c = 0; c <= cols; c += 1) {
          const u = c / cols, x = (ridgeX(u, depth) + sway) * S, y = (base - ridgeHeight(u, depth, tSec, burst) * grow) * S;
          if (c === 0) path.moveTo(x, y); else path.lineTo(x, y);
        }
        // Ground below the line hides the farther ridges.
        const fill = path.copy(); fill.lineTo((ridgeX(1, depth) + sway) * S, S); fill.lineTo((ridgeX(0, depth) + sway) * S, S); fill.close();
        canvas.drawPath(fill, paints.ground);
        let glowA = 0;
        for (const w of waves) glowA = Math.max(glowA, ridgeWaveGlow(w, depth, nowMs));
        const lime = ridgeOrderMix(depth, burst);
        const alpha = grow * Math.min(1, ridgeRowAlpha(depth) + (lime > 0.02 ? lime : glowA * 0.8));
        const rowInk = lime > 0.02 ? accent : ridgeNeonInk(ink, tone, depth, glowA);
        const width = Math.max(0.5, (0.6 + 0.9 * (1 - depth)) * (S / 720) * 2);
        // Neon: a wide soft pass under the line on the near rows and wherever a wave or order is lighting a ridge.
        if (detail === 1 && !reducedMotion && ridgeGlowsRow(r, depth, glowA, lime)) {
          set(paints.glow, rowInk, alpha * (0.25 + glowA * 0.35));
          paints.glow.setStyle(PaintStyle.Stroke); paints.glow.setStrokeWidth(width * 3.2);
          canvas.drawPath(path, paints.glow);
        }
        set(paints.line, rowInk, alpha);
        paints.line.setStrokeWidth(width);
        canvas.drawPath(path, paints.line);
      }
      // Fade the landscape's left and right ends into the ground (paints built once per size).
      for (const edge of edges) canvas.drawRect(edge.rect, edge.paint);
      // A PAPER order: a lime beam rising from the peak, with a soft bloom at its foot.
      if (burst > 0.02) {
        const foot = holoFillMarker(S);
        set(paints.line, accent, grow * 0.55 * burst); paints.line.setStrokeWidth(Math.max(1, S / 240));
        canvas.drawLine(foot.x, foot.y, foot.x, 0, paints.line);
        paints.glow.setStyle(PaintStyle.Fill); set(paints.glow, accent, grow * 0.5 * burst); canvas.drawCircle(foot.x, foot.y, S * 0.06, paints.glow);
      }
    }, { width: size, height: size }));
  };

  useEffect(() => {
    const now = Date.now();
    state.current = observeHolo(state.current, decisionCount, fillCount, now);
    if (reducedMotion || decisionCount == null) {
      // Still figure: no waves or beam in flight, tone colour applied.
      state.current = Object.freeze({ ...state.current, waves: Object.freeze([]), burst: 0, burstTarget: 0, flash: 0, birth: 1, tintMix: 1 });
      stillDrawn.current = true;
      render(now);
      return undefined;
    }
    // HOME starts with reduced motion assumed until the OS preference resolves; replay the entrance once when live motion begins.
    if (stillDrawn.current) { stillDrawn.current = false; state.current = Object.freeze({ ...state.current, birth: 0 }); }
    let alive = true, last = 0, frame = 0;
    const loop = (t: number) => {
      if (!alive) return;
      const budget = holoFrameBudgetMs(isHoloQuiet(state.current));
      if (t - last >= budget) {
        const dt = last === 0 ? budget : t - last;
        last = t;
        const nowMs = Date.now();
        state.current = tickHolo(state.current, tone, dt, nowMs);
        render(nowMs);
      }
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => { alive = false; cancelAnimationFrame(frame); };
  }, [decisionCount, fillCount, tone, reducedMotion, size]); // eslint-disable-line react-hooks/exhaustive-deps

  return <View style={[styles.stage, { width: size, height: size }]} pointerEvents="none" testID={testID} importantForAccessibility="no-hide-descendants">
    <Canvas style={{ width: size, height: size }}>{picture ? <Picture picture={picture} /> : null}</Canvas>
  </View>;
}

const styles = StyleSheet.create({ stage: { alignItems: "center", justifyContent: "center" } });
