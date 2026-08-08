package service

import (
	"fmt"
	"regexp"
	"strings"

	"jewelchain-studio/internal/model"
)

// This file is the Go implementation of the deterministic requirement and
// prompt contract that used to live in backend/requirements and
// backend/gold-prompt-builder.  The tables are deliberately local to the Go
// binary: the production backend must not read the removable Node tree.

type requirementRule struct{ term, value string }
type styleRule struct {
	terms          []string
	values         []string
	interpretation string
	doNotInfer     string
}

var productRules = []requirementRule{
	{"金镶玉吊坠", "吊坠"}, {"儿童平安锁", "平安锁/儿童吊坠"}, {"平安锁", "平安锁/儿童吊坠"},
	{"儿童手镯", "儿童手镯"}, {"宝宝手镯", "儿童手镯"}, {"纪念日对戒", "对戒"}, {"对戒", "对戒"},
	{"转运珠", "转运珠/串饰"}, {"金条", "金条/礼品金"}, {"耳钉", "耳钉"}, {"耳坠", "耳坠"},
	{"耳环", "耳环"}, {"手镯", "手镯"}, {"手链", "手链"}, {"项链", "项链"}, {"吊坠", "吊坠"},
	{"戒指", "戒指"}, {"金锁", "金锁/吊坠"}, {"摆件", "摆件"},
}
var goldRules = []requirementRule{
	{"3D硬金", "3D硬金"}, {"3d硬金", "3D硬金"}, {"5G黄金", "5G黄金"}, {"5g黄金", "5G黄金"},
	{"硬足金", "硬足金"}, {"18K金", "18K金"}, {"18k金", "18K金"}, {"22K金", "22K金"}, {"22k金", "22K金"},
	{"足金", "足金"}, {"K金", "K金"}, {"k金", "K金"},
}
var surfaceRules = []requirementRule{{"哑光", "哑光"}, {"磨砂", "磨砂"}, {"拉丝", "拉丝"}, {"亮面", "亮面"}, {"光面", "光面"}, {"镜面", "镜面"}, {"做旧", "做旧"}, {"温润", "温润"}, {"古法金", "古法金质感"}}
var craftRules = []requirementRule{{"錾刻", "錾刻"}, {"浮雕", "浮雕"}, {"镂空", "镂空"}, {"电铸", "电铸"}, {"珐琅", "珐琅"}, {"镶嵌", "镶嵌"}, {"喷砂", "喷砂"}, {"拉丝", "拉丝"}, {"磨砂", "磨砂"}, {"古法工艺", "古法工艺"}}
var structureRules = []requirementRule{{"开口", "开口/活口"}, {"活口", "开口/活口"}, {"闭口", "闭口"}, {"固定圈", "固定圈"}, {"空心", "空心"}, {"半空心", "半空心"}, {"实心", "实心"}, {"镂空", "镂空"}, {"可活动", "可活动"}}
var settingRules = []requirementRule{{"不镶嵌", "不镶嵌"}, {"不镶钻", "不镶嵌"}, {"钻石", "钻石"}, {"镶钻", "钻石"}, {"翡翠", "翡翠"}, {"玉石", "玉石"}, {"金镶玉", "玉石"}, {"珍珠", "珍珠"}, {"彩宝", "彩宝"}, {"珐琅", "珐琅"}}
var motifRules = []string{"莲花", "祥云", "龙凤", "生肖龙", "生肖", "福字", "如意", "蝴蝶", "葫芦", "竹节", "几何", "爱心", "貔貅", "佛像", "花卉", "囍字", "窗棂", "元宝", "企业标识", "刻字", "龙", "凤"}
var meaningRules = []string{"平安", "招财", "福气", "长寿", "爱情", "事业", "学业", "健康", "好运", "转运", "福禄", "顺利"}
var styleRules = []styleRule{
	{[]string{"年轻一点", "年轻", "适合年轻人"}, []string{"年轻化", "现代"}, "线条简洁、传统感不过重、适合日常", "不能推断为固定克重、固定尺寸或固定材质"},
	{[]string{"简约", "简单一点", "素一点", "极简"}, []string{"简约"}, "减少装饰、保持清晰比例", "不能推断为完全没有设计或结构过薄"},
	{[]string{"大气"}, []string{"大气", "稳重"}, "视觉存在感、比例舒展", "不能推断为大克重、实心或厚重"},
	{[]string{"高级", "高级感"}, []string{"高级", "克制", "精致"}, "留白、比例协调、细节精致", "不能推断为镶钻、高预算或贵重材质"},
	{[]string{"精致"}, []string{"精致"}, "细节和比例精细", "不能推断为小尺寸或低克重"},
	{[]string{"低调"}, []string{"低调", "克制"}, "不过度张扬、适合日常", "不能推断为极细、极小或没有设计"},
	{[]string{"贵气", "显贵", "富贵"}, []string{"贵气", "质感"}, "礼品感、黄金质感和大方比例", "不能推断为大克重、堆金或财富符号"},
	{[]string{"不俗", "不能俗", "不要太俗", "别太俗"}, []string{"克制", "有设计感"}, "避免直白和元素堆砌", "不能推断为只能极简或删除传统元素"},
	{[]string{"国潮", "中国风", "国风"}, []string{"国风", "传统元素现代化"}, "文化符号现代化表达", "不能把龙凤祥云全部堆叠"},
	{[]string{"古法感", "古法金那种感觉", "古法金的感觉", "古法一点"}, []string{"古法金视觉质感", "温润"}, "哑光、温润、传统工艺气质", "不能直接认定实际采用古法金工艺"},
	{[]string{"轻奢"}, []string{"轻奢", "现代", "精致"}, "简洁中带精致点缀", "不能推断为必须镶钻或高预算"},
	{[]string{"稳重"}, []string{"稳重", "成熟"}, "端正、不过分跳脱", "不能推断为老气或复杂"},
	{[]string{"温柔"}, []string{"柔美", "圆润"}, "曲线柔和、表面细腻", "不能推断为粉色或女性专属元素"},
	{[]string{"可爱"}, []string{"可爱", "圆润", "亲和"}, "亲和、小巧、圆润", "不能直接卡通化或幼稚化"},
	{[]string{"商务"}, []string{"商务", "成熟", "克制"}, "低调、正式、有质感", "不能推断为完全素面或无设计"},
	{[]string{"喜庆"}, []string{"喜庆", "仪式感"}, "吉祥和节庆氛围", "不能推断为龙凤囍字全部必须出现"},
	{[]string{"甜美"}, []string{"甜美", "轻熟"}, "柔和、精致但不过度儿童化", "不能直接卡通化"},
	{[]string{"力量感"}, []string{"力量感", "沉稳"}, "线条稳、结构清晰", "不能推断为越宽越重越好"},
	{[]string{"传统"}, []string{"传统"}, "文化和经典设计语言", "不能推断为复杂满雕"},
	{[]string{"古风"}, []string{"古风"}, "传统气质的日常化表达", "不能推断为复杂长流苏"},
}

