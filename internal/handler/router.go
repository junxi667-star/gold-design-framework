package handler

import (
	"net/http"
	"net/url"
	"strings"

	"jewelchain-studio/internal/model"
	"jewelchain-studio/internal/service"
)

func (server *Server) routeAPI(writer http.ResponseWriter, request *http.Request) {
	path, method := request.URL.Path, request.Method
	if method == http.MethodGet && path == "/api/health" {
		writeData(writer, http.StatusOK, model.Record{"status": "ok", "service": "jewelchain-studio", "version": "1.3.1-go", "timestamp": model.Now()})
		return
	}
	if method == http.MethodGet && path == "/api/hackathon/config" {
		server.configEndpoint(writer)
		return
	}
	if method == http.MethodGet && path == "/api/hackathon/chain/status" {
		writeData(writer, http.StatusOK, server.chain.Status(request.Context()))
		return
	}
	if strings.HasPrefix(path, "/api/v1/workers") {
		server.routeWorkerAPI(writer, request)
		return
	}
	segments := splitPath(strings.TrimPrefix(path, "/api/hackathon/"))
	if method == http.MethodPost && len(segments) == 1 && segments[0] == "designs" {
		if !server.guardMutation(writer, request, true) {
			return
		}
		body, err := readJSON(writer, request)
		if err != nil {
			writeError(writer, request, err)
			return
		}
		result, err := server.design.CreateDesign(body)
		writeResult(writer, request, http.StatusAccepted, result, err)
		return
	}
	if method == http.MethodPost && len(segments) == 3 && segments[0] == "designs" && segments[2] == "revisions" {
		if !server.guardMutation(writer, request, true) {
			return
		}
		body, err := readJSON(writer, request)
		if err != nil {
			writeError(writer, request, err)
			return
		}
		projectID, err := decodeSegment(segments[1])
		if err != nil {
			writeError(writer, request, err)
			return
		}
		result, err := server.design.ReviseDesign(projectID, body)
		writeResult(writer, request, http.StatusAccepted, result, err)
		return
	}
	if method == http.MethodGet && len(segments) == 2 && segments[0] == "designs" {
		if !server.guardRead(writer, request) {
			return
		}
		id, err := decodeSegment(segments[1])
		if err != nil {
			writeError(writer, request, err)
			return
		}
		result, err := server.design.GetProject(id)
		writeResult(writer, request, http.StatusOK, result, err)
		return
	}
	if method == http.MethodGet && len(segments) == 3 && segments[0] == "designs" && segments[2] == "timeline" {
		if !server.guardRead(writer, request) {
			return
		}
		id, err := decodeSegment(segments[1])
		if err != nil {
			writeError(writer, request, err)
			return
		}
		result, err := server.design.Timeline(id)
		writeResult(writer, request, http.StatusOK, result, err)
		return
	}
	if method == http.MethodGet && len(segments) == 3 && segments[0] == "designs" && segments[2] == "certificate" {
		if !server.guardRead(writer, request) {
			return
		}
		id, err := decodeSegment(segments[1])
		if err != nil {
			writeError(writer, request, err)
			return
		}
		result, err := server.design.Certificate(id)
		writeResult(writer, request, http.StatusOK, result, err)
		return
	}
	if method == http.MethodGet && len(segments) == 2 && segments[0] == "jobs" {
		if !server.guardRead(writer, request) {
			return
		}
		id, err := decodeSegment(segments[1])
		if err != nil {
			writeError(writer, request, err)
			return
		}
		result, err := server.design.GetJob(id)
		writeResult(writer, request, http.StatusOK, result, err)
		return
	}
	if method == http.MethodPost && len(segments) == 3 && segments[0] == "versions" && segments[2] == "prepare-registration" {
		if !server.guardMutation(writer, request, false) {
			return
		}
		body, err := readJSON(writer, request)
		if err != nil {
			writeError(writer, request, err)
			return
		}
		id, err := decodeSegment(segments[1])
		if err != nil {
			writeError(writer, request, err)
			return
		}
		result, err := server.chain.PrepareRegistration(request.Context(), id, body, server.publicBaseURL(request))
		writeResult(writer, request, http.StatusOK, result, err)
		return
	}
	if method == http.MethodPost && len(segments) == 3 && segments[0] == "versions" && segments[2] == "prepare-finalize" {
		if !server.guardMutation(writer, request, false) {
			return
		}
		body, err := readJSON(writer, request)
		if err != nil {
			writeError(writer, request, err)
			return
		}
		id, err := decodeSegment(segments[1])
		if err != nil {
			writeError(writer, request, err)
			return
		}
		result, err := server.chain.PrepareFinalize(id, body)
		writeResult(writer, request, http.StatusOK, result, err)
		return
	}
	if method == http.MethodPost && len(segments) == 3 && segments[0] == "versions" && segments[2] == "chain-submission" {
		if !server.guardMutation(writer, request, false) {
			return
		}
		body, err := readJSON(writer, request)
		if err != nil {
			writeError(writer, request, err)
			return
		}
		id, err := decodeSegment(segments[1])
		if err != nil {
			writeError(writer, request, err)
			return
		}
		result, err := server.chain.RecordSubmission(id, body)
		writeResult(writer, request, http.StatusAccepted, result, err)
		return
	}
	if method == http.MethodGet && len(segments) == 3 && segments[0] == "versions" && segments[2] == "chain-status" {
		if !server.guardRead(writer, request) {
			return
		}
		id, err := decodeSegment(segments[1])
		if err != nil {
			writeError(writer, request, err)
			return
		}
		result, err := server.chain.GetChainStatus(request.Context(), id, request.URL.Query().Get("kind"))
		writeResult(writer, request, http.StatusOK, result, err)
		return
	}
	if method == http.MethodPost && len(segments) == 2 && segments[0] == "agent" && segments[1] == "query" {
		if !server.guardRead(writer, request) {
			return
		}
		body, err := readJSON(writer, request)
		if err != nil {
			writeError(writer, request, err)
			return
		}
		result, err := server.design.AnswerQuestion(model.String(body, "projectId"), model.String(body, "question"))
		writeResult(writer, request, http.StatusOK, result, err)
		return
	}
	writeError(writer, request, model.NewError("API_ROUTE_NOT_FOUND", "接口不存在", http.StatusNotFound, false, nil))
}

