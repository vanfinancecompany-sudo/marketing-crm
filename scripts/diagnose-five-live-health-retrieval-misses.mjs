import { createClient } from "@supabase/supabase-js";
import { simulateCustomerConversation } from "../api/marketing-ai-assistant-competence.js";
import { syntheticScenarioAt } from "../lib/aiAssistantHealth.js";
import {
  buildFinanceCoverageEvidence,
  buildRent2BuyCoverageEvidence,
  buildRent2BuyDeliveryEvidence,
  extractUkLocation,
  isCoverageQuestion,
} from "../lib/productCoverageRules.js";

const TARGET_PROJECT_ID = "prj_zD76dAe2MHZdBTO08GNFSqOb9UHf";
const TARGETS = [299, 305, 472, 547, 552];

function marker(name, payload = {}) {
  console.log(`${name} ${JSON.stringify(payload)}`);
}

function shouldRun() {
  return process.env.VERCEL_ENV === "production"
    && process.env.VERCEL_PROJECT_ID === TARGET_PROJECT_ID
    && process.env.VERCEL_GIT_COMMIT_REF === "main";
}

function required(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`${name} is required for the five-case retrieval diagnostic.`);
  return value;
}

function deterministicCoverage({ question, productContext, settings = {} } = {}) {
  if (!isCoverageQuestion(question)) return null;
  if (productContext === "finance") return buildFinanceCoverageEvidence(question, settings);
  if (productContext !== "rent2buy") return null;
  const delivery = buildRent2BuyDeliveryEvidence(question, settings);
  if (delivery) return delivery;
  return buildRent2BuyCoverageEvidence({ location: extractUkLocation(question), settings });
}

async function main() {
  if (!shouldRun()) {
    marker("LIVE_HEALTH_FIVE_DIAGNOSTIC_SKIPPED", {
      environment: process.env.VERCEL_ENV || null,
      project_id: process.env.VERCEL_PROJECT_ID || null,
      branch: process.env.VERCEL_GIT_COMMIT_REF || null,
    });
    return;
  }

  const supabase = createClient(
    required("SUPABASE_URL"),
    required("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  marker("LIVE_HEALTH_FIVE_DIAGNOSTIC_START", {
    scenarios: TARGETS.length,
    openai_calls_expected: 0,
    database_writes_expected: 0,
  });

  for (const syntheticIndex of TARGETS) {
    const scenario = syntheticScenarioAt(syntheticIndex);
    let messages = [];
    let rememberedFacts = {};
    let journeyState = {};

    marker("LIVE_HEALTH_FIVE_SCENARIO_START", {
      synthetic_index: syntheticIndex,
      scenario_id: scenario.id,
      source_scenario_id: scenario.source_scenario_id,
      name: scenario.name,
      category: scenario.category,
      product_context: scenario.product_context,
      messages: scenario.messages,
    });

    for (let turnIndex = 0; turnIndex < scenario.messages.length; turnIndex += 1) {
      const message = scenario.messages[turnIndex];
      const response = await simulateCustomerConversation(supabase, {
        request_id: `five-diagnostic-${scenario.id}-${turnIndex + 1}`,
        session_id: `five-diagnostic-${scenario.id}`,
        scenario_id: scenario.source_scenario_id || scenario.id,
        message,
        product_context: scenario.product_context,
        messages,
        remembered_facts: rememberedFacts,
        journey_state: journeyState,
      }, {
        persist: false,
        generationMode: "deterministic",
        coverageResolver: deterministicCoverage,
      });

      const result = response.result || {};
      marker("LIVE_HEALTH_FIVE_TURN", {
        scenario_id: scenario.id,
        turn: turnIndex + 1,
        message,
        universal_message_type: result.universal_message_type || null,
        conversation_intent: result.conversation_intent || null,
        secondary_intents: result.secondary_intents || [],
        retrieval_required: Boolean(result.retrieval_required),
        retrieval_performed: Boolean(result.retrieval_performed),
        retrieval_used: Boolean(result.retrieval_used),
        insufficient_knowledge: Boolean(result.insufficient_knowledge),
        recovery_required: Boolean(result.recovery_required),
        application_mode_active: Boolean(result.application_mode_active),
        conversation_paused: Boolean(result.conversation_paused),
        conversation_resumed: Boolean(result.conversation_resumed),
        model: result.model || null,
        sources: (result.knowledge_sources_used || []).map((source) => ({
          type: source.type || null,
          source_id: source.source_id || null,
          title: source.title || null,
          heading: source.heading || null,
          category: source.category || source.product || null,
          matched_terms: source.matched_terms || [],
        })),
        reply_excerpt: String(result.reply || "").slice(0, 400),
      });

      messages = [...messages, { role: "user", content: message }, { role: "assistant", content: result.reply || "" }];
      rememberedFacts = result.remembered_facts || rememberedFacts;
      journeyState = result;
    }
  }

  marker("LIVE_HEALTH_FIVE_DIAGNOSTIC_COMPLETE", {
    scenarios: TARGETS.length,
    openai_calls: 0,
    database_writes: 0,
  });
}

main().catch((error) => {
  console.error("LIVE_HEALTH_FIVE_DIAGNOSTIC_FATAL", JSON.stringify({
    name: error?.name || "Error",
    message: error?.message || String(error),
    stack: error?.stack || null,
  }));
  process.exitCode = 1;
});
