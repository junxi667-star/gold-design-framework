package service

import (
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"os"
	"regexp"
	"strconv"
	"strings"
	"sync/atomic"
	"time"

	"jewelchain-studio/internal/config"
	"jewelchain-studio/internal/model"
	"jewelchain-studio/internal/repository"
)

var (
	addressPattern = regexp.MustCompile(`(?i)^0x[0-9a-f]{40}$`)
	bytes32Pattern = regexp.MustCompile(`(?i)^0x[0-9a-f]{64}$`)
	txHashPattern  = regexp.MustCompile(`(?i)^0x[0-9a-f]{64}$`)
)

type ChainService struct {
	config   config.Config
	store    *repository.StateStore
	storage  *MetadataStorage
	client   *http.Client
	sequence atomic.Int64
}

func NewChainService(cfg config.Config, store *repository.StateStore, storage *MetadataStorage) *ChainService {
	return &ChainService{config: cfg, store: store, storage: storage, client: &http.Client{Timeout: 12 * time.Second}}
}

func (service *ChainService) Config() model.Record {
	configuration := service.walletConfiguration()
	configuration["configured"] = service.config.RPCURL != "" && addressPattern.MatchString(service.config.RegistryAddress)
	configuration["rpcUrl"] = service.config.RPCURL
	configuration["explorerUrl"] = service.config.ExplorerURL
	return configuration
}

func (service *ChainService) walletConfiguration() model.Record {
	chainName := "Monad"
	if service.config.ChainID == 10143 {
		chainName = "Monad Testnet"
	}
	return model.Record{
		"chainId":           service.config.ChainID,
		"chainIdHex":        fmt.Sprintf("0x%x", service.config.ChainID),
		"chainName":         chainName,
		"nativeCurrency":    model.Record{"name": "MON", "symbol": "MON", "decimals": 18},
		"rpcUrls":           []string{service.config.RPCURL},
		"blockExplorerUrls": []string{service.config.ExplorerURL},
		"contractAddress":   normalizeAddress(service.config.RegistryAddress),
	}
}

func (service *ChainService) validateRegistry() error {
	if !addressPattern.MatchString(normalizeAddress(service.config.RegistryAddress)) {
		return model.NewError("CHAIN_NOT_CONFIGURED", "Design Registry 合约地址无效", http.StatusServiceUnavailable, false, nil)
	}
	return nil
}

func (service *ChainService) Status(ctx context.Context) model.Record {
	result := model.Record{"configured": service.config.RPCURL != "" && addressPattern.MatchString(service.config.RegistryAddress), "reachable": false, "expectedChainId": service.config.ChainID, "contractAddress": service.config.RegistryAddress, "contractCodePresent": false, "explorerUrl": service.config.ExplorerURL}
	if !model.Bool(result, "configured") {
		return result
	}
	chainID, err := service.rpc(ctx, "eth_chainId", []any{})
	if err != nil {
		result["error"] = "RPC 不可用"
		return result
	}
	chainIDText, _ := chainID.(string)
	actualID, parseErr := parseHexInt(chainIDText)
	if parseErr != nil {
		result["error"] = "RPC 返回了无效链 ID"
		return result
	}
	result["actualChainId"] = actualID
	code, err := service.rpc(ctx, "eth_getCode", []any{service.config.RegistryAddress, "latest"})
	if err != nil {
		result["error"] = "合约状态查询失败"
		return result
	}
	codeText, _ := code.(string)
	result["reachable"], result["contractCodePresent"] = actualID == service.config.ChainID, codeText != "" && codeText != "0x"
	return result
}

