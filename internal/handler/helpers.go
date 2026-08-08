package handler

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net"
	"net/http"
	"strings"

	"jewelchain-studio/internal/model"
)

func readJSON(writer http.ResponseWriter, request *http.Request) (model.Record, error) {
	bytes, err := readBytes(request, jsonBodyLimit)
	if err != nil {
		return nil, err
	}
	if len(strings.TrimSpace(string(bytes))) == 0 {
		return model.Record{}, nil
	}
	var body map[string]any
	if err := json.Unmarshal(bytes, &body); err != nil {
		return nil, model.NewError("INVALID_JSON", "请求体必须是合法 JSON 对象", http.StatusBadRequest, false, nil)
	}
	if body == nil {
		return nil, model.NewError("INVALID_JSON", "请求体必须是 JSON 对象", http.StatusBadRequest, false, nil)
	}
	return model.Record(body), nil
}

func readBytes(request *http.Request, limit int64) ([]byte, error) {
	if request.Body == nil {
		return []byte{}, nil
	}
	bytes, err := io.ReadAll(io.LimitReader(request.Body, limit+1))
	if err != nil {
		return nil, model.NewError("INVALID_BODY", "读取请求体失败", http.StatusBadRequest, false, nil)
	}
	if int64(len(bytes)) > limit {
		return nil, model.NewError("BODY_TOO_LARGE", "请求体超过允许大小", http.StatusRequestEntityTooLarge, false, nil)
	}
	return bytes, nil
}

func writeData(writer http.ResponseWriter, status int, data any) {
	writeJSON(writer, status, model.Record{"data": data})
}

func writeResult(writer http.ResponseWriter, request *http.Request, status int, data any, err error) {
	if err != nil {
		writeError(writer, request, err)
		return
	}
	writeData(writer, status, data)
}

func writeError(writer http.ResponseWriter, request *http.Request, cause error) {
	appError, ok := cause.(*model.AppError)
	if !ok {
		appError = model.NewError("INTERNAL_ERROR", "服务发生未处理错误", http.StatusInternalServerError, false, nil)
	}
	requestID := writer.Header().Get("X-Request-Id")
	writeJSON(writer, appError.Status, model.Record{"error": model.Record{"code": appError.Code, "message": appError.Message, "retryable": appError.Retryable, "details": appError.Details, "requestId": requestID}})
}

func writeJSON(writer http.ResponseWriter, status int, payload any) {
	writer.Header().Set("Content-Type", "application/json; charset=utf-8")
	writer.Header().Set("Cache-Control", "no-store")
	writer.WriteHeader(status)
	if err := json.NewEncoder(writer).Encode(payload); err != nil {
		slog.Warn("failed to encode JSON response", "error", err, "status", status)
	}
}

func errorCode(err error) string {
	var appError *model.AppError
	if errors.As(err, &appError) {
		return appError.Code
	}
	return "INTERNAL_ERROR"
}

func safeMessage(err error) string {
	var appError *model.AppError
	if errors.As(err, &appError) {
		return appError.Message
	}
	return "服务发生未处理错误"
}

func clientID(request *http.Request) string {
	for _, header := range []string{"CF-Connecting-IP", "X-Forwarded-For"} {
		if value := strings.TrimSpace(strings.Split(request.Header.Get(header), ",")[0]); value != "" {
			return value
		}
	}
	host, _, err := net.SplitHostPort(request.RemoteAddr)
	if err == nil {
		return host
	}
	return request.RemoteAddr
}

func newRequestID() string {
	bytes := make([]byte, 16)
	if _, err := rand.Read(bytes); err != nil {
		return model.NewID()
	}
	return hex.EncodeToString(bytes)
}
