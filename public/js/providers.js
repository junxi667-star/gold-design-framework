import { applyRefinement, prepareMockDirections } from "./domain.js";

export const frameworkCapabilities = Object.freeze({
  externalNetwork: false,
  realImageGeneration: false,
  photoRecognition: false,
  ocr: false,
  modelTraining: false,
  aiInterfaceContracts: true,
  localTaskSimulation: true,
  sameOriginApiClient: true,
  localKnowledgeReview: true,
  localVersionHistory: true,
});

export class MockDesignProvider {
  async prepareDirections(project, approvedKnowledge) {
    return prepareMockDirections(project, approvedKnowledge);
  }

  async refine(project, input) {
    return applyRefinement(project, input);
  }
}