var (
	weightRangePattern = regexp.MustCompile(`(?i)(\d+(?:\.\d+)?)\s*(?:-|—|~|～|到|至)\s*(\d+(?:\.\d+)?)\s*(?:g|克)`)
	weightPattern      = regexp.MustCompile(`(?i)(\d+(?:\.\d+)?)\s*(?:g|克)(?:以内|以下|左右|上下)?`)
	budgetPattern      = regexp.MustCompile(`(?:预算\s*)?(\d+(?:\.\d+)?)\s*(万|千|元|块)?(?:以内|以下|左右|上下|前后)`)
)

func parseGoldRequirement(raw string, form model.Record) (model.Record, string) {
	raw = strings.TrimSpace(raw)
	taskType := "new_design"
	if matchesAny(raw, "旧", "原图", "参考图", "造型不要动") || regexp.MustCompile(`保留.*(?:轮廓|造型|形状)|只改(?:材质|表面|质感)`).MatchString(raw) {
		taskType = "modify_existing"
		if regexp.MustCompile(`只改(?:材质|表面|质感)|造型不要动.*古法`).MatchString(raw) {
			taskType = "material_surface_edit"
		}
	}
	requirement := model.Record{
		"taskType": taskType, "productType": "", "goldType": "", "targetAudience": "", "targetUsers": []string{}, "usageScenario": "", "usageScenarios": []string{}, "wearingFrequency": "", "style": "", "styleKeywords": []string{}, "motifs": []string{}, "meanings": []string{}, "weightRequirement": "未说明", "visualWeight": "未说明", "budget": "未说明", "dimensions": []string{}, "structureForms": []string{}, "craftRequirements": []string{}, "surfaceEffects": []string{}, "settingRequirements": []string{}, "productionFeasibility": "待专家确认", "comfortRequirements": []string{}, "safetyRisks": []string{}, "mustKeep": []string{}, "mustAvoid": []string{}, "referenceRequirement": "未说明", "copyrightStatus": "未说明", "versionRelation": "新生成", "namingCompliance": "客户原话与规范命名需分开保存", "hardnessCraftFit": "待专家确认", "loadBearingPoints": []string{}, "contactSurfaces": []string{}, "processingPreferences": []string{}, "salesAttribute": "未说明",
	}
	if taskType == "modify_existing" {
		requirement["versionRelation"], requirement["referenceRequirement"] = "基于旧图修改", "需要参考图或旧款"
	}
	if taskType == "material_surface_edit" {
		requirement["versionRelation"], requirement["referenceRequirement"] = "保留造型，仅修改材质/表面效果", "需要参考图或旧款"
	}

	evidence, ambiguous, doNotInfer := []any{}, []string{}, []string{}
	if found := firstMapped(raw, productRules); found != nil {
		requirement["productType"] = found.value
		evidence = append(evidence, evidenceRow("productType", found.value, "customer_text", found.term, .98))
	}
	ancientVisualOnly := regexp.MustCompile(`古法感|古法金那种(?:感觉|.*质感)|古法金的感觉|换成古法金.*(?:感觉|质感)|古法一点`).MatchString(raw)
	if found := firstMapped(raw, goldRules); found != nil {
		requirement["goldType"] = found.value
		evidence = append(evidence, evidenceRow("goldType", found.value, "customer_text", found.term, .98))
	} else if strings.Contains(raw, "古法金") && !ancientVisualOnly {
		requirement["goldType"] = "古法金（工艺口径待确认）"
		doNotInfer = append(doNotInfer, "“古法金”需要确认是实际工艺还是仅视觉风格")
	}
	if audience := detectAudience(raw); len(audience) > 0 {
		requirement["targetUsers"], requirement["targetAudience"] = audience, strings.Join(audience, "、")
		evidence = append(evidence, evidenceRow("targetAudience", requirement["targetAudience"], "domain_interpretation", audience[0], .86))
	}
	if scenarios := detectScenarios(raw); len(scenarios) > 0 {
		requirement["usageScenarios"], requirement["usageScenario"] = scenarios, strings.Join(scenarios, "、")
		evidence = append(evidence, evidenceRow("usageScenario", requirement["usageScenario"], "domain_interpretation", scenarios[0], .88))
	}
	if matchesAny(raw, "每天", "日常", "平时", "上班", "通勤") {
		requirement["wearingFrequency"] = "日常"
	} else if matchesAny(raw, "重要场合", "婚礼", "婚嫁") {
		requirement["wearingFrequency"] = "重要场合"
	} else if strings.Contains(raw, "收藏") {
		requirement["wearingFrequency"] = "收藏展示"
	}

	styles := []string{}
	for _, rule := range styleRules {
		for _, term := range rule.terms {
			if !containsFold(raw, term) {
				continue
			}
			styles = append(styles, rule.values...)
			ambiguous = append(ambiguous, term+"："+rule.interpretation)
			doNotInfer = append(doNotInfer, term+"："+rule.doNotInfer)
			for _, value := range rule.values {
				evidence = append(evidence, evidenceRow("style", value, "fuzzy_term_interpretation", term, .72))
			}
			break
		}
	}
	styles = uniqueStrings(styles)
	requirement["styleKeywords"], requirement["style"] = styles, strings.Join(styles, "、")
	motifs, meanings := matchedTerms(raw, motifRules), matchedTerms(raw, meaningRules)
	if containsString(motifs, "龙凤") {
		motifs = appendWithout(motifs, "龙", "凤")
	}
	if containsString(motifs, "生肖龙") {
		motifs = appendWithout(motifs, "生肖", "龙")
	}
	if strings.Contains(raw, "福气感") {
		meanings = append(meanings, "福气")
	}
	if strings.Contains(raw, "有好寓意") && len(meanings) == 0 {
		meanings = append(meanings, "吉祥寓意（具体待确认）")
	}
	requirement["motifs"], requirement["meanings"] = uniqueStrings(motifs), uniqueStrings(meanings)
	for _, motif := range model.Strings(requirement["motifs"]) {
		evidence = append(evidence, evidenceRow("motifs", motif, "customer_text", motif, .98))
	}
	if weight := exactWeight(raw); weight != "" {
		requirement["weightRequirement"] = weight
		evidence = append(evidence, evidenceRow("weightRequirement", weight, "customer_text", weight, .99))
	} else if matchesAny(raw, "不要太重", "别太重", "轻一点", "偏轻", "低克重") {
		requirement["weightRequirement"], requirement["visualWeight"] = "偏轻，具体克重未说明", "轻量"
		ambiguous = append(ambiguous, "不要太重：偏轻或降低视觉厚重，具体原因和克重待确认")
		doNotInfer = append(doNotInfer, "不要把“不要太重”推断为具体克重数字")
	}
	if matchesAny(raw, "看起来不能太小气", "不能太小气", "显大不重", "有存在感") {
		requirement["visualWeight"] = "有存在感，但实际克重需控制"
	}
	if matchesAny(raw, "厚重", "有分量感") && model.String(requirement, "visualWeight") == "未说明" {
		requirement["visualWeight"] = "厚重或有分量感（实际克重未说明）"
	}
	if budget := exactBudget(raw); budget != "" {
		requirement["budget"] = budget
		evidence = append(evidence, evidenceRow("budget", budget, "customer_text", budget, .99))
	} else if strings.Contains(raw, "预算有限") {
		requirement["budget"] = "有限，具体金额未说明"
		doNotInfer = append(doNotInfer, "预算有限不能转成具体金额")
	}

	requirement["structureForms"], requirement["craftRequirements"], requirement["surfaceEffects"], requirement["settingRequirements"] = allMapped(raw, structureRules), allMapped(raw, craftRules), allMapped(raw, surfaceRules), allMapped(raw, settingRules)
	if ancientVisualOnly {
		requirement["surfaceEffects"] = uniqueStrings(append(model.Strings(requirement["surfaceEffects"]), "哑光", "温润", "古法金视觉质感"))
		requirement["goldType"] = ""
		requirement["styleKeywords"] = uniqueStrings(append(model.Strings(requirement["styleKeywords"]), "古法金视觉质感", "温润"))
		requirement["style"] = strings.Join(model.Strings(requirement["styleKeywords"]), "、")
		doNotInfer = append(doNotInfer, "古法金视觉质感不能直接认定实际采用古法工艺")
	}
	if matchesAny(raw, "不刮衣服", "不勾头发", "不挂头发") {
		requirement["comfortRequirements"] = append(model.Strings(requirement["comfortRequirements"]), "减少勾挂风险")
	}
	if matchesAny(raw, "安全第一", "不要尖", "不要尖尖", "圆润") {
		requirement["comfortRequirements"] = append(model.Strings(requirement["comfortRequirements"]), "边缘圆润，避免尖锐")
	}
	if strings.Contains(raw, "不压耳") {
		requirement["comfortRequirements"] = append(model.Strings(requirement["comfortRequirements"]), "轻便，不压耳")
	}
	if strings.Contains(raw, "方便调大小") {
		requirement["structureForms"] = append(model.Strings(requirement["structureForms"]), "开口/活口")
	}
	if strings.Contains(raw, "金镶玉") {
		requirement["settingRequirements"] = uniqueStrings(append(model.Strings(requirement["settingRequirements"]), "玉石"))
	}
	requirement["mustKeep"], requirement["mustAvoid"] = detectMustKeep(raw, model.Strings(requirement["motifs"]), taskType), detectMustAvoid(raw)

	normalizeRequirementForm(requirement, form, &evidence)
	requirement["targetUsers"] = splitRequirementList(model.String(requirement, "targetAudience"))
	requirement["usageScenarios"] = splitRequirementList(model.String(requirement, "usageScenario"))
	requirement["styleKeywords"] = splitRequirementList(model.String(requirement, "style"))
	comfort, risks := detectComfortAndRisks(raw, requirement)
	requirement["comfortRequirements"] = uniqueStrings(append(model.Strings(requirement["comfortRequirements"]), comfort...))
	requirement["safetyRisks"] = uniqueStrings(append(model.Strings(requirement["safetyRisks"]), risks...))
	addProductWearability(requirement)
	for _, key := range []string{"mustKeep", "mustAvoid", "structureForms", "craftRequirements", "surfaceEffects", "settingRequirements", "comfortRequirements", "safetyRisks", "loadBearingPoints", "contactSurfaces"} {
		requirement[key] = uniqueStrings(model.Strings(requirement[key]))
	}
	requirement["weightOrBudget"] = strings.Join(nonUnknown(model.String(requirement, "weightRequirement"), model.String(requirement, "budget")), "；")
	return requirement, understandingSummary(requirement, raw, ambiguous, doNotInfer, evidence)
}

