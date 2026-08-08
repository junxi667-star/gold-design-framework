// Package worker implements the remote Image Worker protocol used by the
// JewelChain Master. It deliberately uses the public HTTP/WebSocket contract
// so the worker can run on a separate machine that holds the Ark credential.
package worker

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"runtime"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gorilla/websocket"

	"jewelchain-studio/internal/config"
	"jewelchain-studio/internal/model"
	"jewelchain-studio/internal/service"
)

const (
	heartbeatInterval = 30 * time.Second
	reconnectDelay    = 5 * time.Second
	writeTimeout      = 10 * time.Second
)

// Daemon is a single-concurrency Image Worker. The Master is responsible for
// task leases and accepts both the WebSocket push path and HTTP polling path.
type Daemon struct {
	config     config.Config
	generator  service.ImageGenerator
	client     *http.Client
	logger     *slog.Logger
	workerID   string
	busy       atomic.Bool
	registered atomic.Bool

	socketMu sync.RWMutex
	socket   *workerSocket
}

type workerSocket struct {
	connection *websocket.Conn
	mu         sync.Mutex
}

func (socket *workerSocket) send(value any) error {
	socket.mu.Lock()
	defer socket.mu.Unlock()
	if err := socket.connection.SetWriteDeadline(time.Now().Add(writeTimeout)); err != nil {
		return err
	}
	err := socket.connection.WriteJSON(value)
	_ = socket.connection.SetWriteDeadline(time.Time{})
	return err
}

// New returns a Worker configured from the same environment names as the
// legacy image-worker.js. Passing nil uses the production Ark generator.
func New(cfg config.Config, generator service.ImageGenerator) *Daemon {
	workerConfig := cfg
	if workerConfig.WorkerGeneratedDir != "" {
		workerConfig.GeneratedDir = workerConfig.WorkerGeneratedDir
	}
	if generator == nil {
		generator = service.NewArkImageGenerator(workerConfig)
	}
	workerID := strings.TrimSpace(cfg.WorkerID)
	if workerID == "" {
		hostname, err := os.Hostname()
		if err != nil || strings.TrimSpace(hostname) == "" {
			hostname = "jewelchain"
		}
		workerID = strings.ToLower(strings.TrimSpace(hostname)) + "-image-01"
	}
	return &Daemon{
		config:    cfg,
		generator: generator,
		client:    &http.Client{Timeout: 90 * time.Second},
		logger:    slog.Default(),
		workerID:  workerID,
	}
}

// Run keeps the worker registered, receives pushed work when possible, and
// falls back to HTTP polling whenever the WebSocket is unavailable.
func (daemon *Daemon) Run(ctx context.Context) error {
	if strings.TrimSpace(daemon.config.WorkerToken) == "" {
		return errors.New("WORKER_TOKEN is required")
	}
	if _, err := masterURL(daemon.config.MasterBaseURL); err != nil {
		return err
	}
	if daemon.generator == nil || !daemon.generator.Configured() {
		return errors.New("Ark image generator is not configured")
	}

	// Match the legacy worker's startup ordering: register the HTTP fallback
	// before starting the WebSocket loop. Otherwise an HTTP register racing a
	// successful WebSocket registration can overwrite the worker transport back
	// to "http" in the Master state.
	if err := daemon.Register(ctx); err != nil {
		daemon.logger.Warn("initial worker registration failed", "worker_id", daemon.workerID, "error", err)
	}
	go daemon.runWebSocket(ctx)
	heartbeats := time.NewTicker(heartbeatInterval)
	polling := time.NewTicker(workerPollInterval(daemon.config.WorkerPollInterval))
	defer heartbeats.Stop()
	defer polling.Stop()

	if err := daemon.PollOnce(ctx); err != nil {
		daemon.logger.Warn("initial worker poll failed", "worker_id", daemon.workerID, "error", err)
	}
	for {
		select {
		case <-ctx.Done():
			daemon.closeSocket()
			return nil
		case <-heartbeats.C:
			if err := daemon.Heartbeat(ctx); err != nil {
				daemon.logger.Warn("worker heartbeat failed", "worker_id", daemon.workerID, "error", err)
			}
		case <-polling.C:
			if err := daemon.PollOnce(ctx); err != nil {
				daemon.logger.Warn("worker poll failed", "worker_id", daemon.workerID, "error", err)
			}
		}
	}
}

