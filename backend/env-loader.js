import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

function stripQuotes(value) {
  const trimmed = String(value ?? "").trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export function loadEnvFile(baseDir) {
  const envPath = path.join(baseDir, ".env");
  if (!existsSync(envPath)) return { loaded: false, path: envPath };
  const content = readFileSync(envPath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (!key || process.env[key] !== undefined) continue;
    const value = stripQuotes(line.slice(eq + 1));
    process.env[key] = value;
  }
  return { loaded: true, path: envPath };
}
