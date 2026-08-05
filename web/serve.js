// A tiny static server for local testing: `npm run serve` or `node serve.js`.
//
// ES modules will not load over file://, so the app needs to be served from
// somewhere. This serves only the files in this folder, and only to this
// machine.

import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL(".", import.meta.url));
const PORT = Number(process.env.PORT) || 8123;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

async function resolve(urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0]);
  const relative = normalize(decoded).replace(/^[/\\]+/, "");
  const target = join(ROOT, relative || "index.html");

  // Never serve anything outside this folder.
  if (!target.startsWith(ROOT.endsWith(sep) ? ROOT : ROOT + sep)) return null;

  try {
    const info = await stat(target);
    if (info.isDirectory()) return resolve(join(relative, "index.html"));
    return target;
  } catch {
    return null;
  }
}

const server = createServer(async (request, response) => {
  const file = await resolve(request.url || "/");
  if (!file) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    return response.end("Not found");
  }

  response.writeHead(200, {
    "Content-Type": TYPES[extname(file).toLowerCase()] || "application/octet-stream",
    // Always re-read during testing, so an edit shows up on refresh.
    "Cache-Control": "no-store",
  });
  createReadStream(file).pipe(response);
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`YNAB Toolkit running at http://127.0.0.1:${PORT}/`);
  console.log("Press Ctrl+C to stop.");
});
