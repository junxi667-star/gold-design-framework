package service

import (
	"context"
	"fmt"
	"log/slog"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"unicode/utf8"

	"jewelchain-studio/internal/config"
	"jewelchain-studio/internal/model"
	"jewelchain-studio/internal/repository"
)

const zeroHash = "0x0000000000000000000000000000000000000000000000000000000000000000"

type ImageGenerator interface {
	Configured() bool
	Status() model.Record
	Generate(context.Context, model.Record) (model.Record, error)
}

type DesignService struct {
	config    config.Config
	store     *repository.StateStore
	broker    *TaskBroker
	generator ImageGenerator
	running   sync.Map
}

func NewDesignService(cfg config.Config, store *repository.StateStore, broker *TaskBroker, generator ImageGenerator) *DesignService {
	service := &DesignService{config: cfg, store: store, broker: broker, generator: generator}
	broker.SetCompletionHandler(service.CompleteWorkerGeneration)
	return service
}

func (service *DesignService) CreateDesign(input model.Record) (model.Record, error) {
	raw := strings.TrimSpace(model.String(input, "customerText"))
	if utf8.RuneCountInString(raw) < 6 {
		return nil, model.NewError("INVALID_REQUIREMENT", "请输入更详细的珠宝需求，至少包含一句完整描述", 400, false, nil)
	}
	if utf8.RuneCountInString(raw) > 4000 {
		return nil, model.NewError("VALIDATION_FAILED", "需求描述不能超过 4000 个字符", 400, false, nil)
	}
	requirement, summary := parseRequirement(raw, model.RecordValue(input, "formFields"))
	projectID, versionID, jobID, now := model.NewID(), model.NewID(), model.NewID(), model.Now()
	localID := "DESIGN-" + strings.ToUpper(strings.Split(projectID, "-")[0])
	project := model.Record{"id": projectID, "localDesignId": localID, "title": projectTitle(requirement), "customerText": raw, "currentVersion": 1, "finalVersionId": nil, "createdAt": now, "updatedAt": now}
	version := newVersion(versionID, projectID, 1, "", zeroHash, "", requirement, summary, now)
	job := newJob(jobID, projectID, versionID, 1, now)
	_, err := service.store.Update(func(state *model.State) (any, error) {
		state.Projects, state.Versions, state.Jobs = append(state.Projects, project), append(state.Versions, version), append(state.Jobs, job)
		return nil, nil
	})
	if err != nil {
		slog.Error("create design failed", "error", err, "project_id", projectID)
		return nil, err
	}
	slog.Info("design created", "project_id", projectID, "version_id", versionID, "job_id", jobID)
	go service.RunGeneration(jobID, "generate")
	return model.Record{"projectId": projectID, "localDesignId": localID, "versionId": versionID, "jobId": jobID, "parsed": model.Record{"understandingSummary": summary, "structuredRequirement": requirement}}, nil
}

func (service *DesignService) ReviseDesign(projectID string, input model.Record) (model.Record, error) {
	change := strings.TrimSpace(model.String(input, "changeRequest"))
	if utf8.RuneCountInString(change) < 2 {
		return nil, model.NewError("INVALID_CHANGE_REQUEST", "请填写本次修改要求", 400, false, nil)
	}
	parentID := model.String(input, "parentVersionId")
	var response model.Record
	_, err := service.store.Update(func(state *model.State) (any, error) {
		project, _ := model.Find(state.Projects, projectID)
		if project == nil {
			return nil, model.NewError("PROJECT_NOT_FOUND", "设计项目不存在", 404, false, nil)
		}
		parent, _ := model.Find(state.Versions, parentID)
		if parent == nil || model.String(parent, "projectId") != projectID {
			return nil, model.NewError("PARENT_VERSION_NOT_FOUND", "作为修改来源的上一版本不存在", 404, false, nil)
		}
		if model.String(parent, "status") != "chain_confirmed" {
			return nil, model.NewError("PARENT_NOT_ONCHAIN", "为确保版本来源可验证，请先将当前版本登记到 Monad。登记完成后，系统才能把它记录为下一版的来源", 409, false, nil)
		}
		if model.String(project, "finalVersionId") != "" {
			return nil, model.NewError("DESIGN_FINALIZED", "该设计已经确定最终版本，不能继续新增版本", 409, false, nil)
		}
		changeRequirement, summary := parseRevisionRequirement(change)
		requirement := mergeRevision(model.RecordValue(parent, "structuredRequirement"), changeRequirement, change)
		versionNumber := 1
		for _, version := range state.Versions {
			if model.String(version, "projectId") == projectID && model.Int(version, "versionNumber") >= versionNumber {
				versionNumber = model.Int(version, "versionNumber") + 1
			}
		}
		versionID, jobID, now := model.NewID(), model.NewID(), model.Now()
		version := newVersion(versionID, projectID, versionNumber, parentID, model.String(parent, "contentHash"), change, requirement, summary, now)
		job := newJob(jobID, projectID, versionID, versionNumber, now)
		state.Versions, state.Jobs = append(state.Versions, version), append(state.Jobs, job)
		project["currentVersion"], project["updatedAt"] = versionNumber, now
		response = model.Record{"projectId": projectID, "versionId": versionID, "versionNumber": versionNumber, "jobId": jobID}
		return nil, nil
	})
	if err != nil {
		return nil, err
	}
	go service.RunGeneration(model.String(response, "jobId"), "refine")
	return response, nil
}

