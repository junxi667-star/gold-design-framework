import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { detectImageType, normalizeImageMimeType } from "./media/image-type.js";
import { clone, iso } from "./utils.js";
import {
  createAppError,
  TASK_BROKER_ERROR,
  LEASE_EXPIRED,
  WORKER_NOT_REGISTERED,
  WORKER_WAIT_TIMEOUT,
  WORKER_NOT_ONLINE,
  WORKER_TASK_NOT_FOUND,
  WORKER_LEASE_MISMATCH,
  WORKER_TASK_STATE_INVALID,
  WORKER_LEASE_EXPIRED,
  WORKER_UPLOAD_EMPTY,
  WORKER_UPLOAD_UNSUPPORTED_IMAGE,
  WORKER_UPLOAD_MIME_MISMATCH,
  WORKER_UPLOAD_HASH_MISMATCH,
  WORKER_UPLOAD_NOT_FOUND,
  WORKER_TASK_FAILED,
  WORKER_EXECUTION_FAILED,
  WORKER_ID_REQUIRED,
} from "./error-codes.js";

function brokerError(message, { code = TASK_BROKER_ERROR, httpStatus, retryable, details } = {}) {
  return createAppError(code, { message, httpStatus, retryable, details });
}

function timestamp(value) {
  const time = Date.parse(value || "");
  return Number.isFinite(time) ? time : 0;
}

function workerOnline(worker, now = Date.now()) {
  return worker?.status === "online" && now - timestamp(worker.lastSeenAt) <= 90_000;
}

function safeFileName(value) {
  return String(value || "image.png").replace(/[^A-Za-z0-9._-]/g, "_").slice(-160) || "image.png";
}

export class TaskBroker {
  constructor({ store, generatedDir, uploadDir } = {}) {
    this.store = store;
    this.generatedDir = generatedDir;
    this.uploadDir = uploadDir;
    this.leaseSeconds = Math.max(30, Number(process.env.WORKER_LEASE_SECONDS || 120));
    this.maxAttempts = Math.max(1, Number(process.env.WORKER_TASK_MAX_ATTEMPTS || 3));
    this.waiters = new Map();
    this.notifier = null;
    this.sweepTimer = null;
  }

  setNotifier(callback) {
    this.notifier = typeof callback === "function" ? callback : null;
  }

  start() {
    if (this.sweepTimer) return;
    this.sweepTimer = setInterval(() => this.sweep().catch(() => {}), 10_000);
    this.sweepTimer.unref?.();
  }

  stop() {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    this.sweepTimer = null;
  }

  async sweep() {
    const now = Date.now();
    let shouldNotify = false;
    await this.store.update((state) => {
      for (const worker of state.workers || []) {
        if (worker.status === "online" && !workerOnline(worker, now)) worker.status = "offline";
      }
      for (const task of state.workerTasks || []) {
        if (["claimed", "running", "uploading"].includes(task.status) && timestamp(task.leaseExpiresAt) <= now) {
          task.status = task.attempts >= task.maxAttempts ? "failed" : "pending";
          task.workerId = null;
          task.leaseId = null;
          task.leaseExpiresAt = null;
          task.lastError = task.attempts >= task.maxAttempts
            ? { code: LEASE_EXPIRED, message: "Worker 租约多次过期，任务终止", retryable: false }
            : { code: LEASE_EXPIRED, message: "Worker 租约过期，任务已重新排队", retryable: true };
          task.currentStep = task.lastError.message;
          task.updatedAt = iso();
          const job = (state.jobs || []).find((item) => item.id === task.jobId);
          if (job) {
            job.status = task.status === "failed" ? "failed" : "queued";
            job.currentStep = task.currentStep || task.lastError.message;
            if (task.status === "failed") job.error = task.lastError;
            job.updatedAt = iso();
          }
          shouldNotify ||= task.status === "pending";
          if (task.status === "failed") this.rejectWaiter(task.id, brokerError(task.lastError.message, { code: task.lastError.code, httpStatus: 502 }));
        }
      }
      return null;
    });
    if (shouldNotify) this.notifier?.();
  }

  async registerWorker({ workerId, workerVersion, capabilities = [], maxConcurrency = 1, transport = "http", source = "unknown" } = {}) {
    const id = String(workerId || "").trim();
    if (!id) throw brokerError("workerId 不能为空", { code: WORKER_ID_REQUIRED });
    const now = iso();
    const worker = await this.store.update((state) => {
      state.workers ||= [];
      let current = state.workers.find((item) => item.id === id);
      if (!current) {
        current = { id, createdAt: now };
        state.workers.push(current);
      }
      Object.assign(current, {
        workerVersion: String(workerVersion || "unknown"),
        capabilities: [...new Set((Array.isArray(capabilities) ? capabilities : []).map(String))],
        maxConcurrency: Math.max(1, Number(maxConcurrency || 1)),
        transport,
        source,
        status: "online",
        lastSeenAt: now,
        updatedAt: now,
      });
      return current;
    });
    this.notifier?.(id);
    return worker;
  }

