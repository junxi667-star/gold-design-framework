import { createId, list, text } from "../utils.js";
import {
  REQUIREMENT_DATA_VERSION,
  REQUIREMENT_PARSER_VERSION,
  STRUCTURED_FIELD_LABELS,
} from "./requirement-schema.js";

const PRODUCT_RULES = [
  ["金镶玉吊坠", "吊坠"], ["儿童平安锁", "平安锁/儿童吊坠"], ["平安锁", "平安锁/儿童吊坠"],
  ["儿童手镯", "儿童手镯"], ["宝宝手镯", "儿童手镯"], ["纪念日对戒", "对戒"], ["对戒", "对戒"],
  ["转运珠", "转运珠/串饰"], ["金条", "金条/礼品金"], ["耳钉", "耳钉"], ["耳坠", "耳坠"],
  ["耳环", "耳环"], ["手镯", "手镯"], ["手链", "手链"], ["项链", "项链"], ["吊坠", "吊坠"],
  ["戒指", "戒指"], ["金锁", "金锁/吊坠"], ["摆件", "摆件"],
];

const GOLD_TYPE_RULES = [
  ["3D硬金", "3D硬金"], ["3d硬金", "3D硬金"], ["5G黄金", "5G黄金"], ["5g黄金", "5G黄金"],
  ["硬足金", "硬足金"], ["18K金", "18K金"], ["18k金", "18K金"], ["22K金", "22K金"], ["22k金", "22K金"],
  ["足金", "足金"], ["K金", "K金"], ["k金", "K金"],
];

const MOTIFS = [
  "莲花", "祥云", "龙凤", "生肖龙", "生肖", "福字", "如意", "蝴蝶", "葫芦", "竹节", "几何",
  "爱心", "貔貅", "佛像", "花卉", "囍字", "窗棂", "元宝", "企业标识", "刻字", "龙", "凤",
];

const MEANINGS = ["平安", "招财", "福气", "长寿", "爱情", "事业", "学业", "健康", "好运", "转运", "福禄", "顺利"];

const STYLE_RULES = [
  { terms: ["年轻一点", "年轻", "适合年轻人"], values: ["年轻化", "现代"], interpretation: "线条简洁、传统感不过重、适合日常", doNotInfer: "不能推断为固定克重、固定尺寸或固定材质" },
  { terms: ["简约", "简单一点", "素一点", "极简"], values: ["简约"], interpretation: "减少装饰、保持清晰比例", doNotInfer: "不能推断为完全没有设计或结构过薄" },
  { terms: ["大气"], values: ["大气", "稳重"], interpretation: "视觉存在感、比例舒展", doNotInfer: "不能推断为大克重、实心或厚重" },
  { terms: ["高级", "高级感"], values: ["高级", "克制", "精致"], interpretation: "留白、比例协调、细节精致", doNotInfer: "不能推断为镶钻、高预算或贵重材质" },
  { terms: ["精致"], values: ["精致"], interpretation: "细节和比例精细", doNotInfer: "不能推断为小尺寸或低克重" },
  { terms: ["低调"], values: ["低调", "克制"], interpretation: "不过度张扬、适合日常", doNotInfer: "不能推断为极细、极小或没有设计" },
  { terms: ["贵气", "显贵", "富贵"], values: ["贵气", "质感"], interpretation: "礼品感、黄金质感和大方比例", doNotInfer: "不能推断为大克重、堆金或财富符号" },
  { terms: ["不俗", "不能俗", "不要太俗", "别太俗"], values: ["克制", "有设计感"], interpretation: "避免直白和元素堆砌", doNotInfer: "不能推断为只能极简或删除传统元素" },
  { terms: ["国潮", "中国风", "国风"], values: ["国风", "传统元素现代化"], interpretation: "文化符号现代化表达", doNotInfer: "不能把龙凤祥云全部堆叠" },
  { terms: ["古法感", "古法金那种感觉", "古法金的感觉", "古法一点"], values: ["古法金视觉质感", "温润"], interpretation: "哑光、温润、传统工艺气质", doNotInfer: "不能直接认定实际采用古法金工艺" },
  { terms: ["轻奢"], values: ["轻奢", "现代", "精致"], interpretation: "简洁中带精致点缀", doNotInfer: "不能推断为必须镶钻或高预算" },
  { terms: ["稳重"], values: ["稳重", "成熟"], interpretation: "端正、不过分跳脱", doNotInfer: "不能推断为老气或复杂" },
  { terms: ["温柔"], values: ["柔美", "圆润"], interpretation: "曲线柔和、表面细腻", doNotInfer: "不能推断为粉色或女性专属元素" },
  { terms: ["可爱"], values: ["可爱", "圆润", "亲和"], interpretation: "亲和、小巧、圆润", doNotInfer: "不能直接卡通化或幼稚化" },
  { terms: ["商务"], values: ["商务", "成熟", "克制"], interpretation: "低调、正式、有质感", doNotInfer: "不能推断为完全素面或无设计" },
  { terms: ["喜庆"], values: ["喜庆", "仪式感"], interpretation: "吉祥和节庆氛围", doNotInfer: "不能推断为龙凤囍字全部必须出现" },
  { terms: ["甜美"], values: ["甜美", "轻熟"], interpretation: "柔和、精致但不过度儿童化", doNotInfer: "不能直接卡通化" },
  { terms: ["力量感"], values: ["力量感", "沉稳"], interpretation: "线条稳、结构清晰", doNotInfer: "不能推断为越宽越重越好" },
  { terms: ["传统"], values: ["传统"], interpretation: "文化和经典设计语言", doNotInfer: "不能推断为复杂满雕" },
  { terms: ["古风"], values: ["古风"], interpretation: "传统气质的日常化表达", doNotInfer: "不能推断为复杂长流苏" },
];