func parseRequirement(raw string, form model.Record) (model.Record, string) {
	requirement, summary := parseGoldRequirement(raw, form)
	return normalizeRequirementForGeneration(requirement), summary
}
func parseRevisionRequirement(raw string) (model.Record, string) {
	return parseGoldRequirement(raw, nil)
}

func normalizeRequirementForGeneration(requirement model.Record) model.Record {
	result := model.Clone(requirement)
	result["productType"] = normalizeProductType(model.String(result, "productType"))
	if model.String(result, "goldType") == "" {
		result["goldType"] = "足金"
	}
	if model.String(result, "style") == "" {
		result["style"] = "新中式"
	}
	for _, field := range []string{"motifs", "surfaceEffects", "mustKeep", "mustAvoid", "structureForms"} {
		if result[field] == nil {
			result[field] = []string{}
		}
	}
	return result
}

func firstMapped(raw string, rules []requirementRule) *requirementRule {
	for _, rule := range rules {
		if containsFold(raw, rule.term) {
			copy := rule
			return &copy
		}
	}
	return nil
}
func allMapped(raw string, rules []requirementRule) []string {
	result := []string{}
	for _, rule := range rules {
		if containsFold(raw, rule.term) {
			result = append(result, rule.value)
		}
	}
	return uniqueStrings(result)
}
func matchedTerms(raw string, terms []string) []string {
	result := []string{}
	for _, term := range terms {
		if containsFold(raw, term) {
			result = append(result, term)
		}
	}
	return uniqueStrings(result)
}
func containsFold(raw, term string) bool {
	return strings.Contains(strings.ToLower(raw), strings.ToLower(term))
}
func matchesAny(raw string, terms ...string) bool {
	for _, term := range terms {
		if strings.Contains(raw, term) {
			return true
		}
	}
	return false
}
func exactWeight(raw string) string {
	if match := weightRangePattern.FindStringSubmatch(raw); len(match) == 3 {
		return match[1] + "-" + match[2] + "克"
	}
	return strings.ReplaceAll(strings.ReplaceAll(weightPattern.FindString(raw), "g", "克"), "G", "克")
}
func exactBudget(raw string) string {
	match := budgetPattern.FindStringSubmatch(raw)
	if len(match) == 0 || (match[2] == "" && !strings.Contains(match[0], "预算") && !strings.Contains(raw, "预算"+match[1])) {
		return ""
	}
	return strings.TrimSpace(strings.TrimPrefix(match[0], "预算"))
}
func evidenceRow(field string, value any, source, excerpt string, confidence float64) model.Record {
	return model.Record{"field": field, "value": value, "source": source, "excerpt": excerpt, "confidence": confidence}
}

