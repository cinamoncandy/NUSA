import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { api } from "../api/client";
import type { ControlEvent } from "../api/types";

if (Platform.OS !== "web") {
  // expo-notifications has no web implementation at all (scheduleNotificationAsync throws
  // "not available on web" if called there) -- setNotificationHandler is native-only setup, so
  // it must not even be called on web.
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false
    })
  });
}

export async function requestNotificationPermission(): Promise<boolean> {
  if (Platform.OS === "web") {
    if (typeof Notification === "undefined") return false;
    if (Notification.permission === "granted") return true;
    return (await Notification.requestPermission()) === "granted";
  }
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  const requested = await Notifications.requestPermissionsAsync();
  return requested.granted;
}

async function sendLocalNotification(title: string, body: string): Promise<void> {
  if (Platform.OS === "web") {
    // The web build has no Expo-managed local-notification API to call -- the browser's own
    // Notification constructor is the real equivalent there (verified against a real Chromium
    // instance with permission granted).
    if (typeof Notification !== "undefined" && Notification.permission === "granted") new Notification(title, { body });
    return;
  }
  await Notifications.scheduleNotificationAsync({ content: { title, body }, trigger: null });
}

// GET /api/control translates event.type to Korean server-side (apps/server/src/apiRouter.ts's
// translateEventType(), see apps/server/src/logMessages.ts's EVENT_TYPE_KO) before this app ever
// sees it, so this has to match those translated labels ("주문"/"리스크"), not the raw English
// ORDER/RISK values ControlPlane.record() uses internally.
const NOTIFIED_EVENT_TYPES = new Set(["주문", "리스크"]);

/**
 * Polls GET /api/control while this screen is mounted and fires a local device notification
 * for any new ORDER/RISK event -- the same "only notify on the types an operator actually
 * needs to act on, baseline on first poll so a restart doesn't replay old history" shape as
 * apps/server/src/paperRuntime.ts's notifyNewControlEvents(), just running client-side.
 *
 * This is honestly scoped as foreground polling, not real OS-level background push: Expo's
 * local notifications only fire while this app process is alive (foreground or, on some OS
 * versions, freshly backgrounded). A true always-on push (the phone gets notified even after
 * being force-quit) needs a deployed EAS project with push credentials, which this sandbox has
 * no way to provision or verify -- see apps/server's existing webhook notifier
 * (webhookNotifier.ts) for the one channel that already works regardless of whether this app is
 * even running.
 */
export class ControlEventNotifier {
  private lastSeenEventId: string | undefined;
  private baselined = false;
  private timer: ReturnType<typeof setInterval> | undefined;

  start(pollIntervalMs = 5_000): void {
    this.poll();
    this.timer = setInterval(() => void this.poll(), pollIntervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  private async poll(): Promise<void> {
    let events: readonly ControlEvent[];
    try {
      events = (await api.control()).events;
    } catch {
      return;
    }
    if (events.length === 0) return;
    if (!this.baselined) {
      this.lastSeenEventId = events[0]!.id;
      this.baselined = true;
      return;
    }
    const lastSeenIndex = events.findIndex((event) => event.id === this.lastSeenEventId);
    const newEvents = lastSeenIndex === -1 ? events : events.slice(0, lastSeenIndex);
    this.lastSeenEventId = events[0]!.id;
    for (const event of [...newEvents].reverse()) {
      if (!NOTIFIED_EVENT_TYPES.has(event.type)) continue;
      await sendLocalNotification(`DOKKAEBI: ${event.type}`, event.message);
    }
  }
}