const SURFACE_RULES = [
  ["哑光", "哑光"], ["磨砂", "磨砂"], ["拉丝", "拉丝"], ["亮面", "亮面"], ["光面", "光面"],
  ["镜面", "镜面"], ["做旧", "做旧"], ["温润", "温润"], ["古法金", "古法金质感"],
];

const CRAFT_RULES = [
  ["錾刻", "錾刻"], ["浮雕", "浮雕"], ["镂空", "镂空"], ["电铸", "电铸"], ["珐琅", "珐琅"],
  ["镶嵌", "镶嵌"], ["喷砂", "喷砂"], ["拉丝", "拉丝"], ["磨砂", "磨砂"], ["古法工艺", "古法工艺"],
];

const STRUCTURE_RULES = [
  ["开口", "开口/活口"], ["活口", "开口/活口"], ["闭口", "闭口"], ["固定圈", "固定圈"],
  ["空心", "空心"], ["半空心", "半空心"], ["实心", "实心"], ["镂空", "镂空"], ["可活动", "可活动"],
];

const SETTING_RULES = [
  ["不镶嵌", "不镶嵌"], ["不镶钻", "不镶嵌"], ["钻石", "钻石"], ["镶钻", "钻石"], ["翡翠", "翡翠"],
  ["玉石", "玉石"], ["金镶玉", "玉石"], ["珍珠", "珍珠"], ["彩宝", "彩宝"], ["珐琅", "珐琅"],
];

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function includes(raw, term) {
  return raw.toLowerCase().includes(term.toLowerCase());
}

function findMapped(raw, rules) {
  for (const [term, value] of rules) {
    if (includes(raw, term)) return { term, value };
  }
  return null;
}

function allMapped(raw, rules) {
  return unique(rules.filter(([term]) => includes(raw, term)).map(([, value]) => value));
}

function exactNumberConstraint(raw) {
  const range = raw.match(/(\d+(?:\.\d+)?)\s*(?:-|—|~|～|到|至)\s*(\d+(?:\.\d+)?)\s*(?:g|克)/i);
  if (range) return `${range[1]}-${range[2]}克`;
  const single = raw.match(/(\d+(?:\.\d+)?)\s*(?:g|克)(?:以内|以下|左右|上下)?/i);
  if (single) return single[0].replace(/g/i, "克");
  return "";
}

function budgetConstraint(raw) {
  const match = raw.match(/(?:预算\s*)?(\d+(?:\.\d+)?)\s*(万|千|元|块)?(?:以内|以下|左右|上下|前后)/);
  if (!match) return "";
  if (!match[2] && !/预算/.test(match[0]) && !raw.includes(`预算${match[1]}`)) return "";
  return match[0].replace(/^预算\s*/, "");
}

function makeEvidence(field, value, source, excerpt, confidence) {
  return { field, value, source, excerpt, confidence };
}

function getFormValue(form, key) {
  const value = form?.[key];
  return Array.isArray(value) ? unique(value.map(text)) : text(value);
}

