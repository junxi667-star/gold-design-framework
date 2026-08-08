package model

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math"
	"strings"
	"time"
)

const StateSchemaVersion = "jewelchain-state/v2"

type Record map[string]any

type State struct {
	SchemaVersion string            `json:"schemaVersion"`
	Projects      []Record          `json:"projects"`
	Versions      []Record          `json:"versions"`
	Jobs          []Record          `json:"jobs"`
	ChainRecords  []Record          `json:"chainRecords"`
	WorkerTasks   []Record          `json:"workerTasks"`
	Workers       []Record          `json:"workers"`
	WorkerUploads []Record          `json:"workerUploads"`
	Idempotency   map[string]Record `json:"idempotency"`
}

func NewState() State {
	return State{
		SchemaVersion: StateSchemaVersion,
		Projects:      []Record{},
		Versions:      []Record{},
		Jobs:          []Record{},
		ChainRecords:  []Record{},
		WorkerTasks:   []Record{},
		Workers:       []Record{},
		WorkerUploads: []Record{},
		Idempotency:   map[string]Record{},
	}
}

func (state *State) Normalize() {
	if state.SchemaVersion == "" {
		state.SchemaVersion = StateSchemaVersion
	}
	if state.Projects == nil {
		state.Projects = []Record{}
	}
	if state.Versions == nil {
		state.Versions = []Record{}
	}
	if state.Jobs == nil {
		state.Jobs = []Record{}
	}
	if state.ChainRecords == nil {
		state.ChainRecords = []Record{}
	}
	if state.WorkerTasks == nil {
		state.WorkerTasks = []Record{}
	}
	if state.Workers == nil {
		state.Workers = []Record{}
	}
	if state.WorkerUploads == nil {
		state.WorkerUploads = []Record{}
	}
	if state.Idempotency == nil {
		state.Idempotency = map[string]Record{}
	}
}

func CloneRecord(record Record) Record {
	if record == nil {
		return nil
	}
	cloned := make(Record, len(record))
	for k, v := range record {
		switch typed := v.(type) {
		case Record:
			cloned[k] = CloneRecord(typed)
		case map[string]any:
			cloned[k] = CloneRecord(Record(typed))
		case []Record:
			clonedSlice := make([]Record, len(typed))
			for i, item := range typed {
				clonedSlice[i] = CloneRecord(item)
			}
			cloned[k] = clonedSlice
		case []any:
			clonedSlice := make([]any, len(typed))
			for i, item := range typed {
				if rec, ok := item.(Record); ok {
					clonedSlice[i] = CloneRecord(rec)
				} else if m, ok := item.(map[string]any); ok {
					clonedSlice[i] = CloneRecord(Record(m))
				} else {
					clonedSlice[i] = item
				}
			}
			cloned[k] = clonedSlice
		default:
			cloned[k] = v
		}
	}
	return cloned
}

func Clone[T any](value T) T {
	switch typed := any(value).(type) {
	case Record:
		return any(CloneRecord(typed)).(T)
	default:
		var cloned T
		bytes, _ := json.Marshal(value)
		_ = json.Unmarshal(bytes, &cloned)
		return cloned
	}
}

func NewID() string {
	bytes := make([]byte, 16)
	if _, err := rand.Read(bytes); err != nil {
		return fmt.Sprintf("fallback-%d", time.Now().UnixNano())
	}
	bytes[6] = (bytes[6] & 0x0f) | 0x40
	bytes[8] = (bytes[8] & 0x3f) | 0x80
	return hex.EncodeToString(bytes[0:4]) + "-" + hex.EncodeToString(bytes[4:6]) + "-" + hex.EncodeToString(bytes[6:8]) + "-" + hex.EncodeToString(bytes[8:10]) + "-" + hex.EncodeToString(bytes[10:16])
}

func Now() string { return time.Now().UTC().Format(time.RFC3339Nano) }

func String(record Record, key string) string {
	value, ok := record[key]
	if !ok || value == nil {
		return ""
	}
	switch typed := value.(type) {
	case string:
		return strings.TrimSpace(typed)
	case fmt.Stringer:
		return strings.TrimSpace(typed.String())
	default:
		return strings.TrimSpace(fmt.Sprint(value))
	}
}

