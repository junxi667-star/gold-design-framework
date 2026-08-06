import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const stateFile = path.join(root, ".gold-demo-server.json");
const host = "127.0.0.1";
const port = Number(process.env.PORT || process.argv[3] || 4173);

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function readState() {
  if (!existsSync(stateFile)) return null;
  try { return JSON.parse(readFileSync(stateFile, "utf8")); } catch { return null; }
}
function removeState() { if (existsSync(stateFile)) unlinkSync(stateFile); }
function probe(targetPort, timeout = 900) {
  return new Promise((resolve) => {
    const request = http.get({ host, port: targetPort, path: "/api/health", timeout }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({ ok: response.statusCode === 200, body: Buffer.concat(chunks).toString("utf8") }));
    });
    request.on("timeout", () => request.destroy());
    request.on("error", () => resolve({ ok: false, body: "" }));
  });
}

async function start() {
  const old = readState();
  if (old?.pid && old?.port) {
    const alive = await probe(old.port);
    if (alive.ok) {
      console.log(`Already running: http://${host}:${old.port}`);
      return;
    }
    removeState();
  }
  const occupied = await probe(port);
  if (occupied.ok) throw new Error(`Port ${port} is already used by another server.`);
  const token = randomUUID();
  const child = spawn(process.execPath, [path.join(root, "server.js")], {
    cwd: root,
    detached: true,
    windowsHide: true,
    stdio: "ignore",
    env: { ...process.env, PORT: String(port), JEWELCHAIN_INSTANCE_TOKEN: token },
  });
  await new Promise((resolve, reject) => { child.once("spawn", resolve); child.once("error", reject); });
  writeFileSync(stateFile, JSON.stringify({ pid: child.pid, port, token }, null, 2), "utf8");
  child.unref();
  for (let i = 0; i < 40; i += 1) {
    await sleep(200);
    if ((await probe(port)).ok) {
      console.log(`Started: http://${host}:${port}`);
      return;
    }
  }
  try { process.kill(child.pid); } catch {}
  removeState();
  throw new Error("Server did not become ready.");
}

async function stop() {
  const saved = readState();
  if (!saved) { console.log("No package-owned server is running."); return; }
  try { process.kill(saved.pid); } catch (error) { if (error.code !== "ESRCH") throw error; }
  for (let i = 0; i < 20; i += 1) {
    await sleep(150);
    if (!(await probe(saved.port)).ok) break;
  }
  removeState();
  console.log("Stopped.");
}

try {
  if (process.argv[2] === "start") await start();
  else if (process.argv[2] === "stop") await stop();
  else throw new Error("Usage: service-manager.js start|stop [port]");
} catch (error) {
  console.error(`ERROR: ${error.message}`);
  process.exitCode = 1;
}