// PollOnce is exported for deterministic integration tests and for callers
// that intentionally run an HTTP-only worker.
func (daemon *Daemon) PollOnce(ctx context.Context) error {
	if daemon.busy.Load() || daemon.currentSocket() != nil {
		return nil
	}
	if !daemon.registered.Load() {
		if err := daemon.Register(ctx); err != nil {
			return err
		}
	}
	result, err := daemon.api(ctx, http.MethodPost, "/api/v1/workers/tasks/claim", bytes.NewReader([]byte("{}")), http.Header{"Content-Type": []string{"application/json"}})
	if err != nil {
		if isRegistrationError(err) {
			daemon.registered.Store(false)
		}
		return err
	}
	task := model.RecordValue(result, "task")
	if task != nil {
		daemon.startTask(ctx, task)
	}
	return nil
}

// Register announces worker capabilities over HTTP. WebSocket registration is
// performed separately after the socket handshake succeeds.
func (daemon *Daemon) Register(ctx context.Context) error {
	_, err := daemon.apiJSON(ctx, http.MethodPost, "/api/v1/workers/register", model.Record{
		"workerVersion":  "1.3.1-go",
		"capabilities":   []string{"seedream", "jewelry-v1-v2"},
		"maxConcurrency": 1,
		"transport":      "http",
	})
	if err == nil {
		daemon.registered.Store(true)
	}
	return err
}

// Heartbeat reports capacity through the active WebSocket when available and
// otherwise uses the HTTP fallback contract.
func (daemon *Daemon) Heartbeat(ctx context.Context) error {
	details := model.Record{
		"type":          "worker.heartbeat",
		"workerId":      daemon.workerID,
		"runningTasks":  boolToInt(daemon.busy.Load()),
		"available":     !daemon.busy.Load(),
		"memoryUsageMb": memoryUsageMB(),
	}
	if socket := daemon.currentSocket(); socket != nil {
		if err := socket.send(details); err == nil {
			return nil
		}
		daemon.clearSocket(socket)
	}
	if !daemon.registered.Load() {
		return daemon.Register(ctx)
	}
	details["transport"] = "http"
	_, err := daemon.apiJSON(ctx, http.MethodPost, "/api/v1/workers/heartbeat", details)
	if isRegistrationError(err) {
		daemon.registered.Store(false)
	}
	return err
}

func (daemon *Daemon) runWebSocket(ctx context.Context) {
	for ctx.Err() == nil {
		if err := daemon.connectAndServe(ctx); err != nil && ctx.Err() == nil {
			daemon.logger.Warn("worker websocket disconnected", "worker_id", daemon.workerID, "error", err)
		}
		if !waitContext(ctx, reconnectDelay) {
			return
		}
	}
}

func (daemon *Daemon) connectAndServe(ctx context.Context) error {
	endpoint, err := websocketURL(daemon.config.MasterBaseURL)
	if err != nil {
		return err
	}
	connection, _, err := websocket.DefaultDialer.DialContext(ctx, endpoint, nil)
	if err != nil {
		return fmt.Errorf("connect worker websocket: %w", err)
	}
	defer connection.Close()
	socket := &workerSocket{connection: connection}
	if err := socket.send(model.Record{
		"type":           "worker.register",
		"token":          daemon.config.WorkerToken,
		"workerId":       daemon.workerID,
		"workerVersion":  "1.3.1-go",
		"capabilities":   []string{"seedream", "jewelry-v1-v2"},
		"maxConcurrency": 1,
	}); err != nil {
		return fmt.Errorf("register worker websocket: %w", err)
	}
	_, raw, err := connection.ReadMessage()
	if err != nil {
		return fmt.Errorf("read worker registration: %w", err)
	}
	var initial model.Record
	if err := json.Unmarshal(raw, &initial); err != nil {
		return fmt.Errorf("decode worker registration: %w", err)
	}
	if model.String(initial, "type") == "server.error" {
		return fmt.Errorf("worker websocket rejected: %s", model.String(initial, "message"))
	}
	if model.String(initial, "type") != "worker.registered" {
		return fmt.Errorf("unexpected worker registration response: %s", model.String(initial, "type"))
	}
	daemon.setSocket(socket)
	daemon.registered.Store(true)
	defer daemon.clearSocket(socket)

	done := make(chan struct{})
	go func() {
		select {
		case <-ctx.Done():
			_ = connection.Close()
		case <-done:
		}
	}()
	defer close(done)
	for {
		_, raw, err := connection.ReadMessage()
		if err != nil {
			return err
		}
		var message model.Record
		if err := json.Unmarshal(raw, &message); err != nil {
			continue
		}
		switch model.String(message, "type") {
		case "task.assigned":
			if task := model.RecordValue(message, "task"); task != nil {
				daemon.startTask(ctx, task)
			}
		case "server.error":
			daemon.logger.Warn("master rejected worker message", "worker_id", daemon.workerID, "code", model.String(message, "code"), "message", model.String(message, "message"))
		}
	}
}