  async heartbeat(workerId, details = {}) {
    const now = iso();
    return this.store.update((state) => {
      const worker = (state.workers || []).find((item) => item.id === workerId);
      if (!worker) throw brokerError("Worker 尚未注册", { code: WORKER_NOT_REGISTERED, httpStatus: 404 });
      Object.assign(worker, {
        status: "online",
        lastSeenAt: now,
        updatedAt: now,
        runningTasks: Math.max(0, Number(details.runningTasks || 0)),
        available: details.available !== false,
        cpuUsage: Number.isFinite(Number(details.cpuUsage)) ? Number(details.cpuUsage) : null,
        memoryUsageMb: Number.isFinite(Number(details.memoryUsageMb)) ? Number(details.memoryUsageMb) : null,
        transport: details.transport || worker.transport,
      });
      return worker;
    });
  }

  async markWorkerOffline(workerId) {
    if (!workerId) return;
    await this.store.update((state) => {
      const worker = (state.workers || []).find((item) => item.id === workerId);
      if (worker) {
        worker.status = "offline";
        worker.updatedAt = iso();
      }
      return null;
    });
  }

  async status() {
    await this.sweep();
    const state = await this.store.read();
    const now = Date.now();
    const workers = (state.workers || []).map((worker) => {
      const copy = clone(worker);
      delete copy.source;
      return { ...copy, online: workerOnline(worker, now) };
    });
    const tasks = state.workerTasks || [];
    return {
      onlineWorkers: workers.filter((item) => item.online).length,
      workers,
      tasks: {
        pending: tasks.filter((item) => item.status === "pending").length,
        active: tasks.filter((item) => ["claimed", "running", "uploading"].includes(item.status)).length,
        completed: tasks.filter((item) => item.status === "completed").length,
        failed: tasks.filter((item) => item.status === "failed").length,
      },
      leaseSeconds: this.leaseSeconds,
    };
  }

  async hasOnlineWorker(requiredCapability = null) {
    const summary = await this.status();
    return summary.workers.some((worker) => worker.online && (!requiredCapability || worker.capabilities.includes(requiredCapability)));
  }

  async enqueueGeneration({ jobId, versionId, projectId, prompt, filenamePrefix, operation, requiredCapability = "seedream" } = {}) {
    const idempotencyKey = `generation:${jobId}`;
    const now = iso();
    const task = await this.store.update((state) => {
      state.workerTasks ||= [];
      const existing = state.workerTasks.find((item) => item.idempotencyKey === idempotencyKey);
      if (existing) return existing;
      const created = {
        id: randomUUID(),
        idempotencyKey,
        type: "generate-image",
        requiredCapability,
        projectId,
        versionId,
        jobId,
        payload: { prompt, filenamePrefix, operation },
        status: "pending",
        progress: 0,
        currentStep: "等待生图端处理任务",
        workerId: null,
        leaseId: null,
        leaseExpiresAt: null,
        attempts: 0,
        maxAttempts: this.maxAttempts,
        result: null,
        lastError: null,
        createdAt: now,
        updatedAt: now,
      };
      state.workerTasks.push(created);
      const job = state.jobs.find((item) => item.id === jobId);
      if (job) {
        job.status = "queued";
        job.progress = Math.max(job.progress || 0, 30);
        job.currentStep = "任务已进入等待队列，生图端上线后会自动处理";
        job.updatedAt = now;
      }
      return created;
    });
    this.notifier?.();
    return task;
  }

