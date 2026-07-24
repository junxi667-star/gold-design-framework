import {
  confirmVersion,
  createKnowledgeItem,
  createProject,
  reviewKnowledgeItem,
  selectDirection,
} from "./domain.js";

export function isDemoMode(search = "") {
  return new URLSearchParams(search).get("demo") === "1";
}

export async function seedDemoDataIfRequested(database, designProvider, search = "") {
  if (!isDemoMode(search)) {
    return { seeded: false, reason: "not_demo_mode" };
  }

  const [projects, knowledgeItems] = await Promise.all([
    database.getAll("projects"),
    database.getAll("knowledge"),
  ]);
  if (projects.length > 0 || knowledgeItems.length > 0) {
    return { seeded: false, reason: "existing_data" };
  }

  let knowledge = createKnowledgeItem({
    kind: "text",
    title: "演示资料｜人工审核流程占位",
    category: "reference",
    sourceNote: "系统内置演示数据，不是外部行业来源",
    provider: "演示数据",
    textContent: "这是一条用于展示资料录入、人工审核和设计引用关系的占位内容，不包含黄金行业事实或专业结论。",
    notes: "仅供界面和流程演示，不得作为设计、工艺或生产依据。",
    rightsNote: "由本地演示项目创建，仅用于产品演示。",
    rightsConfirmed: true,
  });
  knowledge = reviewKnowledgeItem(knowledge, {
    decision: "approved",
    reviewer: "演示审核员",
    note: "仅批准其作为流程占位数据，不代表行业知识已经核验。",
  });
  await database.put("knowledge", knowledge);

  let project = createProject({
    theme: "莲花新生纪念吊坠",
    category: "吊坠",
    audience: "年轻用户（演示）",
    scene: "周年纪念（演示）",
    style: "轻奢精致（演示）",
    notes: "用于展示从主题、方向选择到细化确认的完整交互流程。",
  }, [knowledge.id]);
  project = await designProvider.prepareDirections(project, [knowledge]);
  project = selectDirection(project, project.directions[0].id);
  project = await designProvider.refine(project, {
    optionIds: ["simplify", "contemporary"],
    customerRequest: "希望轮廓更轻盈，中心层级更清楚。（演示）",
  });
  project = confirmVersion(project, project.currentVersionId);
  await database.put("projects", project);

  return {
    seeded: true,
    projectId: project.id,
    knowledgeId: knowledge.id,
  };
}
