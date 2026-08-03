import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnvFile } from "../backend/env-loader.js";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
loadEnvFile(root);
const { ArkImageProvider } = await import("../backend/ark-image-provider.js");
const provider = new ArkImageProvider({ generatedDir: path.join(root, "generated") });
console.log("Seedream configuration:", JSON.stringify(provider.status(), null, 2));
if (!provider.configured) {
  console.error("FAILED: Please create .env and fill ARK_API_KEY.");
  process.exit(1);
}
try {
  const result = await provider.generate({
    prompt: "一枚单独的闭合黄金戒指，新中式极简祥云纹，白色背景，高级珠宝产品摄影，不要人物，不要文字，不要多个首饰",
    filenamePrefix: "ark_api_test",
  });
  console.log("SUCCESS");
  console.log(`Saved: ${result.filePath}`);
  console.log(`Request ID: ${result.requestId}`);
} catch (error) {
  console.error(`FAILED: ${error.message}`);
  if (error.details) console.error(JSON.stringify(error.details, null, 2));
  process.exit(1);
}
