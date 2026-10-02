import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useRef, useState } from "react";
import { nextDailyBaseline, parseDailyBaseline, applyDailyBaseline, type DailyBaseline } from "./dailyResetModel";

const KEY = "nusa.home.dailyBaseline.v1";

/** Counts since the last 09:00 KST; baseline persisted so a restart does not re-zero mid-day. */
export function useDailyCounts(decisionCount: number | null, orderCount: number | null) {
  const [base, setBase] = useState<DailyBaseline | null>(null);
  const loaded = useRef(false);
  useEffect(() => { void AsyncStorage.getItem(KEY).then((raw) => { loaded.current = true; setBase(parseDailyBaseline(raw)); }).catch(() => { loaded.current = true; }); }, []);
  useEffect(() => {
    if (decisionCount == null || orderCount == null || !loaded.current) return;
    const next = nextDailyBaseline(base, decisionCount, orderCount, Date.now());
    if (next !== base) { setBase(next); void AsyncStorage.setItem(KEY, JSON.stringify(next)).catch(() => undefined); }
  }, [decisionCount, orderCount, base]);
  return applyDailyBaseline(base, decisionCount, orderCount, Date.now());
}