function addListField(target, field, values, evidence, source, excerpt, confidence = 0.9) {
  const normalized = unique(Array.isArray(values) ? values : list(values));
  if (!normalized.length) return;
  target[field] = unique([...(target[field] ?? []), ...normalized]);
  for (const value of normalized) evidence.push(makeEvidence(field, value, source, excerpt, confidence));
}

function addScalarField(target, field, value, evidence, source, excerpt, confidence = 0.9, { overwrite = false } = {}) {
  const normalized = text(value);
  if (!normalized || (target[field] && !overwrite)) return;
  target[field] = normalized;
  evidence.push(makeEvidence(field, normalized, source, excerpt, confidence));
}

function detectAudience(raw) {
  if (/女朋友|年轻女性|女生/.test(raw)) return ["年轻女性"];
  if (/妈妈|母亲/.test(raw)) return ["母亲", "中年女性（年龄待确认）"];
  if (/宝宝|婴幼儿/.test(raw)) return ["婴幼儿或儿童"];
  if (/小孩|孩子|儿童/.test(raw)) return ["儿童"];
  if (/老人|长辈/.test(raw)) return ["老人"];
  if (/男朋友/.test(raw)) return ["成年男性"];
  if (/男士|男性|男人/.test(raw)) return ["男性"];
  if (/闺蜜/.test(raw)) return ["朋友（女性，年龄待确认）"];
  if (/情侣|夫妻|一对/.test(raw)) return ["情侣/夫妻"];
  if (/商务客户|做生意的客户|客户是做生意/.test(raw)) return ["商务客户"];
  if (/新娘/.test(raw)) return ["新娘"];
  return [];
}

function detectScenarios(raw) {
  const result = [];
  if (/送|礼物|买给|给(?:妈妈|母亲|女朋友|男朋友|朋友|客户|小孩|孩子|宝宝|老人|长辈|闺蜜).*(?:做|买)/.test(raw)) result.push("送礼");
  if (/婚嫁|结婚|婚礼/.test(raw)) result.push("婚嫁");
  if (/生日/.test(raw)) result.push("生日");
  if (/情人节/.test(raw)) result.push("情人节");
  if (/纪念日/.test(raw)) result.push("纪念日");
  if (/上班|通勤/.test(raw)) result.push("通勤");
  if (/日常|平时|每天|天天/.test(raw)) result.push("日常佩戴");
  if (/商务|公司送礼|企业礼品/.test(raw)) result.push("商务送礼");
  if (/收藏/.test(raw)) result.push("收藏");
  if (/节庆|过年|春节/.test(raw)) result.push("节庆");
  return unique(result);
}

function detectMustKeep(raw, motifs, taskType) {
  const keep = [];
  if (/保留(?:这个|原有|原来的)?(?:造型|形状|外形)/.test(raw) || /造型不要动/.test(raw)) keep.push("原有造型和结构");
  if (/轮廓我喜欢|保留(?:这个|原有|原来的)?轮廓/.test(raw)) keep.push("原有轮廓");
  if (/只改(?:材质|表面|质感)/.test(raw)) keep.push("原造型、结构和比例");
  if (taskType === "modify_existing" && motifs.length && /保留/.test(raw)) keep.push(...motifs.map((item) => `${item}元素`));
  for (const motif of motifs) {
    if (raw.includes(motif)) keep.push(`${motif}元素`);
  }
  return unique(keep);
}

function detectMustAvoid(raw) {
  const avoid = [];
  if (/不要太花|别太花|不要这么花|太花哨|太复杂|花纹改简单|密密麻麻|不要太挤/.test(raw)) avoid.push("复杂密集纹样", "元素堆砌");
  if (/不要太重|别太重|不要这么重/.test(raw)) avoid.push("过于厚重的视觉和结构");
  if (/不要太夸张|别太夸张|不要太显眼|不喜欢太张扬/.test(raw)) avoid.push("夸张体积和过度装饰");
  if (/不要太传统|不要这么传统|不要做成奶奶款|不要太老气|别太老|别太新潮/.test(raw)) avoid.push("过度老气或传统元素堆砌");
  if (/不要太俗|不能俗|别太俗|不要看起来廉价|不要暴发户/.test(raw)) avoid.push("俗气直白符号和廉价感");
  if (/不要尖|不要尖尖|别刮|不刮手|不刮衣服/.test(raw)) avoid.push("尖锐边缘和勾挂结构");
  if (/不要卡通|不要幼稚/.test(raw)) avoid.push("卡通化和儿童化表达");
  if (/不要太凶|别太凶/.test(raw)) avoid.push("攻击性强、尖牙尖角过多");
  if (/不要完全一样/.test(raw)) avoid.push("两件完全复制");
  if (/不要盖住玉|不要抢了玉/.test(raw)) avoid.push("黄金遮挡或压过玉石主体");
  if (/造型不要动|只改材质|保留形状/.test(raw)) avoid.push("改变产品造型、结构或比例");
  return unique(avoid);
}

