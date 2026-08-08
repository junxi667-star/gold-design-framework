package handler

import (
	"crypto/subtle"
	"encoding/json"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"

	"jewelchain-studio/internal/config"
	"jewelchain-studio/internal/model"
	"jewelchain-studio/internal/service"
)

const (
	workerAuthDeadline  = 10 * time.Second
	workerReadDeadline  = 90 * time.Second
	workerWriteDeadline = 10 * time.Second
)

type workerConnection struct {
	conn *websocket.Conn
	mu   sync.Mutex
}

func (connection *workerConnection) send(value any) error {
	connection.mu.Lock()
	defer connection.mu.Unlock()
	if err := connection.conn.SetWriteDeadline(time.Now().Add(workerWriteDeadline)); err != nil {
		return err
	}
	err := connection.conn.WriteJSON(value)
	_ = connection.conn.SetWriteDeadline(time.Time{})
	return err
}

type WorkerHub struct {
	config      config.Config
	broker      *service.TaskBroker
	mu          sync.RWMutex
	peers       map[string]*workerConnection
	upgrade     websocket.Upgrader
	authTimeout time.Duration
	readTimeout time.Duration
}

func NewWorkerHub(cfg config.Config, broker *service.TaskBroker) *WorkerHub {
	hub := &WorkerHub{config: cfg, broker: broker, peers: map[string]*workerConnection{}, authTimeout: workerAuthDeadline, readTimeout: workerReadDeadline, upgrade: websocket.Upgrader{ReadBufferSize: 4096, WriteBufferSize: 4096, CheckOrigin: func(request *http.Request) bool { return request.Header.Get("Origin") == "" }}}
	broker.SetNotifier(hub.DispatchPending)
	return hub
}

func (hub *WorkerHub) HandleUpgrade(writer http.ResponseWriter, request *http.Request) {
	if hub.config.WorkerToken == "" {
		http.Error(writer, "Worker token is not configured", http.StatusServiceUnavailable)
		return
	}
	connection, err := hub.upgrade.Upgrade(writer, request, nil)
	if err != nil {
		return
	}
	connection.SetReadLimit(1 << 20)
	_ = connection.SetReadDeadline(time.Now().Add(hub.authTimeout))
	_, initial, err := connection.ReadMessage()
	if err != nil {
		_ = connection.Close()
		return
	}
	var message model.Record
	if err := json.Unmarshal(initial, &message); err != nil || model.String(message, "type") != "worker.register" || !safeEqual(model.String(message, "token"), hub.config.WorkerToken) {
		_ = connection.WriteJSON(model.Record{"type": "server.error", "code": "WORKER_UNAUTHORIZED", "message": "Worker 认证失败"})
		_ = connection.Close()
		return
	}
	workerID := model.String(message, "workerId")
	message["transport"] = "websocket"
	worker, err := hub.broker.RegisterWorker(workerID, message, request.RemoteAddr)
	if err != nil {
		_ = connection.WriteJSON(model.Record{"type": "server.error", "code": errorCode(err), "message": safeMessage(err)})
		_ = connection.Close()
		return
	}
	peer := &workerConnection{conn: connection}
	hub.mu.Lock()
	previous := hub.peers[workerID]
	hub.peers[workerID] = peer
	hub.mu.Unlock()
	if previous != nil {
		_ = previous.conn.Close()
	}
	defer func() {
		hub.mu.Lock()
		current := hub.peers[workerID]
		isCurrent := current == peer
		if isCurrent {
			delete(hub.peers, workerID)
		}
		hub.mu.Unlock()
		if isCurrent {
			_ = hub.broker.MarkWorkerOffline(workerID)
		}
		_ = connection.Close()
	}()
	_ = connection.SetReadDeadline(time.Now().Add(hub.readTimeout))
	connection.SetPongHandler(func(string) error { return connection.SetReadDeadline(time.Now().Add(hub.readTimeout)) })
	if err := peer.send(model.Record{"type": "worker.registered", "worker": worker, "heartbeatIntervalMs": 30000, "leaseSeconds": int(hub.config.WorkerLease.Seconds())}); err != nil {
		return
	}
	hub.DispatchPending(workerID)
	for {
		_, raw, readErr := connection.ReadMessage()
		if readErr != nil {
			return
		}
		_ = connection.SetReadDeadline(time.Now().Add(hub.readTimeout))
		var next model.Record
		if err := json.Unmarshal(raw, &next); err != nil {
			_ = peer.send(model.Record{"type": "server.error", "code": "INVALID_JSON", "message": "无效 Worker 消息"})
			continue
		}
		switch model.String(next, "type") {
		case "worker.heartbeat":
			next["transport"] = "websocket"
			if _, err := hub.broker.Heartbeat(workerID, next); err != nil {
				_ = peer.send(model.Record{"type": "server.error", "code": errorCode(err), "message": safeMessage(err)})
				return
			}
			if err := peer.send(model.Record{"type": "server.heartbeat", "timestamp": model.Now()}); err != nil {
				return
			}
			if workerAvailable(next) {
				hub.DispatchPending(workerID)
			}
		case "worker.ready":
			hub.DispatchPending(workerID)
		default:
			_ = peer.send(model.Record{"type": "server.error", "code": "WORKER_MESSAGE_INVALID", "message": "未知 Worker 消息类型"})
		}
	}
}

func (hub *WorkerHub) DispatchPending(preferredWorkerID string) {
	hub.mu.RLock()
	peers := map[string]*workerConnection{}
	if preferredWorkerID != "" {
		if peer := hub.peers[preferredWorkerID]; peer != nil {
			peers[preferredWorkerID] = peer
		}
	} else {
		for id, peer := range hub.peers {
			peers[id] = peer
		}
	}
	hub.mu.RUnlock()
	for workerID, peer := range peers {
		task, err := hub.broker.ClaimTask(workerID)
		if err != nil || task == nil {
			continue
		}
		if err := peer.send(model.Record{"type": "task.assigned", "task": task}); err != nil {
			hub.disconnectCurrentPeer(workerID, peer)
		}
	}
}

func (hub *WorkerHub) disconnectCurrentPeer(workerID string, peer *workerConnection) {
	hub.mu.Lock()
	isCurrent := hub.peers[workerID] == peer
	if isCurrent {
		delete(hub.peers, workerID)
	}
	hub.mu.Unlock()
	if isCurrent {
		_ = peer.conn.Close()
		_ = hub.broker.MarkWorkerOffline(workerID)
	}
}

func safeEqual(left, right string) bool {
	if left == "" || len(left) != len(right) {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(left), []byte(right)) == 1
}
func workerAvailable(details model.Record) bool {
	value, present := details["available"]
	return !present || value != false
}
