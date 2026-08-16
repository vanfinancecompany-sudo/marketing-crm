import { createClient } from "@supabase/supabase-js";
import {
  calculateKnowledgeQualityChecks,
  markdownToKnowledgeHtml,
  validateKnowledgeArticle,
} from "../lib/knowledgeHub.js";

const TARGET_PROJECT_ID = "prj_zD76dAe2MHZdBTO08GNFSqOb9UHf";
const TARGET_ARTICLE_ID = "f6d1b83f-0b7e-4df9-a40c-b73e442fd96a";

const TITLE = "Rent2Buy Application: What Happens Next?";
const SEO_TITLE = "Rent2Buy Application: What Happens Next?";
const META_DESCRIPTION =
  "See how a Rent2Buy application works, how affordability is assessed without a credit check, and what the team confirms before Southampton collection.";
const EXCERPT =
  "Ready to apply for Rent2Buy? Learn how the application is assessed, what happens next, and which details the team will confirm for your van.";
const CTA = "View available Rent2Buy vans or use APPLY NOW to start your application.";

const CONTENT_MARKDOWN = `# Rent2Buy Application: What Happens Next?

If you are thinking about Rent2Buy and want to know what happens when you are ready to apply, the most important thing is to separate the confirmed process from details that can vary between customers and vehicles.

Rent2Buy is a separate rent-to-own arrangement and is not a finance product.

There is no credit check. Instead, the application is assessed using affordability and the required supporting documents. The exact requirements can depend on your circumstances and the vehicle you are interested in, so the team will confirm what is needed for your application rather than relying on a generic fixed checklist.

## How do I start a Rent2Buy application?

Use the APPLY NOW option on the Rent2Buy website when you are ready to begin. Provide accurate information so the team can review your application and tell you what they need next.

You do not need to guess which documents, deposit amount, agreement length or other fixed terms apply. Those details should be confirmed for your own application and chosen vehicle.

## What happens after I apply?

The process is straightforward, but some stages depend on your circumstances.

1. **Your application is reviewed.** The team checks the information you have provided and assesses affordability rather than carrying out a credit check.
2. **Any required documents are confirmed.** The team will tell you which supporting documents are needed for your application. This avoids relying on an outdated or one-size-fits-all document list.
3. **Your location is checked.** Rent2Buy applicants normally need to be within 100 miles of Southampton. If you are unsure, provide your home postcode and the team can check the area for you.
4. **Vehicle-specific details are confirmed.** If your application can proceed, the team will confirm the current requirements and the rental details that apply to the van you are considering.
5. **Collection arrangements are confirmed.** Collection only from Southampton.

There is no need to work from a promised decision time. The time taken can depend on the information and documents required for the individual application, so the team will confirm progress once they have what they need.

## What if my income varies or my circumstances are unusual?

If your income changes from month to month, you are self-employed, or your circumstances do not fit a simple example, do not assume that a generic online checklist tells you exactly what will be required.

Start the application or speak to the team and they can confirm the current affordability evidence and supporting information needed for your circumstances. This is more reliable than publishing a fixed list that may not apply to every customer.

## Do I need to choose a van before applying?

You can view the current Rent2Buy vans before you apply so you have an idea of the type of vehicle you need. If you already have a particular van in mind, include that when you contact the team.

Any vehicle-specific rental amounts, initial payment requirements, term, mileage conditions or other contractual details should be taken from the current information for that vehicle and the agreement you are offered. They should not be assumed from a general guide.

## Is Rent2Buy available everywhere in the UK?

Rent2Buy is not a nationwide collection product. Applicants normally need to be within 100 miles of Southampton, and the team can check your postcode if you are unsure whether your location fits the current criteria.

Collection only from Southampton.

## What should I have ready before I apply?

The most useful things to have ready are:

- your accurate personal or business details for the application;
- your home postcode so the location can be checked if needed;
- an idea of the type of van you need, or the specific van you are interested in;
- the ability to provide the supporting documents the team asks for during the affordability assessment.

The team will confirm the current requirement for your application and chosen vehicle. That includes any documents, payments, vehicle-specific rental terms or other details that should not be treated as fixed across every Rent2Buy application.

## What is the next step when I am ready?

If Rent2Buy looks suitable, view the available vans and use APPLY NOW to begin. The team can then check your application, confirm the required evidence, check your location where necessary and explain the next steps for the vehicle you want.

Rent2Buy is designed to keep the process separate from traditional vehicle finance. There is no credit check, but affordability and eligibility still need to be assessed before an application can proceed.`;

