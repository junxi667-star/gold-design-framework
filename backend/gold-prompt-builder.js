import { list, text } from "./utils.js";
import { resolveShape, resolveStyle, selectProductTemplate } from "./gold-product-template-router.js";

const MOTIF_MAP = new Map([
  ["莲花", "a clearly recognizable restrained lotus motif"],
  ["龙凤", "balanced refined dragon and phoenix motifs"],
  ["生肖龙", "a gentle elegant Chinese zodiac dragon motif"],
  ["龙", "a refined dragon motif"],
  ["福字", "a modernized Chinese Fu character motif"],
  ["祥云", "restrained auspicious cloud motifs"],
  ["如意", "a refined ruyi motif"],
  ["蝴蝶", "a sophisticated butterfly motif"],
  ["葫芦", "a modernized gourd motif"],
  ["竹节", "a clean bamboo-joint motif"],
  ["爱心", "an abstract restrained heart motif"],
  ["貔貅", "a calm wearable pixiu motif"],
  ["花卉", "a simplified floral motif"],
]);

const NEGATIVE_MAP = [
  [/复杂|太花|花哨|密集/, "dense ornament, excessive pattern density"],
  [/厚重|太重/, "visually bulky construction"],
  [/尖|刮|勾挂|毛刺/, "sharp edges, barbs, snagging details"],
  [/夸张|张扬/, "oversized theatrical form"],
  [/俗|廉价/, "cheap-looking ornament, gaudy wealth symbols"],
  [/老气/, "dated styling"],
  [/卡通|幼稚/, "cartoonish childish styling"],
  [/凶/, "aggressive expression, sharp fangs"],
];

function unique(values) {
  return [...new Set(values.map(text).filter(Boolean))];
}

function mapMotifs(requirement) {
  return unique(list(requirement.motifs).map((motif) => {
    for (const [key, value] of MOTIF_MAP) {
      if (motif.includes(key)) return value;
    }
    return motif ? `a restrained ${motif} inspired motif` : "";
  }));
}

function mapGoldType(requirement) {
  const value = text(requirement.goldType);
  if (/古法/.test(value)) return "warm matte ancient-gold finish";
  if (/18K|22K|K金/.test(value)) return "refined gold alloy material";
  if (/硬足金|硬金|3D硬金|5G/.test(value)) return "crisp hard-gold jewelry construction";
  return "realistic premium yellow gold material";
}

function mapAudience(requirement) {
  const audience = text(requirement.targetAudience) || list(requirement.targetUsers).join("、");
  if (!audience) return "";
  if (/年轻女性|女朋友|女生/.test(audience)) return "designed for a young woman";
  if (/母亲|中年女性|妈妈|贵妇/.test(audience)) return "designed for a mature woman";
  if (/儿童|婴幼儿|宝宝|小孩/.test(audience)) return "designed for a child with rounded safe details";
  if (/男/.test(audience)) return "designed for an adult man";
  return "";
}

function mapScenario(requirement) {
  const scenario = text(requirement.usageScenario) || list(requirement.usageScenarios).join("、");
  if (!scenario) return "";
  if (/日常|通勤/.test(scenario)) return "suitable for comfortable daily wear";
  if (/婚嫁|结婚/.test(scenario)) return "appropriate for an elegant wedding occasion";
  if (/商务/.test(scenario)) return "appropriate as a restrained business gift";
  if (/礼|生日|情人节|纪念/.test(scenario)) return "appropriate as a premium meaningful gift";
  return "";
}

function mappedNegatives(requirement) {
  const constraints = [
    ...list(requirement.mustAvoid),
    ...list(requirement.safetyRisks),
    ...list(requirement.comfortRequirements),
  ].join(" ");
  return NEGATIVE_MAP.filter(([pattern]) => pattern.test(constraints)).map(([, value]) => value);
}