func (service *DesignService) RunGeneration(jobID, operation string) {
	if _, loaded := service.running.LoadOrStore(jobID, struct{}{}); loaded {
		return
	}
	defer service.running.Delete(jobID)
	slog.Info("generation started", "job_id", jobID, "operation", operation)
	var job, version model.Record
	_, err := service.store.Update(func(state *model.State) (any, error) {
		job, _ = model.Find(state.Jobs, jobID)
		if job == nil {
			return nil, model.NewError("JOB_NOT_FOUND", "生成任务不存在", 404, false, nil)
		}
		version, _ = model.Find(state.Versions, model.String(job, "versionId"))
		if version == nil {
			return nil, model.NewError("VERSION_NOT_FOUND", "设计版本不存在", 404, false, nil)
		}
		if model.String(job, "status") == "succeeded" || model.String(job, "status") == "failed" {
			return nil, nil
		}
		job["status"], job["progress"], job["currentStep"], job["updatedAt"] = "running", max(10, model.Int(job, "progress")), "Agent 正在整理结构化需求和生图提示词", model.Now()
		job, version = model.Clone(job), model.Clone(version)
		return nil, nil
	})
	if err != nil || job == nil || version == nil {
		return
	}
	prompts, promptErr := buildGoldAPIImagePrompt(model.RecordValue(version, "structuredRequirement"), operation, model.String(version, "changeRequest"))
	if promptErr != nil {
		service.failGeneration(jobID, promptErr)
		return
	}
	prompt := model.String(prompts, "apiPrompt")
	_, err = service.store.Update(func(state *model.State) (any, error) {
		current, _ := model.Find(state.Versions, model.String(version, "id"))
		currentJob, _ := model.Find(state.Jobs, jobID)
		if current == nil || currentJob == nil {
			return nil, nil
		}
		current["apiPrompt"], current["updatedAt"] = prompt, model.Now()
		if requirement := model.RecordValue(current, "structuredRequirement"); requirement != nil {
			requirement["productType"], requirement["shape"] = prompts["productName"], prompts["shape"]
			current["structuredRequirement"] = requirement
		}
		currentJob["progress"], currentJob["currentStep"], currentJob["updatedAt"] = max(30, model.Int(currentJob, "progress")), "生图提示词已生成，正在调度图片服务", model.Now()
		return nil, nil
	})
	if err != nil {
		service.failGeneration(jobID, err)
		return
	}
	input := model.Record{"jobId": jobID, "versionId": model.String(version, "id"), "projectId": model.String(version, "projectId"), "prompt": prompt, "filenamePrefix": fmt.Sprintf("%s-v%d", strings.ToLower(model.String(job, "projectId")), model.Int(version, "versionNumber")), "operation": operation, "requiredCapability": "seedream"}
	useDirect := service.config.ExecutionMode == "direct"
	if service.config.ExecutionMode == "hybrid" {
		online, onlineErr := service.broker.HasOnlineWorker("seedream")
		useDirect = onlineErr == nil && !online && service.generator != nil && service.generator.Configured()
	}
	if useDirect {
		if service.generator == nil || !service.generator.Configured() {
			service.failGeneration(jobID, model.NewError("ARK_NOT_CONFIGURED", "图片服务尚未配置", 503, false, nil))
			return
		}
		result, generateErr := service.generator.Generate(context.Background(), input)
		if generateErr != nil {
			service.failGeneration(jobID, generateErr)
			return
		}
		if err := service.persistGeneration(jobID, result); err != nil {
			service.failGeneration(jobID, err)
		}
		return
	}
	if _, err := service.broker.Enqueue(input); err != nil {
		service.failGeneration(jobID, err)
	}
}