func (daemon *Daemon) startTask(ctx context.Context, task model.Record) {
	if !daemon.busy.CompareAndSwap(false, true) {
		go daemon.failTask(ctx, task, "WORKER_BUSY", "生图端正在执行其他任务，任务已重新排队", true)
		return
	}
	go daemon.executeTask(ctx, task)
}

func (daemon *Daemon) executeTask(ctx context.Context, task model.Record) {
	defer func() {
		daemon.busy.Store(false)
		if socket := daemon.currentSocket(); socket != nil {
			_ = socket.send(model.Record{"type": "worker.ready"})
		}
	}()
	if model.String(task, "type") != "generate-image" {
		daemon.failTask(ctx, task, "UNSUPPORTED_TASK_TYPE", "不支持的 Worker 任务类型", false)
		return
	}
	if err := daemon.progress(ctx, task, 20, "生图端正在调用图片模型"); err != nil {
		daemon.failTask(ctx, task, errorCode(err), errorMessage(err), isRetryable(err))
		return
	}
	renewContext, cancelRenew := context.WithCancel(ctx)
	defer cancelRenew()
	go daemon.renewLease(renewContext, task)

	payload := model.RecordValue(task, "payload")
	generated, err := daemon.generator.Generate(ctx, model.Record{
		"prompt":         model.String(payload, "prompt"),
		"filenamePrefix": firstNonBlank(model.String(payload, "filenamePrefix"), "task_"+model.String(task, "id")),
	})
	if err != nil {
		daemon.failTask(ctx, task, errorCode(err), errorMessage(err), isRetryable(err))
		return
	}
	if err := daemon.progress(ctx, task, 80, "图片生成完成，正在上传调度服务"); err != nil {
		daemon.failTask(ctx, task, errorCode(err), errorMessage(err), isRetryable(err))
		return
	}
	upload, err := daemon.upload(ctx, task, generated)
	if err != nil {
		daemon.failTask(ctx, task, errorCode(err), errorMessage(err), isRetryable(err))
		return
	}
	if err := daemon.progress(ctx, task, 94, "图片已上传，正在提交任务结果"); err != nil {
		daemon.failTask(ctx, task, errorCode(err), errorMessage(err), isRetryable(err))
		return
	}
	_, err = daemon.apiJSON(ctx, http.MethodPost, "/api/v1/workers/tasks/"+url.PathEscape(model.String(task, "id"))+"/complete", model.Record{
		"leaseId":       model.String(task, "leaseId"),
		"uploadId":      model.String(upload, "id"),
		"requestId":     model.String(generated, "requestId"),
		"modelProvider": model.String(generated, "modelProvider"),
		"modelName":     model.String(generated, "modelName"),
		"imageSize":     generated["imageSize"],
	})
	if err != nil {
		daemon.failTask(ctx, task, errorCode(err), errorMessage(err), isRetryable(err))
		return
	}
	daemon.logger.Info("worker task completed", "worker_id", daemon.workerID, "task_id", model.String(task, "id"))
}

func (daemon *Daemon) renewLease(ctx context.Context, task model.Record) {
	ticker := time.NewTicker(35 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if _, err := daemon.apiJSON(ctx, http.MethodPost, "/api/v1/workers/tasks/"+url.PathEscape(model.String(task, "id"))+"/renew", model.Record{"leaseId": model.String(task, "leaseId")}); err != nil {
				daemon.logger.Warn("worker lease renewal failed", "worker_id", daemon.workerID, "task_id", model.String(task, "id"), "error", err)
			}
		}
	}
}