func (service *ChainService) PrepareRegistration(ctx context.Context, versionID string, input model.Record, publicBaseURL string) (model.Record, error) {
	if err := service.validateRegistry(); err != nil {
		return nil, err
	}
	wallet := normalizeAddress(model.String(input, "walletAddress"))
	if !addressPattern.MatchString(wallet) {
		return nil, model.NewError("INVALID_WALLET_ADDRESS", "钱包地址格式无效", 400, false, nil)
	}
	state, err := service.store.Read()
	if err != nil {
		return nil, err
	}
	version, _ := model.Find(state.Versions, versionID)
	if version == nil {
		return nil, model.NewError("VERSION_NOT_FOUND", "设计版本不存在", 404, false, nil)
	}
	project, _ := model.Find(state.Projects, model.String(version, "projectId"))
	if project == nil {
		return nil, model.NewError("PROJECT_NOT_FOUND", "设计项目不存在", 404, false, nil)
	}
	if model.String(version, "status") == "chain_confirmed" || model.String(version, "status") == "finalized" {
		return model.Record{"alreadyConfirmed": true, "version": publicVersion(version)}, nil
	}
	if model.String(version, "status") != "awaiting_confirmation" && model.String(version, "status") != "awaiting_wallet_signature" && model.String(version, "status") != "registration_failed" {
		return nil, model.NewError("VERSION_NOT_READY", "版本尚未准备好登记", 409, false, model.Record{"status": model.String(version, "status")})
	}
	if registrant := normalizeAddress(model.String(version, "registrant")); registrant != "" && registrant != wallet {
		return nil, model.NewError("REGISTRANT_LOCKED", "该版本已绑定其他登记钱包", 409, false, nil)
	}
	if parentID := model.String(version, "parentVersionId"); parentID != "" {
		parent, _ := model.Find(state.Versions, parentID)
		if parent == nil {
			return nil, model.NewError("PARENT_VERSION_NOT_FOUND", "父版本不存在", 404, false, nil)
		}
		if model.String(parent, "status") != "chain_confirmed" && model.String(parent, "status") != "finalized" {
			return nil, model.NewError("PARENT_NOT_CONFIRMED", "父版本尚未在 Monad 确认", 409, false, nil)
		}
		if parentWallet := normalizeAddress(model.String(parent, "registrant")); parentWallet != "" && parentWallet != wallet {
			return nil, model.NewError("WALLET_MISMATCH", "V2 必须使用父版本登记钱包", 409, false, nil)
		}
	}
	imageURI, storageMode, imageWarning, err := service.storage.PrepareImage(ctx, project, version, publicBaseURL)
	if err != nil {
		return nil, err
	}
	metadata, err := buildMetadata(project, version, wallet, imageURI)
	if err != nil {
		return nil, err
	}
	contentHash, err := hashCanonical(metadata)
	if err != nil {
		return nil, err
	}
	preparedVersion := model.Clone(version)
	preparedVersion["registrant"], preparedVersion["metadata"], preparedVersion["contentHash"], preparedVersion["imageUri"], preparedVersion["requirementHash"], preparedVersion["promptHash"], preparedVersion["imageHash"], preparedVersion["status"] = wallet, metadata, contentHash, imageURI, model.String(metadata, "requirementHash"), model.String(metadata, "promptHash"), model.String(metadata, "imageHash"), "awaiting_wallet_signature"
	uri, persistedMode, warning, err := service.storage.PutMetadata(ctx, project, preparedVersion, metadata, publicBaseURL, storageMode)
	if err != nil {
		return nil, err
	}
	preparedVersion["metadataUri"], preparedVersion["storageMode"], preparedVersion["storageWarning"] = uri, persistedMode, strings.Trim(strings.Join([]string{imageWarning, warning}, "；"), "；")
	if err := service.storage.SyncDesign(ctx, project, preparedVersion); err != nil {
		return nil, err
	}
	designID := keccakHex([]byte(model.String(project, "localDesignId")))
	parentHash := firstNonBlank(model.String(version, "parentContentHash"), zeroHash)
	transaction, err := registerTransaction(designID, contentHash, parentHash, uri, service.config.RegistryAddress)
	if err != nil {
		return nil, err
	}
	_, err = service.store.Update(func(next *model.State) (any, error) {
		current, _ := model.Find(next.Versions, versionID)
		if current == nil {
			return nil, model.NewError("VERSION_NOT_FOUND", "设计版本不存在", 404, false, nil)
		}
		if status := model.String(current, "status"); status != "awaiting_confirmation" && status != "awaiting_wallet_signature" && status != "registration_failed" {
			return nil, model.NewError("VERSION_NOT_READY", "版本状态已变化，请刷新后重试", 409, false, nil)
		}
		if registrant := normalizeAddress(model.String(current, "registrant")); registrant != "" && registrant != wallet {
			return nil, model.NewError("REGISTRANT_LOCKED", "该版本已绑定其他登记钱包", 409, false, nil)
		}
		if err := assertVersionTransition(model.String(current, "status"), "awaiting_wallet_signature"); err != nil {
			return nil, err
		}
		current["registrant"], current["metadata"], current["metadataUri"], current["contentHash"], current["imageUri"], current["requirementHash"], current["promptHash"], current["imageHash"], current["storageMode"], current["storageWarning"], current["preparedTransaction"], current["status"], current["updatedAt"] = wallet, metadata, uri, contentHash, imageURI, preparedVersion["requirementHash"], preparedVersion["promptHash"], preparedVersion["imageHash"], persistedMode, preparedVersion["storageWarning"], preparedTransaction("register", service.walletConfiguration(), transaction, designID, contentHash, parentHash, uri), "awaiting_wallet_signature", model.Now()
		return nil, nil
	})
	if err != nil {
		return nil, err
	}
	return model.Record{"versionId": versionID, "versionNumber": model.Int(version, "versionNumber"), "designId": designID, "contentHash": contentHash, "parentContentHash": parentHash, "metadataUri": uri, "imageUri": metadataAssetURI(metadata), "storageWarning": preparedVersion["storageWarning"], "kind": "register", "chain": service.walletConfiguration(), "transaction": transaction, "expected": model.Record{"designId": designID, "contentHash": contentHash, "parentContentHash": parentHash, "walletAddress": wallet, "metadataUri": uri}}, nil
}

