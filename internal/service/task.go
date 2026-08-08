package service

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode"

	"jewelchain-studio/internal/config"
	"jewelchain-studio/internal/model"
	"jewelchain-studio/internal/repository"
)

const maxWorkerUploadSize = 25 << 20

type TaskBroker struct {
	config     config.Config
	store      *repository.StateStore
	mu         sync.RWMutex
	notifier   func(string)
	completion func(*model.State, model.Record) error
}

func NewTaskBroker(cfg config.Config, store *repository.StateStore) *TaskBroker {
	return &TaskBroker{config: cfg, store: store}
}

func (broker *TaskBroker) SetNotifier(notifier func(string)) {
	broker.mu.Lock()
	defer broker.mu.Unlock()
	broker.notifier = notifier
}

func (broker *TaskBroker) SetCompletionHandler(handler func(*model.State, model.Record) error) {
	broker.mu.Lock()
	defer broker.mu.Unlock()
	broker.completion = handler
}

func (broker *TaskBroker) notify(workerID string) {
	broker.mu.RLock()
	defer broker.mu.RUnlock()
	if broker.notifier != nil {
		broker.notifier(workerID)
	}
}

func (broker *TaskBroker) complete(state *model.State, result model.Record) error {
	broker.mu.RLock()
	handler := broker.completion
	broker.mu.RUnlock()
	if handler != nil {
		return handler(state, model.Clone(result))
	}
	return nil
}

func (broker *TaskBroker) Start(stop <-chan struct{}) {
	slog.Info("task broker sweep started")
	ticker := time.NewTicker(10 * time.Second)
	go func() {
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				_ = broker.Sweep()
			case <-stop:
				return
			}
		}
	}()
}

func (broker *TaskBroker) Sweep() error {
	result, err := broker.store.Update(func(state *model.State) (any, error) {
		now := time.Now().UTC()
		changed := false
		for _, worker := range state.Workers {
			if workerOnline(worker, now, broker.config.WorkerStaleAfter) {
				continue
			}
			if model.String(worker, "status") != "offline" {
				worker["status"] = "offline"
				worker["updatedAt"] = model.Now()
				changed = true
			}
		}
		for _, task := range state.WorkerTasks {
			status := model.String(task, "status")
			if status != "claimed" && status != "running" && status != "uploading" {
				continue
			}
			expires, err := parseTime(model.String(task, "leaseExpiresAt"))
			if err == nil && expires.After(now) {
				continue
			}
			if model.Int(task, "attempts") < model.Int(task, "maxAttempts") {
				task["status"] = "pending"
				task["workerId"], task["leaseId"], task["leaseExpiresAt"] = nil, nil, nil
				task["currentStep"] = "生图端租约过期，任务已重新进入等待队列"
				if job, _ := model.Find(state.Jobs, model.String(task, "jobId")); job != nil {
					job["status"], job["error"], job["currentStep"], job["updatedAt"] = "queued", nil, task["currentStep"], model.Now()
				}
			} else {
				task["status"] = "failed"
				task["workerId"], task["leaseId"], task["leaseExpiresAt"] = nil, nil, nil
				task["lastError"] = model.Record{"code": "WORKER_LEASE_EXPIRED", "message": "生图端租约过期", "retryable": false}
				task["currentStep"] = "生图任务失败"
				if job, _ := model.Find(state.Jobs, model.String(task, "jobId")); job != nil {
					job["status"], job["error"], job["currentStep"], job["updatedAt"] = "failed", task["lastError"], task["currentStep"], model.Now()
				}
			}
			task["updatedAt"] = model.Now()
			changed = true
		}
		return changed, nil
	})
	changed, _ := result.(bool)
	if err == nil && changed {
		slog.Info("task broker sweep state changed")
		broker.notify("")
	}
	return err
}