func (service *DesignService) CompleteWorkerGeneration(state *model.State, result model.Record) error {
	for _, task := range state.WorkerTasks {
		if model.String(task, "id") == model.String(result, "taskId") {
			return service.persistGenerationState(state, model.String(task, "jobId"), result)
		}
	}
	return model.NewError("WORKER_TASK_NOT_FOUND", "Worker 任务不存在", 404, false, nil)
}

func (service *DesignService) persistGeneration(jobID string, result model.Record) error {
	_, err := service.store.Update(func(state *model.State) (any, error) {
		return nil, service.persistGenerationState(state, jobID, result)
	})
	return err
}

func (service *DesignService) persistGenerationState(state *model.State, jobID string, result model.Record) error {
	job, _ := model.Find(state.Jobs, jobID)
	if job == nil {
		// The broker also supports externally enqueued worker tasks that do not
		// belong to a design job. Their task completion is still valid.
		return nil
	}
	version, _ := model.Find(state.Versions, model.String(job, "versionId"))
	if version == nil {
		return model.NewError("VERSION_NOT_FOUND", "设计版本不存在", 404, false, nil)
	}
	if model.String(job, "status") == "succeeded" {
		return nil
	}
	version["imageUrl"], version["imageFilename"], version["imageFilePath"], version["imageMimeType"] = result["imageUrl"], result["filename"], result["filePath"], result["mimeType"]
	if err := assertVersionTransition(model.String(version, "status"), "awaiting_confirmation"); err != nil {
		return err
	}
	version["modelProvider"], version["modelName"], version["status"], version["updatedAt"] = result["modelProvider"], result["modelName"], "awaiting_confirmation", model.Now()
	job["status"], job["progress"], job["currentStep"], job["error"], job["updatedAt"] = "succeeded", 100, "图片生成完成，等待钱包登记", nil, model.Now()
	return nil
}

func (service *DesignService) failGeneration(jobID string, cause error) {
	appError, ok := cause.(*model.AppError)
	if !ok {
		appError = model.NewError("GENERATION_FAILED", "图片生成失败", 502, false, nil)
	}
	slog.Error("generation failed", "job_id", jobID, "error_code", appError.Code, "error_message", appError.Message)
	_, _ = service.store.Update(func(state *model.State) (any, error) {
		job, _ := model.Find(state.Jobs, jobID)
		if job == nil {
			return nil, nil
		}
		version, _ := model.Find(state.Versions, model.String(job, "versionId"))
		if version != nil {
			if err := assertVersionTransition(model.String(version, "status"), "generation_failed"); err != nil {
				return nil, err
			}
			version["status"], version["updatedAt"] = "generation_failed", model.Now()
		}
		job["status"], job["error"], job["currentStep"], job["updatedAt"] = "failed", model.Record{"code": appError.Code, "message": appError.Message, "retryable": appError.Retryable}, "图片生成失败", model.Now()
		return nil, nil
	})
}

func (service *DesignService) ResumePendingJobs() {
	state, err := service.store.Read()
	if err != nil {
		return
	}
	for _, task := range state.WorkerTasks {
		if model.String(task, "status") == "completed" && model.RecordValue(task, "result") != nil {
			_ = service.persistGeneration(model.String(task, "jobId"), model.RecordValue(task, "result"))
		}
	}
	for _, job := range state.Jobs {
		status := model.String(job, "status")
		if status != "queued" && status != "running" {
			continue
		}
		hasTask := false
		for _, task := range state.WorkerTasks {
			if model.String(task, "jobId") == model.String(job, "id") {
				hasTask = true
				break
			}
		}
		if !hasTask {
			go service.RunGeneration(model.String(job, "id"), "generate")
		}
	}
}

func (service *DesignService) GetProject(projectID string) (model.Record, error) {
	state, err := service.store.Read()
	if err != nil {
		return nil, err
	}
	project, _ := model.Find(state.Projects, projectID)
	if project == nil {
		return nil, model.NewError("PROJECT_NOT_FOUND", "设计项目不存在", 404, false, nil)
	}
	result := model.Clone(project)
	versions := []any{}
	for _, version := range state.Versions {
		if model.String(version, "projectId") == projectID {
			versions = append(versions, publicVersion(version))
		}
	}
	sort.Slice(versions, func(i, j int) bool {
		return model.Int(versions[i].(model.Record), "versionNumber") < model.Int(versions[j].(model.Record), "versionNumber")
	})
	result["versions"] = versions
	return result, nil
}

