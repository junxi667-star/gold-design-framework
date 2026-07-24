import { spawn } from "node:child_process";

import { createAppServer } from "./server.js";

const host = "127.0.0.1";
const port = Number(process.env.PORT || 4173);
const demoUrl = `http://${host}:${port}/?demo=1`;
const server = createAppServer();

function openBrowser() {
  if (process.env.GOLD_DEMO_NO_BROWSER === "1") {
    return;
  }
  const command = process.env.ComSpec || "cmd.exe";
  const opener = spawn(command, ["/d", "/s", "/c", "start", "", demoUrl], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  opener.unref();
}

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`端口 ${port} 已被其他程序占用，请关闭占用程序后重试。`);
  } else {
    console.error(`本地演示服务启动失败：${error.message}`);
  }
  process.exitCode = 1;
});

server.listen(port, host, () => {
  console.log("黄金产业 AI 智能设计框架已启动。");
  console.log(`演示地址：${demoUrl}`);
  console.log("请保留此窗口；关闭窗口即可停止本地服务。\n");
  openBrowser();
});

process.on("SIGINT", () => {
  server.close(() => process.exit(0));
});
