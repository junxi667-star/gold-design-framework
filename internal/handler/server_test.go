package handler

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"

	"jewelchain-studio/internal/config"
	"jewelchain-studio/internal/model"
)

var tinyPNG = []byte{0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n'}

func newTestServer(t *testing.T) *Server {
	t.Helper()
	root := t.TempDir()
	cfg := config.Config{StatePath: filepath.Join(root, "data", "state.json"), GeneratedDir: filepath.Join(root, "generated"), MetadataDir: filepath.Join(root, "metadata"), WorkerUploadDir: filepath.Join(root, "uploads"), WorkerToken: "test-worker-token-12345678901234567890", WorkerLease: time.Minute, WorkerStaleAfter: time.Minute, WorkerMaxAttempt: 3, GenerationLimit: 10, ExecutionMode: "worker", RegistryAddress: "0x017BA6A7b6d90387bc588ad6FccDf2e0FD16D8b7", ChainID: 10143}
	return New(cfg)
}

func request(t *testing.T, app *Server, method, path string, body []byte, headers map[string]string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, path, bytes.NewReader(body))
	for key, value := range headers {
		req.Header.Set(key, value)
	}
	recorder := httptest.NewRecorder()
	app.Handler().ServeHTTP(recorder, req)
	return recorder
}

func decodeData(t *testing.T, recorder *httptest.ResponseRecorder) model.Record {
	t.Helper()
	var payload map[string]any
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	data, ok := payload["data"].(map[string]any)
	if !ok {
		t.Fatalf("expected data envelope, got %s", recorder.Body.String())
	}
	return model.Record(data)
}

func TestWorkerHTTPRoundTripValidatesImageAndLease(t *testing.T) {
	app := newTestServer(t)
	if _, err := app.broker.Enqueue(model.Record{"jobId": "job-1", "versionId": "version-1", "projectId": "project-1", "prompt": "test", "filenamePrefix": "test", "operation": "generate"}); err != nil {
		t.Fatal(err)
	}
	auth := map[string]string{"Authorization": "Bearer test-worker-token-12345678901234567890", "X-Worker-Id": "worker-1", "Content-Type": "application/json"}
	registered := request(t, app, http.MethodPost, "/api/v1/workers/register", []byte(`{"workerVersion":"test","capabilities":["seedream"],"maxConcurrency":1}`), auth)
	if registered.Code != http.StatusOK {
		t.Fatalf("register: %d %s", registered.Code, registered.Body.String())
	}
	claim := request(t, app, http.MethodPost, "/api/v1/workers/tasks/claim", []byte(`{}`), auth)
	if claim.Code != http.StatusOK {
		t.Fatalf("claim: %d %s", claim.Code, claim.Body.String())
	}
	task := model.RecordValue(decodeData(t, claim), "task")
	if model.String(task, "status") != "claimed" || model.String(task, "leaseId") == "" {
		t.Fatalf("invalid claimed task: %#v", task)
	}
	uploadHeaders := map[string]string{"Authorization": auth["Authorization"], "X-Worker-Id": "worker-1", "X-Lease-Id": model.String(task, "leaseId"), "X-File-Name": "image.png", "X-Content-Sha256": ""}
	badHeaders := map[string]string{"Authorization": auth["Authorization"], "X-Worker-Id": "worker-1", "X-Lease-Id": model.String(task, "leaseId"), "X-File-Name": "image.png", "Content-Type": "image/jpeg"}
	badUpload := request(t, app, http.MethodPut, "/api/v1/workers/tasks/"+model.String(task, "id")+"/upload", tinyPNG, badHeaders)
	if badUpload.Code != http.StatusUnsupportedMediaType {
		t.Fatalf("forged MIME should fail: %d %s", badUpload.Code, badUpload.Body.String())
	}
	uploadHeaders["Content-Type"] = "image/png"
	upload := request(t, app, http.MethodPut, "/api/v1/workers/tasks/"+model.String(task, "id")+"/upload", tinyPNG, uploadHeaders)
	if upload.Code != http.StatusCreated {
		t.Fatalf("upload: %d %s", upload.Code, upload.Body.String())
	}
	uploadID := model.String(decodeData(t, upload), "id")
	completeBody := []byte(`{"leaseId":"` + model.String(task, "leaseId") + `","uploadId":"` + uploadID + `","modelName":"test"}`)
	completed := request(t, app, http.MethodPost, "/api/v1/workers/tasks/"+model.String(task, "id")+"/complete", completeBody, auth)
	if completed.Code != http.StatusOK {
		t.Fatalf("complete: %d %s", completed.Code, completed.Body.String())
	}
	if model.String(decodeData(t, completed), "status") != "completed" {
		t.Fatalf("task did not complete: %s", completed.Body.String())
	}
}

