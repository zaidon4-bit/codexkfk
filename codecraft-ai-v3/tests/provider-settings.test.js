import test from "node:test";
import assert from "node:assert/strict";
import { applyProviderSettings, classifyReasoningUsage, isOdiRouterGemini25Pro, setPayloadField } from "../server/provider-settings.js";

const baseURL = "https://api.odirouter.ai/v1";
const geminiModel = "google/gemini-2.5-pro:free";

function payload() {
  return { model: geminiModel, messages: [{ role: "user", content: "OK" }] };
}

test("detects only the ODiRouter Gemini 2.5 Pro route", () => {
  assert.equal(isOdiRouterGemini25Pro(baseURL, geminiModel), true);
  assert.equal(isOdiRouterGemini25Pro("https://api.odirouter.ai/v1", "google/gemini-2.5-flash:free"), false);
  assert.equal(isOdiRouterGemini25Pro("https://api.other.example/v1", geminiModel), false);
});

test("maps Low, Medium, High and X High into an explicit request parameter", () => {
  for (const level of ["low", "medium", "high", "xhigh"]) {
    const body = payload();
    // Simulate a generic .env copied from the example, including AI_THINKING_XHIGH_VALUE=xhigh.
    const applied = applyProviderSettings(body, { thinkingLevel: level, additionalMode: "standard" }, geminiModel, baseURL, null, {
      AI_THINKING_LOW_VALUE: "low", AI_THINKING_MEDIUM_VALUE: "medium", AI_THINKING_HIGH_VALUE: "high", AI_THINKING_XHIGH_VALUE: "xhigh", AI_MAX_OUTPUT_FIELD: "max_completion_tokens"
    });
    assert.equal(applied.reasoningParameterApplied, true, `${level} should apply a reasoning parameter`);
    assert.equal(body.reasoning_effort, level === "xhigh" ? "high" : level);
  }
});

test("X High maps to the documented High ceiling for Gemini 2.5 Pro", () => {
  const body = payload();
  const applied = applyProviderSettings(body, { thinkingLevel: "xhigh", additionalMode: "standard" }, geminiModel, baseURL, null, {});
  assert.equal(body.reasoning_effort, "high");
  assert.equal(applied.thinkingValue, "high");
});

test("deep mode sends one thinking-budget shape, not both budget and reasoning_effort", () => {
  const body = payload();
  const applied = applyProviderSettings(body, { thinkingLevel: "high", additionalMode: "deep" }, geminiModel, baseURL, null, {});
  assert.equal(body.reasoning_effort, undefined);
  assert.equal(body.extra_body.google.thinking_config.thinking_budget, 10000);
  assert.equal(applied.deepBudgetTokensRequested, 10000);
  assert.equal(applied.deepBudgetField, "extra_body.google.thinking_config.thinking_budget");
  assert.equal(applied.reasoningParameterApplied, true);
});

test("long mode applies an output-token cap and reports the exact field", () => {
  const body = payload();
  const applied = applyProviderSettings(body, { thinkingLevel: "medium", additionalMode: "long" }, geminiModel, baseURL, null, {});
  assert.equal(body.max_tokens, 10000);
  assert.equal(body.max_completion_tokens, undefined);
  assert.equal(applied.outputField, "max_tokens");
  assert.equal(applied.outputTokenLimitRequested, 10000);
});

test("non-ODiRouter models do not get guessed reasoning controls", () => {
  const body = { messages: [{ role: "user", content: "OK" }] };
  const applied = applyProviderSettings(body, { thinkingLevel: "high", additionalMode: "standard" }, "some-model", "https://api.example.com/v1", null, {});
  assert.equal(applied.reasoningParameterApplied, false);
  assert.equal(body.reasoning_effort, undefined);
});

test("admin-configured provider fields are applied and protected path segments are rejected", () => {
  const body = {};
  const configured = { thinking_field: "reasoning.effort", thinking_low_value: "small", thinking_medium_value: "balanced", thinking_high_value: "strong", thinking_xhigh_value: "max", max_output_field: "max_tokens" };
  const applied = applyProviderSettings(body, { thinkingLevel: "xhigh", additionalMode: "standard" }, "custom-model", "https://provider.example/v1", configured, {});
  assert.deepEqual(body.reasoning, { effort: "max" });
  assert.equal(applied.thinkingField, "reasoning.effort");
  assert.equal(setPayloadField(body, "__proto__.polluted", true), false);
  assert.equal({}.polluted, undefined);
});


test("does not guess max output field for an unknown provider", () => {
  const body = { messages: [{ role: "user", content: "OK" }] };
  const applied = applyProviderSettings(body, { thinkingLevel: "medium", additionalMode: "long" }, "custom-model", "https://provider.example/v1", null, {});
  assert.equal(applied.outputField, null);
  assert.equal(body.max_tokens, undefined);
  assert.equal(body.max_completion_tokens, undefined);
});

test("reasoning verification requires positive usage evidence and does not infer silent ignore", () => {
  assert.deepEqual(classifyReasoningUsage(124), { status: "confirmed_by_usage", evidence: "positive_reasoning_token_count", count: 124 });
  assert.deepEqual(classifyReasoningUsage(0), { status: "not_verified", evidence: "provider_reported_zero_reasoning_tokens", count: 0 });
  assert.deepEqual(classifyReasoningUsage(null), { status: "not_verifiable", evidence: "usage_field_not_reported" });
});