func (broker *TaskBroker) Status() (model.Record, error) {
	if err := broker.Sweep(); err != nil {
		return nil, err
	}
	state, err := broker.store.Read()
	if err != nil {
		return nil, err
	}
	now := time.Now().UTC()
	workers := make([]any, 0, len(state.Workers))
	onlineWorkers := 0
	for _, worker := range state.Workers {
		copy := model.Clone(worker)
		delete(copy, "source")
		online := workerOnline(worker, now, broker.config.WorkerStaleAfter)
		copy["online"] = online
		if online {
			onlineWorkers++
		}
		workers = append(workers, copy)
	}
	tasks := model.Record{"pending": 0, "active": 0, "completed": 0, "failed": 0}
	for _, task := range state.WorkerTasks {
		switch model.String(task, "status") {
		case "pending":
			tasks["pending"] = model.Int(tasks, "pending") + 1
		case "claimed", "running", "uploading":
			tasks["active"] = model.Int(tasks, "active") + 1
		case "completed":
			tasks["completed"] = model.Int(tasks, "completed") + 1
		case "failed":
			tasks["failed"] = model.Int(tasks, "failed") + 1
		}
	}
	return model.Record{"onlineWorkers": onlineWorkers, "workers": workers, "tasks": tasks, "leaseSeconds": int(broker.config.WorkerLease.Seconds())}, nil
}

func (broker *TaskBroker) HasOnlineWorker(capability string) (bool, error) {
	status, err := broker.Status()
	if err != nil {
		return false, err
	}
	for _, worker := range model.Records(status["workers"]) {
		if model.Bool(worker, "online") && (capability == "" || model.HasString(worker["capabilities"], capability)) {
			return true, nil
		}
	}
	return false, nil
}

func (broker *TaskBroker) RegisterWorker(workerID string, details model.Record, source string) (model.Record, error) {
	if err := validWorkerID(workerID); err != nil {
		return nil, err
	}
	result, err := broker.store.Update(func(state *model.State) (any, error) {
		worker, index := model.Find(state.Workers, workerID)
		now := model.Now()
		if index < 0 {
			worker = model.Record{"id": workerID, "createdAt": now}
			state.Workers = append(state.Workers, worker)
		}
		maxConcurrency := model.Int(details, "maxConcurrency")
		if maxConcurrency < 1 {
			maxConcurrency = 1
		}
		if maxConcurrency > 16 {
			return nil, model.NewError("VALIDATION_FAILED", "maxConcurrency 不能超过 16", 400, false, nil)
		}
		worker["workerVersion"] = model.String(details, "workerVersion")
		worker["capabilities"] = uniqueStrings(model.Strings(details["capabilities"]))
		worker["maxConcurrency"] = maxConcurrency
		worker["status"], worker["lastSeenAt"], worker["updatedAt"] = "online", now, now
		worker["runningTasks"], worker["available"] = max(0, model.Int(details, "runningTasks")), !hasFalse(details, "available")
		worker["cpuUsage"], worker["memoryUsageMb"] = optionalNumber(details, "cpuUsage"), optionalNumber(details, "memoryUsageMb")
		worker["transport"] = firstNonBlank(model.String(details, "transport"), "http")
		worker["source"] = source
		return model.Clone(worker), nil
	})
	if err != nil {
		return nil, err
	}
	broker.notify(workerID)
	slog.Info("worker registered", "worker_id", workerID)
	return result.(model.Record), nil
}

func (broker *TaskBroker) Heartbeat(workerID string, details model.Record) (model.Record, error) {
	result, err := broker.store.Update(func(state *model.State) (any, error) {
		worker, _ := model.Find(state.Workers, workerID)
		if worker == nil {
			return nil, model.NewError("WORKER_NOT_REGISTERED", "Worker 尚未注册", 404, false, nil)
		}
		now := model.Now()
		worker["status"], worker["lastSeenAt"], worker["updatedAt"] = "online", now, now
		worker["runningTasks"], worker["available"] = max(0, model.Int(details, "runningTasks")), !hasFalse(details, "available")
		worker["cpuUsage"], worker["memoryUsageMb"] = optionalNumber(details, "cpuUsage"), optionalNumber(details, "memoryUsageMb")
		if transport := model.String(details, "transport"); transport != "" {
			worker["transport"] = transport
		}
		return model.Clone(worker), nil
	})
	if err != nil {
		return nil, err
	}
	return result.(model.Record), nil
}

func (broker *TaskBroker) MarkWorkerOffline(workerID string) error {
	if workerID == "" {
		return nil
	}
	_, err := broker.store.Update(func(state *model.State) (any, error) {
		worker, _ := model.Find(state.Workers, workerID)
		if worker != nil {
			worker["status"], worker["updatedAt"] = "offline", model.Now()
		}
		return nil, nil
	})
	if err == nil {
		slog.Info("worker marked offline", "worker_id", workerID)
	}
	return err
}

