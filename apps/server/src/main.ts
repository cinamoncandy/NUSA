import { readFileSync } from "node:fs";
import path from "node:path";
import { createPaperTradingHttpServer, type HttpServerOptions } from "./httpServer";
import { PaperRuntime } from "./paperRuntime";

const PORT = Number(process.env.DOKKAEBI_SERVER_PORT ?? 4100);
const DATABASE_PATH = process.env.DOKKAEBI_SERVER_DB ?? path.join(process.cwd(), "data", "dokkaebi-server.db");
const STATIC_ROOT = path.join(__dirname, "../../../../apps/web");
// Both opt-in, both undefined (disabled) by default -- see httpServer.ts's HttpServerOptions
// doc comments. scripts/generate-dev-cert.js produces a cert/key pair to point
// DOKKAEBI_TLS_CERT_PATH/DOKKAEBI_TLS_KEY_PATH at.
const API_KEY = process.env.DOKKAEBI_API_KEY || undefined;
const TLS_CERT_PATH = process.env.DOKKAEBI_TLS_CERT_PATH;
const TLS_KEY_PATH = process.env.DOKKAEBI_TLS_KEY_PATH;
const httpServerOptions: HttpServerOptions = {
  ...(API_KEY !== undefined ? { apiKey: API_KEY } : {}),
  ...(TLS_CERT_PATH && TLS_KEY_PATH
    ? { tls: { cert: readFileSync(TLS_CERT_PATH, "utf8"), key: readFileSync(TLS_KEY_PATH, "utf8") } }
    : {})
};

const runtime = new PaperRuntime({ databasePath: DATABASE_PATH });
const server = createPaperTradingHttpServer(runtime, STATIC_ROOT, httpServerOptions);

runtime.start();
server.listen(PORT);

function shutdown(): void {
  server.close();
  runtime.dispose();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