function detectComfortAndRisks(raw, structured) {
  const comfort = [];
  const risks = [];
  const audience = structured.targetAudience;
  const product = structured.productType;
  const daily = structured.usageScenarios.includes("日常佩戴") || structured.usageScenarios.includes("通勤");

  if (/不刮手|别刮手|圆润/.test(raw) || product === "戒指") comfort.push("边缘圆润，不刮手");
  if (/不挂头发|别老是挂头发/.test(raw) || (daily && product === "项链")) comfort.push("链节和扣位顺滑，减少勾挂");
  if (/不压耳|不要压耳朵|轻便/.test(raw) || ["耳钉", "耳环", "耳坠"].includes(product)) comfort.push("控制耳饰重量，避免压耳");
  if (/日常|平时|每天|上班/.test(raw)) comfort.push("适合日常佩戴，结构牢固且不易勾挂");

  if (/儿童|婴幼儿/.test(audience)) {
    comfort.push("佩戴接触面圆润");
    risks.push("尖角或毛刺", "小零件脱落", "易变形开口");
  }
  if (/尖锐|尖尖|尖角/.test(raw)) risks.push("尖锐边缘");
  if (/开口|活口/.test(raw) && product === "戒指") risks.push("开口处易变形，尖端需圆润");
  if (/不要太重|偏轻|低克重/.test(raw) && product === "手镯") risks.push("轻量化结构过薄可能易变形，需专家确认");
  if (/花卉|莲花/.test(structured.motifs.join("、"))) risks.push("立体花瓣、过细连接或悬空结构需专家确认");
  if (taskTypeIsReference(structured.taskType)) risks.push("原图来源和版权状态需确认");
  return { comfort: unique(comfort), risks: unique(risks) };
}

function taskTypeIsReference(taskType) {
  return taskType === "modify_existing" || taskType === "material_surface_edit";
}

function detectContradictions(structured) {
  const contradictions = [];
  const keepAvoid = structured.mustKeep.filter((item) => structured.mustAvoid.includes(item));
  if (keepAvoid.length) contradictions.push(`以下内容同时被标记为保留和避免：${keepAvoid.join("、")}`);
  if (structured.structureForms.includes("空心") && structured.structureForms.includes("实心")) contradictions.push("结构形式同时包含空心和实心");
  if (structured.surfaceEffects.includes("亮面") && structured.surfaceEffects.includes("哑光")) contradictions.push("表面效果同时包含亮面和哑光");
  if (structured.settingRequirements.includes("不镶嵌") && structured.settingRequirements.some((item) => item !== "不镶嵌")) contradictions.push("镶嵌要求同时包含不镶嵌和具体宝石");
  return contradictions;
}

function buildQuestions(structured, raw) {
  const questions = [];
  if (!structured.productType) questions.push("具体要设计哪一种产品，例如戒指、吊坠、手镯或项链？");
  if (!structured.goldType) questions.push("黄金类型或材质是什么，例如足金、硬足金、K金？");
  if (!structured.targetAudience) questions.push("主要佩戴者或收礼对象是谁，年龄和性别是什么？");
  if (!structured.usageScenario) questions.push("主要使用场景是什么，例如日常佩戴、送礼、婚嫁或商务？");
  if (!structured.budget || structured.budget === "未说明") questions.push("预算范围是多少？");
  if (!structured.weightRequirement || structured.weightRequirement.includes("未说明")) questions.push("目标克重或可接受的克重范围是多少？");

  if (["戒指", "对戒"].includes(structured.productType)) questions.push("戒圈号或双方戒圈号是多少？");
  if (["手镯", "儿童手镯", "手链"].includes(structured.productType)) questions.push("手围是多少？");
  if (structured.productType === "项链") questions.push("希望的链长和链型是什么？");
  if (["吊坠", "平安锁/儿童吊坠", "金锁/吊坠"].includes(structured.productType)) questions.push("吊坠尺寸是多少，是否需要配链或配绳？");
  if (["耳钉", "耳环", "耳坠"].includes(structured.productType)) questions.push("希望的尺寸和耳针/耳夹形式是什么？");
  if (/儿童|婴幼儿/.test(structured.targetAudience)) questions.push("佩戴者具体年龄是多少？");
  if (/古法金视觉质感/.test(structured.style) && !structured.goldType) questions.push("需要真实采用古法工艺，还是只需要古法金的视觉质感？");
  if (taskTypeIsReference(structured.taskType)) questions.push("参考图或旧款的来源、归属和版权状态是什么？");
  if (/金镶玉/.test(raw)) questions.push("玉石的尺寸、形状以及是否已有实物是什么？");
  return unique(questions);
}