func (broker *TaskBroker) Enqueue(input model.Record) (model.Record, error) {
	jobID := model.String(input, "jobId")
	if jobID == "" {
		return nil, model.NewError("VALIDATION_FAILED", "jobId 不能为空", 400, false, nil)
	}
	result, err := broker.store.Update(func(state *model.State) (any, error) {
		key := "generation:" + jobID
		for _, task := range state.WorkerTasks {
			if model.String(task, "idempotencyKey") == key {
				return model.Clone(task), nil
			}
		}
		now := model.Now()
		task := model.Record{
			"id": model.NewID(), "idempotencyKey": key, "type": "generate-image", "requiredCapability": firstNonBlank(model.String(input, "requiredCapability"), "seedream"),
			"projectId": model.String(input, "projectId"), "versionId": model.String(input, "versionId"), "jobId": jobID,
			"payload": model.Record{"prompt": model.String(input, "prompt"), "filenamePrefix": model.String(input, "filenamePrefix"), "operation": model.String(input, "operation")},
			"status":  "pending", "progress": 0, "currentStep": "等待生图端处理任务", "workerId": nil, "leaseId": nil, "leaseExpiresAt": nil,
			"attempts": 0, "maxAttempts": broker.config.WorkerMaxAttempt, "result": nil, "lastError": nil, "createdAt": now, "updatedAt": now,
		}
		state.WorkerTasks = append(state.WorkerTasks, task)
		if job, _ := model.Find(state.Jobs, jobID); job != nil {
			job["status"], job["progress"], job["currentStep"], job["updatedAt"] = "queued", max(model.Int(job, "progress"), 30), "任务已进入等待队列，生图端上线后会自动处理", now
		}
		return model.Clone(task), nil
	})
	if err != nil {
		return nil, err
	}
	broker.notify("")
	task := result.(model.Record)
	slog.Info("task enqueued", "task_id", model.String(task, "id"), "job_id", jobID)
	return task, nil
}

func (broker *TaskBroker) ClaimTask(workerID string) (model.Record, error) {
	if err := broker.Sweep(); err != nil {
		return nil, err
	}
	result, err := broker.store.Update(func(state *model.State) (any, error) {
		now := time.Now().UTC()
		worker, _ := model.Find(state.Workers, workerID)
		if worker == nil || !workerOnline(worker, now, broker.config.WorkerStaleAfter) {
			return nil, model.NewError("WORKER_NOT_ONLINE", "Worker 不在线或未注册", 409, false, nil)
		}
		active := 0
		for _, task := range state.WorkerTasks {
			if model.String(task, "workerId") == workerID && activeTask(task) {
				active++
			}
		}
		if active >= max(1, model.Int(worker, "maxConcurrency")) {
			return nil, nil
		}
		candidates := make([]model.Record, 0)
		for _, task := range state.WorkerTasks {
			if model.String(task, "status") == "pending" && (model.String(task, "requiredCapability") == "" || model.HasString(worker["capabilities"], model.String(task, "requiredCapability"))) {
				candidates = append(candidates, task)
			}
		}
		if len(candidates) == 0 {
			return nil, nil
		}
		sort.SliceStable(candidates, func(i, j int) bool {
			return model.String(candidates[i], "createdAt") < model.String(candidates[j], "createdAt")
		})
		task := candidates[0]
		task["status"], task["workerId"], task["leaseId"] = "claimed", workerID, model.NewID()
		task["leaseExpiresAt"] = now.Add(broker.config.WorkerLease).Format(time.RFC3339Nano)
		task["attempts"] = model.Int(task, "attempts") + 1
		task["progress"] = max(5, model.Int(task, "progress"))
		task["currentStep"], task["updatedAt"] = "生图端 "+workerID+" 已开始处理任务", model.Now()
		return model.Clone(task), nil
	})
	if err != nil || result == nil {
		return nil, err
	}
	task := result.(model.Record)
	slog.Info("task claimed", "task_id", model.String(task, "id"), "worker_id", workerID)
	return task, nil
}

