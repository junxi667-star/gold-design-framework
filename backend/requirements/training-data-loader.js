import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const trainingDataPath = path.resolve(moduleDir, "../../data/training/gold-requirement-training-v1.json");
let cache = null;

export function loadRequirementTrainingData() {
  if (!cache) {
    cache = JSON.parse(readFileSync(trainingDataPath, "utf8"));
  }
  return cache;
}

export function getRequirementTrainingMetadata() {
  const data = loadRequirementTrainingData();
  return {
    ...data.metadata,
    counts: {
      fieldDefinitions: data.fieldDefinitions.length,
      additionalFields: data.additionalFields.length,
      examples: data.examples.length,
      fuzzyTerms: data.fuzzyTerms.length,
      modificationRules: data.modificationRules.length,
      evaluationCases: data.evaluationCases.length,
    },
  };
}

export function getRequirementSchemaCatalog() {
  const data = loadRequirementTrainingData();
  return {
    metadata: getRequirementTrainingMetadata(),
    fields: data.fieldDefinitions,
    additionalFields: data.additionalFields,
  };
}

export function getRequirementEvaluationCases() {
  return loadRequirementTrainingData().evaluationCases;
}
