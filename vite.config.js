import path from "node:path";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const apiProxyTarget = process.env.JEWELCHAIN_API_PROXY_TARGET?.trim() || "http://127.0.0.1:4173";

function runtimeConfigPlugin(mode) {
  const apiBaseUrl = mode === "pages" ? "https://api.jewelchain.xyz" : "";
  const deploymentMode = mode === "pages" ? "cloudflare-pages" : "local-or-same-origin";
  const source = [
    "window.JEWELCHAIN_CONFIG = Object.freeze({",
    `  apiBaseUrl: "${apiBaseUrl}",`,
    `  deploymentMode: "${deploymentMode}",`,
    "  siteName: \"JewelChain Studio\"",
    "});",
    "",
  ].join("\n");

  return {
    name: "jewelchain-runtime-config",
    configureServer(server) {
      server.middlewares.use("/runtime-config.js", (_request, response) => {
        response.statusCode = 200;
        response.setHeader("Content-Type", "text/javascript; charset=utf-8");
        response.setHeader("Cache-Control", "no-store");
        response.end(source);
      });
    },
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "runtime-config.js", source });
    },
  };
}

export default defineConfig(({ mode }) => {
  const pagesBuild = mode === "pages";

  return {
    root: path.join(projectRoot, "frontend"),
    publicDir: "static",
    plugins: [react(), runtimeConfigPlugin(mode)],
    server: {
      port: 5173,
      strictPort: true,
      proxy: {
        "/api": apiProxyTarget,
        "/generated": apiProxyTarget,
        "/metadata": apiProxyTarget,
      },
    },
    build: {
      outDir: path.join(projectRoot, pagesBuild ? "pages-frontend" : "public"),
      emptyOutDir: true,
    },
  };
});