func (broker *TaskBroker) RenewTask(taskID, workerID, leaseID string) (model.Record, error) {
	return broker.withLease(taskID, workerID, leaseID, func(state *model.State, task model.Record) (model.Record, error) {
		expires := time.Now().UTC().Add(broker.config.WorkerLease).Format(time.RFC3339Nano)
		task["leaseExpiresAt"], task["updatedAt"] = expires, model.Now()
		return model.Record{"taskId": taskID, "leaseId": leaseID, "leaseExpiresAt": expires}, nil
	})
}

func (broker *TaskBroker) UpdateProgress(taskID, workerID, leaseID string, details model.Record) (model.Record, error) {
	return broker.withLease(taskID, workerID, leaseID, func(state *model.State, task model.Record) (model.Record, error) {
		progress := min(95, max(0, model.Int(details, "progress")))
		if progress >= 80 {
			task["status"] = "uploading"
		} else {
			task["status"] = "running"
		}
		task["progress"] = max(model.Int(task, "progress"), progress)
		if message := model.String(details, "message"); message != "" {
			task["currentStep"] = message
		}
		task["leaseExpiresAt"], task["updatedAt"] = time.Now().UTC().Add(broker.config.WorkerLease).Format(time.RFC3339Nano), model.Now()
		if job, _ := model.Find(state.Jobs, model.String(task, "jobId")); job != nil {
			job["status"], job["progress"], job["currentStep"], job["updatedAt"] = "running", max(model.Int(job, "progress"), min(90, model.Int(task, "progress"))), task["currentStep"], model.Now()
		}
		return model.Clone(task), nil
	})
}

func (broker *TaskBroker) StoreUpload(taskID, workerID, leaseID string, bytes []byte, filename, mimeType, digest string) (model.Record, error) {
	if len(bytes) == 0 {
		return nil, model.NewError("WORKER_UPLOAD_EMPTY", "上传图片为空", 400, false, nil)
	}
	if len(bytes) > maxWorkerUploadSize {
		return nil, model.NewError("BODY_TOO_LARGE", "上传图片超过 25 MiB 限制", 413, false, nil)
	}
	actualMIME, extension, ok := imageType(bytes)
	if !ok {
		return nil, model.NewError("WORKER_UPLOAD_UNSUPPORTED_IMAGE", "仅支持 PNG、JPEG 或 WebP 图片上传", 415, false, nil)
	}
	if declared := normalizeMIME(mimeType); declared != "" && declared != actualMIME {
		return nil, model.NewError("WORKER_UPLOAD_MIME_MISMATCH", "上传图片的 Content-Type 与实际文件不一致", 415, false, nil)
	}
	hash := sha256.Sum256(bytes)
	actualSHA := hex.EncodeToString(hash[:])
	if digest != "" && !strings.EqualFold(strings.TrimSpace(digest), actualSHA) {
		return nil, model.NewError("WORKER_UPLOAD_HASH_MISMATCH", "上传图片 SHA-256 校验失败", 409, false, nil)
	}
	clean := safeFilename(filename)
	stem := strings.TrimSuffix(clean, filepath.Ext(clean))
	if stem == "" {
		stem = "image"
	}
	uploadID := model.NewID()
	name := taskID + "_" + uploadID + "_" + stem + extension
	if err := os.MkdirAll(broker.config.WorkerUploadDir, 0o755); err != nil {
		return nil, fmt.Errorf("create upload directory: %w", err)
	}
	if err := os.MkdirAll(broker.config.GeneratedDir, 0o755); err != nil {
		return nil, fmt.Errorf("create generated directory: %w", err)
	}
	temporary := filepath.Join(broker.config.WorkerUploadDir, uploadID+".part")
	target := filepath.Join(broker.config.GeneratedDir, name)
	if err := writeUploadStaging(temporary, bytes); err != nil {
		return nil, fmt.Errorf("write worker upload: %w", err)
	}
	result, err := broker.withLease(taskID, workerID, leaseID, func(state *model.State, task model.Record) (model.Record, error) {
		for _, existing := range state.WorkerUploads {
			if model.String(existing, "taskId") == taskID && model.String(existing, "workerId") == workerID && model.String(existing, "leaseId") == leaseID {
				return model.Clone(existing), nil
			}
		}
		if err := os.Rename(temporary, target); err != nil {
			return nil, fmt.Errorf("move worker upload: %w", err)
		}
		upload := model.Record{"id": uploadID, "taskId": taskID, "workerId": workerID, "leaseId": leaseID, "filename": name, "filePath": target, "imageUrl": "/generated/" + name, "mimeType": actualMIME, "sizeBytes": len(bytes), "sha256": actualSHA, "createdAt": model.Now()}
		state.WorkerUploads = append(state.WorkerUploads, upload)
		task["status"], task["progress"], task["currentStep"], task["updatedAt"] = "uploading", max(90, model.Int(task, "progress")), "图片已上传到调度服务，正在保存结果", model.Now()
		return model.Clone(upload), nil
	})
	_ = os.Remove(temporary)
	if err != nil {
		_ = os.Remove(target)
		return nil, err
	}
	return result, nil
}

