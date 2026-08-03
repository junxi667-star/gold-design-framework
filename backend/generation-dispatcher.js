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
        ? "生图任务由云端 Master 排队，本地 Image Worker 领取执行"
        : this.mode === "direct"
          ? "Master 直接调用图片 API"
          : "优先使用在线 Image Worker；无 Worker 时由 Master 直接调用图片 API",
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
    });
  }
}
