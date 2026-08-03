import { clone, list, text } from "../utils.js";
import { getRequirementEvaluationCases, getRequirementSchemaCatalog, getRequirementTrainingMetadata } from "./training-data-loader.js";
import { parseGoldRequirement } from "./local-requirement-parser.js";
import { OpenAiCompatibleRequirementProvider } from "./openai-compatible-requirement-provider.js";
import { REQUIREMENT_CONTRACT_VERSION, REQUIREMENT_DATA_VERSION, REQUIREMENT_PARSER_VERSION } from "./requirement-schema.js";

const LIST_FIELDS = [
  "targetUsers", "usageScenarios", "styleKeywords", "motifs", "meanings", "dimensions", "structureForms",
  "craftRequirements", "surfaceEffects", "settingRequirements", "comfortRequirements", "safetyRisks", "mustKeep",
  "mustAvoid", "loadBearingPoints", "contactSurfaces", "processingPreferences",
];
const SCALAR_FIELDS = [
  "taskType", "productType", "goldType", "targetAudience", "usageScenario", "wearingFrequency", "style",
  "weightRequirement", "visualWeight", "budget", "productionFeasibility", "referenceRequirement", "copyrightStatus",
  "versionRelation", "namingCompliance", "hardnessCraftFit", "salesAttribute",
];

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function hardParameterAppearsInInput(value, input) {
  const combined = `${text(input.customerText)} ${JSON.stringify(input.formFields ?? {})}`.toLowerCase();
  const normalized = text(value).toLowerCase();
  if (!normalized || ["未说明", "待确认"].includes(normalized)) return true;
  if (/\d/.test(normalized)) return combined.includes(normalized.replace(/克/g, "").trim()) || combined.includes(normalized);
  return true;
}

function mergeExternal(local, external, input) {
  const remote = external?.raw && typeof external.raw === "object" ? external.raw : {};
  const result = clone(local);
  const structured = clone(local.structuredRequirement);

  for (const field of SCALAR_FIELDS) {
    const value = text(remote[field]);
    if (!value) continue;
    if (["weightRequirement", "budget"].includes(field) && !hardParameterAppearsInInput(value, input)) continue;
    if (!structured[field] || ["未说明", "待专家确认"].includes(structured[field])) structured[field] = value;
  }
  for (const field of LIST_FIELDS) {
    const values = list(remote[field]);
    if (values.length) structured[field] = unique([...(structured[field] ?? []), ...values]);
  }

  result.structuredRequirement = structured;
  result.analysisMode = "openai_compatible_with_expert_guardrails";
  result.externalProvider = { used: true, provider: external.provider, model: external.model, usage: external.usage };
  result.missingFields = unique([...result.missingFields, ...list(remote.missingFields)]);
  result.clarificationQuestions = unique([...result.clarificationQuestions, ...list(remote.clarificationQuestions)]);
  result.contradictions = unique([...result.contradictions, ...list(remote.contradictions)]);
  result.doNotInfer = unique([...result.doNotInfer, ...list(remote.doNotInfer)]);
  result.ambiguousTerms = [...result.ambiguousTerms, ...(Array.isArray(remote.ambiguousTerms) ? remote.ambiguousTerms : [])];
  result.manufacturingRisks = unique([...result.manufacturingRisks, ...list(remote.safetyRisks)]);
  result.understandingSummary = text(remote.understandingSummary) || result.understandingSummary;

  // Keep flattened fields compatible with v0.4.3 workbench.
  for (const field of ["productType", "goldType", "style", "targetAudience", "usageScenario", "motifs", "craftRequirements", "mustKeep", "mustAvoid"]) {
    result[field] = structured[field];
  }
  result.weightOrBudget = unique([structured.weightRequirement, structured.budget])
    .filter((item) => item && item !== "未说明")
    .join("；");
  return result;
}

function expectedProductType(testCase) {
  const tableRow = (testCase.expectedFields ?? []).find((row) => row.字段 === "产品类型");
  const tableValue = text(tableRow?.内容 ?? tableRow?.正确结果);
  if (tableValue) return tableValue;
  const match = text(testCase.expectedSummary).match(/产品类型\s*[=：]\s*([^；;。\n]+)/);
  return match ? text(match[1]) : "";
}

