import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useState } from "react";
import { applyDailyBaseline, msUntilNextReset, nextDailyBaseline, parseDailyBaseline, type DailyBaseline } from "./dailyResetModel";

const KEY = "nusa.home.dailyBaseline.v2";
export const BUY_SIGNAL_KEY = "nusa.home.dailyBuyBaseline.v1";

/**
 * Counts since the last 09:00 KST. The baseline is persisted per runtime instance (sourceId =
 * heartbeat.startedAt). Until storage has loaded the counts read as unknown, and a timer re-renders
 * at each 09:00 so the new window's baseline is taken before its first event.
 */
export function useDailyCounts(sourceId: number | null, decisionCount: number | null, orderCount: number | null, storageKey: string = KEY) {
  const [stored, setStored] = useState<{ readonly ready: boolean; readonly base: DailyBaseline | null }>({ ready: false, base: null });
  const [, setTick] = useState(0);
  useEffect(() => { void AsyncStorage.getItem(storageKey).then((raw) => setStored({ ready: true, base: parseDailyBaseline(raw) })).catch(() => setStored({ ready: true, base: null })); }, [storageKey]);
  useEffect(() => {
    const timer = setTimeout(() => setTick((t) => t + 1), msUntilNextReset(Date.now()) + 50);
    return () => clearTimeout(timer);
  });
  const now = Date.now();
  const base = stored.ready && sourceId != null && decisionCount != null && orderCount != null ? nextDailyBaseline(stored.base, sourceId, decisionCount, orderCount, now) : stored.base;
  useEffect(() => {
    if (base !== stored.base && base != null) { setStored({ ready: true, base }); void AsyncStorage.setItem(storageKey, JSON.stringify(base)).catch(() => undefined); }
  }, [base, stored.base, storageKey]);
  return stored.ready ? applyDailyBaseline(base, sourceId, decisionCount, orderCount, now) : Object.freeze({ decisionCount: null, paperOrderCount: null });
}
