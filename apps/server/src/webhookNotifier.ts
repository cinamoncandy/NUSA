/**
 * Best-effort webhook notifications for ORDER/RISK ControlEvents (fills and risk triggers --
 * see paperRuntime.ts's notifyNewControlEvents()) -- this server has no email/push
 * infrastructure of its own (no new dependency, no SMTP/APNs credentials to manage), so a
 * generic JSON POST to an operator-configured URL is the one notification channel available.
 * The receiving side (the operator's own relay script, a service like n8n, a Slack/Discord
 * "incoming webhook" adapter, ...) is responsible for reformatting this payload into whatever
 * shape its own platform expects; this deliberately does not hardcode one chat platform's body
 * shape (e.g. Slack's {text: ...} vs Discord's {content: ...}).
 *
 * Fire-and-forget by design: a broken, unreachable, or slow webhook URL must never affect
 * trading (same "give up rather than retry forever" convention as position protection/limit
 * order triggers elsewhere in paperRuntime.ts) -- every failure is swallowed here.
 */
export interface WebhookEvent {
  readonly type: string;
  readonly message: string;
  readonly timestamp: string;
}

export type WebhookSender = (url: string, event: WebhookEvent) => Promise<void>;

/** http/https only -- rejects `javascript:`, `file:`, and anything else that isn't a real
 * webhook endpoint, and rejects unparseable input outright. */
export function isValidWebhookUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export const sendWebhookNotification: WebhookSender = async (url, event) => {
  try {
    await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(event)
    });
  } catch {
    // Network failure, DNS failure, non-2xx response, timeout, ... -- see this module's own doc
    // comment. The response itself (even a real 4xx/5xx) is never inspected: there is nowhere
    // in this UI to surface a delivery failure for a fire-and-forget notification, and retrying
    // would risk delaying/blocking the trading pipeline this is only ever a side effect of.
  }
};
