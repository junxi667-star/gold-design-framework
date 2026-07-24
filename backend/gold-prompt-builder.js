import { list, text } from "./utils.js";

const DIRECTION_VISUALS = Object.freeze({
  minimal: "minimalist clean composition, generous negative space, restrained refined ornament",
  narrative: "clear cultural storytelling, recognizable but restrained symbolic motif",
  structural: "distinctive wearable geometry, innovative yet physically plausible jewelry construction",
});

export function buildGoldImagePrompts(requirement, {
  promptTemplate,
  direction,
  payload = {},
} = {}) {
  const productType = text(requirement.productType) || "gold jewelry product";
  const motifs = list(requirement.motifs);
  const mustKeep = list(requirement.mustKeep);
  const craft = list(requirement.craftRequirements);
  const directionCue = DIRECTION_VISUALS[direction?.previewKey]
    || text(direction?.promptAddon)
    || text(direction?.description);
  const positive = [
    `studio product photograph of a single ${productType}`,
    text(requirement.goldType) || "realistic premium yellow gold material",
    text(requirement.style),
    motifs.length ? `motifs: ${motifs.join(", ")}` : "",
    text(requirement.targetAudience) ? `for ${text(requirement.targetAudience)}` : "",
    text(requirement.usageScenario) ? `usage: ${text(requirement.usageScenario)}` : "",
    directionCue,
    mustKeep.length ? `must preserve: ${mustKeep.join(", ")}` : "",
    craft.length ? `craft intention: ${craft.join(", ")}` : "",
    "single isolated product, centered front view, clean neutral background",
    "physically plausible wearable jewelry structure, realistic load-bearing connections",
    "luxury catalog photography, highly detailed",
    promptTemplate?.content ? "follow only confirmed requirements; do not invent weight, budget or manufacturability" : "",
    text(payload.customerChangeRequest || payload.changeRequest)
      ? `requested revision: ${text(payload.customerChangeRequest || payload.changeRequest)}`
      : "",
  ].filter(Boolean).join(", ");
  const negative = [
    "multiple products",
    "duplicate jewelry",
    "broken chain",
    "floating parts",
    "impossible construction",
    "sharp dangerous edges",
    "text",
    "watermark",
    "logo",
    "human",
    "hand",
    "cluttered background",
    ...list(requirement.mustAvoid),
  ].join(", ");
  return { positivePrompt: positive, negativePrompt: negative };
}