func (service *ChainService) PrepareFinalize(versionID string, input model.Record) (model.Record, error) {
	if err := service.validateRegistry(); err != nil {
		return nil, err
	}
	wallet := normalizeAddress(model.String(input, "walletAddress"))
	if !addressPattern.MatchString(wallet) {
		return nil, model.NewError("INVALID_WALLET_ADDRESS", "钱包地址格式无效", 400, false, nil)
	}
	state, err := service.store.Read()
	if err != nil {
		return nil, err
	}
	version, _ := model.Find(state.Versions, versionID)
	if version == nil {
		return nil, model.NewError("VERSION_NOT_FOUND", "设计版本不存在", 404, false, nil)
	}
	if model.String(version, "status") == "finalized" {
		return model.Record{"alreadyFinalized": true, "version": publicVersion(version)}, nil
	}
	if model.String(version, "status") != "chain_confirmed" {
		return nil, model.NewError("VERSION_NOT_REGISTERED", "只有已登记到 Monad 的版本才能确认为最终版", 409, false, nil)
	}
	if normalizeAddress(model.String(version, "registrant")) != wallet {
		return nil, model.NewError("UNAUTHORIZED_FINALIZER", "只有原登记钱包可以确认最终版", 403, false, nil)
	}
	stateProject, _ := model.Find(state.Projects, model.String(version, "projectId"))
	if stateProject == nil {
		return nil, model.NewError("PROJECT_NOT_FOUND", "设计项目不存在", 404, false, nil)
	}
	designID := keccakHex([]byte(model.String(stateProject, "localDesignId")))
	transaction, err := finalizeTransaction(designID, model.String(version, "contentHash"), service.config.RegistryAddress)
	if err != nil {
		return nil, err
	}
	return model.Record{"versionId": versionID, "versionNumber": model.Int(version, "versionNumber"), "designId": designID, "contentHash": model.String(version, "contentHash"), "kind": "finalize", "chain": service.walletConfiguration(), "transaction": transaction, "expected": model.Record{"designId": designID, "contentHash": model.String(version, "contentHash"), "walletAddress": wallet}}, nil
}

