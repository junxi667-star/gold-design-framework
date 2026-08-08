package config

import (
	"bufio"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

const (
	defaultPort             = "4173"
	defaultWorkerLease      = 120 * time.Second
	defaultWorkerStaleAfter = 90 * time.Second
)

// Config holds only runtime configuration. Secrets always come from the
// environment (or the ignored .env file in local development), never source.
type Config struct {
	RootDir            string
	Host               string
	Port               string
	StatePath          string
	GeneratedDir       string
	MetadataDir        string
	WorkerUploadDir    string
	WorkerGeneratedDir string
	FrontendDir        string
	WorkerID           string
	MasterBaseURL      string
	WorkerPollInterval time.Duration
	PublicBaseURL      string
	CORSOrigins        []string
	DemoAccessCode     string
	DemoProtectReads   bool
	GenerationLimit    int
	WorkerToken        string
	WorkerLease        time.Duration
	WorkerStaleAfter   time.Duration
	WorkerMaxAttempt   int
	ExecutionMode      string
	JobWaitTimeout     time.Duration
	ArkAPIKey          string
	ArkBaseURL         string
	ArkImageModel      string
	ArkImageSize       string
	ArkWatermark       bool
	ArkTimeout         time.Duration
	StorageMode        string
	SupabaseURL        string
	SupabaseService    string
	SupabaseBucket     string
	ChainID            int64
	RPCURL             string
	ExplorerURL        string
	RegistryAddress    string
}

// Load reads .env without overriding process environment, matching the legacy
// server's precedence. rootDir is normally the repository root.
func Load(rootDir string) Config {
	loadDotEnv(filepath.Join(rootDir, ".env"))
	cfg := Config{
		RootDir:            rootDir,
		Host:               env("HOST", "127.0.0.1"),
		Port:               env("PORT", defaultPort),
		StatePath:          env("JEWELCHAIN_STATE_PATH", filepath.Join(rootDir, "data", "jewelchain-state.json")),
		GeneratedDir:       filepath.Join(rootDir, "generated"),
		MetadataDir:        filepath.Join(rootDir, "metadata"),
		WorkerUploadDir:    filepath.Join(rootDir, "data", "worker-uploads"),
		WorkerGeneratedDir: pathFromRoot(rootDir, env("IMAGE_WORKER_GENERATED_DIR", "worker-generated")),
		FrontendDir:        pathFromRoot(rootDir, env("FRONTEND_DIST_DIR", "public")),
		WorkerID:           strings.TrimSpace(os.Getenv("WORKER_ID")),
		MasterBaseURL:      strings.TrimRight(env("MASTER_BASE_URL", "http://127.0.0.1:4173"), "/"),
		WorkerPollInterval: durationMillis("WORKER_POLL_INTERVAL_MS", 5*time.Second),
		PublicBaseURL:      strings.TrimRight(env("PUBLIC_BASE_URL", ""), "/"),
		CORSOrigins:        splitCSV(env("CORS_ALLOWED_ORIGINS", "https://demo.jewelchain.xyz")),
		DemoAccessCode:     strings.TrimSpace(os.Getenv("DEMO_ACCESS_CODE")),
		DemoProtectReads:   boolEnv("DEMO_PROTECT_READS", false),
		GenerationLimit:    intEnv("DEMO_GENERATION_LIMIT_PER_HOUR", 10),
		WorkerToken:        strings.TrimSpace(os.Getenv("WORKER_TOKEN")),
		WorkerLease:        durationSeconds("WORKER_LEASE_SECONDS", defaultWorkerLease),
		WorkerStaleAfter:   defaultWorkerStaleAfter,
		WorkerMaxAttempt:   intEnv("WORKER_TASK_MAX_ATTEMPTS", 3),
		ExecutionMode:      strings.ToLower(env("IMAGE_EXECUTION_MODE", "worker")),
		JobWaitTimeout:     durationMillis("WORKER_JOB_WAIT_TIMEOUT_MS", 7*24*time.Hour),
		ArkAPIKey:          strings.TrimSpace(os.Getenv("ARK_API_KEY")),
		ArkBaseURL:         strings.TrimRight(env("ARK_BASE_URL", "https://ark.cn-beijing.volces.com/api/v3"), "/"),
		ArkImageModel:      env("ARK_IMAGE_MODEL", "doubao-seedream-5-0-260128"),
		ArkImageSize:       env("ARK_IMAGE_SIZE", "2K"),
		ArkWatermark:       boolEnv("ARK_IMAGE_WATERMARK", true),
		ArkTimeout:         durationMillis("ARK_IMAGE_TIMEOUT_MS", 180*time.Second),
		StorageMode:        strings.ToLower(env("STORAGE_MODE", "auto")),
		SupabaseURL:        strings.TrimRight(env("SUPABASE_URL", ""), "/"),
		SupabaseService:    strings.TrimSpace(os.Getenv("SUPABASE_SERVICE_ROLE_KEY")),
		SupabaseBucket:     env("SUPABASE_PUBLIC_BUCKET", "jewelchain-public"),
		ChainID:            int64(intEnv("MONAD_CHAIN_ID", 10143)),
		RPCURL:             strings.TrimRight(env("MONAD_RPC_URL", "https://testnet-rpc.monad.xyz"), "/"),
		ExplorerURL:        strings.TrimRight(env("MONAD_EXPLORER_URL", "https://testnet.monadvision.com"), "/"),
		RegistryAddress:    strings.TrimSpace(env("DESIGN_REGISTRY_ADDRESS", "0x017BA6A7b6d90387bc588ad6FccDf2e0FD16D8b7")),
	}
	if cfg.GenerationLimit < 1 {
		cfg.GenerationLimit = 1
	}
	if cfg.WorkerMaxAttempt < 1 {
		cfg.WorkerMaxAttempt = 1
	}
	if cfg.ExecutionMode != "direct" && cfg.ExecutionMode != "hybrid" && cfg.ExecutionMode != "worker" {
		cfg.ExecutionMode = "worker"
	}
	return cfg
}

func env(key, fallback string) string {
	if value, ok := os.LookupEnv(key); ok && strings.TrimSpace(value) != "" {
		return strings.TrimSpace(value)
	}
	return fallback
}

func boolEnv(key string, fallback bool) bool {
	value, ok := os.LookupEnv(key)
	if !ok {
		return fallback
	}
	parsed, err := strconv.ParseBool(strings.TrimSpace(value))
	if err != nil {
		return fallback
	}
	return parsed
}

func intEnv(key string, fallback int) int {
	value, err := strconv.Atoi(strings.TrimSpace(os.Getenv(key)))
	if err != nil {
		return fallback
	}
	return value
}

func durationSeconds(key string, fallback time.Duration) time.Duration {
	seconds := intEnv(key, int(fallback/time.Second))
	if seconds < 1 {
		return fallback
	}
	return time.Duration(seconds) * time.Second
}

func durationMillis(key string, fallback time.Duration) time.Duration {
	value := intEnv(key, int(fallback/time.Millisecond))
	if value < 1 {
		return fallback
	}
	return time.Duration(value) * time.Millisecond
}

func splitCSV(value string) []string {
	items := strings.Split(value, ",")
	result := make([]string, 0, len(items))
	for _, item := range items {
		if item = strings.TrimSpace(item); item != "" {
			result = append(result, item)
		}
	}
	return result
}

func pathFromRoot(rootDir, value string) string {
	if filepath.IsAbs(value) {
		return filepath.Clean(value)
	}
	return filepath.Join(rootDir, value)
}

func loadDotEnv(path string) {
	file, err := os.Open(path)
	if err != nil {
		return
	}
	defer file.Close()
	for scanner := bufio.NewScanner(file); scanner.Scan(); {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		key, value, found := strings.Cut(line, "=")
		key = strings.TrimSpace(key)
		if !found || key == "" {
			continue
		}
		if _, exists := os.LookupEnv(key); exists {
			continue
		}
		value = strings.Trim(strings.TrimSpace(value), "\"'")
		_ = os.Setenv(key, value)
	}
}
