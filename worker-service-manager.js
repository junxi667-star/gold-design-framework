import { closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { loadEnvFile } from "./backend/env-loader.js";

const root = path.dirname(fileURLToPath(import.meta.url));
loadEnvFile(root);
const stateFile = path.join(root, ".jewelchain-worker.json");
const logDir = path.join(root, "logs");
const logFile = path.join(logDir, "image-worker.log");

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function readState() {
  if (!existsSync(stateFile)) return null;
  try { return JSON.parse(readFileSync(stateFile, "utf8")); } catch { return null; }
}
function removeState() { if (existsSync(stateFile)) unlinkSync(stateFile); }
function processAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

async function start() {
  const old = readState();
  if (old?.pid && processAlive(old.pid)) {
    console.log(`Image Worker already running (PID ${old.pid}).`);
    return;
  }
  removeState();
  mkdirSync(logDir, { recursive: true });
  const out = openSync(logFile, "a");
  const child = spawn(process.execPath, [path.join(root, "worker", "image-worker.js")], {
    cwd: root,
    detached: true,
    windowsHide: true,
    stdio: ["ignore", out, out],
    env: { ...process.env },
  });
  await new Promise((resolve, reject) => { child.once("spawn", resolve); child.once("error", reject); });
  closeSync(out);
  writeFileSync(stateFile, JSON.stringify({ pid: child.pid, startedAt: new Date().toISOString(), logFile }, null, 2), "utf8");
  child.unref();
  await sleep(800);
  if (!processAlive(child.pid)) {
    removeState();
    throw new Error(`Image Worker failed to start. Check ${logFile}`);
  }
  console.log(`Image Worker started (PID ${child.pid}).`);
  console.log(`Log: ${logFile}`);
}

async function stop() {
  const saved = readState();
  if (!saved) { console.log("No package-owned Image Worker is running."); return; }
  if (processAlive(saved.pid)) {
    try { process.kill(saved.pid); } catch {}
    for (let i = 0; i < 20 && processAlive(saved.pid); i += 1) await sleep(150);
  }
  removeState();
  console.log("Image Worker stopped.");
}

try {
  if (process.argv[2] === "start") await start();
  else if (process.argv[2] === "stop") await stop();
  else if (process.argv[2] === "status") {
    const saved = readState();
    console.log(saved?.pid && processAlive(saved.pid) ? `RUNNING PID ${saved.pid}` : "STOPPED");
  } else throw new Error("Usage: worker-service-manager.js start|stop|status");
} catch (error) {
  console.error(`ERROR: ${error.message}`);
  process.exitCode = 1;
}