function scoreEvaluationCase(testCase, parsed) {
  const checks = [];
  const add = (name, pass, detail) => checks.push({ name, pass: Boolean(pass), detail });
  const structured = parsed.structuredRequirement;
  const expectedProduct = expectedProductType(testCase);
  if (expectedProduct) {
    const expectedTokens = expectedProduct.split(/[\/、或]/).map(text).filter(Boolean);
    add("产品类型", expectedTokens.some((token) => structured.productType.includes(token) || token.includes(structured.productType)), {
      expected: expectedProduct,
      actual: structured.productType,
    });
  }

  for (const motif of ["莲花", "龙凤", "平安", "招财", "中国风", "国风", "古法", "玉石"]) {
    if (!testCase.customerText.includes(motif)) continue;
    const actual = `${structured.motifs.join("、")} ${structured.meanings.join("、")} ${structured.style} ${structured.goldType} ${structured.surfaceEffects.join("、")} ${structured.settingRequirements.join("、")}`;
    add(`核心语义:${motif}`, actual.includes(motif) || (motif === "中国风" && actual.includes("国风")), actual);
  }
  add("待确认问题", parsed.clarificationQuestions.length > 0, parsed.clarificationQuestions.length);
  if (/不要太重|偏轻|轻量|低克重/.test(testCase.customerText)) {
    add("不乱猜克重", !/\d/.test(structured.weightRequirement), structured.weightRequirement);
  }
  if (/保留|造型不要动|只改/.test(testCase.customerText)) {
    add("修改延续性", structured.taskType !== "new_design" && structured.mustKeep.length > 0, {
      taskType: structured.taskType,
      mustKeep: structured.mustKeep,
    });
  }
  const passed = checks.filter((item) => item.pass).length;
  return {
    caseId: testCase.id,
    title: testCase.title,
    score: checks.length ? Number((passed / checks.length * 100).toFixed(1)) : 100,
    checks,
  };
}

export class RequirementParserService {
  constructor({ externalProvider } = {}) {
    this.externalProvider = externalProvider ?? new OpenAiCompatibleRequirementProvider();
  }

  getStatus() {
    return {
      parserVersion: REQUIREMENT_PARSER_VERSION,
      contractVersion: REQUIREMENT_CONTRACT_VERSION,
      dataSourceVersion: REQUIREMENT_DATA_VERSION,
      defaultMode: "expert_dataset_local",
      externalProvider: this.externalProvider.status(),
      trainingData: getRequirementTrainingMetadata(),
    };
  }

  getSchema() {
    return {
      parser: this.getStatus(),
      catalog: getRequirementSchemaCatalog(),
    };
  }

  getEvaluationCases() {
    return clone(getRequirementEvaluationCases());
  }

  async parse(input = {}) {
    const local = parseGoldRequirement(input);
    local.externalProvider = { used: false, ...this.externalProvider.status() };
    const requestedMode = text(input.analysisMode || input.providerMode || process.env.AI_REQUIREMENT_PROVIDER || "local");
    if (!["openai-compatible", "hybrid"].includes(requestedMode)) return local;
    try {
      const external = await this.externalProvider.parse(input, local.structuredRequirement);
      return mergeExternal(local, external, input);
    } catch (error) {
      return {
        ...local,
        analysisMode: "expert_dataset_local_fallback",
        externalProvider: { used: false, ...this.externalProvider.status(), error: { code: error.code, message: error.message } },
        warnings: [...local.warnings, `外部解析不可用，已安全回退本地专家规则：${error.message}`],
      };
    }
  }

  async evaluate({ caseIds = [] } = {}) {
    const selected = this.getEvaluationCases().filter((item) => !caseIds.length || caseIds.includes(item.id));
    const results = [];
    for (const testCase of selected) {
      const parsed = await this.parse({ customerText: testCase.customerText, analysisMode: "local" });
      results.push(scoreEvaluationCase(testCase, parsed));
    }
    const averageScore = results.length
      ? Number((results.reduce((sum, item) => sum + item.score, 0) / results.length).toFixed(1))
      : 0;
    return {
      parserVersion: REQUIREMENT_PARSER_VERSION,
      dataSourceVersion: REQUIREMENT_DATA_VERSION,
      caseCount: results.length,
      averageScore,
      passedCaseCount: results.filter((item) => item.score >= 80).length,
      threshold: 80,
      results,
    };
  }
}
