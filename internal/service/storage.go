package service

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"

	"jewelchain-studio/internal/config"
	"jewelchain-studio/internal/model"
)

type MetadataStorage struct {
	config config.Config
	client *http.Client
}

func NewMetadataStorage(cfg config.Config, client *http.Client) *MetadataStorage {
	if client == nil {
		client = http.DefaultClient
	}
	return &MetadataStorage{config: cfg, client: client}
}

func (storage *MetadataStorage) Status() model.Record {
	configured := storage.supabaseConfigured()
	mode := storage.config.StorageMode
	if mode == "" {
		mode = "auto"
	}
	effectiveMode := "local"
	if mode == "supabase" || (mode == "auto" && configured) {
		effectiveMode = "supabase"
	}
	return model.Record{"mode": mode, "effectiveMode": effectiveMode, "supabaseConfigured": configured, "localMetadataDir": storage.config.MetadataDir}
}

func (storage *MetadataStorage) PrepareImage(ctx context.Context, project, version model.Record, publicBaseURL string) (uri, mode, warning string, err error) {
	if storage.config.StorageMode == "supabase" || (storage.config.StorageMode == "auto" && storage.supabaseConfigured()) {
		image, readErr := os.ReadFile(model.String(version, "imageFilePath"))
		if readErr == nil {
			objectPath := strings.Join([]string{"designs", safePathSegment(model.String(project, "localDesignId")), fmt.Sprintf("v%d", model.Int(version, "versionNumber")), safePathSegment(model.String(version, "imageFilename"))}, "/")
			uri, err = storage.uploadObject(ctx, objectPath, image, firstNonBlank(model.String(version, "imageMimeType"), "image/png"))
			if err == nil {
				return uri, "supabase", "", nil
			}
		} else {
			err = fmt.Errorf("read source image: %w", readErr)
		}
		if storage.config.StorageMode == "supabase" {
			return "", "", "", err
		}
		warning = "Supabase 图片上传失败，已回退到本地存储"
	}
	return absolutePublicURL(publicBaseURL, model.String(version, "imageUrl")), "local", firstNonBlank(warning, "本地图片 URI 会随当前部署关闭而失效；提交前建议配置 Supabase。"), nil
}

func (storage *MetadataStorage) PutMetadata(ctx context.Context, project, version, metadata model.Record, publicBaseURL, storageMode string) (uri, persistedMode, warning string, err error) {
	if storageMode == "supabase" && storage.supabaseConfigured() {
		uri, err = storage.putSupabase(ctx, project, version, metadata)
		if err == nil {
			return uri, "supabase", "", nil
		}
		if storage.config.StorageMode == "supabase" {
			return "", "", "", err
		}
		warning = "Supabase 元数据写入失败，已回退到本地存储"
	}
	localPath := filepath.Join(safePathSegment(model.String(project, "localDesignId")), fmt.Sprintf("v%d", model.Int(version, "versionNumber")), "metadata.json")
	target := filepath.Join(storage.config.MetadataDir, localPath)
	bytes, marshalErr := json.MarshalIndent(metadata, "", "  ")
	if marshalErr != nil {
		return "", "", "", fmt.Errorf("encode metadata: %w", marshalErr)
	}
	if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
		return "", "", "", fmt.Errorf("create metadata directory: %w", err)
	}
	if err := os.WriteFile(target, append(bytes, '\n'), 0o600); err != nil {
		return "", "", "", fmt.Errorf("write metadata: %w", err)
	}
	uri = absolutePublicURL(publicBaseURL, "/metadata/"+strings.ReplaceAll(localPath, string(filepath.Separator), "/"))
	if warning == "" {
		warning = "本地 metadata URI 仅适用于当前部署；请配置 Supabase 以获得长期公开存储。"
	}
	return uri, "local", warning, nil
}

func (storage *MetadataStorage) supabaseConfigured() bool {
	return storage.config.SupabaseURL != "" && storage.config.SupabaseService != "" && storage.config.SupabaseBucket != ""
}

func (storage *MetadataStorage) putSupabase(ctx context.Context, project, version, metadata model.Record) (string, error) {
	if !storage.supabaseConfigured() {
		return "", model.NewError("STORAGE_NOT_CONFIGURED", "Supabase 存储尚未配置", 503, false, nil)
	}
	path := strings.Join([]string{"designs", safePathSegment(model.String(project, "localDesignId")), fmt.Sprintf("v%d", model.Int(version, "versionNumber")), "metadata.json"}, "/")
	payload, err := json.Marshal(metadata)
	if err != nil {
		return "", fmt.Errorf("encode metadata: %w", err)
	}
	return storage.uploadObject(ctx, path, payload, "application/json; charset=utf-8")
}

