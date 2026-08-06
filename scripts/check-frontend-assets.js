import { getOutOfSyncFrontendAssets } from "./frontend-assets.js";

const outOfSyncAssets = await getOutOfSyncFrontendAssets();
if (outOfSyncAssets.length) {
  throw new Error(`pages-frontend 与 public 的共享文件不一致：${outOfSyncAssets.join(", ")}。请先运行 npm run sync:frontend。`);
}

console.log("Frontend shared assets are in sync.");