func (server *Server) configEndpoint(writer http.ResponseWriter) {
	status, err := server.broker.Status()
	if err != nil {
		writeData(writer, http.StatusOK, model.Record{"version": "1.3.1-go", "generation": model.Record{"mode": server.config.ExecutionMode, "configured": false}})
		return
	}
	generator := service.NewArkImageGenerator(server.config)
	writeData(writer, http.StatusOK, model.Record{"version": "1.3.1-go", "agent": model.Record{"name": "JewelChain Design Agent", "mode": "deterministic-tool-orchestration", "tools": []string{"parse_requirement", "enqueue_generation", "worker_dispatch", "store_assets", "build_metadata", "prepare_monad_tx", "verify_monad_tx", "answer_chain_question"}}, "generation": model.Record{"mode": server.config.ExecutionMode, "directProvider": generator.Status(), "worker": status, "configured": server.config.ExecutionMode != "direct" || generator.Configured()}, "imageProvider": generator.Status(), "storage": service.NewMetadataStorage(server.config, nil).Status(), "chain": server.chain.Config(), "legalNotice": "链上记录证明内容指纹、提交地址与时间，不替代版权登记、原创性审查或法律认定。", "workerStatus": status, "demoAccessCodeRequired": server.config.DemoAccessCode != "", "generationLimitPerHour": server.config.GenerationLimit})
}

