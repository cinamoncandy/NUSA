import { createServer as createHttpServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from "node:http";
import { createServer as createHttpsServer, type Server as HttpsServer } from "node:https";
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize, resolve, sep } from "node:path";
import { errorResponse, handleApiRequest, methodNotAllowed, ok, tooManyRequests, unauthorized, type ApiResponse } from "./apiRouter";
import type { PaperRuntime } from "./paperRuntime";
import { translateErrorMessage } from "./errorMessages";
import { RateLimiter } from "./rateLimiter";
import { isAuthorized } from "./apiAuth";

const MAX_BODY_BYTES = 64 * 1024;

// Auth (apiAuth.ts) is entirely opt-in and off by default -- this rate limit applies
// unconditionally either way, the other half of abuse protection for a deployment that hasn't
// configured a key. A generous but real per-client cap on /api/ requests. apps/web's
// submitCommand() awaits a full refresh()
// (~13 GET requests) after *every* action on top of the normal 5s periodic poll, so a burst of
// manual actions (confirmed live: a Playwright walkthrough clicking through ~20 actions with
// only 500ms waits between them) can easily produce several hundred requests within 10s from
// one legitimate tab -- an earlier, tighter 120/10s limit was measured to false-positive
// against exactly that real usage pattern. 600/10s (60/s) comfortably covers several tabs under
// heavy interactive use while still catching a genuinely runaway loop (which produces far more
// than 60 req/s).
const RATE_LIMIT_WINDOW_MS = 10_000;
const RATE_LIMIT_MAX_REQUESTS = 600;

const CONTENT_TYPES: Readonly<Record<string, string>> = Object.freeze({
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
});

function readJsonBody(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolvePromise, rejectPromise) => {
    if (request.method !== "POST" && request.method !== "PUT") { resolvePromise(undefined); return; }
    const chunks: Buffer[] = [];
    let size = 0;
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) { rejectPromise(new Error("request body too large")); request.destroy(); return; }
      chunks.push(chunk);
    });
    request.on("end", () => {
      if (chunks.length === 0) { resolvePromise(undefined); return; }
      try { resolvePromise(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
      catch { rejectPromise(new Error("request body must be valid JSON")); }
    });
    request.on("error", rejectPromise);
  });
}

/** Serves static files from staticRoot for any GET request that isn't under /api/,
 * rejecting any resolved path that escapes staticRoot (defense against "..") traversal. */
function serveStatic(staticRoot: string, pathname: string, response: ServerResponse): boolean {
  const requested = pathname === "/" ? "/index.html" : pathname;
  const resolved = resolve(join(staticRoot, normalize(requested)));
  if (resolved !== staticRoot && !resolved.startsWith(staticRoot + sep)) {
    response.writeHead(403, { "content-type": "text/plain" }).end("Forbidden");
    return true;
  }
  if (!existsSync(resolved) || !statSync(resolved).isFile()) return false;
  const contentType = CONTENT_TYPES[extname(resolved)] ?? "application/octet-stream";
  response.writeHead(200, { "content-type": contentType });
  createReadStream(resolved).pipe(response);
  return true;
}

export interface HttpServerOptions {
  /** Test injection point: overrides the production RateLimiter (RATE_LIMIT_WINDOW_MS/
   * RATE_LIMIT_MAX_REQUESTS) with a smaller one, so a test can prove the 429 wiring works by
   * sending a handful of requests instead of hundreds. */
  readonly rateLimiter?: RateLimiter;
  /** When set, every /api/ request must carry a matching `Authorization: Bearer <apiKey>`
   * header (see apiAuth.ts). Undefined (the default) disables auth entirely -- today's existing
   * single-user-on-localhost behavior, unchanged. Static assets are never gated: the page itself
   * has to load before an operator has anywhere to type a key in. */
  readonly apiKey?: string;
  /** TLS certificate/private key PEM contents -- when both are set, the returned server is a
   * real node:https.Server instead of node:http.Server. Generate a self-signed pair for local/
   * LAN use with scripts/generate-dev-cert.js (needed for a phone on the same LAN to reach this
   * server over a secure context -- the PWA/Service Worker/Wake Lock features all require one). */
  readonly tls?: { readonly cert: string; readonly key: string };
}

export function createPaperTradingHttpServer(runtime: PaperRuntime, staticRoot: string, options: HttpServerOptions = {}): HttpServer | HttpsServer {
  const normalizedRoot = resolve(staticRoot);
  const rateLimiter = options.rateLimiter ?? new RateLimiter({ windowMs: RATE_LIMIT_WINDOW_MS, maxRequests: RATE_LIMIT_MAX_REQUESTS });
  const requestListener = (request: IncomingMessage, response: ServerResponse): void => {
    void (async () => {
      const method = request.method ?? "GET";
      const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
      if (!pathname.startsWith("/api/")) {
        if (method === "GET" && serveStatic(normalizedRoot, pathname, response)) return;
        response.writeHead(404, { "content-type": "text/plain" }).end("Not Found");
        return;
      }
      // Checked before reading the body -- no reason to buffer a request this server is about
      // to reject anyway. Static assets are exempt (see RATE_LIMIT_* comment above).
      if (!rateLimiter.allow(request.socket.remoteAddress ?? "unknown")) {
        const limited = tooManyRequests();
        response.writeHead(limited.status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store, max-age=0" }).end(JSON.stringify(limited.body));
        return;
      }
      if (options.apiKey !== undefined && !isAuthorized(request.headers.authorization, options.apiKey)) {
        const denied = unauthorized();
        response.writeHead(denied.status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store, max-age=0" }).end(JSON.stringify(denied.body));
        return;
      }
      let body: unknown;
      try {
        body = await readJsonBody(request);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        response.writeHead(400, { "content-type": "application/json; charset=utf-8" }).end(JSON.stringify({ error: translateErrorMessage(message) }));
        return;
      }
      // The only genuinely async route: fetches real Upbit candles + runs backtestEngine
      // (see paperRuntime.ts's runBacktestComparison() doc comment). Handled here rather than
      // in apiRouter.ts's handleApiRequest() so that function can stay synchronous -- every
      // other route is instant, in-memory work, and keeping the whole router async purely for
      // this one endpoint would mean every existing call site (tests included) awaiting a
      // Promise it doesn't actually need to.
      let result: ApiResponse;
      if (pathname === "/api/backtest") {
        if (method !== "POST") { result = methodNotAllowed(); }
        else {
          try {
            const unit = body != null && typeof body === "object" ? (body as Record<string, unknown>).unit : undefined;
            if (unit !== undefined && unit !== "minute" && unit !== "day") throw new Error("unit must be \"minute\" or \"day\"");
            result = ok({ results: await runtime.runBacktestComparison(unit as "minute" | "day" | undefined) });
          } catch (error) { result = errorResponse(error); }
        }
      } else {
        result = handleApiRequest({ method, pathname, body }, runtime);
      }
      if (result.contentType) {
        response.writeHead(result.status, {
          "content-type": result.contentType,
          "cache-control": "no-store, max-age=0",
          ...(result.contentDisposition ? { "content-disposition": result.contentDisposition } : {})
        }).end(String(result.body));
        return;
      }
      response.writeHead(result.status, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store, max-age=0"
      }).end(JSON.stringify(result.body));
    })();
  };
  return options.tls
    ? createHttpsServer({ cert: options.tls.cert, key: options.tls.key }, requestListener)
    : createHttpServer(requestListener);
}
