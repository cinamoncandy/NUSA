import React, { useEffect, useMemo, useRef, useState } from "react";
import { AppState, StyleSheet, Text, View } from "react-native";
import { Canvas, Fill, Shader, Skia } from "@shopify/react-native-skia";
import { AURORA_SKSL } from "./auroraShader";
import { AURORA_SLOTS, auroraMode, beatAdvanced, beatPosition, eventsForRise, liveEvents, packEvents, type AuroraEvent, type AuroraTone } from "./auroraCoreModel";
import { DecisionCore } from "./decisionCore";
import { calmColors } from "./uiKitModel";
import { fieldFonts } from "./fieldFonts";
import { readableFont } from "./designSystem";

/**
 * The aurora, the motion graphic of "지금" (owner-chosen 2026-10-26): slowly flowing silk lines drawn by a Skia shader. A real rise in
 * the decision count sends one ripple through the lines, a real rise in PAPER orders makes that ripple an order ripple (green flare),
 * and a newer server heartbeat time sweeps a light across. Hold turns it amber and slow; no data leaves it dim and nearly still.
 * Presentation only: it draws counts and a timestamp the screen already has and invents nothing. If the device cannot build the
 * shader it falls back to the previous decision core. Reduce-motion (or before the OS answers) draws one settled frame; frames stop
 * while the app is in the background. The shader renders at 60% size and is scaled up to keep the per-frame cost down.
 */
const FRAME_MS = 33;
const RENDER_SCALE = 0.6;
const effect = Skia.RuntimeEffect.Make(AURORA_SKSL);

export function AuroraCore({ tone, decisionCount, orderCount, lastHeartbeatAt, width, reducedMotion, testID = "now-core" }: {
  readonly tone: AuroraTone;
  readonly decisionCount: number | null;
  readonly orderCount: number | null;
  /** Server-reported time of its last heartbeat (ms); a newer value sweeps the light across. */
  readonly lastHeartbeatAt: number | null;
  readonly width: number;
  readonly reducedMotion: boolean | null;
  readonly testID?: string;
}) {
  if (effect == null) return <DecisionCore tone={tone} decisionCount={decisionCount} orderCount={orderCount} width={width} reducedMotion={reducedMotion} testID={testID} />;
  return <AuroraSurface effect={effect} tone={tone} decisionCount={decisionCount} orderCount={orderCount} lastHeartbeatAt={lastHeartbeatAt} width={width} reducedMotion={reducedMotion} testID={testID} />;
}

function AuroraSurface({ effect: fx, tone, decisionCount, orderCount, lastHeartbeatAt, width, reducedMotion, testID }: {
  readonly effect: NonNullable<typeof effect>;
  readonly tone: AuroraTone;
  readonly decisionCount: number | null;
  readonly orderCount: number | null;
  readonly lastHeartbeatAt: number | null;
  readonly width: number;
  readonly reducedMotion: boolean | null;
  readonly testID: string;
}) {
  const height = Math.round(width * 0.9);
  const rw = Math.max(1, Math.round(width * RENDER_SCALE));
  const rh = Math.max(1, Math.round(height * RENDER_SCALE));
  const events = useRef<readonly AuroraEvent[]>([]);
  const lastDecisions = useRef<number | null>(decisionCount);
  const lastOrders = useRef<number | null>(orderCount);
  const lastBeat = useRef<number | null>(lastHeartbeatAt);
  const beatBorn = useRef<number | null>(null);
  const toneRef = useRef(tone);
  toneRef.current = tone;
  const clock = useRef({ t: 8, speed: 1, warm: 0, dim: 1 });
  const slots = useRef<number[]>(new Array(AURORA_SLOTS * 4).fill(-1));
  const [frame, setFrame] = useState(0);
  const [active, setActive] = useState(AppState.currentState === "active");

  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => setActive(s === "active"));
    return () => sub.remove();
  }, []);
  useEffect(() => {
    const now = Date.now();
    if (reducedMotion === false) events.current = liveEvents([...events.current, ...eventsForRise(lastDecisions.current, decisionCount, lastOrders.current, orderCount, now)], now);
    lastDecisions.current = decisionCount;
    lastOrders.current = orderCount;
  }, [decisionCount, orderCount, reducedMotion]);
  useEffect(() => {
    if (reducedMotion === false && beatAdvanced(lastBeat.current, lastHeartbeatAt)) beatBorn.current = Date.now();
    lastBeat.current = lastHeartbeatAt;
  }, [lastHeartbeatAt, reducedMotion]);
  useEffect(() => {
    if (reducedMotion !== false) { setFrame((n) => n + 1); return undefined; } // one settled frame
    if (!active) return undefined;
    let alive = true, last = 0, handle = 0;
    const loop = (ts: number) => {
      if (!alive) return;
      if (ts - last >= FRAME_MS) {
        const dt = last === 0 ? 0 : Math.min(0.1, (ts - last) / 1000); last = ts;
        const goal = auroraMode(toneRef.current), c = clock.current, k = Math.min(1, dt * 2.4);
        c.speed += (goal.speed - c.speed) * k; c.warm += (goal.warm - c.warm) * k; c.dim += (goal.dim - c.dim) * k;
        c.t += dt * c.speed;
        events.current = liveEvents(events.current, Date.now());
        setFrame((n) => n + 1);
      }
      handle = requestAnimationFrame(loop);
    };
    handle = requestAnimationFrame(loop);
    return () => { alive = false; cancelAnimationFrame(handle); };
  }, [reducedMotion, active]);

  const uniforms = useMemo(() => {
    const c = clock.current, now = Date.now();
    packEvents(events.current, now, slots.current);
    return { uRes: [rw, rh], uT: c.t, uWarm: c.warm, uDim: c.dim, uBeat: beatPosition(beatBorn.current, now), uEv: slots.current.slice() };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frame, rw, rh]);

  const chip = tone === "limit" ? "HOLD" : tone === "live" ? "LIVE" : "—";
  const label = `판단 오로라. ${decisionCount == null ? "판단 수를 받지 못했어요" : `오늘 판단 ${decisionCount.toLocaleString("en-US")}번`}${orderCount == null ? "" : `, 모의 주문 ${orderCount.toLocaleString("en-US")}번`}${tone === "limit" ? ". 새 매수는 멈춰 있어요" : ""}`;
  return <View style={{ width, height, borderRadius: 24, overflow: "hidden" }} testID={testID} accessible accessibilityLabel={label}>
    <Canvas style={{ position: "absolute", left: (width - rw) / 2, top: (height - rh) / 2, width: rw, height: rh, transform: [{ scale: 1 / RENDER_SCALE }] }} pointerEvents="none">
      <Fill><Shader source={fx} uniforms={uniforms} /></Fill>
    </Canvas>
    <Text style={[fieldFonts.mono, styles.chip, { color: tone === "limit" ? calmColors.attention : tone === "live" ? calmColors.text : calmColors.muted, borderColor: tone === "limit" ? calmColors.attention : calmColors.line }]} importantForAccessibility="no-hide-descendants">{chip}</Text>
  </View>;
}

const styles = StyleSheet.create({
  chip: { position: "absolute", right: 12, top: 10, fontSize: readableFont(10), letterSpacing: 1.2, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 6, paddingVertical: 2, backgroundColor: "rgba(3,7,10,0.45)" },
});
