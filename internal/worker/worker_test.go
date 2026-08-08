package worker_test

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"jewelchain-studio/internal/config"
	"jewelchain-studio/internal/handler"
	"jewelchain-studio/internal/model"
	"jewelchain-studio/internal/worker"
)

var validPNG = []byte{
	0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n',
	0x00, 0x00, 0x00, 0x0d, 'I', 'H', 'D', 'R',
	0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
	0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
	0x89, 0x00, 0x00, 0x00, 0x0d, 'I', 'D', 'A', 'T',
	0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0xf0, 0x1f,
	0x00, 0x05, 0xfe, 0x02, 0xfe, 0x66, 0xb3, 0xf4,
	0x00, 0x00, 0x00, 0x00, 'I', 'E', 'N', 'D', 0xae,
	0x42, 0x60, 0x82,
}

type fakeGenerator struct {
	directory string
}

func (generator fakeGenerator) Configured() bool { return true }
func (generator fakeGenerator) Status() model.Record {
	return model.Record{"configured": true, "provider": "test"}
}
func (generator fakeGenerator) Generate(_ context.Context, _ model.Record) (model.Record, error) {
	path := filepath.Join(generator.directory, "worker-result.png")
	if err := os.MkdirAll(generator.directory, 0o755); err != nil {
		return nil, err
	}
	if err := os.WriteFile(path, validPNG, 0o600); err != nil {
		return nil, err
	}
	hash := sha256.Sum256(validPNG)
	return model.Record{
		"requestId":     "worker-test-request",
		"filename":      "worker-result.png",
		"filePath":      path,
		"mimeType":      "image/png",
		"sha256":        hex.EncodeToString(hash[:]),
		"modelProvider": "test-worker",
		"modelName":     "fake-seedream",
		"imageSize":     "1x1",
	}, nil
}

func TestGoWorkerCompletesWebSocketAssignedTask(t *testing.T) {
	root := t.TempDir()
	cfg := config.Config{
		StatePath:          filepath.Join(root, "data", "state.json"),
		GeneratedDir:       filepath.Join(root, "generated"),
		MetadataDir:        filepath.Join(root, "metadata"),
		WorkerUploadDir:    filepath.Join(root, "uploads"),
		WorkerGeneratedDir: filepath.Join(root, "worker-generated"),
		WorkerID:           "go-worker-test",
		WorkerToken:        "worker-test-token-12345678901234567890",
		WorkerLease:        time.Minute,
		WorkerStaleAfter:   time.Minute,
		WorkerMaxAttempt:   3,
		GenerationLimit:    10,
		ExecutionMode:      "worker",
		RegistryAddress:    "0x017BA6A7b6d90387bc588ad6FccDf2e0FD16D8b7",
		ChainID:            10143,
		WorkerPollInterval: 1500 * time.Millisecond,
	}
	app := handler.New(cfg)
	server := httptest.NewServer(app.Handler())
	t.Cleanup(server.Close)
	cfg.MasterBaseURL = server.URL

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() {
		done <- worker.New(cfg, fakeGenerator{directory: cfg.WorkerGeneratedDir}).Run(ctx)
	}()
	t.Cleanup(func() {
		cancel()
		select {
		case err := <-done:
			if err != nil {
				t.Errorf("worker stopped with error: %v", err)
			}
		case <-time.After(2 * time.Second):
			t.Error("worker did not stop")
		}
		waitFor(t, time.Second, func() bool {
			response, err := http.Get(server.URL + "/api/v1/workers/status")
			if err != nil {
				return false
			}
			defer response.Body.Close()
			var envelope struct {
				Data struct {
					OnlineWorkers int `json:"onlineWorkers"`
				} `json:"data"`
			}
			return response.StatusCode == http.StatusOK && json.NewDecoder(response.Body).Decode(&envelope) == nil && envelope.Data.OnlineWorkers == 0
		})
	})

	waitFor(t, 2*time.Second, func() bool {
		response, err := http.Get(server.URL + "/api/v1/workers/status")
		if err != nil {
			return false
		}
		defer response.Body.Close()
		var envelope struct {
			Data struct {
				OnlineWorkers int `json:"onlineWorkers"`
				Workers       []struct {
					Transport string `json:"transport"`
				} `json:"workers"`
			} `json:"data"`
		}
		return response.StatusCode == http.StatusOK && json.NewDecoder(response.Body).Decode(&envelope) == nil && envelope.Data.OnlineWorkers == 1 && len(envelope.Data.Workers) == 1 && envelope.Data.Workers[0].Transport == "websocket"
	})

	response, err := http.Post(server.URL+"/api/hackathon/designs", "application/json", strings.NewReader(`{"customerText":"设计一枚轻盈的新中式黄金戒指，使用祥云元素"}`))
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusAccepted {
		t.Fatalf("create design: %d", response.StatusCode)
	}
	var created struct {
		Data struct {
			JobID string `json:"jobId"`
		} `json:"data"`
	}
	if err := json.NewDecoder(response.Body).Decode(&created); err != nil {
		t.Fatal(err)
	}
	if created.Data.JobID == "" {
		t.Fatal("missing job id")
	}

	waitFor(t, 4*time.Second, func() bool {
		response, err := http.Get(server.URL + "/api/hackathon/jobs/" + created.Data.JobID)
		if err != nil {
			return false
		}
		defer response.Body.Close()
		var envelope struct {
			Data struct {
				Status string `json:"status"`
			} `json:"data"`
		}
		return response.StatusCode == http.StatusOK && json.NewDecoder(response.Body).Decode(&envelope) == nil && envelope.Data.Status == "succeeded"
	})
}

func waitFor(t *testing.T, timeout time.Duration, condition func() bool) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if condition() {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatal("condition was not met before timeout")
}
