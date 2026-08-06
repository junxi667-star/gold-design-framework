import { copyFile, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

export const localFrontendDir = path.join(rootDir, "public");
export const pagesFrontendDir = path.join(rootDir, "pages-frontend");
export const sharedFrontendAssets = Object.freeze([
  "favicon.svg",
  "index.html",
  "styles.css",
  path.join("js", "app.js"),
]);

export async function getOutOfSyncFrontendAssets() {
  const comparisons = await Promise.all(sharedFrontendAssets.map(async (relativePath) => {
    const [local, pages] = await Promise.all([
      readFile(path.join(localFrontendDir, relativePath)),
      readFile(path.join(pagesFrontendDir, relativePath)),
    ]);
    return local.equals(pages) ? null : relativePath;
  }));
  return comparisons.filter(Boolean);
}

export async function syncFrontendAssets() {
  await Promise.all(sharedFrontendAssets.map((relativePath) => copyFile(
    path.join(localFrontendDir, relativePath),
    path.join(pagesFrontendDir, relativePath),
  )));
}
