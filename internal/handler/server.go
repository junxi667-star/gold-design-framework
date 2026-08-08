package handler

import (
	"log/slog"
	"net/http"
	"strings"

	"jewelchain-studio/internal/config"
	"jewelchain-studio/internal/model"
	"jewelchain-studio/internal/repository"
	"jewelchain-studio/internal/service"
)

const jsonBodyLimit = 2 << 20

type Server struct {
	config config.Config
	store  *repository.StateStore
	design *service.DesignService
	chain  *service.ChainService
	broker *service.TaskBroker
	hub    *WorkerHub
	guard  *mutationGuard
	logger *slog.Logger
}

func New(cfg config.Config) *Server {
	store := repository.NewStateStore(cfg.StatePath, cfg.GeneratedDir)
	broker := service.NewTaskBroker(cfg, store)
	generator := service.NewArkImageGenerator(cfg)
	design := service.NewDesignService(cfg, store, broker, generator)
	storage := service.NewMetadataStorage(cfg, nil)
	chain := service.NewChainService(cfg, store, storage)
	guard := newMutationGuard(cfg.DemoAccessCode, cfg.GenerationLimit)
	return &Server{config: cfg, store: store, design: design, chain: chain, broker: broker, hub: NewWorkerHub(cfg, broker), guard: guard, logger: slog.Default()}
}

func (server *Server) Start(stop <-chan struct{}) {
	server.broker.Start(stop)
	server.design.ResumePendingJobs()
	server.logger.Info("server started", "mode", server.config.ExecutionMode)
}

func (server *Server) Handler() http.Handler {
	return server.withRequestContext(http.HandlerFunc(server.serveHTTP))
}

func (server *Server) serveHTTP(writer http.ResponseWriter, request *http.Request) {
	path := request.URL.Path
	if path == "/ws/worker" {
		server.hub.HandleUpgrade(writer, request)
		return
	}
	if path == "/health" || path == "/ready" {
		writeData(writer, http.StatusOK, model.Record{"status": "ok", "service": "jewelchain-studio-go", "timestamp": model.Now()})
		return
	}
	if strings.HasPrefix(path, "/api/") {
		if server.applyCORS(writer, request) {
			return
		}
		server.routeAPI(writer, request)
		return
	}
	if strings.HasPrefix(path, "/generated/") {
		server.serveRestrictedFile(writer, request, server.config.GeneratedDir, strings.TrimPrefix(path, "/generated/"), map[string]string{".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp"})
		return
	}
	if strings.HasPrefix(path, "/metadata/") {
		server.serveRestrictedFile(writer, request, server.config.MetadataDir, strings.TrimPrefix(path, "/metadata/"), map[string]string{".json": "application/json; charset=utf-8"})
		return
	}
	server.serveFrontend(writer, request)
}
