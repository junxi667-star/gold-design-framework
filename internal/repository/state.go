package repository

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"

	"jewelchain-studio/internal/model"
)

// StateStore preserves the established v2 JSON state format. Same-process
// instances share a mutex and each commit uses a unique, fsynced temporary
// file. The format remains single-Master only: separate processes must not
// write one state file until persistence moves to a transactional database.
type StateStore struct {
	path         string
	generatedDir string
	mu           *sync.Mutex
}

var stateLocks sync.Map // map[string]*sync.Mutex, shared by same-process store instances

func NewStateStore(path, generatedDir string) *StateStore {
	cleanPath := filepath.Clean(path)
	lock, _ := stateLocks.LoadOrStore(cleanPath, &sync.Mutex{})
	return &StateStore{path: cleanPath, generatedDir: filepath.Clean(generatedDir), mu: lock.(*sync.Mutex)}
}

func (store *StateStore) Read() (model.State, error) {
	store.mu.Lock()
	defer store.mu.Unlock()
	return store.readLocked()
}

func (store *StateStore) Update(mutator func(*model.State) (any, error)) (any, error) {
	store.mu.Lock()
	defer store.mu.Unlock()
	state, err := store.readLocked()
	if err != nil {
		return nil, err
	}
	result, err := mutator(&state)
	if err != nil {
		return nil, err
	}
	if err := store.writeLocked(state); err != nil {
		return nil, err
	}
	return result, nil
}

func (store *StateStore) readLocked() (model.State, error) {
	if err := os.MkdirAll(filepath.Dir(store.path), 0o755); err != nil {
		return model.State{}, fmt.Errorf("create state directory: %w", err)
	}
	bytes, err := os.ReadFile(store.path)
	if errors.Is(err, os.ErrNotExist) {
		state := model.NewState()
		if err := store.writeLocked(state); err != nil {
			return model.State{}, err
		}
		return state, nil
	}
	if err != nil {
		return model.State{}, fmt.Errorf("read state: %w", err)
	}
	state := model.NewState()
	if err := json.Unmarshal(bytes, &state); err != nil {
		return model.State{}, fmt.Errorf("decode state: %w", err)
	}
	state.Normalize()
	store.restorePaths(&state)
	return state, nil
}

func (store *StateStore) writeLocked(state model.State) error {
	state.Normalize()
	diskState := model.Clone(state)
	store.sanitizePaths(&diskState)
	bytes, err := json.MarshalIndent(diskState, "", "  ")
	if err != nil {
		return fmt.Errorf("encode state: %w", err)
	}
	if err := os.MkdirAll(filepath.Dir(store.path), 0o755); err != nil {
		return fmt.Errorf("create state directory: %w", err)
	}
	temporary, err := os.CreateTemp(filepath.Dir(store.path), "."+filepath.Base(store.path)+"-*.tmp")
	if err != nil {
		return fmt.Errorf("create temporary state: %w", err)
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if err := temporary.Chmod(0o600); err != nil {
		_ = temporary.Close()
		return fmt.Errorf("set temporary state mode: %w", err)
	}
	if _, err := temporary.Write(append(bytes, '\n')); err != nil {
		_ = temporary.Close()
		return fmt.Errorf("write state: %w", err)
	}
	if err := temporary.Sync(); err != nil {
		_ = temporary.Close()
		return fmt.Errorf("sync state: %w", err)
	}
	if err := temporary.Close(); err != nil {
		return fmt.Errorf("close state: %w", err)
	}
	if err := os.Rename(temporaryPath, store.path); err != nil {
		return fmt.Errorf("replace state atomically: %w", err)
	}
	if directory, err := os.Open(filepath.Dir(store.path)); err == nil {
		_ = directory.Sync()
		_ = directory.Close()
	}
	return nil
}

func (store *StateStore) sanitizePaths(state *model.State) {
	for _, version := range state.Versions {
		store.makeRelative(version, "imageFilePath")
	}
	for _, upload := range state.WorkerUploads {
		store.makeRelative(upload, "filePath")
	}
	for _, task := range state.WorkerTasks {
		store.makeRelative(model.RecordValue(task, "result"), "filePath")
	}
}

func (store *StateStore) restorePaths(state *model.State) {
	for _, version := range state.Versions {
		store.makeAbsolute(version, "imageFilePath")
	}
	for _, upload := range state.WorkerUploads {
		store.makeAbsolute(upload, "filePath")
	}
	for _, task := range state.WorkerTasks {
		store.makeAbsolute(model.RecordValue(task, "result"), "filePath")
	}
}

func (store *StateStore) makeRelative(record model.Record, key string) {
	value := model.String(record, key)
	if value == "" || !filepath.IsAbs(value) {
		return
	}
	relative, err := filepath.Rel(store.generatedDir, value)
	if err == nil && relative != "." && relative != ".." && !startsOutside(relative) {
		record[key] = relative
	}
}

func (store *StateStore) makeAbsolute(record model.Record, key string) {
	value := model.String(record, key)
	if value != "" && !filepath.IsAbs(value) {
		record[key] = filepath.Join(store.generatedDir, value)
	}
}

func startsOutside(value string) bool {
	return value == ".." || len(value) > 3 && value[:3] == ".."+string(filepath.Separator)
}
