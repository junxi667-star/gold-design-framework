package service

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"

	"jewelchain-studio/internal/config"
	"jewelchain-studio/internal/model"
)

type ArkImageGenerator struct {
	config config.Config
	client *http.Client
}

func NewArkImageGenerator(cfg config.Config) *ArkImageGenerator {
	return &ArkImageGenerator{config: cfg, client: &http.Client{Timeout: cfg.ArkTimeout, CheckRedirect: func(request *http.Request, via []*http.Request) error {
		if len(via) >= 2 {
			return http.ErrUseLastResponse
		}
		if request.URL.Scheme != "https" {
			return fmt.Errorf("unsafe image redirect scheme")
		}
		return nil
	}}}
}

func (generator *ArkImageGenerator) Configured() bool {
	key := strings.TrimSpace(generator.config.ArkAPIKey)
	return key != "" && !strings.Contains(key, "请填写")
}

func (generator *ArkImageGenerator) Status() model.Record {
	return model.Record{"configured": generator.Configured(), "provider": "Volcengine Ark", "model": generator.config.ArkImageModel, "size": generator.config.ArkImageSize}
}

func (generator *ArkImageGenerator) Generate(ctx context.Context, input model.Record) (model.Record, error) {
	if !generator.Configured() {
		return nil, model.NewError("ARK_NOT_CONFIGURED", "图片服务尚未配置 ARK_API_KEY", 503, false, nil)
	}
	body, err := json.Marshal(model.Record{"model": generator.config.ArkImageModel, "prompt": model.String(input, "prompt"), "size": generator.config.ArkImageSize, "watermark": generator.config.ArkWatermark, "sequential_image_generation": "disabled", "response_format": "url", "stream": false})
	if err != nil {
		return nil, fmt.Errorf("encode Ark request: %w", err)
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, generator.config.ArkBaseURL+"/images/generations", bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("create Ark request: %w", err)
	}
	request.Header.Set("Authorization", "Bearer "+generator.config.ArkAPIKey)
	request.Header.Set("Content-Type", "application/json")
	response, err := generator.client.Do(request)
	if err != nil {
		return nil, model.NewError("ARK_REQUEST_FAILED", "调用图片服务失败", 502, true, nil)
	}
	defer response.Body.Close()
	limited := io.LimitReader(response.Body, 2<<20)
	responseBody, readErr := io.ReadAll(limited)
	if readErr != nil {
		return nil, model.NewError("ARK_RESPONSE_INVALID", "读取图片服务响应失败", 502, true, nil)
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, model.NewError("ARK_REQUEST_FAILED", "图片服务请求失败", 502, response.StatusCode >= 500, model.Record{"status": response.StatusCode})
	}
	var decoded any
	if err := json.Unmarshal(responseBody, &decoded); err != nil {
		return nil, model.NewError("ARK_RESPONSE_INVALID", "图片服务返回了无效 JSON", 502, false, nil)
	}
	imageURL := findImageURL(decoded)
	if imageURL == "" {
		return nil, model.NewError("ARK_RESPONSE_INVALID", "图片服务未返回图片地址", 502, false, nil)
	}
	parsed, err := url.Parse(imageURL)
	if err != nil || parsed.Scheme != "https" || parsed.Host == "" {
		return nil, model.NewError("ARK_RESPONSE_INVALID", "图片服务返回了不安全的图片地址", 502, false, nil)
	}
	download, err := http.NewRequestWithContext(ctx, http.MethodGet, imageURL, nil)
	if err != nil {
		return nil, model.NewError("ARK_RESPONSE_INVALID", "图片地址无效", 502, false, nil)
	}
	imageResponse, err := generator.client.Do(download)
	if err != nil {
		return nil, model.NewError("ARK_DOWNLOAD_FAILED", "下载生成图片失败", 502, true, nil)
	}
	defer imageResponse.Body.Close()
	if imageResponse.StatusCode < 200 || imageResponse.StatusCode >= 300 {
		return nil, model.NewError("ARK_DOWNLOAD_FAILED", "下载生成图片失败", 502, imageResponse.StatusCode >= 500, model.Record{"status": imageResponse.StatusCode})
	}
	image, err := io.ReadAll(io.LimitReader(imageResponse.Body, maxWorkerUploadSize+1))
	if err != nil {
		return nil, model.NewError("ARK_DOWNLOAD_FAILED", "读取生成图片失败", 502, true, nil)
	}
	if len(image) == 0 {
		return nil, model.NewError("ARK_EMPTY_IMAGE", "下载到的图片为空", 502, false, nil)
	}
	if len(image) > maxWorkerUploadSize {
		return nil, model.NewError("ARK_IMAGE_TOO_LARGE", "生成图片超过 25 MiB 限制", 502, false, nil)
	}
	mimeType, extension, valid := imageType(image)
	if !valid {
		return nil, model.NewError("ARK_UNSUPPORTED_IMAGE", "图片服务返回了不支持的图片格式", 502, false, nil)
	}
	if err := os.MkdirAll(generator.config.GeneratedDir, 0o755); err != nil {
		return nil, fmt.Errorf("create generated directory: %w", err)
	}
	filename := filenameFor(model.String(input, "filenamePrefix"), extension)
	filePath := filepath.Join(generator.config.GeneratedDir, filename)
	if err := os.WriteFile(filePath, image, 0o600); err != nil {
		return nil, fmt.Errorf("store generated image: %w", err)
	}
	hash := sha256.Sum256(image)
	requestID := response.Header.Get("X-Request-Id")
	if requestID == "" {
		requestID = model.NewID()
	}
	return model.Record{"requestId": requestID, "filename": filename, "filePath": filePath, "imageUrl": "/generated/" + filename, "mimeType": mimeType, "sizeBytes": len(image), "sha256": hex.EncodeToString(hash[:]), "modelProvider": "Volcengine Ark", "modelName": generator.config.ArkImageModel, "imageSize": generator.config.ArkImageSize}, nil
}

func findImageURL(value any) string {
	root, ok := value.(map[string]any)
	if !ok {
		return ""
	}
	if data, ok := root["data"].([]any); ok && len(data) > 0 {
		if item, ok := data[0].(map[string]any); ok {
			if result, ok := item["url"].(string); ok {
				return result
			}
			if result, ok := item["imageUrl"].(string); ok {
				return result
			}
		}
	}
	if images, ok := root["images"].([]any); ok && len(images) > 0 {
		if item, ok := images[0].(map[string]any); ok {
			if result, ok := item["image_url"].(string); ok {
				return result
			}
		}
	}
	if result, ok := root["result"].(map[string]any); ok {
		return findImageURL(result)
	}
	return ""
}