func TestBrowserAPIRejectsInvalidProtectedMutation(t *testing.T) {
	app := newTestServer(t)
	app.config.DemoAccessCode = "secret-code"
	app.guard.code = "secret-code"
	recorder := request(t, app, http.MethodPost, "/api/hackathon/designs", []byte(`{"customerText":"一个足金戒指设计"}`), map[string]string{"Content-Type": "application/json", "X-Demo-Access-Code": "wrong"})
	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("wrong demo code: %d %s", recorder.Code, recorder.Body.String())
	}
	var payload map[string]any
	_ = json.Unmarshal(recorder.Body.Bytes(), &payload)
	errorBody := model.Record(payload["error"].(map[string]any))
	if model.String(errorBody, "code") != "INVALID_DEMO_ACCESS_CODE" || model.String(errorBody, "requestId") == "" {
		t.Fatalf("unsafe error envelope: %#v", errorBody)
	}
}

func TestGoMasterServesBuiltReactBundleWithoutMaskingAPI(t *testing.T) {
	app := newTestServer(t)
	frontend := t.TempDir()
	if err := os.WriteFile(filepath.Join(frontend, "index.html"), []byte("<main id=\"root\">React bundle</main>"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(filepath.Join(frontend, "assets"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(frontend, "assets", "app.js"), []byte("console.log('react')"), 0o600); err != nil {
		t.Fatal(err)
	}
	app.config.FrontendDir = frontend
	page := request(t, app, http.MethodGet, "/", nil, nil)
	if page.Code != http.StatusOK || !strings.Contains(page.Body.String(), "React bundle") {
		t.Fatalf("built React entry was not served: %d %s", page.Code, page.Body.String())
	}
	route := request(t, app, http.MethodGet, "/workspace/project-1", nil, nil)
	if route.Code != http.StatusOK || !strings.Contains(route.Body.String(), "React bundle") {
		t.Fatalf("React route fallback failed: %d %s", route.Code, route.Body.String())
	}
	asset := request(t, app, http.MethodGet, "/assets/app.js", nil, nil)
	if asset.Code != http.StatusOK || !strings.Contains(asset.Body.String(), "console.log") {
		t.Fatalf("React asset was not served: %d %s", asset.Code, asset.Body.String())
	}
	api := request(t, app, http.MethodGet, "/api/hackathon/config", nil, nil)
	if api.Code != http.StatusOK || !strings.Contains(api.Body.String(), "generation") {
		t.Fatalf("API was masked by frontend fallback: %d %s", api.Code, api.Body.String())
	}
}

func TestWorkerWebSocketReceivesPendingTask(t *testing.T) {
	app := newTestServer(t)
	if _, err := app.broker.Enqueue(model.Record{"jobId": "ws-job", "versionId": "version", "projectId": "project", "prompt": "test", "filenamePrefix": "test", "operation": "generate"}); err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(app.Handler())
	defer server.Close()
	connection, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(server.URL, "http")+"/ws/worker", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer connection.Close()
	if err := connection.WriteJSON(model.Record{"type": "worker.register", "token": "test-worker-token-12345678901234567890", "workerId": "websocket-worker", "workerVersion": "test", "capabilities": []string{"seedream"}, "maxConcurrency": 1}); err != nil {
		t.Fatal(err)
	}
	_ = connection.SetReadDeadline(time.Now().Add(2 * time.Second))
	var registered model.Record
	if err := connection.ReadJSON(&registered); err != nil {
		t.Fatal(err)
	}
	if model.String(registered, "type") != "worker.registered" {
		t.Fatalf("unexpected registration message: %#v", registered)
	}
	var assignment model.Record
	if err := connection.ReadJSON(&assignment); err != nil {
		t.Fatal(err)
	}
	if model.String(assignment, "type") != "task.assigned" || model.String(model.RecordValue(assignment, "task"), "status") != "claimed" {
		t.Fatalf("unexpected task assignment: %#v", assignment)
	}
	_ = connection.Close()
	server.Close()
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		state, err := app.store.Read()
		if err == nil {
			worker, _ := model.Find(state.Workers, "websocket-worker")
			if worker != nil && model.String(worker, "status") == "offline" {
				return
			}
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("websocket worker was not marked offline")
}

func TestWorkerWebSocketApplicationHeartbeatKeepsConnectionAlive(t *testing.T) {
	app := newTestServer(t)
	app.hub.readTimeout = 60 * time.Millisecond
	server := httptest.NewServer(app.Handler())
	defer server.Close()
	connection := registerWorkerSocket(t, server.URL, "heartbeat-worker")

	for index := 0; index < 4; index++ {
		time.Sleep(35 * time.Millisecond)
		if err := connection.WriteJSON(model.Record{"type": "worker.heartbeat", "workerId": "heartbeat-worker", "runningTasks": 0, "available": true}); err != nil {
			t.Fatalf("heartbeat %d: %v", index, err)
		}
		_ = connection.SetReadDeadline(time.Now().Add(time.Second))
		var response model.Record
		if err := connection.ReadJSON(&response); err != nil {
			t.Fatalf("heartbeat response %d: %v", index, err)
		}
		if model.String(response, "type") != "server.heartbeat" {
			t.Fatalf("unexpected heartbeat response: %#v", response)
		}
	}
	status, err := app.broker.Status()
	if err != nil {
		t.Fatal(err)
	}
	if model.Int(status, "onlineWorkers") != 1 {
		t.Fatalf("heartbeat worker should remain online: %#v", status)
	}
	_ = connection.Close()
	waitForWorkerOffline(t, app, "heartbeat-worker")
}

func TestWorkerWebSocketReconnectDoesNotOfflineReplacement(t *testing.T) {
	app := newTestServer(t)
	server := httptest.NewServer(app.Handler())
	defer server.Close()
	first := registerWorkerSocket(t, server.URL, "reconnect-worker")
	second := registerWorkerSocket(t, server.URL, "reconnect-worker")

	time.Sleep(50 * time.Millisecond)
	status, err := app.broker.Status()
	if err != nil {
		t.Fatal(err)
	}
	if model.Int(status, "onlineWorkers") != 1 {
		t.Fatalf("replacement websocket worker was marked offline: %#v", status)
	}
	if _, err := app.broker.Enqueue(model.Record{"jobId": "reconnect-job", "versionId": "version", "projectId": "project", "prompt": "test", "filenamePrefix": "test", "operation": "generate"}); err != nil {
		t.Fatal(err)
	}
	_ = second.SetReadDeadline(time.Now().Add(time.Second))
	var assignment model.Record
	if err := second.ReadJSON(&assignment); err != nil {
		t.Fatal(err)
	}
	if model.String(assignment, "type") != "task.assigned" {
		t.Fatalf("replacement worker did not receive task: %#v", assignment)
	}
	_ = first.Close()
	_ = second.Close()
	waitForWorkerOffline(t, app, "reconnect-worker")
}

func registerWorkerSocket(t *testing.T, serverURL, workerID string) *websocket.Conn {
	t.Helper()
	connection, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(serverURL, "http")+"/ws/worker", nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := connection.WriteJSON(model.Record{"type": "worker.register", "token": "test-worker-token-12345678901234567890", "workerId": workerID, "workerVersion": "test", "capabilities": []string{"seedream"}, "maxConcurrency": 1}); err != nil {
		_ = connection.Close()
		t.Fatal(err)
	}
	_ = connection.SetReadDeadline(time.Now().Add(time.Second))
	var registered model.Record
	if err := connection.ReadJSON(&registered); err != nil {
		_ = connection.Close()
		t.Fatal(err)
	}
	if model.String(registered, "type") != "worker.registered" {
		_ = connection.Close()
		t.Fatalf("unexpected registration message: %#v", registered)
	}
	return connection
}

func waitForWorkerOffline(t *testing.T, app *Server, workerID string) {
	t.Helper()
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		state, err := app.store.Read()
		if err == nil {
			worker, _ := model.Find(state.Workers, workerID)
			if worker != nil && model.String(worker, "status") == "offline" {
				return
			}
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("websocket worker %q was not marked offline", workerID)
}