func detectAudience(raw string) []string {
	switch {
	case matchesAny(raw, "女朋友", "年轻女性", "女生"):
		return []string{"年轻女性"}
	case matchesAny(raw, "妈妈", "母亲"):
		return []string{"母亲", "中年女性（年龄待确认）"}
	case matchesAny(raw, "宝宝", "婴幼儿"):
		return []string{"婴幼儿或儿童"}
	case matchesAny(raw, "小孩", "孩子", "儿童"):
		return []string{"儿童"}
	case matchesAny(raw, "老人", "长辈"):
		return []string{"老人"}
	case strings.Contains(raw, "男朋友"):
		return []string{"成年男性"}
	case matchesAny(raw, "男士", "男性", "男人"):
		return []string{"男性"}
	case strings.Contains(raw, "闺蜜"):
		return []string{"朋友（女性，年龄待确认）"}
	case matchesAny(raw, "情侣", "夫妻", "一对"):
		return []string{"情侣/夫妻"}
	case matchesAny(raw, "商务客户", "做生意的客户", "客户是做生意"):
		return []string{"商务客户"}
	case strings.Contains(raw, "新娘"):
		return []string{"新娘"}
	default:
		return []string{}
	}
}
func detectScenarios(raw string) []string {
	result := []string{}
	if strings.Contains(raw, "送") || strings.Contains(raw, "礼物") || strings.Contains(raw, "买给") || regexp.MustCompile(`给(?:妈妈|母亲|女朋友|男朋友|朋友|客户|小孩|孩子|宝宝|老人|长辈|闺蜜).*(?:做|买)`).MatchString(raw) {
		result = append(result, "送礼")
	}
	for _, pair := range []struct {
		terms []string
		value string
	}{{[]string{"婚嫁", "结婚", "婚礼"}, "婚嫁"}, {[]string{"生日"}, "生日"}, {[]string{"情人节"}, "情人节"}, {[]string{"纪念日"}, "纪念日"}, {[]string{"上班", "通勤"}, "通勤"}, {[]string{"日常", "平时", "每天", "天天"}, "日常佩戴"}, {[]string{"商务", "公司送礼", "企业礼品"}, "商务送礼"}, {[]string{"收藏"}, "收藏"}, {[]string{"节庆", "过年", "春节"}, "节庆"}} {
		if matchesAny(raw, pair.terms...) {
			result = append(result, pair.value)
		}
	}
	return uniqueStrings(result)
}
func detectMustKeep(raw string, motifs []string, taskType string) []string {
	result := []string{}
	if regexp.MustCompile(`保留(?:这个|原有|原来的)?(?:造型|形状|外形)`).MatchString(raw) || strings.Contains(raw, "造型不要动") {
		result = append(result, "原有造型和结构")
	}
	if regexp.MustCompile(`轮廓我喜欢|保留(?:这个|原有|原来的)?轮廓`).MatchString(raw) {
		result = append(result, "原有轮廓")
	}
	if regexp.MustCompile(`只改(?:材质|表面|质感)`).MatchString(raw) {
		result = append(result, "原造型、结构和比例")
	}
	if taskType == "modify_existing" && len(motifs) > 0 && strings.Contains(raw, "保留") {
		for _, motif := range motifs {
			result = append(result, motif+"元素")
		}
	}
	for _, motif := range motifs {
		if strings.Contains(raw, motif) {
			result = append(result, motif+"元素")
		}
	}
	return uniqueStrings(result)
}
func detectMustAvoid(raw string) []string {
	result := []string{}
	for _, rule := range []struct {
		match  []string
		values []string
	}{
		{[]string{"不要太花", "别太花", "不要这么花", "太花哨", "太复杂", "花纹改简单", "密密麻麻", "不要太挤"}, []string{"复杂密集纹样", "元素堆砌"}},
		{[]string{"不要太重", "别太重", "不要这么重"}, []string{"过于厚重的视觉和结构"}},
		{[]string{"不要太夸张", "别太夸张", "不要太显眼", "不喜欢太张扬"}, []string{"夸张体积和过度装饰"}},
		{[]string{"不要太传统", "不要这么传统", "不要做成奶奶款", "不要太老气", "别太老", "别太新潮"}, []string{"过度老气或传统元素堆砌"}},
		{[]string{"不要太俗", "不能俗", "别太俗", "不要看起来廉价", "不要暴发户"}, []string{"俗气直白符号和廉价感"}},
		{[]string{"不要尖", "不要尖尖", "别刮", "不刮手", "不刮衣服"}, []string{"尖锐边缘和勾挂结构"}},
		{[]string{"不要卡通", "不要幼稚"}, []string{"卡通化和儿童化表达"}},
		{[]string{"不要太凶", "别太凶"}, []string{"攻击性强、尖牙尖角过多"}},
		{[]string{"不要完全一样"}, []string{"两件完全复制"}}, {[]string{"不要盖住玉", "不要抢了玉"}, []string{"黄金遮挡或压过玉石主体"}},
		{[]string{"造型不要动", "只改材质", "保留形状"}, []string{"改变产品造型、结构或比例"}},
	} {
		if matchesAny(raw, rule.match...) {
			result = append(result, rule.values...)
		}
	}
	return uniqueStrings(result)
}
func detectComfortAndRisks(raw string, requirement model.Record) ([]string, []string) {
	comfort, risks, product, audience := []string{}, []string{}, model.String(requirement, "productType"), model.String(requirement, "targetAudience")
	daily := containsString(model.Strings(requirement["usageScenarios"]), "日常佩戴") || containsString(model.Strings(requirement["usageScenarios"]), "通勤")
	if matchesAny(raw, "不刮手", "别刮手", "圆润") || product == "戒指" {
		comfort = append(comfort, "边缘圆润，不刮手")
	}
	if matchesAny(raw, "不挂头发", "别老是挂头发") || (daily && product == "项链") {
		comfort = append(comfort, "链节和扣位顺滑，减少勾挂")
	}
	if matchesAny(raw, "不压耳", "不要压耳朵", "轻便") || product == "耳钉" || product == "耳环" || product == "耳坠" {
		comfort = append(comfort, "控制耳饰重量，避免压耳")
	}
	if matchesAny(raw, "日常", "平时", "每天", "上班") {
		comfort = append(comfort, "适合日常佩戴，结构牢固且不易勾挂")
	}
	if matchesAny(audience, "儿童", "婴幼儿") {
		comfort = append(comfort, "佩戴接触面圆润")
		risks = append(risks, "尖角或毛刺", "小零件脱落", "易变形开口")
	}
	if matchesAny(raw, "尖锐", "尖尖", "尖角") {
		risks = append(risks, "尖锐边缘")
	}
	if matchesAny(raw, "开口", "活口") && product == "戒指" {
		risks = append(risks, "开口处易变形，尖端需圆润")
	}
	if matchesAny(raw, "不要太重", "偏轻", "低克重") && product == "手镯" {
		risks = append(risks, "轻量化结构过薄可能易变形，需专家确认")
	}
	if matchesAny(strings.Join(model.Strings(requirement["motifs"]), "、"), "花卉", "莲花") {
		risks = append(risks, "立体花瓣、过细连接或悬空结构需专家确认")
	}
	if model.String(requirement, "taskType") == "modify_existing" || model.String(requirement, "taskType") == "material_surface_edit" {
		risks = append(risks, "原图来源和版权状态需确认")
	}
	return uniqueStrings(comfort), uniqueStrings(risks)
}
func normalizeRequirementForm(requirement, form model.Record, evidence *[]any) {
	if form == nil {
		return
	}
	for _, key := range []string{"productType", "goldType", "targetAudience", "usageScenario", "wearingFrequency", "style", "weightRequirement", "visualWeight", "budget", "copyrightStatus", "versionRelation"} {
		if value := model.String(form, key); value != "" {
			requirement[key] = value
			*evidence = append(*evidence, evidenceRow(key, value, "form_field", key, 1))
		}
	}
	for _, key := range []string{"motifs", "meanings", "dimensions", "structureForms", "craftRequirements", "surfaceEffects", "settingRequirements", "comfortRequirements", "safetyRisks", "mustKeep", "mustAvoid"} {
		if values := formList(form[key]); len(values) > 0 {
			requirement[key] = values
			for _, value := range values {
				*evidence = append(*evidence, evidenceRow(key, value, "form_field", key, 1))
			}
		}
	}
	if legacy := model.String(form, "weightOrBudget"); legacy != "" {
		if strings.ContainsAny(legacy, "预算元块万千") {
			requirement["budget"] = legacy
		} else {
			requirement["weightRequirement"] = legacy
		}
	}
}
func addProductWearability(requirement model.Record) {
	product := model.String(requirement, "productType")
	if containsString([]string{"吊坠", "平安锁/儿童吊坠", "金锁/吊坠"}, product) {
		requirement["loadBearingPoints"] = append(model.Strings(requirement["loadBearingPoints"]), "吊坠扣头和连接环")
	}
	if product == "戒指" || product == "对戒" {
		requirement["loadBearingPoints"] = append(model.Strings(requirement["loadBearingPoints"]), "戒臂和开口端（如有）")
		requirement["contactSurfaces"] = append(model.Strings(requirement["contactSurfaces"]), "戒指内圈")
	}
	if product == "手镯" || product == "儿童手镯" {
		requirement["loadBearingPoints"] = append(model.Strings(requirement["loadBearingPoints"]), "手镯开口或连接位置")
		requirement["contactSurfaces"] = append(model.Strings(requirement["contactSurfaces"]), "手镯内壁")
	}
	if product == "耳钉" || product == "耳环" || product == "耳坠" {
		requirement["loadBearingPoints"] = append(model.Strings(requirement["loadBearingPoints"]), "耳针、耳托和连接件")
		requirement["contactSurfaces"] = append(model.Strings(requirement["contactSurfaces"]), "耳针和耳托接触面")
	}
	if product == "项链" {
		requirement["loadBearingPoints"] = append(model.Strings(requirement["loadBearingPoints"]), "链节、连接环和扣位")
		requirement["contactSurfaces"] = append(model.Strings(requirement["contactSurfaces"]), "链节和扣位接触面")
	}
}
func understandingSummary(requirement model.Record, raw string, ambiguous, doNotInfer []string, evidence []any) string {
	questions := missingRequirementFields(requirement, raw)
	known := nonEmpty([]string{model.String(requirement, "productType"), model.String(requirement, "targetAudience"), model.String(requirement, "usageScenario"), model.String(requirement, "style"), strings.Join(model.Strings(requirement["motifs"]), "、")})
	if weight := model.String(requirement, "weightRequirement"); weight != "未说明" {
		known = append(known, weight)
	}
	if len(known) == 0 {
		return "当前信息不足，未形成可靠结构化需求；请补充产品类型、对象、场景和基本限制。"
	}
	return fmt.Sprintf("已从客户原话和明确字段整理：%s。模糊词未被转换成未经确认的硬参数，仍需人工确认 %s。", strings.Join(uniqueStrings(known), "；"), strings.Join(questions, "、"))
}
func missingRequirementFields(requirement model.Record, raw string) []string {
	result := []string{}
	if model.String(requirement, "productType") == "" {
		result = append(result, "产品类型")
	}
	if model.String(requirement, "goldType") == "" {
		result = append(result, "黄金类型")
	}
	if model.String(requirement, "targetAudience") == "" {
		result = append(result, "目标人群")
	}
	if model.String(requirement, "usageScenario") == "" {
		result = append(result, "使用场景")
	}
	if model.String(requirement, "budget") == "未说明" {
		result = append(result, "预算")
	}
	if strings.Contains(model.String(requirement, "weightRequirement"), "未说明") {
		result = append(result, "克重要求")
	}
	product := model.String(requirement, "productType")
	if containsString([]string{"戒指", "对戒", "手镯", "儿童手镯", "手链", "项链", "吊坠", "平安锁/儿童吊坠", "金锁/吊坠", "耳钉", "耳环", "耳坠"}, product) {
		result = append(result, "尺寸或佩戴参数")
	}
	if matchesAny(model.String(requirement, "targetAudience"), "儿童", "婴幼儿") {
		result = append(result, "尺寸或佩戴参数")
	}
	if strings.Contains(model.String(requirement, "style"), "古法金视觉质感") && model.String(requirement, "goldType") == "" {
		result = append(result, "真实工艺要求")
	}
	if model.String(requirement, "taskType") != "new_design" {
		result = append(result, "参考图版权状态")
	}
	if strings.Contains(raw, "金镶玉") {
		result = append(result, "尺寸或佩戴参数")
	}
	return uniqueStrings(result)
}
func splitRequirementList(value string) []string { return formList(value) }
func formList(value any) []string {
	switch typed := value.(type) {
	case string:
		return uniqueStrings(strings.FieldsFunc(strings.TrimSpace(typed), func(r rune) bool { return strings.ContainsRune("，,、;；\n", r) }))
	default:
		return uniqueStrings(model.Strings(typed))
	}
}
func uniqueStrings(values []string) []string {
	result, seen := []string{}, map[string]struct{}{}
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		result = append(result, value)
	}
	return result
}
func containsString(values []string, expected string) bool {
	for _, value := range values {
		if value == expected {
			return true
		}
	}
	return false
}
func appendWithout(values []string, removed ...string) []string {
	result := []string{}
	for _, value := range values {
		if !containsString(removed, value) {
			result = append(result, value)
		}
	}
	return uniqueStrings(result)
}
func nonUnknown(values ...string) []string {
	result := []string{}
	for _, value := range values {
		if value != "" && value != "未说明" {
			result = append(result, value)
		}
	}
	return uniqueStrings(result)
}

