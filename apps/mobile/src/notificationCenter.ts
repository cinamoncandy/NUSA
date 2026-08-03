import { MobileNotificationQueue, type MobileNotification } from "./notificationQueue";
import type { AppSettings } from "./settings";

export type MobileNotificationEvent = Readonly<{ id: string; kind: "PRICE" | "FILL" | "ORDER" | "SYSTEM"; title: string; message: string; severity: "INFO" | "WARNING" | "ERROR"; createdAtMs: number }>;

export class MobileNotificationCenter {
  public constructor(private readonly queue = new MobileNotificationQueue()) {}

  public publish(event: MobileNotificationEvent, settings: AppSettings, background: boolean): boolean {
    if (!settings.notifications.enabled) return false;
    if ((event.kind === "FILL" || event.kind === "ORDER") && !settings.notifications.orderUpdates) return false;
    if ((event.kind === "PRICE" || event.kind === "SYSTEM") && !settings.notifications.riskAlerts) return false;
    return this.queue.enqueue({ notificationId: event.id, category: `${event.kind}:${background ? "BACKGROUND" : "FOREGROUND"}`, title: event.title, message: event.message, severity: event.severity, createdAtMs: event.createdAtMs, expiresAtMs: null });
  }

  public list(nowMs: number): readonly MobileNotification[] { return this.queue.list(nowMs); }
}