func (service *ChainService) RecordSubmission(versionID string, input model.Record) (model.Record, error) {
	wallet, txHash, kind := normalizeAddress(model.String(input, "walletAddress")), strings.ToLower(model.String(input, "txHash")), model.String(input, "kind")
	if !addressPattern.MatchString(wallet) {
		return nil, model.NewError("INVALID_WALLET_ADDRESS", "钱包地址格式无效", 400, false, nil)
	}
	if !txHashPattern.MatchString(txHash) {
		return nil, model.NewError("INVALID_TX_HASH", "txHash 格式无效", 400, false, nil)
	}
	if kind != "register" && kind != "finalize" {
		return nil, model.NewError("VALIDATION_FAILED", "kind 必须为 register 或 finalize", 400, false, nil)
	}
	result, err := service.store.Update(func(state *model.State) (any, error) {
		version, _ := model.Find(state.Versions, versionID)
		if version == nil {
			return nil, model.NewError("VERSION_NOT_FOUND", "设计版本不存在", 404, false, nil)
		}
		if normalizeAddress(model.String(version, "registrant")) != wallet {
			return nil, model.NewError("WALLET_MISMATCH", "回传钱包与登记钱包不一致", 409, false, nil)
		}
		if kind == "register" && model.String(version, "status") != "awaiting_wallet_signature" {
			return nil, model.NewError("VERSION_NOT_READY", "版本未准备登记交易", 409, false, nil)
		}
		if kind == "finalize" && model.String(version, "status") != "chain_confirmed" {
			return nil, model.NewError("VERSION_NOT_REGISTERED", "版本尚未登记确认", 409, false, nil)
		}
		if kind == "register" {
			if err := assertVersionTransition(model.String(version, "status"), "tx_submitted"); err != nil {
				return nil, err
			}
		} else if err := assertVersionTransition(model.String(version, "status"), "chain_confirmed"); err != nil {
			return nil, err
		}
		for _, record := range state.ChainRecords {
			if model.String(record, "versionId") == versionID && model.String(record, "kind") == kind && strings.EqualFold(model.String(record, "txHash"), txHash) {
				return model.Clone(record), nil
			}
		}
		record := model.Record{"id": model.NewID(), "versionId": versionID, "projectId": model.String(version, "projectId"), "kind": kind, "chainId": service.config.ChainID, "contractAddress": normalizeAddress(service.config.RegistryAddress), "walletAddress": wallet, "txHash": txHash, "status": "submitted", "blockNumber": nil, "event": nil, "submittedAt": model.Now(), "confirmedAt": nil, "errorCode": nil, "errorMessage": nil, "updatedAt": model.Now()}
		state.ChainRecords = append(state.ChainRecords, record)
		if kind == "register" {
			version["status"], version["txHash"] = "tx_submitted", txHash
		} else {
			version["finalizeTxHash"] = txHash
		}
		version["updatedAt"] = model.Now()
		return model.Clone(record), nil
	})
	if err != nil {
		return nil, err
	}
	_ = service.storage.SaveChainRecord(context.Background(), result.(model.Record))
	return result.(model.Record), nil
}

func (service *ChainService) GetChainStatus(ctx context.Context, versionID, kind string) (model.Record, error) {
	if kind != "finalize" {
		kind = "register"
	}
	state, err := service.store.Read()
	if err != nil {
		return nil, err
	}
	version, _ := model.Find(state.Versions, versionID)
	if version == nil {
		return nil, model.NewError("VERSION_NOT_FOUND", "设计版本不存在", 404, false, nil)
	}
	var record model.Record
	for _, item := range state.ChainRecords {
		if model.String(item, "versionId") == versionID && model.String(item, "kind") == kind {
			record = item
		}
	}
	if record == nil {
		status := "not_submitted"
		if kind == "register" {
			status = model.String(version, "status")
		}
		return model.Record{"status": status}, nil
	}
	if status := model.String(record, "status"); status == "confirmed" || status == "failed" {
		return chainRecordPublic(record, service.config.ExplorerURL), nil
	}
	verification, err := service.verifyTransaction(ctx, record, version)
	if err != nil {
		return nil, err
	}
	if model.String(verification, "status") == "pending" {
		return chainRecordPublic(record, service.config.ExplorerURL), nil
	}
	updated, err := service.store.Update(func(next *model.State) (any, error) {
		currentRecord, _ := model.Find(next.ChainRecords, model.String(record, "id"))
		currentVersion, _ := model.Find(next.Versions, versionID)
		if currentRecord == nil || currentVersion == nil {
			return nil, model.NewError("VERSION_NOT_FOUND", "版本或链记录不存在", 404, false, nil)
		}
		if model.String(verification, "status") != "confirmed" {
			currentRecord["status"], currentRecord["errorCode"], currentRecord["errorMessage"], currentRecord["updatedAt"] = "failed", verification["errorCode"], verification["errorMessage"], model.Now()
			if kind == "register" {
				if err := assertVersionTransition(model.String(currentVersion, "status"), "registration_failed"); err != nil {
					return nil, err
				}
				currentVersion["status"] = "registration_failed"
			}
			return model.Clone(currentRecord), nil
		}
		currentRecord["status"], currentRecord["blockNumber"], currentRecord["event"], currentRecord["confirmedAt"], currentRecord["errorCode"], currentRecord["errorMessage"], currentRecord["updatedAt"] = "confirmed", verification["blockNumber"], verification["event"], model.Now(), nil, nil, model.Now()
		if kind == "register" {
			if err := assertVersionTransition(model.String(currentVersion, "status"), "chain_confirmed"); err != nil {
				return nil, err
			}
			currentVersion["status"] = "chain_confirmed"
			event := model.RecordValue(verification, "event")
			currentVersion["onchainVersionNumber"], currentVersion["registeredBy"] = event["versionNumber"], event["registeredBy"]
		} else {
			if err := assertVersionTransition(model.String(currentVersion, "status"), "finalized"); err != nil {
				return nil, err
			}
			currentVersion["status"] = "finalized"
			project, _ := model.Find(next.Projects, model.String(currentVersion, "projectId"))
			if project != nil {
				project["finalVersionId"], project["updatedAt"] = versionID, model.Now()
			}
		}
		currentVersion["updatedAt"] = model.Now()
		return model.Clone(currentRecord), nil
	})
	if err != nil {
		return nil, err
	}
	updatedRecord := updated.(model.Record)
	if refreshed, readErr := service.store.Read(); readErr == nil {
		version, _ := model.Find(refreshed.Versions, versionID)
		if version != nil {
			project, _ := model.Find(refreshed.Projects, model.String(version, "projectId"))
			if project != nil {
				_ = service.storage.SyncDesign(context.Background(), project, version)
			}
		}
	}
	_ = service.storage.SaveChainRecord(context.Background(), updatedRecord)
	return chainRecordPublic(updatedRecord, service.config.ExplorerURL), nil
}