type productTemplate struct {
	key, name, defaultShape string
	aliases, shapes         []string
}

var productTemplates = []productTemplate{
	{"pendant", "吊坠", "圆形吊坠", []string{"吊坠", "平安锁", "金锁", "pendant"}, []string{"圆形吊坠", "椭圆吊坠", "水滴形吊坠", "方牌吊坠", "心形吊坠", "平安锁"}},
	{"necklace", "项链", "细链单圈", []string{"项链", "锁骨链", "链条项链", "necklace"}, []string{"细链单圈", "锁骨链", "古巴链", "盒子链", "绳链"}},
	{"ring", "戒指", "圆弧素圈", []string{"戒指", "对戒", "素圈", "ring"}, []string{"细版素圈", "宽版素圈", "圆弧素圈", "方形戒面", "花冠戒"}},
	{"bangle", "手镯", "闭口圆镯", []string{"手镯", "闭口手镯", "圆镯", "bangle"}, []string{"闭口圆镯", "椭圆手镯", "细圆镯", "宽面手镯", "扁条手镯"}},
}
var shapeFragments = map[string]string{
	"圆形吊坠": "compact circular pendant body", "椭圆吊坠": "balanced oval pendant body", "水滴形吊坠": "elegant teardrop pendant silhouette", "方牌吊坠": "compact rectangular plaque pendant with rounded safe corners", "心形吊坠": "restrained symmetrical heart-shaped pendant", "平安锁": "rounded child-safe Chinese safety-lock pendant silhouette",
	"细链单圈": "one continuous fine-chain oval loop with small uniform links", "锁骨链": "delicate short clavicle necklace proportions", "古巴链": "uniform polished curb-chain links, refined rather than oversized", "盒子链": "small precise box-chain links with consistent thickness", "绳链": "fine twisted rope-chain texture with consistent slender thickness",
	"细版素圈": "slim closed ring band with a clean circular profile", "宽版素圈": "wide closed ring band with balanced wearable proportions", "圆弧素圈": "rounded comfort-fit closed ring band", "方形戒面": "restrained signet-style ring with a compact squared top", "花冠戒": "single closed ring with a refined floral crown detail",
	"闭口圆镯": "complete closed circular adult-size bangle", "椭圆手镯": "complete closed oval adult-size bangle", "细圆镯": "slim rounded tubular adult-size bangle", "宽面手镯": "wide flat-faced adult-size closed bangle", "扁条手镯": "balanced flat-strip adult-size closed bangle",
}
var styleFragments = []struct{ name, fragment string }{
	{"现代极简", "modern minimalist jewelry design, clean lines, restrained ornamentation, smooth surfaces, understated elegance"}, {"新中式", "modern Chinese-inspired jewelry design, refined oriental aesthetics, balanced symmetry, simplified auspicious motifs"}, {"轻奢精致", "refined luxury jewelry design, delicate layered details, sophisticated elegance, premium craftsmanship"}, {"传统吉祥", "traditional Chinese auspicious jewelry design, symbolic decorative motifs, ceremonial elegance, classic festive character"}, {"年轻活力", "youthful contemporary jewelry design, light visual weight, fresh clean proportions"}, {"成熟大气", "dignified mature jewelry design, balanced proportions, restrained premium presence"},
}