func (storage *MetadataStorage) uploadObject(ctx context.Context, objectPath string, payload []byte, contentType string) (string, error) {
	endpoint := storage.config.SupabaseURL + "/storage/v1/object/" + url.PathEscape(storage.config.SupabaseBucket) + "/" + escapeObjectPath(objectPath)
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(payload))
	if err != nil {
		return "", fmt.Errorf("create storage request: %w", err)
	}
	request.Header.Set("Authorization", "Bearer "+storage.config.SupabaseService)
	request.Header.Set("apikey", storage.config.SupabaseService)
	request.Header.Set("Content-Type", contentType)
	request.Header.Set("x-upsert", "true")
	response, err := storage.client.Do(request)
	if err != nil {
		return "", model.NewError("STORAGE_UPLOAD_FAILED", "上传 metadata 到 Supabase 失败", 502, true, nil)
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return "", model.NewError("STORAGE_UPLOAD_FAILED", "Supabase 拒绝 metadata 上传", 502, response.StatusCode >= 500, model.Record{"status": response.StatusCode})
	}
	return storage.config.SupabaseURL + "/storage/v1/object/public/" + url.PathEscape(storage.config.SupabaseBucket) + "/" + escapeObjectPath(objectPath), nil
}

func (storage *MetadataStorage) SyncDesign(ctx context.Context, project, version model.Record) error {
	if !storage.supabaseConfigured() {
		return nil
	}
	projectRow := model.Record{"id": project["id"], "local_design_id": project["localDesignId"], "title": project["title"], "current_version": project["currentVersion"], "final_version_id": project["finalVersionId"], "created_at": project["createdAt"], "updated_at": model.Now()}
	versionRow := model.Record{"id": version["id"], "project_id": version["projectId"], "version_number": version["versionNumber"], "parent_version_id": version["parentVersionId"], "parent_content_hash": version["parentContentHash"], "structured_requirement": version["structuredRequirement"], "change_request": version["changeRequest"], "prompt_snapshot": model.Record{"apiPrompt": version["apiPrompt"]}, "image_url": version["imageUri"], "image_hash": version["imageHash"], "metadata_json": version["metadata"], "metadata_uri": version["metadataUri"], "content_hash": version["contentHash"], "model_provider": version["modelProvider"], "model_name": version["modelName"], "status": version["status"], "created_at": version["createdAt"], "updated_at": model.Now()}
	if err := storage.upsert(ctx, "design_projects", []model.Record{projectRow}, "id"); err != nil {
		return err
	}
	return storage.upsert(ctx, "design_versions", []model.Record{versionRow}, "id")
}

func (storage *MetadataStorage) SaveChainRecord(ctx context.Context, record model.Record) error {
	if !storage.supabaseConfigured() {
		return nil
	}
	row := model.Record{"id": record["id"], "version_id": record["versionId"], "chain_id": record["chainId"], "contract_address": record["contractAddress"], "wallet_address": record["walletAddress"], "tx_hash": record["txHash"], "block_number": record["blockNumber"], "transaction_kind": record["kind"], "chain_status": record["status"], "submitted_at": record["submittedAt"], "confirmed_at": record["confirmedAt"], "error_message": record["errorMessage"], "updated_at": model.Now()}
	return storage.upsert(ctx, "chain_records", []model.Record{row}, "id")
}

func (storage *MetadataStorage) upsert(ctx context.Context, table string, rows []model.Record, conflict string) error {
	payload, err := json.Marshal(rows)
	if err != nil {
		return fmt.Errorf("encode %s upsert: %w", table, err)
	}
	endpoint := storage.config.SupabaseURL + "/rest/v1/" + table + "?on_conflict=" + url.QueryEscape(conflict)
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(payload))
	if err != nil {
		return fmt.Errorf("create %s upsert: %w", table, err)
	}
	request.Header.Set("Authorization", "Bearer "+storage.config.SupabaseService)
	request.Header.Set("apikey", storage.config.SupabaseService)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Prefer", "resolution=merge-duplicates,return=representation")
	response, err := storage.client.Do(request)
	if err != nil {
		return model.NewError("SUPABASE_REQUEST_FAILED", "Supabase 数据同步失败", 502, true, nil)
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return model.NewError("SUPABASE_REQUEST_FAILED", "Supabase 拒绝数据同步", 502, response.StatusCode >= 500, model.Record{"status": response.StatusCode})
	}
	return nil
}

func safePathSegment(value string) string {
	if value == "" {
		return "unknown"
	}
	var builder strings.Builder
	for _, char := range value {
		if (char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z') || (char >= '0' && char <= '9') || char == '-' || char == '_' || char == '.' {
			builder.WriteRune(char)
		} else {
			builder.WriteByte('_')
		}
	}
	return strings.Trim(builder.String(), ".")
}

func escapeObjectPath(value string) string {
	parts := strings.Split(value, "/")
	for index, item := range parts {
		parts[index] = url.PathEscape(item)
	}
	return strings.Join(parts, "/")
}
