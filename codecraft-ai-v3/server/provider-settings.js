// Provider-aware request shaping kept pure so the exact payload mapping can be tested offline.
export function classifyReasoningUsage(value) {
  if (value === null || value === undefined || value === "") {
    return { status: "not_verifiable", evidence: "usage_field_not_reported" };
  }
  const count = Number(value);
  if (!Number.isFinite(count) || count < 0) {
    return { status: "not_verifiable", evidence: "usage_field_invalid" };
  }
  if (count > 0) return { status: "confirmed_by_usage", evidence: "positive_reasoning_token_count", count };
  return { status: "not_verified", evidence: "provider_reported_zero_reasoning_tokens", count: 0 };
}

export function setPayloadField(payload, dottedField, value) {
  const parts = String(dottedField || "").split(".").filter(Boolean);
  if (!parts.length || parts.length > 4 || parts.some(p => !/^[a-zA-Z0-9_-]{1,80}$/.test(p) || ["__proto__", "prototype", "constructor"].includes(p))) return false;
  let target = payload;
  for (const key of parts.slice(0, -1)) {
    if (!target[key] || typeof target[key] !== "object" || Array.isArray(target[key])) target[key] = {};
    target = target[key];
  }
  target[parts[parts.length - 1]] = value;
  return true;
}

function providerHost(baseURL) {
  try { return new URL(baseURL).hostname.toLowerCase(); } catch { return ""; }
}

export function isOdiRouterGemini25Pro(baseURL, modelId) {
  const host = providerHost(baseURL);
  const model = String(modelId || "").toLowerCase().replace(/[\s_]/g, "-");
  return /(^|\.)odirouter\.ai$/.test(host) && /gemini[-/]?2[.-]?5.*pro/.test(model);
}

export function applyProviderSettings(payload, settings, modelId, baseURL = "", modelSettings = null, env = process.env) {
  const thinkingLevel = ["low", "medium", "high", "xhigh"].includes(settings?.thinkingLevel) ? settings.thinkingLevel : "high";
  const additionalMode = ["standard", "quick", "long", "deep"].includes(settings?.additionalMode) ? settings.additionalMode : "standard";
  const odirouterGemini25Pro = isOdiRouterGemini25Pro(baseURL, modelId);
  const configuredThinkingField = modelSettings?.thinking_field || env.AI_THINKING_FIELD || "";
  const thinkingField = configuredThinkingField || (odirouterGemini25Pro ? "reasoning_effort" : "");
  const valueMap = {
    low: modelSettings?.thinking_low_value || env.AI_THINKING_LOW_VALUE || "low",
    medium: modelSettings?.thinking_medium_value || env.AI_THINKING_MEDIUM_VALUE || "medium",
    high: modelSettings?.thinking_high_value || env.AI_THINKING_HIGH_VALUE || "high",
    // Gemini 2.5 Pro's documented highest supported effort is High; X High maps to that ceiling.
    xhigh: modelSettings?.thinking_xhigh_value || (odirouterGemini25Pro ? "high" : (env.AI_THINKING_XHIGH_VALUE || "xhigh"))
  };
  // A model-specific admin override wins. Otherwise the ODiRouter Gemini 2.5 Pro preset
  // takes priority over generic environment defaults that may use OpenAI's other field name.
  // Do not guess a provider's output-token field. For non-preset routes, configure
  // max_output_field per model in Admin or set AI_MAX_OUTPUT_FIELD only when all routes share it.
  const outputField = modelSettings?.max_output_field || (odirouterGemini25Pro ? "max_tokens" : (env.AI_MAX_OUTPUT_FIELD || ""));
  const budgetField = modelSettings?.thinking_budget_field || env.AI_THINKING_BUDGET_FIELD || "";
  let thinkingValue = null;
  let thinkingFieldApplied = null;
  let deepBudgetConfigured = false;
  let deepBudgetFieldApplied = null;
  let deepBudgetTokensRequested = null;

  if (additionalMode !== "deep" && thinkingField) {
    thinkingValue = valueMap[thinkingLevel];
    if (setPayloadField(payload, thinkingField, thinkingValue)) thinkingFieldApplied = thinkingField;
  }

  let outputFieldApplied = null;
  if (additionalMode === "long" && setPayloadField(payload, outputField, 10000)) outputFieldApplied = outputField;
  if (additionalMode === "deep") {
    if (budgetField) {
      deepBudgetConfigured = setPayloadField(payload, budgetField, 10000);
      deepBudgetFieldApplied = deepBudgetConfigured ? budgetField : null;
      deepBudgetTokensRequested = deepBudgetConfigured ? 10000 : null;
      if (thinkingField === "reasoning_effort") delete payload.reasoning_effort;
    } else if (odirouterGemini25Pro) {
      // Do not send reasoning_effort and thinking_budget together; official Gemini docs say they overlap.
      delete payload.reasoning_effort;
      deepBudgetFieldApplied = "extra_body.google.thinking_config.thinking_budget";
      deepBudgetConfigured = setPayloadField(payload, deepBudgetFieldApplied, 10000);
      if (!deepBudgetConfigured) deepBudgetFieldApplied = null;
      deepBudgetTokensRequested = deepBudgetConfigured ? 10000 : null;
    } else if (thinkingField) {
      thinkingValue = valueMap.xhigh;
      if (setPayloadField(payload, thinkingField, thinkingValue)) thinkingFieldApplied = thinkingField;
    }
  }

  return {
    thinkingLevel, additionalMode,
    thinkingField: thinkingFieldApplied,
    thinkingValue: thinkingFieldApplied ? thinkingValue : null,
    thinkingFieldConfigured: Boolean(thinkingField),
    reasoningParameterApplied: Boolean(thinkingFieldApplied || deepBudgetConfigured),
    deepBudgetConfigured, deepBudgetField: deepBudgetFieldApplied, deepBudgetTokensRequested,
    outputField: outputFieldApplied,
    outputTokenLimitRequested: outputFieldApplied ? 10000 : null,
    providerPreset: odirouterGemini25Pro ? "odirouter-gemini-2.5-pro" : (configuredThinkingField ? "admin-configured" : "provider-default")
  };
}