export function buildGoldImagePrompts(requirement, { promptTemplate, operation = "generate", payload = {} } = {}) {
  const { productType, template } = selectProductTemplate(requirement);
  const shape = resolveShape(requirement, template);
  const styleFragments = resolveStyle(requirement);
  const motifs = mapMotifs(requirement);
  const commonPositive = unique([
    shape.fragment,
    mapGoldType(requirement),
    ...styleFragments,
    ...motifs,
    mapAudience(requirement),
    mapScenario(requirement),
    "physically plausible jewelry construction",
    "realistic load-bearing connections and wearable proportions",
  ]);
  const localPositive = unique([
    ...list(requirement.structureForms).map((item) => `structure requirement: ${item}`),
    ...list(requirement.craftRequirements).map((item) => `craft intention: ${item}`),
    ...list(requirement.surfaceEffects).map((item) => `surface effect: ${item}`),
    ...list(requirement.mustKeep).map((item) => `must preserve: ${item}`),
  ]);
  if (text(requirement.visualWeight)) localPositive.push(`visual weight: ${text(requirement.visualWeight)}`);
  if (operation === "refine" && text(payload.customerChangeRequest || payload.changeRequest)) {
    localPositive.push(`requested revision: ${text(payload.customerChangeRequest || payload.changeRequest)}`);
  }
  const negativeExtras = unique([
    ...mappedNegatives(requirement),
    "extra products",
    "duplicate jewelry",
    "floating parts",
    "impossible geometry",
    "text",
    "watermark",
    "logo",
  ]);
  const negativeLocalExtras = unique([
    ...list(requirement.mustAvoid),
    ...list(requirement.safetyRisks),
    "broken load-bearing connection",
    "sharp dangerous edges",
    "malformed jewelry",
  ]);

  const positiveGlobal = commonPositive.join(", ");
  const positiveLocal = localPositive.join(", ");
  const negativeGlobal = negativeExtras.join(", ");
  const negativeLocal = negativeLocalExtras.join(", ");
  const refinerPositive = unique([
    mapGoldType(requirement),
    ...styleFragments,
    ...motifs,
    shape.fragment,
    "precise fine jewelry craftsmanship",
    "natural gold reflections",
    "clean luxury catalog photography",
  ]).join(", ");
  const refinerNegative = unique([
    ...negativeExtras,
    ...negativeLocalExtras,
    "melted gold",
    "rough surface",
    "blurry",
    "low quality",
  ]).join(", ");

  return {
    productType,
    productName: template.name,
    mode: template.mode,
    templateVersion: "gold-product-templates-v2",
    workflow: template.workflow,
    referenceImage: template.referenceImage,
    shape: shape.name,
    style: text(requirement.style) || "未指定",
    positiveGlobal,
    positiveLocal,
    negativeGlobal,
    negativeLocal,
    refinerPositive,
    refinerNegative,
    positivePrompt: unique([positiveGlobal, positiveLocal]).join(", "),
    negativePrompt: unique([negativeGlobal, negativeLocal]).join(", "),
    template,
    promptTemplateId: promptTemplate?.id || null,
  };
}

function apiConstraintForProduct(productType) {
  if (productType === "pendant") {
    return "只展示单个吊坠主体，可带吊环，不要整条项链，不要人物佩戴图。";
  }
  if (productType === "necklace") {
    return "必须是一条完整的单圈黄金项链，只保留一条链和一个锁扣，链条闭合完整，不要叠戴，不要多条链。";
  }
  if (productType === "ring") {
    return "必须是单枚闭合戒指，戒圈完整，比例清晰，不要生成手镯、项链或耳饰。";
  }
  if (productType === "bangle") {
    return "必须是单个成人尺寸的完整闭口手镯，明显大于戒指，不要开口，不要变成戒指。";
  }
  return "只展示一个首饰主体。";
}

export function buildGoldApiImagePrompt(requirement, { promptTemplate, operation = "generate", payload = {} } = {}) {
  const { productType, template } = selectProductTemplate(requirement);
  const shape = resolveShape(requirement, template);
  const styleFragments = resolveStyle(requirement);
  const motifs = mapMotifs(requirement);
  const positivePrompt = unique([
    shape.fragment,
    mapGoldType(requirement),
    ...styleFragments,
    ...motifs,
    mapAudience(requirement),
    mapScenario(requirement),
    ...list(requirement.structureForms).map((item) => `structure requirement: ${item}`),
    ...list(requirement.craftRequirements).map((item) => `craft intention: ${item}`),
    ...list(requirement.surfaceEffects).map((item) => `surface effect: ${item}`),
    "physically plausible jewelry construction",
    "realistic premium gold reflections",
    "single jewelry product centered in frame",
    "clean light gray or white background",
    "luxury catalog product photography",
  ]).join(", ");

  const humanStyle = text(requirement.style) || (styleFragments.length ? styleFragments.join("，") : "简洁精致");
  const motifsText = list(requirement.motifs).join("、");
  const targetAudience = text(requirement.targetAudience) || list(requirement.targetUsers).join("、");
  const usageScenario = text(requirement.usageScenario) || list(requirement.usageScenarios).join("、");
  const weightRequirement = text(requirement.weightRequirement) || text(requirement.visualWeight) || text(requirement.weightOrBudget);
  const goldType = text(requirement.goldType) || "黄金 / 足金质感";
  const refineRequest = operation === "refine" ? text(payload.customerChangeRequest || payload.changeRequest) : "";

  const apiPrompt = [
    `请生成一张高级珠宝产品摄影风格的${template.name}概念效果图。`,
    `主体：单个${template.name}。`,
    `款式形状：${shape.name}。`,
    humanStyle ? `风格：${humanStyle}。` : "",
    motifsText ? `设计元素：${motifsText}。` : "",
    targetAudience ? `适合人群：${targetAudience}。` : "",
    usageScenario ? `使用场景：${usageScenario}。` : "",
    weightRequirement ? `重量或视觉倾向：${weightRequirement}。` : "",
    `材质：${goldType}，需要真实黄金金属光泽与高级珠宝质感。`,
    apiConstraintForProduct(productType),
    refineRequest ? `修改要求：${refineRequest}。` : "",
    "构图要求：产品居中，背景干净，白底或浅灰底，边缘清晰，结构合理，可佩戴。",
    "禁止内容：不要人物，不要手模，不要文字，不要 logo，不要水印，不要多个产品，不要漂浮断裂结构。",
  ].filter(Boolean).join(" ");

  return {
    productType,
    productName: template.name,
    templateVersion: "gold-product-templates-v2",
    shape: shape.name,
    style: text(requirement.style) || "未指定",
    positivePrompt,
    apiPrompt,
    promptTemplateId: promptTemplate?.id || null,
  };
}