func (daemon *Daemon) progress(ctx context.Context, task model.Record, progress int, message string) error {
	_, err := daemon.apiJSON(ctx, http.MethodPost, "/api/v1/workers/tasks/"+url.PathEscape(model.String(task, "id"))+"/progress", model.Record{"leaseId": model.String(task, "leaseId"), "progress": progress, "message": message})
	return err
}

func (daemon *Daemon) upload(ctx context.Context, task, generated model.Record) (model.Record, error) {
	image, err := os.ReadFile(model.String(generated, "filePath"))
	if err != nil {
		return nil, fmt.Errorf("read generated image: %w", err)
	}
	digest := model.String(generated, "sha256")
	if digest == "" {
		hash := sha256.Sum256(image)
		digest = hex.EncodeToString(hash[:])
	}
	headers := http.Header{
		"Content-Type":     []string{firstNonBlank(model.String(generated, "mimeType"), "image/png")},
		"X-Lease-Id":       []string{model.String(task, "leaseId")},
		"X-File-Name":      []string{firstNonBlank(model.String(generated, "filename"), "image.png")},
		"X-Content-Sha256": []string{digest},
	}
	return daemon.api(ctx, http.MethodPut, "/api/v1/workers/tasks/"+url.PathEscape(model.String(task, "id"))+"/upload", bytes.NewReader(image), headers)
}

func (daemon *Daemon) failTask(ctx context.Context, task model.Record, code, message string, retryable bool) {
	if model.String(task, "id") == "" || model.String(task, "leaseId") == "" {
		return
	}
	_, err := daemon.apiJSON(ctx, http.MethodPost, "/api/v1/workers/tasks/"+url.PathEscape(model.String(task, "id"))+"/fail", model.Record{
		"leaseId":      model.String(task, "leaseId"),
		"errorCode":    firstNonBlank(code, "WORKER_EXECUTION_FAILED"),
		"errorMessage": firstNonBlank(message, "Image Worker 执行失败"),
		"retryable":    retryable,
	})
	if err != nil {
		daemon.logger.Warn("report worker task failure", "worker_id", daemon.workerID, "task_id", model.String(task, "id"), "error", err)
	}
}

func (daemon *Daemon) apiJSON(ctx context.Context, method, path string, value any) (model.Record, error) {
	payload, err := json.Marshal(value)
	if err != nil {
		return nil, fmt.Errorf("encode worker request: %w", err)
	}
	return daemon.api(ctx, method, path, bytes.NewReader(payload), http.Header{"Content-Type": []string{"application/json"}})
}

func (daemon *Daemon) api(ctx context.Context, method, path string, body io.Reader, headers http.Header) (model.Record, error) {
	base, err := masterURL(daemon.config.MasterBaseURL)
	if err != nil {
		return nil, err
	}
	request, err := http.NewRequestWithContext(ctx, method, base+path, body)
	if err != nil {
		return nil, fmt.Errorf("create worker request: %w", err)
	}
	request.Header.Set("Authorization", "Bearer "+daemon.config.WorkerToken)
	request.Header.Set("X-Worker-Id", daemon.workerID)
	for key, values := range headers {
		request.Header[key] = append([]string(nil), values...)
	}
	response, err := daemon.client.Do(request)
	if err != nil {
		return nil, model.NewError("WORKER_MASTER_UNAVAILABLE", "无法连接 Master API", http.StatusBadGateway, true, nil)
	}
	defer response.Body.Close()
	payload, err := io.ReadAll(io.LimitReader(response.Body, 2<<20))
	if err != nil {
		return nil, model.NewError("WORKER_MASTER_RESPONSE_INVALID", "读取 Master API 响应失败", http.StatusBadGateway, true, nil)
	}
	var envelope struct {
		Data  model.Record `json:"data"`
		Error *struct {
			Code      string `json:"code"`
			Message   string `json:"message"`
			Retryable bool   `json:"retryable"`
			Details   any    `json:"details"`
		} `json:"error"`
	}
	if err := json.Unmarshal(payload, &envelope); err != nil {
		return nil, model.NewError("WORKER_MASTER_RESPONSE_INVALID", "Master API 返回了无效 JSON", http.StatusBadGateway, true, nil)
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		if envelope.Error != nil {
			return nil, model.NewError(firstNonBlank(envelope.Error.Code, "WORKER_API_ERROR"), firstNonBlank(envelope.Error.Message, "Master API 请求失败"), response.StatusCode, envelope.Error.Retryable, envelope.Error.Details)
		}
		return nil, model.NewError("WORKER_API_ERROR", "Master API 请求失败", response.StatusCode, response.StatusCode >= 500, nil)
	}
	if envelope.Data == nil {
		return model.Record{}, nil
	}
	return envelope.Data, nil
}