func Number(record Record, key string) float64 {
	value, ok := record[key]
	if !ok || value == nil {
		return 0
	}
	switch typed := value.(type) {
	case float64:
		return typed
	case float32:
		return float64(typed)
	case int:
		return float64(typed)
	case int64:
		return float64(typed)
	case json.Number:
		result, _ := typed.Float64()
		return result
	default:
		var result float64
		_, _ = fmt.Sscan(fmt.Sprint(value), &result)
		return result
	}
}

func Int(record Record, key string) int { return int(math.Round(Number(record, key))) }

func Bool(record Record, key string) bool {
	value, ok := record[key]
	if !ok || value == nil {
		return false
	}
	if result, ok := value.(bool); ok {
		return result
	}
	return strings.EqualFold(fmt.Sprint(value), "true")
}

func RecordValue(record Record, key string) Record {
	switch value := record[key].(type) {
	case Record:
		return value
	case map[string]any:
		return Record(value)
	default:
		return nil
	}
}

func Records(value any) []Record {
	items, ok := value.([]any)
	if !ok {
		if records, ok := value.([]Record); ok {
			return records
		}
		return []Record{}
	}
	result := make([]Record, 0, len(items))
	for _, item := range items {
		switch record := item.(type) {
		case Record:
			result = append(result, record)
		case map[string]any:
			result = append(result, Record(record))
		}
	}
	return result
}

func Strings(value any) []string {
	items, ok := value.([]any)
	if !ok {
		if stringsValue, ok := value.([]string); ok {
			return stringsValue
		}
		return []string{}
	}
	result := make([]string, 0, len(items))
	for _, item := range items {
		if text := strings.TrimSpace(fmt.Sprint(item)); text != "" {
			result = append(result, text)
		}
	}
	return result
}

func HasString(value any, expected string) bool {
	for _, item := range Strings(value) {
		if item == expected {
			return true
		}
	}
	return false
}

func Find(records []Record, id string) (Record, int) {
	for index, record := range records {
		if String(record, "id") == id {
			return record, index
		}
	}
	return nil, -1
}

type AppError struct {
	Code      string `json:"code"`
	Message   string `json:"message"`
	Status    int    `json:"-"`
	Retryable bool   `json:"retryable"`
	Details   any    `json:"details,omitempty"`
}

func (err *AppError) Error() string { return err.Code + ": " + err.Message }

func NewError(code, message string, status int, retryable bool, details any) *AppError {
	if status == 0 {
		status = DefaultHTTPStatus(code)
	}
	return &AppError{Code: code, Message: message, Status: status, Retryable: retryable, Details: details}
}

func DefaultHTTPStatus(code string) int {
	switch code {
	case "INVALID_DEMO_ACCESS_CODE", "WORKER_UNAUTHORIZED":
		return 401
	case "UNAUTHORIZED_FINALIZER":
		return 403
	case "PROJECT_NOT_FOUND", "VERSION_NOT_FOUND", "PARENT_VERSION_NOT_FOUND", "JOB_NOT_FOUND", "WORKER_TASK_NOT_FOUND", "WORKER_NOT_REGISTERED":
		return 404
	case "PARENT_NOT_ONCHAIN", "DESIGN_FINALIZED", "VERSION_NOT_READY", "REGISTRANT_LOCKED", "PARENT_NOT_CONFIRMED", "WALLET_MISMATCH", "VERSION_NOT_REGISTERED", "WORKER_NOT_ONLINE", "WORKER_LEASE_MISMATCH", "WORKER_LEASE_EXPIRED", "WORKER_TASK_STATE_INVALID", "WORKER_UPLOAD_NOT_FOUND", "WORKER_UPLOAD_HASH_MISMATCH":
		return 409
	case "GENERATION_RATE_LIMITED":
		return 429
	case "WORKER_TOKEN_NOT_CONFIGURED":
		return 503
	case "WORKER_WAIT_TIMEOUT":
		return 504
	case "WORKER_UPLOAD_UNSUPPORTED_IMAGE", "WORKER_UPLOAD_MIME_MISMATCH":
		return 415
	case "ARK_REQUEST_FAILED", "ARK_RESPONSE_INVALID", "RPC_REQUEST_FAILED", "RPC_CONNECT_FAILED", "GENERATION_FAILED", "WORKER_TASK_FAILED":
		return 502
	default:
		return 400
	}
}
