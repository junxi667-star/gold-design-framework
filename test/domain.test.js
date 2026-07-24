import assert from "node:assert/strict";
import test from "node:test";

import {
  applyRefinement,
  confirmVersion,
  createKnowledgeItem,
  createProject,
  prepareMockDirections,
  reviewKnowledgeItem,
  selectDirection,
} from "../public/js/domain.js";

test("新建设计只产生三个明确的本地占位方向", () => {
  const project = createProject({ theme: "莲花", category: "吊坠" }, [], "2026-07-20T00:00:00Z");
  const prepared = prepareMockDirections(project, [], "2026-07-20T00:01:00Z");

  assert.equal(prepared.directions.length, 3);
  assert.deepEqual(prepared.directions.map((item) => item.slot), [1, 2, 3]);
  assert.ok(prepared.directions.every((item) => item.origin === "demo_placeholder"));
  assert.deepEqual(
    prepareMockDirections(prepared, []).directions.map((item) => item.id),
    prepared.directions.map((item) => item.id),
    "重复准备方向必须幂等",
  );
});

test("方向选择和客户反馈会新建版本而不覆盖历史", () => {
  let project = createProject({ theme: "生肖龙" });
  project = prepareMockDirections(project);
  project = selectDirection(project, project.directions[0].id);
  const firstVersion = project.versions[0];

  project = applyRefinement(project, {
    optionIds: ["simplify"],
    customerRequest: "龙纹不要太凶，更适合日常佩戴",
  });

  assert.equal(project.versions.length, 2);
  assert.equal(project.versions[0].id, firstVersion.id);
  assert.deepEqual(project.versions[1].unresolvedRequests, ["龙纹不要太凶，更适合日常佩戴"]);

  project = confirmVersion(project, project.versions[1].id);
  assert.equal(project.status, "completed");
  assert.equal(project.confirmedVersionId, project.versions[1].id);
});

test("只有人工批准的资料会被记录为设计引用", () => {
  const pending = createKnowledgeItem({
    kind: "text",
    title: "待审资料",
    category: "style",
    sourceNote: "内部访谈",
    textContent: "原始专家说明",
    rightsConfirmed: true,
  });
  const approvedBase = createKnowledgeItem({
    kind: "text",
    title: "已审资料",
    category: "style",
    sourceNote: "内部访谈",
    textContent: "经审核说明",
    rightsConfirmed: true,
  });
  const approved = reviewKnowledgeItem(approvedBase, {
    decision: "approved",
    reviewer: "行业专家甲",
    note: "仅用于概念沟通",
  });

  let project = createProject({ theme: "祥云" }, [pending.id, approved.id]);
  project = prepareMockDirections(project, [pending, approved]);

  assert.ok(project.directions.every((item) => item.knowledgeRefs.length === 1));
  assert.ok(project.directions.every((item) => item.knowledgeRefs[0] === approved.id));
});

test("没有来源权限确认的资料不能保存", () => {
  assert.throws(
    () => createKnowledgeItem({
      kind: "text",
      title: "无权限资料",
      category: "reference",
      sourceNote: "未知",
      textContent: "内容",
      rightsConfirmed: false,
    }),
    /确认资料来源和使用权限/,
  );
});
