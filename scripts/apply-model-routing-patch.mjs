import { readFile, writeFile } from "node:fs/promises";

const apiPath = "api/marketing-ai-assistant-competence.js";
let source = await readFile(apiPath, "utf8");

function replaceOnce(label, search, replacement) {
  const first = source.indexOf(search);
  if (first < 0) throw new Error(`${label}: expected source was not found`);
  if (source.indexOf(search, first + search.length) >= 0) throw new Error(`${label}: expected source was not unique`);
  source = source.replace(search, replacement);
}

replaceOnce(
  "model-router import",
  `} from "../lib/aiAssistantHealth.js";\n\nconst API_KEY_HEADER`,
  `} from "../lib/aiAssistantHealth.js";\nimport {\n  ASSISTANT_MODEL_POLICY,\n  buildAssistantResponseModelParameters,\n  chooseAssistantModel,\n} from "../lib/aiAssistantModelRouter.js";\n\nconst API_KEY_HEADER`,
);

const requestFunctionPattern = /export async function requestOpenAIConversationReply\(prompt, environment = process\.env, fetchImplementation = fetch\) \{[\s\S]*?\n\}\n\nexport function parseOpenAIConversationReply/;
const requestFunctionReplacement = `export async function requestOpenAIConversationReply(prompt, route = {}, environment = process.env, fetchImplementation = fetch) {
  const apiKey = clean(environment.OPENAI_API_KEY);
  if (!apiKey) throw new ApiError(500, "OPENAI_API_KEY is not configured.", "configuration", { openai_api_key_present: false });
  const modelParameters = buildAssistantResponseModelParameters(route);
  const model = modelParameters.model;
  const response = await fetchImplementation("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: \`Bearer \${apiKey}\`, "Content-Type": "application/json" },
    body: JSON.stringify({
      ...modelParameters,
      input: [
        { role: "system", content: "You are the grounded internal simulation of a UK van website assistant. Compose only the customer-facing reply. Never override product context, deterministic rules, remembered facts or supplied evidence." },
        { role: "user", content: prompt },
      ],
      text: { format: { type: "json_schema", name: "conversation_simulation_reply", strict: true, schema: CONVERSATION_REPLY_SCHEMA } },
    }),
  });
  let payload;
  try { payload = await response.json(); } catch (error) { throw new ApiError(502, \`OpenAI returned a non-JSON conversation response (\${response.status} \${response.statusText}).\`, "ai", { model, cause: clean(error.message, 500) }); }
  if (!response.ok) throw new ApiError(502, openAIErrorMessage(payload, response), "ai", { model, openai_status: response.status });
  return {
    payload,
    model,
    route: {
      ...route,
      model,
      temperature: modelParameters.temperature,
      reasoning_effort: modelParameters.reasoning?.effort || null,
    },
  };
}

export function parseOpenAIConversationReply`;

if (!requestFunctionPattern.test(source)) throw new Error("OpenAI conversation request function was not found");
source = source.replace(requestFunctionPattern, requestFunctionReplacement);

replaceOnce(
  "initial model-route state",
  `  let model = "deterministic-conversation-rules";\n  let tokenUsage`,
  `  let model = "deterministic-conversation-rules";\n  let modelRoute = {\n    model,\n    tier: "deterministic",\n    temperature: null,\n    reasoning_effort: null,\n    reason: "The turn was handled by canonical server-side conversation rules without an OpenAI generation call.",\n  };\n  let tokenUsage`,
);

replaceOnce(
  "deterministic health route",
  `      model = "deterministic-health-engine";`,
  `      model = "deterministic-health-engine";\n      modelRoute = {\n        model,\n        tier: "deterministic",\n        temperature: null,\n        reasoning_effort: null,\n        reason: "The deterministic health engine generated the evidence response without an OpenAI call.",\n      };`,
);

replaceOnce(
  "routed OpenAI request",
  `      const requested = await runStage("Conversation OpenAI request", { ...context, source_count: sources.length }, () => requestOpenAIConversationReply(prompt));\n      const generated`,
  `      const selectedModelRoute = chooseAssistantModel({\n        message: question,\n        intent,\n        human,\n        orchestration,\n        sourceCount: sources.length,\n      });\n      const requested = await runStage("Conversation OpenAI request", { ...context, source_count: sources.length, model: selectedModelRoute.model, model_tier: selectedModelRoute.tier }, () => requestOpenAIConversationReply(prompt, selectedModelRoute));\n      modelRoute = requested.route;\n      const generated`,
);

replaceOnce(
  "structured routing diagnostics",
  `    token_usage: tokenUsage,\n    estimated_cost_usd:`,
  `    model_route: modelRoute,\n    token_usage: tokenUsage,\n    estimated_cost_usd:`,
);

replaceOnce(
  "returned routing diagnostics",
  `generation_time_ms: generationTime, model, category_filter: categoryFilter }, request_trace: trace };`,
  `generation_time_ms: generationTime, model, model_route: modelRoute, category_filter: categoryFilter }, request_trace: trace };`,
);

replaceOnce(
  "live health model logging",
  `model: clean(environment.OPENAI_MODEL, 200) || "gpt-4.1-mini"`,
  `model: ASSISTANT_MODEL_POLICY.full`,
);

replaceOnce(
  "live health model configuration",
  `validation: { openai_calls_enabled: true, database_writes: 0, customer_records_created: 0, model: clean(environment.OPENAI_MODEL, 200) || "gpt-4.1-mini", pricing_configured: estimateOpenAICost({}, environment) !== null }`,
  `validation: { openai_calls_enabled: true, database_writes: 0, customer_records_created: 0, model_policy: ASSISTANT_MODEL_POLICY, pricing_configured: estimateOpenAICost({}, environment) !== null }`,
);

replaceOnce(
  "health configuration model policy",
  `    model: clean(environment.OPENAI_MODEL, 200) || "gpt-4.1-mini",`,
  `    model_policy: ASSISTANT_MODEL_POLICY,`,
);

await writeFile(apiPath, source);
console.log("Canonical model routing patch applied.");
