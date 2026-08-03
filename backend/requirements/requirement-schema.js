export const REQUIREMENT_PARSER_VERSION = "gold-requirement-parser-v1.0.0";
export const REQUIREMENT_CONTRACT_VERSION = "1.1";
export const REQUIREMENT_DATA_VERSION = "黄金珠宝AI需求解析训练资料 V1.0";

export const REQUIREMENT_STATUSES = Object.freeze([
  "parsed",
  "needs_confirmation",
  "confirmed",
  "superseded",
]);

export const LEGACY_FIELDS = Object.freeze([
  "productType",
  "goldType",
  "style",
  "targetAudience",
  "usageScenario",
  "motifs",
  "weightOrBudget",
  "craftRequirements",
  "mustKeep",
  "mustAvoid",
]);

export const STRUCTURED_FIELD_LABELS = Object.freeze({
  taskType: "任务类型",
  productType: "产品类型",
  goldType: "黄金类型",
  targetAudience: "目标人群",
  usageScenario: "使用场景",
  wearingFrequency: "佩戴频率",
  style: "风格",
  motifs: "图案元素",
  meanings: "寓意要求",
  weightRequirement: "实际克重要求",
  visualWeight: "视觉克重",
  budget: "预算",
  dimensions: "尺寸参数",
  structureForms: "结构形式",
  craftRequirements: "工艺要求",
  surfaceEffects: "表面效果",
  settingRequirements: "镶嵌要求",
  comfortRequirements: "佩戴舒适性",
  safetyRisks: "安全风险",
  mustKeep: "必须保留",
  mustAvoid: "不希望出现",
  copyrightStatus: "版权状态",
});
