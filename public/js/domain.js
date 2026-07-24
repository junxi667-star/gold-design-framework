const KNOWLEDGE_TYPES = new Set(["text", "photo"]);
const REVIEW_DECISIONS = new Set(["approved", "rejected", "needs_revision"]);

function id(prefix) {
  const value = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${value}`;
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function requireText(value, label) {
  const normalized = text(value);
  if (!normalized) {
    throw new Error(`${label}不能为空`);
  }
  return normalized;
}

function iso(now) {
  return now instanceof Date ? now.toISOString() : new Date(now ?? Date.now()).toISOString();
}

export const refinementOptions = [
  { id: "simplify", label: "减少装饰，强化留白", group: "视觉密度" },
  { id: "enrich", label: "增加层次与细节", group: "视觉密度" },
  { id: "softer", label: "轮廓更圆润柔和", group: "轮廓表达" },
  { id: "sharper", label: "轮廓更利落现代", group: "轮廓表达" },
  { id: "traditional", label: "强化传统文化表达", group: "风格倾向" },
  { id: "contemporary", label: "强化现代年轻表达", group: "风格倾向" },
];

export function createProject(input, knowledgeRefs = [], now = new Date()) {
  const createdAt = iso(now);
  return {
    id: id("project"),
    brief: {
      theme: requireText(input.theme, "设计主题"),
      category: text(input.category),
      audience: text(input.audience),
      scene: text(input.scene),
      style: text(input.style),
      notes: text(input.notes),
    },
    status: "choosing_direction",
    knowledgeRefs: [...new Set(knowledgeRefs)],
    directions: [],
    selectedDirectionId: null,
    versions: [],
    currentVersionId: null,
    confirmedVersionId: null,
    createdAt,
    updatedAt: createdAt,
  };
}

export function prepareMockDirections(project, knowledgeItems = [], now = new Date()) {
  if (project.directions.length === 3) {
    return project;
  }

  const approvedIds = new Set(
    knowledgeItems.filter((item) => item.reviewStatus === "approved").map((item) => item.id),
  );
  const knowledgeRefs = project.knowledgeRefs.filter((itemId) => approvedIds.has(itemId));
  const subject = project.brief.category || "黄金饰品";
  const theme = project.brief.theme;
  const createdAt = iso(now);

  const templates = [
    {
      title: "方向 A｜轻雅留白",
      concept: `围绕“${theme}”保留清晰主体，使用更克制的轮廓与留白表达，形成易于继续沟通的基础方向。`,
      keywords: ["简洁轮廓", "主体突出", "适合继续细化"],
      placeholderKey: "minimal",
    },
    {
      title: "方向 B｜文化叙事",
      concept: `围绕“${theme}”强调纹样与故事线索，通过层次变化形成更鲜明的主题表达。`,
      keywords: ["主题纹样", "层次表达", "文化线索"],
      placeholderKey: "narrative",
    },
    {
      title: "方向 C｜结构新意",
      concept: `围绕“${theme}”探索更现代的结构关系和视觉重心，为${subject}提供区别于常见样式的讨论起点。`,
      keywords: ["现代结构", "视觉重心", "差异化方向"],
      placeholderKey: "structural",
    },
  ];

  return {
    ...project,
    directions: templates.map((template, index) => ({
      id: id("direction"),
      slot: index + 1,
      origin: "demo_placeholder",
      knowledgeRefs,
      createdAt,
      ...template,
    })),
    updatedAt: createdAt,
  };
}

export function selectDirection(project, directionId, now = new Date()) {
  const direction = project.directions.find((item) => item.id === directionId);
  if (!direction) {
    throw new Error("所选方向不属于当前设计");
  }

  const createdAt = iso(now);
  const version = {
    id: id("version"),
    number: project.versions.length + 1,
    parentVersionId: project.currentVersionId,
    directionId,
    changeType: "direction_selected",
    changeSummary: `客户选择“${direction.title}”作为继续细化的方向。`,
    selectedOptions: [],
    customerRequest: "",
    unresolvedRequests: [],
    placeholderKey: direction.placeholderKey,
    createdAt,
  };

  return {
    ...project,
    status: "refining",
    selectedDirectionId: directionId,
    versions: [...project.versions, version],
    currentVersionId: version.id,
    confirmedVersionId: null,
    updatedAt: createdAt,
  };
}

export function applyRefinement(project, input, now = new Date()) {
  const direction = project.directions.find((item) => item.id === project.selectedDirectionId);
  const selectedOptionIds = [...new Set(input.optionIds ?? [])];
  const selected = refinementOptions.filter((option) => selectedOptionIds.includes(option.id));
  const customerRequest = text(input.customerRequest);

  if (!direction || !project.currentVersionId) {
    throw new Error("请先选择一个设计方向");
  }
  if (selected.length === 0 && !customerRequest) {
    throw new Error("请选择至少一个细化方向，或填写自己的要求");
  }

  const createdAt = iso(now);
  const parts = selected.map((option) => option.label);
  if (customerRequest) {
    parts.push(`客户原话：${customerRequest}`);
  }

  const version = {
    id: id("version"),
    number: project.versions.length + 1,
    parentVersionId: project.currentVersionId,
    directionId: direction.id,
    changeType: "refinement",
    changeSummary: parts.join("；"),
    selectedOptions: selected.map((option) => option.id),
    customerRequest,
    unresolvedRequests: customerRequest ? [customerRequest] : [],
    placeholderKey: `${direction.placeholderKey}-${project.versions.length + 1}`,
    createdAt,
  };

  return {
    ...project,
    status: "refining",
    versions: [...project.versions, version],
    currentVersionId: version.id,
    confirmedVersionId: null,
    updatedAt: createdAt,
  };
}

export function confirmVersion(project, versionId, now = new Date()) {
  if (!project.versions.some((version) => version.id === versionId)) {
    throw new Error("确认版本不存在");
  }

  return {
    ...project,
    status: "completed",
    currentVersionId: versionId,
    confirmedVersionId: versionId,
    updatedAt: iso(now),
  };
}

export function createKnowledgeItem(input, now = new Date()) {
  if (!KNOWLEDGE_TYPES.has(input.kind)) {
    throw new Error("资料类型不受支持");
  }
  if (!input.rightsConfirmed) {
    throw new Error("请先确认资料来源和使用权限");
  }

  const createdAt = iso(now);
  const item = {
    id: id("knowledge"),
    kind: input.kind,
    title: requireText(input.title, "资料标题"),
    category: requireText(input.category, "资料分类"),
    sourceNote: requireText(input.sourceNote, "资料来源"),
    provider: text(input.provider),
    notes: text(input.notes),
    tags: (input.tags ?? []).map(text).filter(Boolean),
    rightsNote: text(input.rightsNote),
    reviewStatus: "pending",
    reviewer: "",
    reviewNote: "",
    reviewedAt: null,
    createdAt,
    updatedAt: createdAt,
  };

  if (input.kind === "text") {
    item.textContent = requireText(input.textContent, "专业文本");
  } else {
    if (!input.photo?.assetId || !input.photo?.fileName) {
      throw new Error("请选择一张照片");
    }
    item.photo = {
      assetId: input.photo.assetId,
      fileName: input.photo.fileName,
      mimeType: input.photo.mimeType,
      size: input.photo.size,
      caption: requireText(input.photo.caption, "照片说明"),
    };
  }

  return item;
}

export function reviewKnowledgeItem(item, input, now = new Date()) {
  if (!REVIEW_DECISIONS.has(input.decision)) {
    throw new Error("审核结论不受支持");
  }
  const reviewedAt = iso(now);
  return {
    ...item,
    reviewStatus: input.decision,
    reviewer: requireText(input.reviewer, "审核人"),
    reviewNote: text(input.note),
    reviewedAt,
    updatedAt: reviewedAt,
  };
}

export function buildProjectExport(project, knowledgeItems) {
  const linkedKnowledge = knowledgeItems
    .filter((item) => project.knowledgeRefs.includes(item.id))
    .map(({ id: itemId, title, category, sourceNote, reviewStatus }) => ({
      id: itemId,
      title,
      category,
      sourceNote,
      reviewStatus,
    }));

  return {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    notice: "本文件来自本地框架演示，不包含真实 AI 图片或生产可行性结论。",
    project,
    linkedKnowledge,
  };
}