  async enqueueAndWait(input, { timeoutMs = 60 * 60 * 1000 } = {}) {
    const task = await this.enqueueGeneration(input);
    if (task.status === "completed") return clone(task.result);
    if (task.status === "failed") throw brokerError(task.lastError?.message || "生图任务失败", { code: task.lastError?.code || WORKER_TASK_FAILED, httpStatus: 502 });
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        const entries = this.waiters.get(task.id) || [];
        this.waiters.set(task.id, entries.filter((item) => item.resolve !== resolve));
        reject(brokerError("等待生图端超时，任务仍保留在云端队列中", {
          code: WORKER_WAIT_TIMEOUT,
          httpStatus: 504,
          retryable: true,
          details: { taskId: task.id },
        }));
      }, timeoutMs);
      timeout.unref?.();
      const entries = this.waiters.get(task.id) || [];
      entries.push({ resolve, reject, timeout });
      this.waiters.set(task.id, entries);
    });
  }

  resolveWaiter(taskId, result) {
    const entries = this.waiters.get(taskId) || [];
    this.waiters.delete(taskId);
    for (const entry of entries) {
      clearTimeout(entry.timeout);
      entry.resolve(clone(result));
    }
  }

  rejectWaiter(taskId, error) {
    const entries = this.waiters.get(taskId) || [];
    this.waiters.delete(taskId);
    for (const entry of entries) {
      clearTimeout(entry.timeout);
      entry.reject(error);
    }
  }

  async claimTask(workerId) {
    await this.sweep();
    const now = Date.now();
    const claimed = await this.store.update((state) => {
      const worker = (state.workers || []).find((item) => item.id === workerId);
      if (!worker || !workerOnline(worker, now)) throw brokerError("Worker 不在线或未注册", { code: WORKER_NOT_ONLINE, httpStatus: 409 });
      const activeCount = (state.workerTasks || []).filter((item) => item.workerId === workerId && ["claimed", "running", "uploading"].includes(item.status)).length;
      if (activeCount >= Math.max(1, Number(worker.maxConcurrency || 1))) return null;
      const task = (state.workerTasks || [])
        .filter((item) => item.status === "pending" && (!item.requiredCapability || worker.capabilities.includes(item.requiredCapability)))
        .sort((a, b) => timestamp(a.createdAt) - timestamp(b.createdAt))[0];
      if (!task) return null;
      task.status = "claimed";
      task.workerId = workerId;
      task.leaseId = randomUUID();
      task.leaseExpiresAt = new Date(Date.now() + this.leaseSeconds * 1000).toISOString();
      task.attempts += 1;
      task.progress = Math.max(5, Number(task.progress || 0));
      task.currentStep = `生图端 ${workerId} 已开始处理任务`;
      task.updatedAt = iso();
      return task;
    });
    return claimed ? clone(claimed) : null;
  }

  async validateLease(taskId, workerId, leaseId, allowedStatuses = ["claimed", "running", "uploading"]) {
    const state = await this.store.read();
    const task = (state.workerTasks || []).find((item) => item.id === taskId);
    if (!task) throw brokerError("Worker 任务不存在", { code: WORKER_TASK_NOT_FOUND, httpStatus: 404 });
    if (task.workerId !== workerId || task.leaseId !== leaseId) throw brokerError("Worker 租约不匹配", { code: WORKER_LEASE_MISMATCH, httpStatus: 409 });
    if (!allowedStatuses.includes(task.status)) throw brokerError("当前任务状态不允许该操作", { code: WORKER_TASK_STATE_INVALID, httpStatus: 409, details: { status: task.status } });
    if (timestamp(task.leaseExpiresAt) <= Date.now()) throw brokerError("Worker 租约已经过期", { code: WORKER_LEASE_EXPIRED, httpStatus: 409, retryable: true });
    return task;
  }

  async renewTask(taskId, workerId, leaseId) {
    await this.validateLease(taskId, workerId, leaseId);
    return this.store.update((state) => {
      const task = state.workerTasks.find((item) => item.id === taskId);
      task.leaseExpiresAt = new Date(Date.now() + this.leaseSeconds * 1000).toISOString();
      task.updatedAt = iso();
      return { taskId, leaseId, leaseExpiresAt: task.leaseExpiresAt };
    });
  }

  async updateProgress(taskId, workerId, leaseId, { progress, message } = {}) {
    await this.validateLease(taskId, workerId, leaseId);
    return this.store.update((state) => {
      const task = state.workerTasks.find((item) => item.id === taskId);
      task.status = Number(progress || 0) >= 80 ? "uploading" : "running";
      task.progress = Math.max(task.progress || 0, Math.min(95, Number(progress || 0)));
      task.currentStep = String(message || task.currentStep || "生图端正在处理");
      task.leaseExpiresAt = new Date(Date.now() + this.leaseSeconds * 1000).toISOString();
      task.updatedAt = iso();
      const job = state.jobs.find((item) => item.id === task.jobId);
      if (job) {
        job.status = "running";
        job.progress = Math.max(job.progress || 0, Math.min(90, task.progress));
        job.currentStep = task.currentStep;
        job.updatedAt = iso();
      }
      return task;
    });
  }

  async storeUpload(taskId, workerId, leaseId, bytes, { filename, mimeType, sha256 } = {}) {
    await this.validateLease(taskId, workerId, leaseId);
    if (!Buffer.isBuffer(bytes) || !bytes.length) throw brokerError("上传图片为空", { code: WORKER_UPLOAD_EMPTY });
    const imageType = detectImageType(bytes);
    if (!imageType) {
      throw brokerError("仅支持 PNG、JPEG 或 WebP 图片上传", {
        code: WORKER_UPLOAD_UNSUPPORTED_IMAGE,
        httpStatus: 415,
      });
    }
    const declaredMimeType = normalizeImageMimeType(mimeType);
    if (declaredMimeType && declaredMimeType !== imageType.mimeType) {
      throw brokerError("上传图片的 Content-Type 与实际文件不一致", {
        code: WORKER_UPLOAD_MIME_MISMATCH,
        httpStatus: 415,
      });
    }
    const actualSha = createHash("sha256").update(bytes).digest("hex");
    if (sha256 && actualSha.toLowerCase() !== String(sha256).toLowerCase()) {
      throw brokerError("上传图片 SHA-256 校验失败", { code: WORKER_UPLOAD_HASH_MISMATCH, httpStatus: 409 });
    }
    await mkdir(this.uploadDir, { recursive: true });
    await mkdir(this.generatedDir, { recursive: true });
    const originalName = safeFileName(filename);
    const stem = originalName.replace(/\.[^.]+$/, "") || "image";
    const cleanName = `${taskId}_${stem}${imageType.extension}`;
    const temporary = path.join(this.uploadDir, `${cleanName}.part`);
    const target = path.join(this.generatedDir, cleanName);
    await writeFile(temporary, bytes);
    await rename(temporary, target);
    const info = await stat(target);
    const upload = {
      id: randomUUID(),
      taskId,
      workerId,
      filename: cleanName,
      filePath: target,
      imageUrl: `/generated/${encodeURIComponent(cleanName)}`,
      mimeType: imageType.mimeType,
      sizeBytes: info.size,
      sha256: actualSha,
      createdAt: iso(),
    };
    await this.store.update((state) => {
      state.workerUploads ||= [];
      state.workerUploads.push(upload);
      const task = state.workerTasks.find((item) => item.id === taskId);
      task.status = "uploading";
      task.progress = Math.max(task.progress || 0, 90);
      task.currentStep = "图片已上传到调度服务，正在保存结果";
      task.updatedAt = iso();
      return null;
    });
    return upload;
  }

  async completeTask(taskId, workerId, leaseId, { uploadId, requestId, modelProvider, modelName, imageSize } = {}) {
    await this.validateLease(taskId, workerId, leaseId);
    const completed = await this.store.update((state) => {
      const task = state.workerTasks.find((item) => item.id === taskId);
      const upload = (state.workerUploads || []).find((item) => item.id === uploadId && item.taskId === taskId);
      if (!upload) throw brokerError("找不到本次任务上传的图片", { code: WORKER_UPLOAD_NOT_FOUND, httpStatus: 409 });
      const result = {
        requestId: requestId || randomUUID(),
        filename: upload.filename,
        filePath: upload.filePath,
        imageUrl: upload.imageUrl,
        mimeType: upload.mimeType,
        sizeBytes: upload.sizeBytes,
        sha256: upload.sha256,
        modelProvider: modelProvider || "Image Worker",
        modelName: modelName || "unknown",
        imageSize: imageSize || null,
        workerId,
        taskId,
      };
      task.status = "completed";
      task.progress = 100;
      task.currentStep = "生图端已完成任务";
      task.result = result;
      task.leaseExpiresAt = null;
      task.updatedAt = iso();
      return { task: clone(task), result };
    });
    this.resolveWaiter(taskId, completed.result);
    this.notifier?.(workerId);
    return completed.task;
  }

  async failTask(taskId, workerId, leaseId, { errorCode, errorMessage, retryable = false } = {}) {
    await this.validateLease(taskId, workerId, leaseId);
    const result = await this.store.update((state) => {
      const task = state.workerTasks.find((item) => item.id === taskId);
      const canRetry = Boolean(retryable) && task.attempts < task.maxAttempts;
      task.status = canRetry ? "pending" : "failed";
      task.workerId = null;
      task.leaseId = null;
      task.leaseExpiresAt = null;
      task.lastError = {
        code: String(errorCode || WORKER_EXECUTION_FAILED),
        message: String(errorMessage || "Image Worker 执行失败"),
        retryable: canRetry,
      };
      task.currentStep = canRetry ? "生图端执行失败，任务已重新进入等待队列" : "生图任务失败";
      task.updatedAt = iso();
      const job = (state.jobs || []).find((item) => item.id === task.jobId);
      if (job) {
        job.status = canRetry ? "queued" : "failed";
        job.currentStep = task.currentStep;
        job.error = canRetry ? null : task.lastError;
        job.updatedAt = iso();
      }
      return clone(task);
    });
    if (result.status === "failed") {
      this.rejectWaiter(taskId, brokerError(result.lastError.message, { code: result.lastError.code, httpStatus: 502, retryable: false }));
    } else {
      this.notifier?.();
    }
    return result;
  }

  async taskForWorker(taskId, workerId) {
    const state = await this.store.read();
    const task = (state.workerTasks || []).find((item) => item.id === taskId && item.workerId === workerId);
    return task ? clone(task) : null;
  }
}