func (service *DesignService) Timeline(projectID string) (model.Record, error) {
	project, err := service.GetProject(projectID)
	if err != nil {
		return nil, err
	}
	state, err := service.store.Read()
	if err != nil {
		return nil, err
	}
	versions := []any{}
	for _, version := range state.Versions {
		if model.String(version, "projectId") != projectID {
			continue
		}
		copy := publicVersion(version)
		records := []any{}
		for _, record := range state.ChainRecords {
			if model.String(record, "versionId") == model.String(version, "id") {
				records = append(records, chainRecordPublic(record, service.config.ExplorerURL))
			}
		}
		copy["chainRecords"] = records
		versions = append(versions, copy)
	}
	sort.Slice(versions, func(i, j int) bool {
		return model.Int(versions[i].(model.Record), "versionNumber") < model.Int(versions[j].(model.Record), "versionNumber")
	})
	return model.Record{"project": project, "versions": versions}, nil
}

func (service *DesignService) GetJob(jobID string) (model.Record, error) {
	state, err := service.store.Read()
	if err != nil {
		return nil, err
	}
	job, _ := model.Find(state.Jobs, jobID)
	if job == nil {
		return nil, model.NewError("JOB_NOT_FOUND", "生成任务不存在", 404, false, nil)
	}
	result := model.Clone(job)
	version, _ := model.Find(state.Versions, model.String(job, "versionId"))
	if version == nil {
		result["version"] = nil
	} else {
		result["version"] = publicVersion(version)
	}
	return result, nil
}

func (service *DesignService) Certificate(projectID string) (model.Record, error) {
	state, err := service.store.Read()
	if err != nil {
		return nil, err
	}
	project, _ := model.Find(state.Projects, projectID)
	if project == nil {
		return nil, model.NewError("PROJECT_NOT_FOUND", "设计项目不存在", 404, false, nil)
	}
	finalID := model.String(project, "finalVersionId")
	if finalID == "" {
		return nil, model.NewError("DESIGN_NOT_FINALIZED", "该设计尚未确认最终版本", 409, false, nil)
	}
	version, _ := model.Find(state.Versions, finalID)
	if version == nil {
		return nil, model.NewError("VERSION_NOT_FOUND", "最终版本不存在", 404, false, nil)
	}
	chainRecords := []any{}
	for _, record := range state.ChainRecords {
		if model.String(record, "versionId") == finalID {
			chainRecords = append(chainRecords, chainRecordPublic(record, service.config.ExplorerURL))
		}
	}
	return model.Record{"schemaVersion": "jewelchain-certificate/v1", "project": model.Clone(project), "finalVersion": publicVersion(version), "monad": model.Record{"chainId": service.config.ChainID, "contractAddress": service.config.RegistryAddress, "records": chainRecords}, "issuedAt": model.Now(), "declaration": "链上记录证明内容指纹、提交地址与时间，不替代版权登记、原创性审查或法律认定。"}, nil
}

