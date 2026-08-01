const http = require("node:http");
const { readFile } = require("node:fs/promises");
const path = require("node:path");

const rendererRoot = path.resolve(__dirname, "../../apps/desktop/renderer");
const mimeTypes = { ".css": "text/css", ".html": "text/html", ".js": "text/javascript" };

const server = http.createServer(async (request, response) => {
  const pathname = request.url === "/" ? "/component-preview.html" : new URL(request.url, "http://127.0.0.1").pathname;
  const filePath = path.resolve(rendererRoot, `.${pathname}`);
  if (!filePath.startsWith(rendererRoot)) { response.writeHead(403).end(); return; }
  try {
    const body = await readFile(filePath);
    response.writeHead(200, { "content-type": mimeTypes[path.extname(filePath)] || "application/octet-stream" });
    response.end(body);
  } catch {
    response.writeHead(404).end();
  }
});

server.listen(4173, "127.0.0.1");

function shutdown() {
  server.closeAllConnections();
  server.close(() => process.exit(0));
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
