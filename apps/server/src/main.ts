import path from "node:path";
import { createPaperTradingHttpServer } from "./httpServer";
import { PaperRuntime } from "./paperRuntime";

const PORT = Number(process.env.DOKKAEBI_SERVER_PORT ?? 4100);
const DATABASE_PATH = process.env.DOKKAEBI_SERVER_DB ?? path.join(process.cwd(), "data", "dokkaebi-server.db");
const STATIC_ROOT = path.join(__dirname, "../../../../apps/web");

const runtime = new PaperRuntime({ databasePath: DATABASE_PATH });
const server = createPaperTradingHttpServer(runtime, STATIC_ROOT);

runtime.start();
server.listen(PORT);

function shutdown(): void {
  server.close();
  runtime.dispose();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
