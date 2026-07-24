import { readFile } from "node:fs/promises";

import { LocalRequirementParser } from "../backend/requirement-parser.js";

const datasetUrl = new URL("../data/training/gold-requirement-training-v1.json", import.meta.url);
const dataset = JSON.parse(await readFile(datasetUrl, "utf8"));
const parser = new LocalRequirementParser();
const cases = Array.isArray(dataset.evaluationCases) ? dataset.evaluationCases : [];
const results = [];

for (const item of cases) {
  try {
    const parsed = parser.parse({ customerText: item.customerText, formFields: {} });
    results.push({
      caseId: item.id,
      title: item.title,
      parsed: true,
      productType: parsed.productType || "待确认",
      missingFieldCount: parsed.missingFields.length,
    });
  } catch (error) {
    results.push({
      caseId: item.id,
      title: item.title,
      parsed: false,
      error: error.message,
    });
  }
}

console.log(`解析器：${parser.getStatus().parserVersion}`);
console.log(`项目种子资料：${dataset.metadata?.name || "未命名"} ${dataset.metadata?.version || ""}`);
console.log(`资料案例：${Array.isArray(dataset.examples) ? dataset.examples.length : 0} 条`);
console.log(`固定烟雾样例：${cases.length} 条`);
console.log(`无异常完成：${results.filter((item) => item.parsed).length}/${results.length}`);
console.log("说明：这只验证资料结构和本地解析流程可运行，不代表行业准确率、模型训练效果或生产可行性。");

for (const item of results) {
  console.log(item.parsed
    ? `${item.caseId} ${item.title}：产品类型=${item.productType}，待确认字段=${item.missingFieldCount}`
    : `${item.caseId} ${item.title}：解析失败 ${item.error}`);
}

if (results.some((item) => !item.parsed)) {
  process.exitCode = 1;
}