func (server *Server) routeWorkerAPI(writer http.ResponseWriter, request *http.Request) {
	path, method := request.URL.Path, request.Method
	if method == http.MethodGet && path == "/api/v1/workers/status" {
		result, err := server.broker.Status()
		writeResult(writer, request, http.StatusOK, result, err)
		return
	}
	workerID, err := server.workerAuth(request)
	if err != nil {
		writeError(writer, request, err)
		return
	}
	if method == http.MethodPost && path == "/api/v1/workers/register" {
		body, err := readJSON(writer, request)
		if err != nil {
			writeError(writer, request, err)
			return
		}
		if model.String(body, "transport") == "" {
			body["transport"] = "http"
		}
		result, err := server.broker.RegisterWorker(workerID, body, request.RemoteAddr)
		if err != nil {
			writeError(writer, request, err)
			return
		}
		writeData(writer, http.StatusOK, model.Record{"worker": result, "heartbeatIntervalMs": 30000, "leaseSeconds": int(server.config.WorkerLease.Seconds())})
		return
	}
	if method == http.MethodPost && path == "/api/v1/workers/heartbeat" {
		body, err := readJSON(writer, request)
		if err != nil {
			writeError(writer, request, err)
			return
		}
		result, err := server.broker.Heartbeat(workerID, body)
		writeResult(writer, request, http.StatusOK, result, err)
		return
	}
	if method == http.MethodPost && path == "/api/v1/workers/tasks/claim" {
		result, err := server.broker.ClaimTask(workerID)
		writeResult(writer, request, http.StatusOK, model.Record{"task": result}, err)
		return
	}
	segments := splitPath(strings.TrimPrefix(path, "/api/v1/workers/tasks/"))
	if len(segments) == 2 {
		taskID, decodeErr := decodeSegment(segments[0])
		if decodeErr != nil {
			writeError(writer, request, decodeErr)
			return
		}
		action := segments[1]
		if method == http.MethodPost && action == "renew" {
			body, err := readJSON(writer, request)
			if err != nil {
				writeError(writer, request, err)
				return
			}
			result, err := server.broker.RenewTask(taskID, workerID, model.String(body, "leaseId"))
			writeResult(writer, request, http.StatusOK, result, err)
			return
		}
		if method == http.MethodPost && action == "progress" {
			body, err := readJSON(writer, request)
			if err != nil {
				writeError(writer, request, err)
				return
			}
			result, err := server.broker.UpdateProgress(taskID, workerID, model.String(body, "leaseId"), body)
			writeResult(writer, request, http.StatusOK, result, err)
			return
		}
		if method == http.MethodPut && action == "upload" {
			bytes, err := readBytes(request, 25<<20)
			if err != nil {
				writeError(writer, request, err)
				return
			}
			result, err := server.broker.StoreUpload(taskID, workerID, request.Header.Get("X-Lease-Id"), bytes, request.Header.Get("X-File-Name"), request.Header.Get("Content-Type"), request.Header.Get("X-Content-Sha256"))
			writeResult(writer, request, http.StatusCreated, result, err)
			return
		}
		if method == http.MethodPost && action == "complete" {
			body, err := readJSON(writer, request)
			if err != nil {
				writeError(writer, request, err)
				return
			}
			result, err := server.broker.CompleteTask(taskID, workerID, model.String(body, "leaseId"), body)
			writeResult(writer, request, http.StatusOK, result, err)
			return
		}
		if method == http.MethodPost && action == "fail" {
			body, err := readJSON(writer, request)
			if err != nil {
				writeError(writer, request, err)
				return
			}
			result, err := server.broker.FailTask(taskID, workerID, model.String(body, "leaseId"), body)
			writeResult(writer, request, http.StatusOK, result, err)
			return
		}
	}
	writeError(writer, request, model.NewError("WORKER_ROUTE_NOT_FOUND", "Worker 接口不存在", http.StatusNotFound, false, nil))
}

