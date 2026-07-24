const baseUrl = process.env.COMFYUI_BASE_URL || "http://127.0.0.1:8188";
const required = [
  "sd_xl_base_1.0.safetensors",
  "sd_xl_refiner_1.0.safetensors",
];

function fail(message) {
  console.error(`\n检查失败：${message}`);
  process.exitCode = 1;
}

try {
  console.log(`正在检查 ComfyUI：${baseUrl}`);
  const statsResponse = await fetch(`${baseUrl}/system_stats`, { signal: AbortSignal.timeout(5000) });
  if (!statsResponse.ok) throw new Error(`system_stats HTTP ${statsResponse.status}`);
  const stats = await statsResponse.json();
  const device = stats?.devices?.[0];
  console.log("连接成功。");
  console.log(`设备：${device?.name || "未返回设备名称"}`);
  if (device?.vram_total) {
    console.log(`显存总量：${Math.round(device.vram_total / 1024 / 1024)} MB`);
  }

  const objectResponse = await fetch(`${baseUrl}/object_info/CheckpointLoaderSimple`, { signal: AbortSignal.timeout(10000) });
  if (!objectResponse.ok) throw new Error(`object_info HTTP ${objectResponse.status}`);
  const objectInfo = await objectResponse.json();
  const checkpointInfo = objectInfo?.CheckpointLoaderSimple ?? objectInfo;
  const options = checkpointInfo?.input?.required?.ckpt_name?.[0] || [];
  const missing = required.filter((name) => !options.includes(name));
  if (missing.length) {
    fail(`ComfyUI 已连接，但缺少模型：${missing.join("、")}`);
  } else {
    console.log(`模型检查通过：${required.join("、")}`);
    console.log("\n可以启动黄金 AI 项目并切换到“同源后端 API”。");
  }
} catch (error) {
  fail(`无法连接本地 ComfyUI。请先启动 NVIDIA 版 ComfyUI，再重试。\n原因：${error.message}`);
}
