import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const packageRoot = path.dirname(fileURLToPath(import.meta.url));
const statePath = path.join(packageRoot, ".gold-demo-server.json");
const host = "127.0.0.1";
const requestedPort = Number(process.env.PORT || 4173);

function demoUrl(port) {
  return `http://${host}:${port}/?demo=1`;
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function readState() {
  if (!existsSync(statePath)) {
    return null;
  }
  try {
    const value = JSON.parse(readFileSync(statePath, "utf8"));
    if (!Number.isInteger(value.pid) || typeof value.token !== "string" || !value.token) {
      return null;
    }
    return value;
  } catch {
    return null;
  }
}

function removeState() {
  if (existsSync(statePath)) {
    unlinkSync(statePath);
  }
}

function probeServer(port, timeout = 900) {
  return new Promise((resolve) => {
    const request = http.get({ host, port, path: "/", timeout }, (response) => {
      response.resume();
      resolve({
        reachable: true,
        statusCode: response.statusCode,
        token: String(response.headers["x-gold-demo-instance"] || ""),
      });
    });
    request.on("timeout", () => request.destroy());
    request.on("error", () => resolve({ reachable: false, statusCode: null, token: "" }));
  });
}

function openBrowser(port) {
  if (process.env.GOLD_DEMO_NO_BROWSER === "1") {
    return;
  }
  const command = process.env.ComSpec || "cmd.exe";
  const opener = spawn(command, ["/d", "/s", "/c", "start", "", demoUrl(port)], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  opener.on("error", () => {});
  opener.unref();
}

async function startService() {
  const saved = readState();
  if (saved) {
    const savedPort = Number.isInteger(saved.port) ? saved.port : requestedPort;
    const savedServer = await probeServer(savedPort);
    if (savedServer.reachable && savedServer.token === saved.token) {
      openBrowser(savedPort);
      console.log(`Demo is already running: ${demoUrl(savedPort)}`);
      return;
    }
  }
  const current = await probeServer(requestedPort);
  if (current.reachable) {
    throw new Error(`Port ${requestedPort} is used by another application.`);
  }
  removeState();

  const token = randomUUID();
  const serverPath = path.join(packageRoot, "server.js");
  const child = spawn(process.execPath, [serverPath], {
    cwd: packageRoot,
    detached: true,
    env: { ...process.env, GOLD_DEMO_INSTANCE_TOKEN: token, PORT: String(requestedPort) },
    stdio: "ignore",
    windowsHide: true,
  });
  await new Promise((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", reject);
  });
  writeFileSync(statePath, JSON.stringify({ pid: child.pid, token, port: requestedPort }, null, 2), "utf8");
  child.unref();

  for (let attempt = 0; attempt < 30; attempt += 1) {
    await sleep(200);
    const status = await probeServer(requestedPort);
    if (status.reachable && status.token === token) {
      openBrowser(requestedPort);
      console.log(`Demo started in background: ${demoUrl(requestedPort)}`);
      return;
    }
  }

  try {
    process.kill(child.pid);
  } catch {}
  removeState();
  throw new Error("The background server did not become ready.");
}

async function stopService() {
  const saved = readState();
  if (!saved) {
    console.log("No package-owned demo server is running.");
    return;
  }

  const savedPort = Number.isInteger(saved.port) ? saved.port : requestedPort;
  const current = await probeServer(savedPort);
  if (!current.reachable) {
    removeState();
    console.log("The demo server had already stopped.");
    return;
  }
  if (current.token !== saved.token) {
    throw new Error("Refusing to stop a server that does not belong to this package.");
  }

  try {
    process.kill(saved.pid);
  } catch (error) {
    if (error.code !== "ESRCH") {
      throw error;
    }
  }
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await sleep(150);
    const status = await probeServer(savedPort);
    if (!status.reachable || status.token !== saved.token) {
      break;
    }
  }
  removeState();
  console.log("Demo server stopped.");
}

const command = process.argv[2];
try {
  if (command === "start") {
    await startService();
  } else if (command === "stop") {
    await stopService();
  } else {
    throw new Error("Usage: service-manager.js start|stop");
  }
} catch (error) {
  console.error(`ERROR: ${error.message}`);
  process.exitCode = 1;
}
