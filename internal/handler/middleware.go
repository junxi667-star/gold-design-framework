package handler

import (
	"net/http"
	"sync"
	"time"

	"jewelchain-studio/internal/model"
)

func (server *Server) withRequestContext(next http.Handler) http.Handler {
	return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		requestID := newRequestID()
		writer.Header().Set("X-Request-Id", requestID)
		writer.Header().Set("X-Content-Type-Options", "nosniff")
		writer.Header().Set("Referrer-Policy", "no-referrer")
		writer.Header().Set("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
		defer func() {
			if recovered := recover(); recovered != nil {
				server.logger.Error("panic", "request_id", requestID, "error", recovered)
				writeError(writer, request, model.NewError("INTERNAL_ERROR", "服务发生未处理错误", http.StatusInternalServerError, false, nil))
			}
		}()
		next.ServeHTTP(writer, request)
	})
}

type mutationGuard struct {
	code        string
	hourlyLimit int
	mu          sync.Mutex
	hits        map[string][]time.Time
	stop        chan struct{}
}

func newMutationGuard(code string, hourlyLimit int) *mutationGuard {
	guard := &mutationGuard{code: code, hourlyLimit: hourlyLimit, hits: make(map[string][]time.Time), stop: make(chan struct{})}
	go guard.cleanupLoop()
	return guard
}

func (guard *mutationGuard) cleanupLoop() {
	ticker := time.NewTicker(5 * time.Minute)
	defer ticker.Stop()
	for {
		select {
		case <-ticker.C:
			guard.cleanup()
		case <-guard.stop:
			return
		}
	}
}

func (guard *mutationGuard) cleanup() {
	guard.mu.Lock()
	defer guard.mu.Unlock()
	cutoff := time.Now().Add(-time.Hour)
	for id, entries := range guard.hits {
		valid := make([]time.Time, 0, len(entries))
		for _, entry := range entries {
			if entry.After(cutoff) {
				valid = append(valid, entry)
			}
		}
		if len(valid) == 0 {
			delete(guard.hits, id)
		} else {
			guard.hits[id] = valid
		}
	}
}

func (guard *mutationGuard) requireCode(request *http.Request) error {
	if guard.code == "" {
		return nil
	}
	if !safeEqual(request.Header.Get("X-Demo-Access-Code"), guard.code) {
		return model.NewError("INVALID_DEMO_ACCESS_CODE", "演示访问码错误", http.StatusUnauthorized, false, nil)
	}
	return nil
}

func (guard *mutationGuard) requireGenerationQuota(id string) error {
	guard.mu.Lock()
	defer guard.mu.Unlock()
	now, cutoff := time.Now(), time.Now().Add(-time.Hour)
	valid := []time.Time{}
	for _, entry := range guard.hits[id] {
		if entry.After(cutoff) {
			valid = append(valid, entry)
		}
	}
	if len(valid) >= guard.hourlyLimit {
		return model.NewError("GENERATION_RATE_LIMITED", "当前设备每小时生成次数已达上限，请稍后再试", http.StatusTooManyRequests, false, nil)
	}
	guard.hits[id] = append(valid, now)
	return nil
}