func (service *DesignService) AnswerQuestion(projectID, question string) (model.Record, error) {
	timeline, err := service.Timeline(projectID)
	if err != nil {
		return nil, err
	}
	versions := model.Records(timeline["versions"])
	query := strings.TrimSpace(question)
	if strings.Contains(query, "最终") || strings.Contains(query, "确认") {
		for _, version := range versions {
			if model.String(version, "status") == "finalized" {
				return model.Record{"intent": "final_version", "answer": fmt.Sprintf("当前最终确认版本是 V%d。", model.Int(version, "versionNumber")), "evidence": []any{model.Record{"label": "最终版本", "value": fmt.Sprintf("V%d", model.Int(version, "versionNumber"))}, model.Record{"label": "内容指纹", "value": model.String(version, "contentHash")}}}, nil
			}
		}
		return model.Record{"intent": "final_version", "answer": "该设计尚未完成最终确认。", "evidence": []any{}}, nil
	}
	if strings.Contains(query, "修改") || strings.Contains(query, "要求") {
		if len(versions) == 0 {
			return model.Record{"intent": "revision", "answer": "目前还没有可查询的版本。", "evidence": []any{}}, nil
		}
		target := versions[len(versions)-1]
		return model.Record{"intent": "revision", "answer": fmt.Sprintf("V%d 的修改要求是：%s", model.Int(target, "versionNumber"), firstNonBlank(model.String(target, "changeRequest"), "未记录修改要求")), "evidence": []any{model.Record{"label": "版本", "value": fmt.Sprintf("V%d", model.Int(target, "versionNumber"))}, model.Record{"label": "修改要求", "value": firstNonBlank(model.String(target, "changeRequest"), "未记录")}}}, nil
	}
	if strings.Contains(query, "来源") || strings.Contains(query, "父版本") || strings.Contains(strings.ToLower(query), "v2") || strings.Contains(query, "版本关系") {
		for _, child := range versions {
			parentID := model.String(child, "parentVersionId")
			if parentID == "" {
				continue
			}
			for _, parent := range versions {
				if model.String(parent, "id") != parentID {
					continue
				}
				matched := strings.EqualFold(model.String(child, "parentContentHash"), model.String(parent, "contentHash"))
				answer := "当前记录的上一版指纹不一致，无法验证版本来源。"
				if matched {
					answer = fmt.Sprintf("V%d 由 V%d 修改而来，上一版内容指纹匹配。", model.Int(child, "versionNumber"), model.Int(parent, "versionNumber"))
				}
				return model.Record{"intent": "parent_relation", "answer": answer, "evidence": []any{model.Record{"label": fmt.Sprintf("V%d 内容指纹", model.Int(parent, "versionNumber")), "value": model.String(parent, "contentHash")}, model.Record{"label": fmt.Sprintf("V%d 上一版指纹", model.Int(child, "versionNumber")), "value": model.String(child, "parentContentHash")}}}, nil
			}
		}
		return model.Record{"intent": "parent_relation", "answer": "目前还没有形成 V1 → V2 的版本继承关系。", "evidence": []any{}}, nil
	}
	if strings.Contains(query, "替换") || strings.Contains(query, "篡改") || strings.Contains(query, "一致") || strings.Contains(query, "完整") || strings.Contains(query, "验证") {
		if len(versions) == 0 {
			return model.Record{"intent": "integrity", "answer": "暂无可验证版本。", "evidence": []any{}}, nil
		}
		latest := versions[len(versions)-1]
		if latest["metadata"] == nil || model.String(latest, "contentHash") == "" {
			return model.Record{"intent": "integrity", "answer": "最新版本还没有生成完整版本信息，暂时无法进行一致性校验。", "evidence": []any{}}, nil
		}
		recomputed, hashErr := hashCanonical(latest["metadata"])
		if hashErr != nil {
			return nil, hashErr
		}
		matched := strings.EqualFold(recomputed, model.String(latest, "contentHash"))
		answer := "当前文件与链上登记不一致。最新版本重新计算得到的内容指纹不同，说明内容已变化或不是当时登记的文件。"
		if matched {
			answer = "当前文件与链上登记一致。最新版本信息重新计算后，内容指纹与登记值一致。"
		}
		return model.Record{"intent": "integrity", "answer": answer, "evidence": []any{model.Record{"label": "链上登记的内容指纹", "value": model.String(latest, "contentHash")}, model.Record{"label": "当前文件重新计算结果", "value": recomputed}, model.Record{"label": "结果", "value": map[bool]string{true: "一致", false: "不一致"}[matched]}}}, nil
	}
	confirmed := 0
	evidence := make([]any, 0, len(versions))
	for _, version := range versions {
		if status := model.String(version, "status"); status == "chain_confirmed" || status == "finalized" {
			confirmed++
		}
		evidence = append(evidence, model.Record{"label": fmt.Sprintf("V%d", model.Int(version, "versionNumber")), "value": model.String(version, "status")})
	}
	return model.Record{"intent": "summary", "answer": fmt.Sprintf("该设计目前有 %d 个版本，%d 个版本已在 Monad 确认。", len(versions), confirmed), "evidence": evidence}, nil
}