func (daemon *Daemon) currentSocket() *workerSocket {
	daemon.socketMu.RLock()
	defer daemon.socketMu.RUnlock()
	return daemon.socket
}

func (daemon *Daemon) setSocket(socket *workerSocket) {
	daemon.socketMu.Lock()
	previous := daemon.socket
	daemon.socket = socket
	daemon.socketMu.Unlock()
	if previous != nil && previous != socket {
		_ = previous.connection.Close()
	}
}

func (daemon *Daemon) clearSocket(socket *workerSocket) {
	daemon.socketMu.Lock()
	if daemon.socket == socket {
		daemon.socket = nil
	}
	daemon.socketMu.Unlock()
}

func (daemon *Daemon) closeSocket() {
	if socket := daemon.currentSocket(); socket != nil {
		_ = socket.connection.Close()
		daemon.clearSocket(socket)
	}
}

func masterURL(value string) (string, error) {
	parsed, err := url.Parse(strings.TrimSpace(value))
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" || parsed.User != nil {
		return "", errors.New("MASTER_BASE_URL must be a credential-free http(s) URL")
	}
	return strings.TrimRight(parsed.String(), "/"), nil
}

func websocketURL(master string) (string, error) {
	parsed, err := url.Parse(master)
	if err != nil || parsed.Host == "" {
		return "", errors.New("MASTER_BASE_URL is invalid")
	}
	switch parsed.Scheme {
	case "http":
		parsed.Scheme = "ws"
	case "https":
		parsed.Scheme = "wss"
	default:
		return "", errors.New("MASTER_BASE_URL must use http or https")
	}
	parsed.Path = "/ws/worker"
	parsed.RawQuery = ""
	parsed.Fragment = ""
	return parsed.String(), nil
}

func workerPollInterval(value time.Duration) time.Duration {
	if value < 1500*time.Millisecond {
		return 1500 * time.Millisecond
	}
	return value
}

func memoryUsageMB() uint64 {
	var stats runtimeMemStats
	readRuntimeMemStats(&stats)
	return stats.Alloc / 1024 / 1024
}

// These aliases keep runtime details isolated for tests.
type runtimeMemStats struct{ Alloc uint64 }

func readRuntimeMemStats(stats *runtimeMemStats) {
	var current runtime.MemStats
	runtime.ReadMemStats(&current)
	stats.Alloc = current.Alloc
}

func boolToInt(value bool) int {
	if value {
		return 1
	}
	return 0
}

func waitContext(ctx context.Context, duration time.Duration) bool {
	timer := time.NewTimer(duration)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-timer.C:
		return true
	}
}

func isRegistrationError(err error) bool {
	return errorCode(err) == "WORKER_NOT_REGISTERED" || errorCode(err) == "WORKER_UNAUTHORIZED" || errorCode(err) == "WORKER_TOKEN_NOT_CONFIGURED"
}

func errorCode(err error) string {
	var appError *model.AppError
	if errors.As(err, &appError) {
		return appError.Code
	}
	return "WORKER_EXECUTION_FAILED"
}

func errorMessage(err error) string {
	var appError *model.AppError
	if errors.As(err, &appError) {
		return appError.Message
	}
	if err == nil {
		return ""
	}
	return err.Error()
}

func isRetryable(err error) bool {
	var appError *model.AppError
	return errors.As(err, &appError) && appError.Retryable
}

func firstNonBlank(values ...string) string {
	for _, value := range values {
		if value = strings.TrimSpace(value); value != "" {
			return value
		}
	}
	return ""
}