func buildGoldAPIImagePrompt(requirement model.Record, operation, changeRequest string) (model.Record, error) {
	template, ok := selectProductTemplate(requirement)
	if !ok {
		return nil, model.NewError("UNSUPPORTED_PRODUCT_TEMPLATE", "当前客户版只支持吊坠、项链、戒指和手镯，请在确认页选择其中一种。", 400, false, nil)
	}
	shape := template.defaultShape
	shapeSource := strings.Join(append(model.Strings(requirement["structureForms"]), model.String(requirement, "shape"), model.String(requirement, "style"), model.String(requirement, "customerText")), " ")
	for _, candidate := range template.shapes {
		if strings.Contains(shapeSource, candidate) {
			shape = candidate
			break
		}
	}
	styles, motifs := resolveStyleFragments(requirement), promptMotifs(requirement)
	positive := uniqueStrings(append([]string{shapeFragments[shape], mapGoldType(requirement)}, append(append(styles, motifs...), append([]string{mapAudience(requirement), mapScenario(requirement)}, promptRequirements(requirement)...)...)...))
	positive = uniqueStrings(append(positive, "physically plausible jewelry construction", "realistic premium gold reflections", "single jewelry product centered in frame", "clean light gray or white background", "luxury catalog product photography"))
	humanStyle := model.String(requirement, "style")
	if humanStyle == "" {
		humanStyle = "简洁精致"
	}
	motifsText := strings.Join(model.Strings(requirement["motifs"]), "、")
	target := firstNonBlank(model.String(requirement, "targetAudience"), strings.Join(model.Strings(requirement["targetUsers"]), "、"))
	scenario := firstNonBlank(model.String(requirement, "usageScenario"), strings.Join(model.Strings(requirement["usageScenarios"]), "、"))
	weight := firstNonBlank(model.String(requirement, "weightRequirement"), model.String(requirement, "visualWeight"), model.String(requirement, "weightOrBudget"))
	gold := firstNonBlank(model.String(requirement, "goldType"), "黄金 / 足金质感")
	parts := []string{fmt.Sprintf("请生成一张高级珠宝产品摄影风格的%s概念效果图。", template.name), fmt.Sprintf("主体：单个%s。", template.name), fmt.Sprintf("款式形状：%s。", shape), "风格：" + humanStyle + "。"}
	if motifsText != "" {
		parts = append(parts, "设计元素："+motifsText+"。")
	}
	if target != "" {
		parts = append(parts, "适合人群："+target+"。")
	}
	if scenario != "" {
		parts = append(parts, "使用场景："+scenario+"。")
	}
	if weight != "" {
		parts = append(parts, "重量或视觉倾向："+weight+"。")
	}
	parts = append(parts, "材质："+gold+"，需要真实黄金金属光泽与高级珠宝质感。", apiConstraintForProduct(template.key))
	if operation == "refine" && strings.TrimSpace(changeRequest) != "" {
		parts = append(parts, "修改要求："+strings.TrimSpace(changeRequest)+"。")
	}
	parts = append(parts, "构图要求：产品居中，背景干净，白底或浅灰底，边缘清晰，结构合理，可佩戴。", "禁止内容：不要人物，不要手模，不要文字，不要 logo，不要水印，不要多个产品，不要漂浮断裂结构。")
	return model.Record{"productType": template.key, "productName": template.name, "templateVersion": "gold-product-templates-v2", "shape": shape, "style": firstNonBlank(model.String(requirement, "style"), "未指定"), "positivePrompt": strings.Join(positive, ", "), "apiPrompt": strings.Join(parts, " "), "promptTemplateId": nil}, nil
}
func selectProductTemplate(requirement model.Record) (productTemplate, bool) {
	raw := strings.ToLower(strings.Join(nonEmpty([]string{model.String(requirement, "productType"), model.String(requirement, "product"), model.String(requirement, "category"), model.String(requirement, "customerText")}), " "))
	for _, template := range productTemplates {
		for _, alias := range template.aliases {
			if strings.Contains(raw, strings.ToLower(alias)) {
				return template, true
			}
		}
	}
	return productTemplate{}, false
}
func resolveStyleFragments(requirement model.Record) []string {
	raw := strings.Join(append([]string{model.String(requirement, "style")}, model.Strings(requirement["styleKeywords"])...), " ")
	result := []string{}
	for _, item := range styleFragments {
		if strings.Contains(raw, item.name) || item.name == "现代极简" && regexp.MustCompile(`现代|简约|极简|克制`).MatchString(raw) || item.name == "新中式" && regexp.MustCompile(`国风|中式|东方`).MatchString(raw) || item.name == "轻奢精致" && regexp.MustCompile(`轻奢|精致|高级|贵气`).MatchString(raw) || item.name == "传统吉祥" && regexp.MustCompile(`传统|吉祥|喜庆|婚嫁`).MatchString(raw) || item.name == "年轻活力" && regexp.MustCompile(`年轻|活力|少女`).MatchString(raw) || item.name == "成熟大气" && regexp.MustCompile(`成熟|大气|稳重|妈妈|贵妇`).MatchString(raw) {
			result = append(result, item.fragment)
		}
	}
	return uniqueStrings(result)
}
func promptMotifs(requirement model.Record) []string {
	mapped := []requirementRule{{"莲花", "a clearly recognizable restrained lotus motif"}, {"龙凤", "balanced refined dragon and phoenix motifs"}, {"生肖龙", "a gentle elegant Chinese zodiac dragon motif"}, {"龙", "a refined dragon motif"}, {"福字", "a modernized Chinese Fu character motif"}, {"祥云", "restrained auspicious cloud motifs"}, {"如意", "a refined ruyi motif"}, {"蝴蝶", "a sophisticated butterfly motif"}, {"葫芦", "a modernized gourd motif"}, {"竹节", "a clean bamboo-joint motif"}, {"爱心", "an abstract restrained heart motif"}, {"貔貅", "a calm wearable pixiu motif"}, {"花卉", "a simplified floral motif"}}
	result := []string{}
	for _, motif := range model.Strings(requirement["motifs"]) {
		value := ""
		for _, mapping := range mapped {
			if strings.Contains(motif, mapping.term) {
				value = mapping.value
				break
			}
		}
		if value == "" && motif != "" {
			value = "a restrained " + motif + " inspired motif"
		}
		result = append(result, value)
	}
	return uniqueStrings(result)
}
func mapGoldType(requirement model.Record) string {
	value := model.String(requirement, "goldType")
	switch {
	case strings.Contains(value, "古法"):
		return "warm matte ancient-gold finish"
	case regexp.MustCompile(`18K|22K|K金`).MatchString(value):
		return "refined gold alloy material"
	case regexp.MustCompile(`硬足金|硬金|3D硬金|5G`).MatchString(value):
		return "crisp hard-gold jewelry construction"
	default:
		return "realistic premium yellow gold material"
	}
}
func mapAudience(requirement model.Record) string {
	audience := firstNonBlank(model.String(requirement, "targetAudience"), strings.Join(model.Strings(requirement["targetUsers"]), "、"))
	switch {
	case regexp.MustCompile(`年轻女性|女朋友|女生`).MatchString(audience):
		return "designed for a young woman"
	case regexp.MustCompile(`母亲|中年女性|妈妈|贵妇`).MatchString(audience):
		return "designed for a mature woman"
	case regexp.MustCompile(`儿童|婴幼儿|宝宝|小孩`).MatchString(audience):
		return "designed for a child with rounded safe details"
	case strings.Contains(audience, "男"):
		return "designed for an adult man"
	default:
		return ""
	}
}
func mapScenario(requirement model.Record) string {
	scenario := firstNonBlank(model.String(requirement, "usageScenario"), strings.Join(model.Strings(requirement["usageScenarios"]), "、"))
	switch {
	case regexp.MustCompile(`日常|通勤`).MatchString(scenario):
		return "suitable for comfortable daily wear"
	case regexp.MustCompile(`婚嫁|结婚`).MatchString(scenario):
		return "appropriate for an elegant wedding occasion"
	case strings.Contains(scenario, "商务"):
		return "appropriate as a restrained business gift"
	case regexp.MustCompile(`礼|生日|情人节|纪念`).MatchString(scenario):
		return "appropriate as a premium meaningful gift"
	default:
		return ""
	}
}
func promptRequirements(requirement model.Record) []string {
	result := []string{}
	for _, pair := range []struct{ field, label string }{{"structureForms", "structure requirement: "}, {"craftRequirements", "craft intention: "}, {"surfaceEffects", "surface effect: "}} {
		for _, item := range model.Strings(requirement[pair.field]) {
			result = append(result, pair.label+item)
		}
	}
	return result
}
func apiConstraintForProduct(productType string) string {
	switch productType {
	case "pendant":
		return "只展示单个吊坠主体，可带吊环，不要整条项链，不要人物佩戴图。"
	case "necklace":
		return "必须是一条完整的单圈黄金项链，只保留一条链和一个锁扣，链条闭合完整，不要叠戴，不要多条链。"
	case "ring":
		return "必须是单枚闭合戒指，戒圈完整，比例清晰，不要生成手镯、项链或耳饰。"
	case "bangle":
		return "必须是单个成人尺寸的完整闭口手镯，明显大于戒指，不要开口，不要变成戒指。"
	default:
		return "只展示一个首饰主体。"
	}
}
