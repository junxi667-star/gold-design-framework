import { createReadStream } from "node:fs";
import { access, stat } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(rootDir, "public");

const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
]);

function resolvePublicPath(requestUrl) {
  const pathname = decodeURIComponent(new URL(requestUrl, "http://localhost").pathname);
  const requested = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const resolved = path.resolve(publicDir, requested);

  if (resolved !== publicDir && !resolved.startsWith(`${publicDir}${path.sep}`)) {
    return null;
  }

  return resolved;
}

export function createAppServer({ instanceToken = process.env.GOLD_DEMO_INSTANCE_TOKEN || "" } = {}) {
  return http.createServer(async (request, response) => {
    if (!request.url || !["GET", "HEAD"].includes(request.method ?? "")) {
      response.writeHead(405, { Allow: "GET, HEAD" });
      response.end("Method not allowed");
      return;
    }

    const filePath = resolvePublicPath(request.url);
    if (!filePath) {
      response.writeHead(400);
      response.end("Invalid path");
      return;
    }

    try {
      await access(filePath);
      const fileStat = await stat(filePath);
      if (!fileStat.isFile()) {
        throw new Error("Not a file");
      }

      const headers = {
        "Content-Type": contentTypes.get(path.extname(filePath)) ?? "application/octet-stream",
        "Content-Length": fileStat.size,
        "Cache-Control": "no-store",
        "Content-Security-Policy": "default-src 'self'; img-src 'self' blob:; style-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
      };
      if (instanceToken) {
        headers["X-Gold-Demo-Instance"] = instanceToken;
      }
      response.writeHead(200, headers);

      if (request.method === "HEAD") {
        response.end();
        return;
      }

      createReadStream(filePath).pipe(response);
    } catch {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not found");
    }
  });
}

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) {
  const port = Number(process.env.PORT || 4173);
  const server = createAppServer();
  server.listen(port, "127.0.0.1", () => {
    console.log(`黄金产业 AI 智能设计框架：http://127.0.0.1:${port}`);
  });
}
