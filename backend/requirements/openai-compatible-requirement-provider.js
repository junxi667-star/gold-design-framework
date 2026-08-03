import { text } from "../utils.js";
import { REQUIREMENT_DATA_VERSION, REQUIREMENT_PARSER_VERSION } from "./requirement-schema.js";

function parseJsonContent(content) {
  const normalized = text(content).replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  return JSON.parse(normalized);
}

function providerError(message, { code = "REQUIREMENT_PROVIDER_FAILED", retryable = true, details = null } = {}) {
  const error = new Error(message);
  error.code = code;
  error.httpStatus = 502;
  error.retryable = retryable;
  error.details = details;
  return error;
}

export class OpenAiCompatibleRequirementProvider {
  constructor({
    baseUrl = process.env.AI_REQUIREMENT_API_BASE,
    apiKey = process.env.AI_REQUIREMENT_API_KEY,
    model = process.env.AI_REQUIREMENT_MODEL,
    timeoutMs = Number(process.env.AI_REQUIREMENT_TIMEOUT_MS || 45000),
    allowExternalData = process.env.AI_ALLOW_EXTERNAL_REQUIREMENT_DATA === "true",
    fetchImpl = globalThis.fetch,
  } = {}) {
    this.baseUrl = text(baseUrl).replace(/\/$/, "");
    this.apiKey = text(apiKey);
    this.model = text(model);
    this.timeoutMs = timeoutMs;
    this.allowExternalData = allowExternalData;
    this.fetchImpl = fetchImpl;
  }

  get configured() {
    return Boolean(this.baseUrl && this.apiKey && this.model && this.allowExternalData && this.fetchImpl);
  }

  status() {
    return {
      provider: "openai-compatible",
      configured: this.configured,
      externalDataAllowed: this.allowExternalData,
      model: this.configured ? this.model : null,
      notice: this.allowExternalData
        ? "已明确允许把需求文本发送给外部模型供应商。"
        : "默认禁止把项目需求发送给外部模型；需显式设置 AI_ALLOW_EXTERNAL_REQUIREMENT_DATA=true。",
    };
  }

  async parse(input, localBaseline) {
    if (!this.configured) {
      throw providerError("外部需求解析 Provider 未完整配置", {
        code: "REQUIREMENT_PROVIDER_NOT_CONFIGURED",
        retryable: false,
      });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const systemPrompt = [
      "你是黄金珠宝行业需求解析器。只输出 JSON，不输出解释性文本。",
      `解析规范版本：${REQUIREMENT_PARSER_VERSION}；行业资料：${REQUIREMENT_DATA_VERSION}。`,
      "核心规则：客户的模糊词只能转成风格、视觉重量或待确认问题，不得虚构克重、预算、材质、尺寸、工艺或生产结论。",
      "修改任务必须明确 taskType、mustKeep、mustAvoid、允许修改范围和版权待确认项。",
      "输出字段必须包含：productType、goldType、targetAudience、usageScenario、style、motifs、meanings、weightRequirement、visualWeight、budget、dimensions、structureForms、craftRequirements、surfaceEffects、settingRequirements、comfortRequirements、safetyRisks、mustKeep、mustAvoid、missingFields、clarificationQuestions、ambiguousTerms、contradictions、doNotInfer、understandingSummary。",
      "无法确定的标量使用空字符串或“未说明”，列表使用空数组。",
    ].join("\n");
    const userPrompt = JSON.stringify({
      customerText: text(input.customerText),
      formFields: input.formFields ?? {},
      localSafetyBaseline: localBaseline,
    });

    try {
      const response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.model,
          temperature: 0,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
        }),
        signal: controller.signal,
      });
      const raw = await response.text();
      let payload;
      try {
        payload = raw ? JSON.parse(raw) : {};
      } catch {
        throw providerError("外部模型返回了无法解析的响应", { details: { status: response.status } });
      }
      if (!response.ok) {
        throw providerError("外部需求解析请求失败", {
          retryable: response.status === 429 || response.status >= 500,
          details: { status: response.status, providerError: payload?.error?.message ?? null },
        });
      }
      const content = payload?.choices?.[0]?.message?.content;
      if (!content) throw providerError("外部模型没有返回解析内容");
      return {
        provider: "openai-compatible",
        model: this.model,
        raw: parseJsonContent(content),
        usage: payload.usage ?? null,
      };
    } catch (error) {
      if (error?.name === "AbortError") {
        throw providerError("外部需求解析超时", { code: "REQUIREMENT_PROVIDER_TIMEOUT" });
      }
      if (error?.httpStatus) throw error;
      throw providerError("无法连接外部需求解析服务", { details: { cause: error?.message ?? String(error) } });
    } finally {
      clearTimeout(timeout);
    }
  }
}