func (service *ChainService) verifyTransaction(ctx context.Context, record, version model.Record) (model.Record, error) {
	receiptAny, err := service.rpc(ctx, "eth_getTransactionReceipt", []any{model.String(record, "txHash")})
	if err != nil {
		return nil, err
	}
	if receiptAny == nil {
		return model.Record{"status": "pending"}, nil
	}
	receipt, ok := receiptAny.(map[string]any)
	if !ok {
		return nil, model.NewError("RPC_RESPONSE_INVALID", "RPC 返回了无效交易回执", 502, true, nil)
	}
	if !strings.EqualFold(model.String(model.Record(receipt), "status"), "0x1") {
		return model.Record{"status": "failed", "errorCode": "TRANSACTION_REVERTED", "errorMessage": "Monad 交易执行失败"}, nil
	}
	transactionAny, err := service.rpc(ctx, "eth_getTransactionByHash", []any{model.String(record, "txHash")})
	if err != nil {
		return nil, err
	}
	transaction, ok := transactionAny.(map[string]any)
	if !ok {
		return model.Record{"status": "pending"}, nil
	}
	if !strings.EqualFold(model.String(model.Record(transaction), "to"), service.config.RegistryAddress) {
		return model.Record{"status": "failed", "errorCode": "WRONG_CONTRACT", "errorMessage": "交易目标不是当前 Design Registry 合约"}, nil
	}
	if !strings.EqualFold(model.String(model.Record(transaction), "from"), model.String(record, "walletAddress")) {
		return model.Record{"status": "failed", "errorCode": "WALLET_MISMATCH", "errorMessage": "交易发送钱包与提交记录不一致"}, nil
	}
	projectState, err := service.store.Read()
	if err != nil {
		return nil, err
	}
	project, _ := model.Find(projectState.Projects, model.String(version, "projectId"))
	if project == nil {
		return nil, model.NewError("PROJECT_NOT_FOUND", "设计项目不存在", 404, false, nil)
	}
	designID := strings.TrimPrefix(keccakHex([]byte(model.String(project, "localDesignId"))), "0x")
	contentHash := strings.TrimPrefix(model.String(version, "contentHash"), "0x")
	event := matchingEvent(model.Record(receipt), model.String(record, "kind"), designID, contentHash, model.String(version, "parentContentHash"), model.String(version, "metadataUri"), service.config.RegistryAddress)
	if event == nil {
		return model.Record{"status": "failed", "errorCode": "EXPECTED_EVENT_NOT_FOUND", "errorMessage": "交易成功，但没有找到匹配的版本登记事件"}, nil
	}
	blockNumber, err := parseHexInt(model.String(model.Record(receipt), "blockNumber"))
	if err != nil {
		return nil, model.NewError("RPC_RESPONSE_INVALID", "RPC 返回了无效区块号", 502, true, nil)
	}
	return model.Record{"status": "confirmed", "blockNumber": blockNumber, "event": event}, nil
}