function combineLegacyWeight(structured) {
  return unique([structured.weightRequirement, structured.budget]).filter((item) => item && item !== "未说明").join("；");
}

function calculateConfidence(structured, evidence, missingFields, ambiguousTerms, contradictions) {
  const fields = {};
  for (const item of evidence) fields[item.field] = Math.max(fields[item.field] ?? 0, item.confidence);
  const core = ["productType", "targetAudience", "usageScenario", "style", "motifs", "goldType"];
  const known = core.filter((field) => {
    const value = structured[field];
    return Array.isArray(value) ? value.length : Boolean(value);
  }).length;
  let overall = 0.35 + known * 0.09 - missingFields.length * 0.015 - ambiguousTerms.length * 0.01 - contradictions.length * 0.1;
  overall = Math.max(0.2, Math.min(0.98, overall));
  return { overall: Number(overall.toFixed(2)), fields };
}

function normalizeForm(form, structured, evidence) {
  const scalarFields = ["productType", "goldType", "targetAudience", "usageScenario", "wearingFrequency", "style", "weightRequirement", "visualWeight", "budget", "copyrightStatus", "versionRelation"];
  const listFields = ["motifs", "meanings", "dimensions", "structureForms", "craftRequirements", "surfaceEffects", "settingRequirements", "comfortRequirements", "safetyRisks", "mustKeep", "mustAvoid"];
  for (const field of scalarFields) {
    const value = getFormValue(form, field);
    if (value) addScalarField(structured, field, value, evidence, "form_field", field, 1, { overwrite: true });
  }
  for (const field of listFields) {
    const value = getFormValue(form, field);
    if (Array.isArray(value) ? value.length : value) {
      structured[field] = [];
      addListField(structured, field, value, evidence, "form_field", field, 1);
    }
  }
  const legacyWeight = getFormValue(form, "weightOrBudget");
  if (legacyWeight) {
    if (/预算|元|块|万|千/.test(legacyWeight)) addScalarField(structured, "budget", legacyWeight, evidence, "form_field", "weightOrBudget", 1, { overwrite: true });
    else addScalarField(structured, "weightRequirement", legacyWeight, evidence, "form_field", "weightOrBudget", 1, { overwrite: true });
  }
}