const FAQ_JSON = [
  {
    question: "Is there a credit check when I apply for Rent2Buy?",
    answer:
      "No. Rent2Buy does not use a credit check. The application is assessed using affordability and the required supporting documents instead.",
  },
  {
    question: "What documents do I need for a Rent2Buy application?",
    answer:
      "The exact supporting documents can depend on your circumstances. The team will confirm the current requirements for your application rather than relying on a fixed generic checklist.",
  },
  {
    question: "Do I need to live near Southampton for Rent2Buy?",
    answer:
      "Applicants normally need to be within 100 miles of Southampton. If you are unsure, provide your home postcode and the team can check the area for you.",
  },
  {
    question: "How long does a Rent2Buy application decision take?",
    answer:
      "There is no fixed decision-time promise in this guide. Timing can depend on the information and documents required, and the team will confirm progress for your application.",
  },
  {
    question: "What happens when my Rent2Buy application can proceed?",
    answer:
      "The team will confirm the current requirements and vehicle-specific rental details for the van you are considering, then explain the next steps. Collection only from Southampton.",
  },
];

function required(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function allowedRuntime() {
  return (
    process.env.VERCEL_ENV === "production" &&
    process.env.VERCEL_PROJECT_ID === TARGET_PROJECT_ID &&
    process.env.VERCEL_GIT_COMMIT_REF === "main"
  );
}

function getSupabase() {
  return createClient(required("SUPABASE_URL"), required("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export default async function handler(request, response) {
  if (request.method !== "GET") {
    return response.status(405).json({ ok: false, message: "Method not allowed." });
  }
  if (!allowedRuntime()) {
    return response.status(403).json({ ok: false, message: "Maintenance action unavailable here." });
  }

  try {
    const supabase = getSupabase();
    const existingResult = await supabase
      .from("knowledge_articles")
      .select("*")
      .eq("id", TARGET_ARTICLE_ID)
      .single();
    if (existingResult.error) throw existingResult.error;
    const existing = existingResult.data;
    if (!existing || existing.status !== "draft") {
      return response.status(409).json({
        ok: false,
        message: "Target article is missing or is no longer a draft.",
        status: existing?.status || null,
      });
    }

    const candidate = {
      ...existing,
      title: TITLE,
      seo_title: SEO_TITLE,
      meta_description: META_DESCRIPTION,
      excerpt: EXCERPT,
      content_markdown: CONTENT_MARKDOWN,
      content_html: markdownToKnowledgeHtml(CONTENT_MARKDOWN),
      faq_json: FAQ_JSON,
      cta: CTA,
      updated_at: new Date().toISOString(),
    };
    candidate.quality_checks = calculateKnowledgeQualityChecks(candidate);

    const validation = validateKnowledgeArticle(candidate);
    if (Object.keys(validation).length) {
      return response.status(400).json({ ok: false, message: "Corrected draft failed validation.", validation });
    }

    const update = {
      title: candidate.title,
      seo_title: candidate.seo_title,
      meta_description: candidate.meta_description,
      excerpt: candidate.excerpt,
      content_markdown: candidate.content_markdown,
      content_html: candidate.content_html,
      faq_json: candidate.faq_json,
      cta: candidate.cta,
      quality_checks: candidate.quality_checks,
      updated_at: candidate.updated_at,
    };

    const savedResult = await supabase
      .from("knowledge_articles")
      .update(update)
      .eq("id", TARGET_ARTICLE_ID)
      .eq("status", "draft")
      .select("id,title,slug,category,status,seo_title,meta_description,excerpt,content_markdown,faq_json,cta,quality_checks,updated_at,wix_sync_status,wix_publication_status,published_at")
      .single();
    if (savedResult.error) throw savedResult.error;

    return response.status(200).json({
      ok: true,
      corrected: true,
      article: savedResult.data,
      safeguards: {
        article_id: TARGET_ARTICLE_ID,
        status_required: "draft",
        wix_calls: 0,
        publishing_actions: 0,
        approval_actions: 0,
      },
    });
  } catch (error) {
    console.error("RENT2BUY DRAFT CORRECTION ERROR", {
      article_id: TARGET_ARTICLE_ID,
      message: error?.message || String(error),
    });
    return response.status(500).json({ ok: false, message: "Rent2Buy draft correction failed." });
  }
}
