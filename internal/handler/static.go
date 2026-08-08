package handler

import (
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"jewelchain-studio/internal/model"
)

func (server *Server) serveFrontend(writer http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodGet && request.Method != http.MethodHead {
		writeError(writer, request, model.NewError("NOT_FOUND", "Not found", http.StatusNotFound, false, nil))
		return
	}
	root := strings.TrimSpace(server.config.FrontendDir)
	if root == "" {
		writeError(writer, request, model.NewError("NOT_FOUND", "Not found", http.StatusNotFound, false, nil))
		return
	}
	requested := strings.TrimPrefix(request.URL.Path, "/")
	if requested == "" {
		requested = "index.html"
	}
	path := filepath.Join(root, filepath.FromSlash(requested))
	if safeFrontendPath(root, path) {
		if info, err := os.Stat(path); err == nil && !info.IsDir() {
			http.ServeFile(writer, request, path)
			return
		}
	}
	if filepath.Ext(requested) == "" {
		index := filepath.Join(root, "index.html")
		if info, err := os.Stat(index); err == nil && !info.IsDir() {
			http.ServeFile(writer, request, index)
			return
		}
	}
	writeError(writer, request, model.NewError("NOT_FOUND", "Not found", http.StatusNotFound, false, nil))
}

func safeFrontendPath(root, path string) bool {
	resolvedRoot, rootErr := filepath.Abs(root)
	resolvedPath, pathErr := filepath.Abs(path)
	if rootErr != nil || pathErr != nil {
		return false
	}
	relative, err := filepath.Rel(resolvedRoot, resolvedPath)
	return err == nil && relative != ".." && !strings.HasPrefix(relative, ".."+string(filepath.Separator))
}

func (server *Server) serveRestrictedFile(writer http.ResponseWriter, request *http.Request, base, requested string, contentTypes map[string]string) {
	if request.Method != http.MethodGet && request.Method != http.MethodHead {
		writer.Header().Set("Allow", "GET, HEAD")
		writeError(writer, request, model.NewError("METHOD_NOT_ALLOWED", "Method not allowed", http.StatusMethodNotAllowed, false, nil))
		return
	}
	decoded, err := url.PathUnescape(requested)
	if err != nil {
		writeError(writer, request, model.NewError("INVALID_ROUTE_PARAMETER", "路径参数无效", http.StatusBadRequest, false, nil))
		return
	}
	target := filepath.Clean(filepath.Join(base, decoded))
	cleanBase := filepath.Clean(base)
	if target == cleanBase || !strings.HasPrefix(target, cleanBase+string(filepath.Separator)) {
		writeError(writer, request, model.NewError("INVALID_ASSET_PATH", "Invalid asset path", http.StatusBadRequest, false, nil))
		return
	}
	contentType, allowed := contentTypes[strings.ToLower(filepath.Ext(target))]
	if !allowed {
		writeError(writer, request, model.NewError("NOT_FOUND", "Not found", http.StatusNotFound, false, nil))
		return
	}
	file, err := os.Open(target)
	if err != nil {
		writeError(writer, request, model.NewError("NOT_FOUND", "Not found", http.StatusNotFound, false, nil))
		return
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() {
		writeError(writer, request, model.NewError("NOT_FOUND", "Not found", http.StatusNotFound, false, nil))
		return
	}
	writer.Header().Set("Content-Type", contentType)
	writer.Header().Set("Content-Length", strconv.FormatInt(info.Size(), 10))
	writer.Header().Set("Cache-Control", "private, max-age=3600")
	if request.Method == http.MethodHead {
		writer.WriteHeader(http.StatusOK)
		return
	}
	_, _ = io.Copy(writer, file)
}