func (service *ChainService) rpc(ctx context.Context, method string, params []any) (any, error) {
	id := service.sequence.Add(1)
	payload, _ := json.Marshal(model.Record{"jsonrpc": "2.0", "id": id, "method": method, "params": params})
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, service.config.RPCURL, bytes.NewReader(payload))
	if err != nil {
		return nil, model.NewError("RPC_REQUEST_FAILED", "创建 RPC 请求失败", 502, true, nil)
	}
	request.Header.Set("Content-Type", "application/json")
	response, err := service.client.Do(request)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) || os.IsTimeout(err) {
			return nil, model.NewError("RPC_TIMEOUT", "Monad RPC 请求超时", 502, true, nil)
		}
		return nil, model.NewError("RPC_CONNECT_FAILED", "无法连接 Monad RPC", 502, true, nil)
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, model.NewError("RPC_REQUEST_FAILED", "Monad RPC 请求失败", 502, response.StatusCode >= 500, model.Record{"status": response.StatusCode})
	}
	var decoded struct {
		Result any `json:"result"`
		Error  *struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.NewDecoder(io.LimitReader(response.Body, 2<<20)).Decode(&decoded); err != nil {
		return nil, model.NewError("RPC_RESPONSE_INVALID", "Monad RPC 返回无效 JSON", 502, true, nil)
	}
	if decoded.Error != nil {
		return nil, model.NewError("RPC_REQUEST_FAILED", "Monad RPC 返回错误", 502, true, nil)
	}
	return decoded.Result, nil
}

func normalizeAddress(value string) string { return strings.ToLower(strings.TrimSpace(value)) }
func parseHexInt(value string) (int64, error) {
	return strconv.ParseInt(strings.TrimPrefix(value, "0x"), 16, 64)
}
func metadataAssetURI(metadata model.Record) string { return model.String(metadata, "imageUri") }

func preparedTransaction(kind string, chain, transaction model.Record, designID, contentHash, parentHash, metadataURI string) model.Record {
	expected := model.Record{"designId": designID, "contentHash": contentHash}
	if kind == "register" {
		expected["parentContentHash"], expected["metadataUri"] = parentHash, metadataURI
	}
	return model.Record{"kind": kind, "chain": chain, "transaction": transaction, "expected": expected}
}

func registerTransaction(designID, contentHash, parentHash, uri, contract string) (model.Record, error) {
	data, err := encodeRegister(designID, contentHash, parentHash, uri)
	if err != nil {
		return nil, err
	}
	return model.Record{"to": contract, "data": data, "value": "0x0"}, nil
}
func finalizeTransaction(designID, contentHash, contract string) (model.Record, error) {
	data, err := encodeFinalize(designID, contentHash)
	if err != nil {
		return nil, err
	}
	return model.Record{"to": contract, "data": data, "value": "0x0"}, nil
}

func encodeRegister(designID, contentHash, parentHash, uri string) (string, error) {
	selector := strings.TrimPrefix(keccakHex([]byte("registerVersion(bytes32,bytes32,bytes32,string)")), "0x")[:8]
	normalizedDesignID, err := normalizeBytes32(designID, "designId")
	if err != nil {
		return "", err
	}
	normalizedContentHash, err := normalizeBytes32(contentHash, "contentHash")
	if err != nil {
		return "", err
	}
	normalizedParentHash, err := normalizeBytes32(parentHash, "parentContentHash")
	if err != nil {
		return "", err
	}
	words := []string{strings.TrimPrefix(normalizedDesignID, "0x"), strings.TrimPrefix(normalizedContentHash, "0x"), strings.TrimPrefix(normalizedParentHash, "0x"), fmt.Sprintf("%064x", 128), fmt.Sprintf("%064x", len([]byte(uri)))}
	encoded := hex.EncodeToString([]byte(uri))
	padding := (64 - len(encoded)%64) % 64
	encoded += strings.Repeat("0", padding)
	if len(words) != 5 {
		return "", fmt.Errorf("invalid ABI layout")
	}
	return "0x" + selector + strings.Join(words[:4], "") + words[4] + encoded, nil
}
func encodeFinalize(designID, contentHash string) (string, error) {
	selector := strings.TrimPrefix(keccakHex([]byte("confirmVersion(bytes32,bytes32)")), "0x")[:8]
	normalizedDesignID, err := normalizeBytes32(designID, "designId")
	if err != nil {
		return "", err
	}
	normalizedContentHash, err := normalizeBytes32(contentHash, "contentHash")
	if err != nil {
		return "", err
	}
	return "0x" + selector + strings.TrimPrefix(normalizedDesignID, "0x") + strings.TrimPrefix(normalizedContentHash, "0x"), nil
}