export function parseGoldRequirement(input = {}) {
  const raw = text(input.customerText);
  const form = input.formFields ?? {};
  const hasForm = Object.values(form).some((value) => Array.isArray(value) ? value.length : text(value));
  if (!raw && !hasForm) {
    const error = new Error("客户原话或明确字段至少填写一项");
    error.code = "VALIDATION_FAILED";
    error.httpStatus = 400;
    error.details = { field: "customerText" };
    throw error;
  }
  if (raw.length > 4000) {
    const error = new Error("客户原话不能超过 4000 个字符");
    error.code = "VALIDATION_FAILED";
    error.httpStatus = 400;
    error.details = { field: "customerText", maxLength: 4000 };
    throw error;
  }

  const evidence = [];
  const ambiguousTerms = [];
  const doNotInfer = [];
  const interpretedFields = [];
  const explicitFields = [];
  const structured = {
    taskType: /旧|原图|参考图|造型不要动|保留.*(?:轮廓|造型|形状)|只改(?:材质|表面|质感)/.test(raw)
      ? (/只改(?:材质|表面|质感)|造型不要动.*古法/.test(raw) ? "material_surface_edit" : "modify_existing")
      : "new_design",
    productType: "",
    goldType: "",
    targetAudience: "",
    targetUsers: [],
    usageScenario: "",
    usageScenarios: [],
    wearingFrequency: "",
    style: "",
    styleKeywords: [],
    motifs: [],
    meanings: [],
    weightRequirement: "未说明",
    visualWeight: "未说明",
    budget: "未说明",
    dimensions: [],
    structureForms: [],
    craftRequirements: [],
    surfaceEffects: [],
    settingRequirements: [],
    productionFeasibility: "待专家确认",
    comfortRequirements: [],
    safetyRisks: [],
    mustKeep: [],
    mustAvoid: [],
    referenceRequirement: taskTypeIsReference(/只改(?:材质|表面|质感)|造型不要动.*古法/.test(raw) ? "material_surface_edit" : (/旧|原图|参考图|造型不要动|保留.*(?:轮廓|造型|形状)/.test(raw) ? "modify_existing" : "new_design")) ? "需要参考图或旧款" : "未说明",
    copyrightStatus: "未说明",
    versionRelation: "新生成",
    namingCompliance: "客户原话与规范命名需分开保存",
    hardnessCraftFit: "待专家确认",
    loadBearingPoints: [],
    contactSurfaces: [],
    processingPreferences: [],
    salesAttribute: "未说明",
  };
  if (structured.taskType === "modify_existing") structured.versionRelation = "基于旧图修改";
  if (structured.taskType === "material_surface_edit") structured.versionRelation = "保留造型，仅修改材质/表面效果";

  const product = findMapped(raw, PRODUCT_RULES);
  if (product) {
    addScalarField(structured, "productType", product.value, evidence, "customer_text", product.term, 0.98);
    explicitFields.push("productType");
  }

  const ancientVisualOnly = /古法感|古法金那种(?:感觉|.*质感)|古法金的感觉|换成古法金.*(?:感觉|质感)|古法一点/.test(raw);
  const gold = findMapped(raw, GOLD_TYPE_RULES);
  if (gold) {
    addScalarField(structured, "goldType", gold.value, evidence, "customer_text", gold.term, 0.98);
    explicitFields.push("goldType");
  } else if (/古法金/.test(raw) && !ancientVisualOnly) {
    addScalarField(structured, "goldType", "古法金（工艺口径待确认）", evidence, "customer_text", "古法金", 0.82);
    explicitFields.push("goldType");
    doNotInfer.push("“古法金”需要确认是实际工艺还是仅视觉风格");
  }

  const audiences = detectAudience(raw);
  if (audiences.length) {
    structured.targetUsers = audiences;
    structured.targetAudience = audiences.join("、");
    addScalarField(structured, "targetAudience", structured.targetAudience, evidence, "domain_interpretation", audiences[0], 0.86, { overwrite: true });
    interpretedFields.push("targetAudience");
  }

  const scenarios = detectScenarios(raw);
  if (scenarios.length) {
    structured.usageScenarios = scenarios;
    structured.usageScenario = scenarios.join("、");
    addScalarField(structured, "usageScenario", structured.usageScenario, evidence, "domain_interpretation", scenarios[0], 0.88, { overwrite: true });
    interpretedFields.push("usageScenario");
  }
  if (/每天|日常|平时|上班|通勤/.test(raw)) structured.wearingFrequency = "日常";
  else if (/重要场合|婚礼|婚嫁/.test(raw)) structured.wearingFrequency = "重要场合";
  else if (/收藏/.test(raw)) structured.wearingFrequency = "收藏展示";

  for (const rule of STYLE_RULES) {
    const matched = rule.terms.find((term) => includes(raw, term));
    if (!matched) continue;
    structured.styleKeywords.push(...rule.values);
    ambiguousTerms.push({ term: matched, interpretation: rule.interpretation, doNotInfer: rule.doNotInfer });
    doNotInfer.push(`${matched}：${rule.doNotInfer}`);
    interpretedFields.push("style");
    for (const value of rule.values) evidence.push(makeEvidence("style", value, "fuzzy_term_interpretation", matched, 0.72));
  }
  structured.styleKeywords = unique(structured.styleKeywords);
  structured.style = structured.styleKeywords.join("、");

  structured.motifs = unique(MOTIFS.filter((item) => includes(raw, item)).map((item) => item === "生肖龙" ? "生肖龙" : item));
  if (structured.motifs.includes("龙凤")) structured.motifs = unique([...structured.motifs.filter((item) => !["龙", "凤"].includes(item)), "龙凤"]);
  if (structured.motifs.includes("生肖龙")) structured.motifs = unique([...structured.motifs.filter((item) => !["生肖", "龙"].includes(item)), "生肖龙"]);
  structured.meanings = unique(MEANINGS.filter((item) => includes(raw, item)));
  if (/福气感/.test(raw)) structured.meanings.push("福气");
  if (/有好寓意/.test(raw) && !structured.meanings.length) structured.meanings.push("吉祥寓意（具体待确认）");
  for (const motif of structured.motifs) evidence.push(makeEvidence("motifs", motif, "customer_text", motif, 0.98));

  const exactWeight = exactNumberConstraint(raw);
  if (exactWeight) {
    structured.weightRequirement = exactWeight;
    evidence.push(makeEvidence("weightRequirement", exactWeight, "customer_text", exactWeight, 0.99));
    explicitFields.push("weightRequirement");
  } else if (/不要太重|别太重|轻一点|偏轻|低克重/.test(raw)) {
    structured.weightRequirement = "偏轻，具体克重未说明";
    structured.visualWeight = "轻量";
    ambiguousTerms.push({ term: "不要太重", interpretation: "偏轻或降低视觉厚重，具体原因和克重待确认", doNotInfer: "不能生成具体克重数字" });
    doNotInfer.push("不要把“不要太重”推断为具体克重数字");
    interpretedFields.push("weightRequirement", "visualWeight");
  }
  if (/看起来不能太小气|不能太小气|显大不重|有存在感/.test(raw)) structured.visualWeight = "有存在感，但实际克重需控制";
  if (/厚重|有分量感/.test(raw) && structured.visualWeight === "未说明") structured.visualWeight = "厚重或有分量感（实际克重未说明）";

  const budget = budgetConstraint(raw);
  if (budget) {
    structured.budget = budget;
    evidence.push(makeEvidence("budget", budget, "customer_text", budget, 0.99));
    explicitFields.push("budget");
  } else if (/预算有限/.test(raw)) {
    structured.budget = "有限，具体金额未说明";
    interpretedFields.push("budget");
    doNotInfer.push("预算有限不能转成具体金额");
  }

  structured.structureForms = allMapped(raw, STRUCTURE_RULES);
  structured.craftRequirements = allMapped(raw, CRAFT_RULES);
  structured.surfaceEffects = allMapped(raw, SURFACE_RULES);
  structured.settingRequirements = allMapped(raw, SETTING_RULES);
  if (ancientVisualOnly) {
    structured.surfaceEffects = unique([...structured.surfaceEffects, "哑光", "温润", "古法金视觉质感"]);
    structured.goldType = "";
    structured.styleKeywords = unique([...structured.styleKeywords, "古法金视觉质感", "温润"]);
    structured.style = structured.styleKeywords.join("、");
    doNotInfer.push("古法金视觉质感不能直接认定实际采用古法工艺");
  }

  if (/不刮衣服|不勾头发|不挂头发/.test(raw)) structured.comfortRequirements.push("减少勾挂风险");
  if (/安全第一|不要尖|不要尖尖|圆润/.test(raw)) structured.comfortRequirements.push("边缘圆润，避免尖锐");
  if (/不压耳/.test(raw)) structured.comfortRequirements.push("轻便，不压耳");
  if (/方便调大小/.test(raw)) structured.structureForms.push("开口/活口");
  if (/金镶玉/.test(raw)) structured.settingRequirements = unique([...structured.settingRequirements, "玉石"]);

  structured.mustKeep = detectMustKeep(raw, structured.motifs, structured.taskType);
  structured.mustAvoid = detectMustAvoid(raw);

  normalizeForm(form, structured, evidence);
  structured.targetUsers = structured.targetAudience ? unique(structured.targetAudience.split(/[、,，]/).map(text)) : [];
  structured.usageScenarios = structured.usageScenario ? unique(structured.usageScenario.split(/[、,，]/).map(text)) : [];
  structured.styleKeywords = structured.style ? unique(structured.style.split(/[、,，]/).map(text)) : [];

  const { comfort, risks } = detectComfortAndRisks(raw, structured);
  structured.comfortRequirements = unique([...structured.comfortRequirements, ...comfort]);
  structured.safetyRisks = unique([...structured.safetyRisks, ...risks]);

  if (["吊坠", "平安锁/儿童吊坠", "金锁/吊坠"].includes(structured.productType)) structured.loadBearingPoints.push("吊坠扣头和连接环");
  if (["戒指", "对戒"].includes(structured.productType)) {
    structured.loadBearingPoints.push("戒臂和开口端（如有）");
    structured.contactSurfaces.push("戒指内圈");
  }
  if (["手镯", "儿童手镯"].includes(structured.productType)) {
    structured.loadBearingPoints.push("手镯开口或连接位置");
    structured.contactSurfaces.push("手镯内壁");
  }
  if (["耳钉", "耳环", "耳坠"].includes(structured.productType)) {
    structured.loadBearingPoints.push("耳针、耳托和连接件");
    structured.contactSurfaces.push("耳针和耳托接触面");
  }
  if (structured.productType === "项链") {
    structured.loadBearingPoints.push("链节、连接环和扣位");
    structured.contactSurfaces.push("链节和扣位接触面");
  }

  structured.mustKeep = unique(structured.mustKeep);
  structured.mustAvoid = unique(structured.mustAvoid);
  structured.structureForms = unique(structured.structureForms);
  structured.craftRequirements = unique(structured.craftRequirements);
  structured.surfaceEffects = unique(structured.surfaceEffects);
  structured.settingRequirements = unique(structured.settingRequirements);
  structured.comfortRequirements = unique(structured.comfortRequirements);
  structured.safetyRisks = unique(structured.safetyRisks);
  structured.loadBearingPoints = unique(structured.loadBearingPoints);
  structured.contactSurfaces = unique(structured.contactSurfaces);

  const contradictions = detectContradictions(structured);
  const clarificationQuestions = buildQuestions(structured, raw);
  const missingFields = unique(clarificationQuestions.map((question) => {
    if (question.includes("哪一种产品")) return "产品类型";
    if (question.includes("黄金类型")) return "黄金类型";
    if (question.includes("佩戴者") || question.includes("收礼对象")) return "目标人群";
    if (question.includes("使用场景")) return "使用场景";
    if (question.includes("预算")) return "预算";
    if (question.includes("克重")) return "克重要求";
    if (/戒圈号|手围|链长|尺寸|年龄/.test(question)) return "尺寸或佩戴参数";
    if (question.includes("版权")) return "参考图版权状态";
    if (question.includes("古法工艺")) return "真实工艺要求";
    return "其他待确认信息";
  }));

  const confidence = calculateConfidence(structured, evidence, missingFields, ambiguousTerms, contradictions);
  const understood = unique([
    structured.productType,
    structured.targetAudience,
    structured.usageScenario,
    structured.style,
    structured.motifs.join("、"),
    structured.weightRequirement !== "未说明" ? structured.weightRequirement : "",
  ]);
  const understandingSummary = understood.length
    ? `已从客户原话和明确字段整理：${understood.join("；")}。模糊词未被转换成未经确认的硬参数，仍需人工确认 ${missingFields.join("、") || "无关键缺失项"}。`
    : "当前信息不足，未形成可靠结构化需求；请补充产品类型、对象、场景和基本限制。";

  const structuredRequirement = {
    ...structured,
    weightOrBudget: combineLegacyWeight(structured),
  };

  return {
    requirementRevisionId: createId("requirement"),
    status: "needs_confirmation",
    analysisMode: "expert_dataset_local",
    parserVersion: REQUIREMENT_PARSER_VERSION,
    dataSourceVersion: REQUIREMENT_DATA_VERSION,
    structuredRequirement,
    // Legacy flattened fields keep the current v0.4.3 workbench compatible.
    productType: structured.productType,
    goldType: structured.goldType,
    style: structured.style,
    targetAudience: structured.targetAudience,
    usageScenario: structured.usageScenario,
    motifs: structured.motifs,
    weightOrBudget: combineLegacyWeight(structured),
    craftRequirements: structured.craftRequirements,
    mustKeep: structured.mustKeep,
    mustAvoid: structured.mustAvoid,
    missingFields,
    clarificationQuestions,
    explicitFields: unique(explicitFields),
    interpretedFields: unique(interpretedFields),
    ambiguousTerms,
    contradictions,
    manufacturingRisks: structured.safetyRisks,
    doNotInfer: unique(doNotInfer),
    evidence,
    confidence,
    referenceImages: (input.referenceImages ?? []).map((image) => ({
      ...image,
      interpretationStatus: "stored_not_interpreted",
      copyrightStatus: text(image.copyrightStatus) || "unconfirmed",
    })),
    understandingSummary,
    warnings: [
      "本地专家资料解析结果必须由内部人员确认后才能进入生图任务。",
      "参考图片尚未进行图像识别；来源不明或未授权图片不能进入训练集。",
    ],
  };
}
