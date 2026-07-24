import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize, resolve, sep } from "node:path";
import { handleApiRequest } from "./apiRouter";
import type { PaperRuntime } from "./paperRuntime";

const MAX_BODY_BYTES = 64 * 1024;

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

export function createPaperTradingHttpServer(runtime: PaperRuntime, staticRoot: string): Server {
  const normalizedRoot = resolve(staticRoot);
  return createServer((request, response) => {
    void (async () => {
      const method = request.method ?? "GET";
      const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
      if (!pathname.startsWith("/api/")) {
        if (method === "GET" && serveStatic(normalizedRoot, pathname, response)) return;
        response.writeHead(404, { "content-type": "text/plain" }).end("Not Found");
        return;
      }
      let body: unknown;
      try {
        body = await readJsonBody(request);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        response.writeHead(400, { "content-type": "application/json; charset=utf-8" }).end(JSON.stringify({ error: message }));
        return;
      }
      const result = handleApiRequest({ method, pathname, body }, runtime);
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
  });
}