func normalizeBytes32(value, label string) (string, error) {
	normalized := strings.TrimPrefix(strings.ToLower(strings.TrimSpace(value)), "0x")
	if !bytes32Pattern.MatchString("0x" + normalized) {
		return "", model.NewError("INVALID_CHAIN_DATA", label+" 必须是 32 字节十六进制值", http.StatusBadRequest, false, model.Record{"field": label})
	}
	return "0x" + normalized, nil
}

func matchingEvent(receipt model.Record, kind, designID, contentHash, parentHash, metadataURI, contract string) model.Record {
	logs, ok := receipt["logs"].([]any)
	if !ok {
		return nil
	}
	signature, minimumTopics := "VersionRegistered(bytes32,bytes32,bytes32,uint64,address,string)", 4
	if kind == "finalize" {
		signature, minimumTopics = "VersionFinalized(bytes32,bytes32,uint64,address)", 3
	}
	eventTopic := strings.TrimPrefix(keccakHex([]byte(signature)), "0x")
	for _, entry := range logs {
		log, ok := entry.(map[string]any)
		if !ok || !strings.EqualFold(model.String(model.Record(log), "address"), contract) {
			continue
		}
		topics, ok := log["topics"].([]any)
		if !ok || len(topics) < minimumTopics {
			continue
		}
		first, _ := topics[0].(string)
		second, _ := topics[1].(string)
		third, _ := topics[2].(string)
		if !strings.EqualFold(strings.TrimPrefix(first, "0x"), eventTopic) || !strings.EqualFold(strings.TrimPrefix(second, "0x"), designID) || !strings.EqualFold(strings.TrimPrefix(third, "0x"), contentHash) {
			continue
		}
		if kind == "register" {
			fourth, _ := topics[3].(string)
			if !strings.EqualFold(strings.TrimPrefix(fourth, "0x"), strings.TrimPrefix(firstNonBlank(parentHash, zeroHash), "0x")) {
				continue
			}
		}
		event := decodeRegistryEvent(kind, model.String(model.Record(log), "data"))
		if event == nil || (kind == "register" && metadataURI != "" && model.String(event, "metadataUri") != metadataURI) {
			continue
		}
		if kind == "register" {
			event["event"], event["designId"], event["contentHash"], event["parentContentHash"] = "VersionRegistered", "0x"+designID, "0x"+contentHash, "0x"+strings.TrimPrefix(firstNonBlank(parentHash, zeroHash), "0x")
		} else {
			event["event"], event["designId"], event["contentHash"] = "VersionFinalized", "0x"+designID, "0x"+contentHash
		}
		return event
	}
	return nil
}

func decodeRegistryEvent(kind, data string) model.Record {
	raw, err := hex.DecodeString(strings.TrimPrefix(data, "0x"))
	if err != nil || len(raw) < 64 {
		return nil
	}
	versionNumber := new(big.Int).SetBytes(raw[:32]).Uint64()
	address := "0x" + hex.EncodeToString(raw[44:64])
	event := model.Record{"kind": kind, "versionNumber": versionNumber}
	if kind == "finalize" {
		event["finalizedBy"] = normalizeAddress(address)
		return event
	}
	if len(raw) < 96 {
		return nil
	}
	offset := new(big.Int).SetBytes(raw[64:96]).Uint64()
	if offset > uint64(len(raw)) || offset+32 > uint64(len(raw)) {
		return nil
	}
	length := new(big.Int).SetBytes(raw[offset : offset+32]).Uint64()
	start, end := offset+32, offset+32+length
	if end > uint64(len(raw)) {
		return nil
	}
	event["registeredBy"], event["metadataUri"] = normalizeAddress(address), string(raw[start:end])
	return event
}