func (broker *TaskBroker) CompleteTask(taskID, workerID, leaseID string, details model.Record) (model.Record, error) {
	var completion model.Record
	result, err := broker.withLease(taskID, workerID, leaseID, func(state *model.State, task model.Record) (model.Record, error) {
		uploadID := model.String(details, "uploadId")
		var upload model.Record
		for _, item := range state.WorkerUploads {
			if model.String(item, "id") == uploadID && model.String(item, "taskId") == taskID && model.String(item, "workerId") == workerID && model.String(item, "leaseId") == leaseID {
				upload = item
				break
			}
		}
		if upload == nil {
			return nil, model.NewError("WORKER_UPLOAD_NOT_FOUND", "找不到本次任务上传的图片", 409, false, nil)
		}
		completion = model.Record{
			"requestId": firstNonBlank(model.String(details, "requestId"), model.NewID()), "filename": upload["filename"], "filePath": upload["filePath"], "imageUrl": upload["imageUrl"], "mimeType": upload["mimeType"], "sizeBytes": upload["sizeBytes"], "sha256": upload["sha256"],
			"modelProvider": firstNonBlank(model.String(details, "modelProvider"), "Image Worker"), "modelName": firstNonBlank(model.String(details, "modelName"), "unknown"), "imageSize": details["imageSize"], "workerId": workerID, "taskId": taskID,
		}
		task["status"], task["progress"], task["currentStep"], task["result"], task["leaseExpiresAt"], task["updatedAt"] = "completed", 100, "生图端已完成任务", completion, nil, model.Now()
		if err := broker.complete(state, completion); err != nil {
			return nil, err
		}
		return model.Clone(task), nil
	})
	if err != nil {
		return nil, err
	}
	broker.notify(workerID)
	slog.Info("task completed", "task_id", taskID, "worker_id", workerID)
	return result, nil
}

func writeUploadStaging(path string, payload []byte) error {
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return err
	}
	if _, err := file.Write(payload); err != nil {
		_ = file.Close()
		return err
	}
	if err := file.Sync(); err != nil {
		_ = file.Close()
		return err
	}
	return file.Close()
}

func (broker *TaskBroker) FailTask(taskID, workerID, leaseID string, details model.Record) (model.Record, error) {
	result, err := broker.withLease(taskID, workerID, leaseID, func(state *model.State, task model.Record) (model.Record, error) {
		canRetry := model.Bool(details, "retryable") && model.Int(task, "attempts") < model.Int(task, "maxAttempts")
		message := firstNonBlank(model.String(details, "errorMessage"), "Image Worker 执行失败")
		lastError := model.Record{"code": firstNonBlank(model.String(details, "errorCode"), "WORKER_EXECUTION_FAILED"), "message": message, "retryable": canRetry}
		if canRetry {
			task["status"] = "pending"
			task["currentStep"] = "生图端执行失败，任务已重新进入等待队列"
		} else {
			task["status"] = "failed"
			task["currentStep"] = "生图任务失败"
		}
		task["workerId"], task["leaseId"], task["leaseExpiresAt"], task["lastError"], task["updatedAt"] = nil, nil, nil, lastError, model.Now()
		if job, _ := model.Find(state.Jobs, model.String(task, "jobId")); job != nil {
			if canRetry {
				job["status"], job["error"] = "queued", nil
			} else {
				job["status"], job["error"] = "failed", lastError
			}
			job["currentStep"], job["updatedAt"] = task["currentStep"], model.Now()
		}
		return model.Clone(task), nil
	})
	if err != nil {
		return nil, err
	}
	broker.notify("")
	slog.Error("task failed", "task_id", taskID, "worker_id", workerID, "error", model.String(details, "errorMessage"))
	return result, nil
}