func (server *Server) workerAuth(request *http.Request) (string, error) {
	if server.config.WorkerToken == "" {
		return "", model.NewError("WORKER_TOKEN_NOT_CONFIGURED", "Master 尚未配置 WORKER_TOKEN", http.StatusServiceUnavailable, false, nil)
	}
	token := strings.TrimSpace(strings.TrimPrefix(request.Header.Get("Authorization"), "Bearer "))
	if !safeEqual(token, server.config.WorkerToken) {
		return "", model.NewError("WORKER_UNAUTHORIZED", "Image Worker 认证失败", http.StatusUnauthorized, false, nil)
	}
	workerID := strings.TrimSpace(request.Header.Get("X-Worker-Id"))
	if workerID == "" {
		return "", model.NewError("WORKER_ID_REQUIRED", "缺少 X-Worker-Id", http.StatusBadRequest, false, nil)
	}
	return workerID, nil
}

func (server *Server) guardMutation(writer http.ResponseWriter, request *http.Request, generation bool) bool {
	if err := server.guard.requireCode(request); err != nil {
		writeError(writer, request, err)
		return false
	}
	if generation {
		if err := server.guard.requireGenerationQuota(clientID(request)); err != nil {
			writeError(writer, request, err)
			return false
		}
	}
	return true
}

func (server *Server) guardRead(writer http.ResponseWriter, request *http.Request) bool {
	if !server.config.DemoProtectReads {
		return true
	}
	if err := server.guard.requireCode(request); err != nil {
		writeError(writer, request, err)
		return false
	}
	return true
}

func (server *Server) publicBaseURL(request *http.Request) string {
	if server.config.PublicBaseURL != "" {
		parsed, err := url.Parse(server.config.PublicBaseURL)
		if err == nil {
			return parsed.Scheme + "://" + parsed.Host
		}
	}
	scheme := "http"
	if request.TLS != nil {
		scheme = "https"
	}
	if forwarded := request.Header.Get("X-Forwarded-Proto"); forwarded == "https" {
		scheme = "https"
	}
	return scheme + "://" + request.Host
}

func (server *Server) applyCORS(writer http.ResponseWriter, request *http.Request) bool {
	origin := request.Header.Get("Origin")
	if server.allowedOrigin(origin) {
		writer.Header().Set("Access-Control-Allow-Origin", origin)
		writer.Header().Set("Vary", "Origin")
		writer.Header().Set("Access-Control-Allow-Methods", "GET,POST,PUT,OPTIONS")
		writer.Header().Set("Access-Control-Allow-Headers", "Accept,Content-Type,X-Demo-Access-Code,Authorization,X-Worker-Id,X-Lease-Id,X-File-Name,X-Content-Sha256")
		writer.Header().Set("Access-Control-Max-Age", "86400")
	}
	if request.Method == http.MethodOptions {
		if server.allowedOrigin(origin) {
			writer.WriteHeader(http.StatusNoContent)
		} else {
			writer.WriteHeader(http.StatusForbidden)
		}
		return true
	}
	return false
}

func (server *Server) allowedOrigin(origin string) bool {
	if origin == "" {
		return false
	}
	for _, allowed := range server.config.CORSOrigins {
		if allowed == "*" || allowed == origin {
			return true
		}
	}
	parsed, err := url.Parse(origin)
	return err == nil && parsed.Scheme == "http" && (parsed.Hostname() == "localhost" || parsed.Hostname() == "127.0.0.1")
}

func splitPath(value string) []string {
	value = strings.Trim(value, "/")
	if value == "" {
		return []string{}
	}
	return strings.Split(value, "/")
}

func decodeSegment(value string) (string, error) {
	decoded, err := url.PathUnescape(value)
	if err != nil || decoded == "" || strings.Contains(decoded, "/") {
		return "", model.NewError("INVALID_ROUTE_PARAMETER", "路径参数无效", http.StatusBadRequest, false, nil)
	}
	return decoded, nil
}
