import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createAppError, UNSUPPORTED_PRODUCT_TEMPLATE } from "./error-codes.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const configPath = path.join(here, "templates", "gold-product-templates.v2.json");
const CONFIG = JSON.parse(readFileSync(configPath, "utf8"));

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function getTemplateConfig() {
  return JSON.parse(JSON.stringify(CONFIG));
}

export function normalizeProductType(requirement = {}) {
  const raw = [requirement.productType, requirement.product, requirement.category, requirement.customerText]
    .map(text)
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  for (const [key, template] of Object.entries(CONFIG.products)) {
    if (template.aliases.some((alias) => raw.includes(String(alias).toLowerCase()))) return key;
  }
  throw createAppError(UNSUPPORTED_PRODUCT_TEMPLATE, { message: "当前客户版只支持吊坠、项链、戒指和手镯，请在确认页选择其中一种。" });
}

export function selectProductTemplate(requirement = {}) {
  const productType = normalizeProductType(requirement);
  return { productType, template: JSON.parse(JSON.stringify(CONFIG.products[productType])) };
}

export function resolveStyle(requirement = {}) {
  const raw = [requirement.style, ...(requirement.styleKeywords || [])].map(text).join(" ");
  const selected = Object.entries(CONFIG.styles)
    .filter(([name]) => raw.includes(name) || (name === "现代极简" && /现代|简约|极简|克制/.test(raw)) ||
      (name === "新中式" && /国风|中式|东方/.test(raw)) ||
      (name === "轻奢精致" && /轻奢|精致|高级|贵气/.test(raw)) ||
      (name === "传统吉祥" && /传统|吉祥|喜庆|婚嫁/.test(raw)) ||
      (name === "年轻活力" && /年轻|活力|少女/.test(raw)) ||
      (name === "成熟大气" && /成熟|大气|稳重|妈妈|贵妇/.test(raw)))
    .map(([, fragment]) => fragment);
  return [...new Set(selected)];
}

export function resolveShape(requirement = {}, template) {
  const raw = [
    ...(Array.isArray(requirement.structureForms) ? requirement.structureForms : []),
    requirement.shape,
    requirement.style,
    requirement.customerText,
  ].map(text).join(" ");
  const selected = template.shapes.find((shape) => raw.includes(shape)) || template.defaultShape;
  return { name: selected, fragment: CONFIG.shapeFragments[selected] || "" };
}