func newVersion(id, projectID string, number int, parentID, parentHash, change string, requirement model.Record, summary string, now string) model.Record {
	return model.Record{"id": id, "projectId": projectID, "versionNumber": number, "parentVersionId": parentID, "parentContentHash": firstNonBlank(parentHash, zeroHash), "changeRequest": change, "structuredRequirement": requirement, "understandingSummary": summary, "status": "generating", "imageUrl": nil, "imageFilename": nil, "imageFilePath": nil, "imageMimeType": nil, "modelProvider": nil, "modelName": nil, "apiPrompt": nil, "contentHash": nil, "metadata": nil, "metadataUri": nil, "txHash": nil, "createdAt": now, "updatedAt": now}
}
func newJob(id, projectID, versionID string, number int, now string) model.Record {
	return model.Record{"id": id, "type": fmt.Sprintf("generate-v%d", number), "projectId": projectID, "versionId": versionID, "status": "queued", "progress": 0, "currentStep": fmt.Sprintf("等待 Agent 开始生成 V%d", number), "error": nil, "createdAt": now, "updatedAt": now}
}
func publicVersion(version model.Record) model.Record {
	result := model.Clone(version)
	delete(result, "apiPrompt")
	delete(result, "imageFilePath")
	return normalizeRequirementForGeneration(result)
}
func chainRecordPublic(record model.Record, explorer string) model.Record {
	result := model.Clone(record)
	if hash := model.String(record, "txHash"); hash != "" && explorer != "" {
		result["explorerUrl"] = strings.TrimRight(explorer, "/") + "/tx/" + hash
	}
	return result
}
func projectTitle(requirement model.Record) string {
	fields := []string{model.String(requirement, "style"), model.String(requirement, "productType")}
	motifs := model.Strings(requirement["motifs"])
	if len(motifs) > 0 {
		fields = append(fields, motifs[0])
	}
	result := strings.Join(nonEmpty(fields), " · ")
	if result == "" {
		return "黄金珠宝 AI 设计"
	}
	return result
}
func nonEmpty(items []string) []string {
	result := []string{}
	for _, item := range items {
		if item != "" {
			result = append(result, item)
		}
	}
	return result
}

func mergeRevision(parent, change model.Record, changeRequest string) model.Record {
	result := model.Clone(parent)
	for _, key := range []string{"productType", "goldType", "style", "targetAudience", "usageScenario", "weightRequirement", "visualWeight"} {
		if value := model.String(change, key); value != "" && value != "未说明" && value != "待确认" {
			result[key] = value
		}
	}
	for _, key := range []string{"surfaceEffects", "craftRequirements", "structureForms"} {
		if values := model.Strings(change[key]); len(values) > 0 {
			result[key] = values
		}
	}
	for _, key := range []string{"motifs", "mustKeep", "mustAvoid", "comfortRequirements", "safetyRisks"} {
		result[key] = uniqueStrings(append(model.Strings(result[key]), model.Strings(change[key])...))
	}
	if shape := firstNonBlank(model.String(parent, "shape"), firstString(model.Strings(parent["structureForms"]))); shape != "" {
		result["mustKeep"] = uniqueStrings(append(model.Strings(result["mustKeep"]), shape))
	}
	for _, motif := range model.Strings(parent["motifs"]) {
		result["mustKeep"] = uniqueStrings(append(model.Strings(result["mustKeep"]), motif+"元素"))
	}
	result["taskType"], result["versionRelation"] = "modify_existing", "在上一版本基础上修改："+changeRequest
	return result
}
func firstString(values []string) string {
	if len(values) > 0 {
		return values[0]
	}
	return ""
}
func normalizeProductType(value string) string {
	switch {
	case strings.Contains(value, "戒"):
		return "戒指"
	case strings.Contains(value, "镯"):
		return "手镯"
	case strings.Contains(value, "链"):
		return "项链"
	case strings.Contains(value, "吊坠") || strings.Contains(value, "金锁") || strings.Contains(value, "平安锁"):
		return "吊坠"
	default:
		return firstNonBlank(value, "戒指")
	}
}
func keywordMatches(text string, terms []string) []string {
	result := []string{}
	for _, term := range terms {
		if strings.Contains(text, term) {
			result = append(result, term)
		}
	}
	return result
}
func legacyBuildGoldPrompt(requirement model.Record, operation, change string) string {
	parts := []string{"premium jewelry product design", model.String(requirement, "goldType"), model.String(requirement, "style"), model.String(requirement, "productType")}
	if motifs := model.Strings(requirement["motifs"]); len(motifs) > 0 {
		parts = append(parts, "motifs: "+strings.Join(motifs, ", "))
	}
	if surface := model.Strings(requirement["surfaceEffects"]); len(surface) > 0 {
		parts = append(parts, "surface: "+strings.Join(surface, ", "))
	}
	parts = append(parts, "studio lighting, realistic gold texture, clean white background, no text, no watermark")
	if operation == "refine" && change != "" {
		parts = append(parts, "revision request: "+change)
	}
	return strings.Join(nonEmpty(parts), "; ")
}

func filenameFor(prefix, extension string) string {
	return filepath.Base(prefix) + "-" + model.NewID()[:8] + extension
}
