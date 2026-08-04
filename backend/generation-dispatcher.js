export class GenerationDispatcher {
  constructor({ imageProvider, taskBroker } = {}) {
    this.imageProvider = imageProvider;
    this.taskBroker = taskBroker;
    this.mode = String(process.env.IMAGE_EXECUTION_MODE || "worker").trim().toLowerCase();
    if (!["worker", "direct", "hybrid"].includes(this.mode)) this.mode = "worker";
  }

  async status() {
    const broker = this.taskBroker ? await this.taskBroker.status() : null;
    return {
      mode: this.mode,
      directProvider: this.imageProvider?.status?.() || null,
      worker: broker,
      configured: this.mode === "direct"
        ? Boolean(this.imageProvider?.configured)
        : this.mode === "worker"
          ? Boolean(broker)
          : Boolean(this.imageProvider?.configured || broker),
      notice: this.mode === "worker"
        ? "生图任务由调度服务排队，本地生图端自动处理"
        : this.mode === "direct"
          ? "Master API 直接调用图片服务（备用）"
          : "优先使用在线生图端；无生图端时由 Master API 直接调用图片服务（备用）",
    };
  }

  async generate(input) {
    if (this.mode === "direct") return this.imageProvider.generate(input);
    if (this.mode === "hybrid") {
      const online = await this.taskBroker.hasOnlineWorker("seedream");
      if (!online && this.imageProvider?.configured) return this.imageProvider.generate(input);
    }
    return this.taskBroker.enqueueAndWait({
      jobId: input.jobId,
      versionId: input.versionId,
      projectId: input.projectId,
      prompt: input.prompt,
      filenamePrefix: input.filenamePrefix,
      operation: input.operation,
      requiredCapability: "seedream",
    }, {
      // Worker 可以晚些上线。Master 持久化任务并等待远程生图端领取。
      timeoutMs: Math.max(60_000, Number(process.env.WORKER_JOB_WAIT_TIMEOUT_MS || 7 * 24 * 60 * 60 * 1000)),
    });
  }
}