func (broker *TaskBroker) withLease(taskID, workerID, leaseID string, mutator func(*model.State, model.Record) (model.Record, error)) (model.Record, error) {
	result, err := broker.store.Update(func(state *model.State) (any, error) {
		task, _ := model.Find(state.WorkerTasks, taskID)
		if task == nil {
			return nil, model.NewError("WORKER_TASK_NOT_FOUND", "Worker 任务不存在", 404, false, nil)
		}
		if model.String(task, "workerId") != workerID || model.String(task, "leaseId") != leaseID {
			return nil, model.NewError("WORKER_LEASE_MISMATCH", "Worker 租约不匹配", 409, false, nil)
		}
		status := model.String(task, "status")
		if status != "claimed" && status != "running" && status != "uploading" {
			return nil, model.NewError("WORKER_TASK_STATE_INVALID", "当前任务状态不允许该操作", 409, false, model.Record{"status": status})
		}
		expires, err := parseTime(model.String(task, "leaseExpiresAt"))
		if err != nil || !expires.After(time.Now().UTC()) {
			return nil, model.NewError("WORKER_LEASE_EXPIRED", "Worker 租约已经过期", 409, true, nil)
		}
		return mutator(state, task)
	})
	if err != nil {
		return nil, err
	}
	return result.(model.Record), nil
}

func workerOnline(worker model.Record, now time.Time, staleAfter time.Duration) bool {
	if model.String(worker, "status") != "online" {
		return false
	}
	seen, err := parseTime(model.String(worker, "lastSeenAt"))
	return err == nil && seen.Add(staleAfter).After(now)
}

func activeTask(task model.Record) bool {
	status := model.String(task, "status")
	return status == "claimed" || status == "running" || status == "uploading"
}
func parseTime(value string) (time.Time, error) { return time.Parse(time.RFC3339Nano, value) }
func firstNonBlank(values ...string) string {
	for _, value := range values {
		if value = strings.TrimSpace(value); value != "" {
			return value
		}
	}
	return ""
}
func hasFalse(record model.Record, key string) bool {
	value, exists := record[key]
	return exists && value == false
}
func optionalNumber(record model.Record, key string) any {
	if _, exists := record[key]; !exists {
		return nil
	}
	return model.Number(record, key)
}

func validWorkerID(workerID string) error {
	if workerID == "" || len(workerID) > 128 {
		return model.NewError("VALIDATION_FAILED", "workerId 长度必须为 1 到 128", 400, false, nil)
	}
	for _, char := range workerID {
		if !(unicode.IsLetter(char) || unicode.IsDigit(char) || char == '-' || char == '_' || char == '.') {
			return model.NewError("VALIDATION_FAILED", "workerId 包含无效字符", 400, false, nil)
		}
	}
	return nil
}

func safeFilename(name string) string {
	if name == "" {
		return "image.png"
	}
	var builder strings.Builder
	for _, char := range filepath.Base(name) {
		if unicode.IsLetter(char) || unicode.IsDigit(char) || char == '.' || char == '-' || char == '_' {
			builder.WriteRune(char)
		} else {
			builder.WriteRune('_')
		}
	}
	result := strings.Trim(builder.String(), ".")
	if result == "" {
		return "image.png"
	}
	if len(result) > 120 {
		return result[:120]
	}
	return result
}

func imageType(bytes []byte) (mime, extension string, ok bool) {
	if len(bytes) >= 8 && string(bytes[:8]) == "\x89PNG\r\n\x1a\n" {
		return "image/png", ".png", true
	}
	if len(bytes) >= 3 && bytes[0] == 0xff && bytes[1] == 0xd8 && bytes[2] == 0xff {
		return "image/jpeg", ".jpg", true
	}
	if len(bytes) >= 12 && string(bytes[:4]) == "RIFF" && string(bytes[8:12]) == "WEBP" {
		return "image/webp", ".webp", true
	}
	return "", "", false
}

func normalizeMIME(value string) string {
	value = strings.ToLower(strings.TrimSpace(strings.Split(value, ";")[0]))
	switch value {
	case "image/png", "image/jpeg", "image/webp":
		return value
	default:
		return ""
	}
}
