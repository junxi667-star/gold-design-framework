import { apiError, createId, list, text } from "./utils.js";

const FIELD_LABELS = Object.freeze({
  productType: "产品类型",
  goldType: "黄金类型",
  style: "风格",
  targetAudience: "目标人群",
  usageScenario: "使用场景",
  motifs: "图案元素",
  weightOrBudget: "克重或预算",
  craftRequirements: "工艺要求",
});

function firstMatch(source, choices) {
  return choices.find((choice) => source.includes(choice)) ?? "";
}

function inferAudience(source) {
  if (/儿童|孩子|小孩|宝宝/.test(source)) return "儿童";
  if (/妈妈|母亲/.test(source)) return "中年女性";
  if (/女朋友|年轻女性|女生/.test(source)) return "年轻女性";
  if (/男士|男性|父亲|爸爸/.test(source)) return "成年男性";
  return "";
}

function inferScenario(source) {
  if (/婚嫁|结婚|婚礼/.test(source)) return "婚嫁";
  if (/送礼|礼物|生日|纪念|女朋友|妈妈|母亲/.test(source)) return "送礼";
  if (/商务/.test(source)) return "商务";
  if (/日常|通勤/.test(source)) return "日常佩戴";
  return "";
}

function inferMotifs(source) {
  return ["莲花", "龙凤", "生肖龙", "福字", "祥云", "如意", "蝴蝶", "葫芦", "竹节", "爱心", "貔貅", "花卉"]
    .filter((motif) => source.includes(motif));
}

function inferStyle(source) {
  const values = [];
  if (/简约|简单/.test(source)) values.push("简约");
  if (/年轻|现代/.test(source)) values.push("年轻现代");
  if (/国风|中国风|传统/.test(source)) values.push("现代国风");
  if (/轻奢|高级|精致/.test(source)) values.push("轻奢精致");
  if (/古法|哑光|温润/.test(source)) values.push("古法金视觉质感");
  if (/大气/.test(source)) values.push("大气");
  return values.join("、");
}

function inferMustAvoid(source) {
  const values = [];
  if (/不要太花|别太花|简单一点/.test(source)) values.push("复杂密集纹样");
  if (/不要尖|尖尖|安全第一/.test(source)) values.push("尖锐结构");
  if (/不要太重|偏轻/.test(source)) values.push("视觉厚重");
  if (/不要老气|别老气/.test(source)) values.push("老气表达");
  return values;
}

export class LocalRequirementParser {
  getStatus() {
    return {
      parserVersion: "local-rule-compat-v1",
      analysisMode: "local_rule_demo",
      externalProvider: { configured: false },
      imageRecognition: false,
      notice: "仅整理客户明确文本和表单字段；照片只保存引用，不进行识别，也不会训练模型。",
    };
  }

  getSchema() {
    return {
      version: "1.2",
      fields: Object.entries(FIELD_LABELS).map(([name, label]) => ({ name, label })),
      editable: true,
    };
  }

  getEvaluationCases() {
    return [];
  }

  evaluate() {
    return {
      caseCount: 0,
      averageScore: null,
      results: [],
      notice: "当前兼容版未内置可宣称为专业能力的评测集。",
    };
  }

  parse(input = {}) {
    const customerText = text(input.customerText);
    const form = input.formFields && typeof input.formFields === "object" ? input.formFields : {};
    const referenceImages = Array.isArray(input.referenceImages) ? input.referenceImages : [];
    if (!customerText && !Object.values(form).some((value) => text(value) || list(value).length) && !referenceImages.length) {
      throw apiError("客户原话、表单字段或参考图片至少提供一项", {
        code: "VALIDATION_FAILED",
        httpStatus: 400,
      });
    }

    const productType = text(form.productType)
      || firstMatch(customerText, ["平安锁", "儿童吊坠", "戒指", "对戒", "吊坠", "手镯", "手链", "项链", "耳钉", "耳环", "耳坠", "金条", "摆件"]);
    const structuredRequirement = {
      productType,
      goldType: text(form.goldType) || firstMatch(customerText, ["足金", "古法金", "硬足金", "硬金", "3D硬金", "5G黄金", "18K金", "K金"]),
      style: text(form.style) || inferStyle(customerText),
      targetAudience: text(form.targetAudience) || inferAudience(customerText),
      usageScenario: text(form.usageScenario) || inferScenario(customerText),
      motifs: list(form.motifs).length ? list(form.motifs) : inferMotifs(customerText),
      weightOrBudget: text(form.weightOrBudget),
      craftRequirements: list(form.craftRequirements),
      mustKeep: list(form.mustKeep),
      mustAvoid: [...new Set([...list(form.mustAvoid), ...inferMustAvoid(customerText)])],
    };

    if (/旧|原有|轮廓/.test(customerText) && /改|调整|修改/.test(customerText)) {
      structuredRequirement.taskType = "modify_existing";
      structuredRequirement.mustKeep = [...new Set([...structuredRequirement.mustKeep, "原有轮廓"])];
    } else {
      structuredRequirement.taskType = "new_design";
    }

    const missingFields = Object.entries(FIELD_LABELS)
      .filter(([key]) => Array.isArray(structuredRequirement[key])
        ? structuredRequirement[key].length === 0
        : !structuredRequirement[key])
      .map(([, label]) => label);
    const explicit = [
      structuredRequirement.productType,
      structuredRequirement.goldType,
      structuredRequirement.style,
      structuredRequirement.targetAudience,
      structuredRequirement.usageScenario,
    ].filter(Boolean);

    return {
      requirementRevisionId: createId("requirement"),
      analysisMode: "local_rule_demo",
      parserVersion: "local-rule-compat-v1",
      ...structuredRequirement,
      structuredRequirement,
      missingFields,
      clarificationQuestions: missingFields.map((label) => `请确认${label}`),
      referenceImages: referenceImages.map((image) => ({
        ...image,
        interpretationStatus: "stored_not_interpreted",
      })),
      understandingSummary: explicit.length
        ? `本地规则仅整理客户明确表达：${explicit.join("、")}。结果需人工修改确认；参考图片尚未识别。`
        : "本地规则没有获得足够明确的文字字段，请人工补充确认；参考图片尚未识别。",
      doNotInfer: ["未明确的具体克重、预算、材质和工艺可行性不得推断"],
      warnings: referenceImages.length ? ["参考图片仅登记，尚未执行识别或版权判断"] : [],
    };
  }
}
