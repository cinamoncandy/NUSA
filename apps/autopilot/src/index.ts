export interface Env {
  NUSA_WEBHOOK_SECRET?: string;
}

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json; charset=utf-8" },
});

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health") {
      return json({
        service: "nusa-autopilot",
        status: "INTERFACE_READY",
        liveAuthority: "NONE",
        productionMutationAllowed: false,
        aiAuthority: "ZERO_AUTHORITY",
      });
    }

    if (request.method !== "POST" || url.pathname !== "/github/webhook") {
      return json({ error: "NOT_FOUND" }, 404);
    }

    if (!env.NUSA_WEBHOOK_SECRET) {
      return json({ error: "WEBHOOK_SECRET_NOT_CONFIGURED", status: "INTERFACE_READY" }, 503);
    }

    return json({
      accepted: false,
      status: "INTERFACE_READY",
      reason: "SIGNATURE_VERIFICATION_AND_EVENT_DISPATCH_NOT_YET_ENABLED",
      liveAuthority: "NONE",
      productionMutationAllowed: false,
      aiAuthority: "ZERO_AUTHORITY",
    }, 503);
  },
};
