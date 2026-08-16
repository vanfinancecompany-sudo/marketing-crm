import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { markdownToKnowledgeHtml, calculateKnowledgeQualityChecks } from "../lib/knowledgeHub.js";
import { publishKnowledgeArticleToWix } from "./marketing-wix-publishing.js";

const TOKEN_HASH = "741ed9ba257d7aba5bf3414bf8b0942545e79ba68adce21c53f81c79b5411538";
const MARKETING_PROJECT_ID = "prj_UA8X61RmObkTDVp8cCkZ5X4oPlHl";
const TRANSIT_OPPORTUNITY_ID = "7260bfbb-19c1-4750-a98a-9e761b4d0108";
const TRANSIT_DRAFT_ID = "f02f7e40-7476-446d-89c0-7f1610c2a812";
const CREDIT_OPPORTUNITY_ID = "3ca57f3d-4a1e-4223-ab81-2d2714f35d14";
const CREDIT_DUPLICATE_DRAFT_ID = "5c8659ad-f5d0-42f0-b9fb-7202da78002b";
const CREDIT_CANONICAL_ID = "7bdb2e7b-26e4-4b4e-9c2e-0b6141528dc8";

const CREDIT_CONTENT = `# Van Finance for Bad Credit: What Options Are Available in the UK?

If you have poor credit, bad credit or a County Court Judgment (CCJ), you may still be able to apply for van finance. A previous credit problem does not automatically mean every lender will decline you.

Van Finance Company arranges finance through a panel of UK lenders. Each lender uses its own criteria, so every application is assessed individually. Approval is never guaranteed and will normally depend on credit checks, affordability, your current circumstances and the vehicle you want to buy.

## Can I Get Van Finance with Bad Credit?

Possibly. Lenders do not all assess credit history in exactly the same way. A lender may consider the overall application rather than one credit score or one past event in isolation.

Factors that may affect the decision include:

- Your current income and affordability
- Existing financial commitments
- Recent payment history
- Defaults, missed payments or CCJs
- How recent any credit problems are
- Whether a CCJ or other debt has been satisfied
- Employment or trading circumstances
- The price and age of the van
- The amount you need to borrow
- Any deposit available, where relevant

A stronger factor in one area does not guarantee approval, and a problem in one area does not always mean automatic rejection.

## Can I Apply for Van Finance with a CCJ?

Yes, you can still apply if you have a CCJ. The presence of a CCJ can affect which lenders are available and the terms they are prepared to offer, but it does not create one universal yes-or-no rule.

A lender may look at the age, value and status of the CCJ alongside your more recent financial behaviour and present affordability. If the lender asks for information about it, provide accurate details rather than trying to leave it out of the application.

Being open about your circumstances gives the application the best chance of being assessed on the correct information.

## Does a Satisfied CCJ Make a Difference?

It can be relevant, but there is no fixed rule that applies to every lender. A lender may take account of whether a CCJ has been satisfied, how long ago it was registered and what your finances look like now.

A satisfied CCJ does not guarantee acceptance, just as an unsatisfied CCJ does not automatically mean that every possible application will be declined. The complete application still matters.

## Is It Still Worth Applying If I Have Poor Credit?

If you genuinely need a van and believe the repayments would be affordable, it can still be worth exploring your options.

The useful question is not simply whether your credit is perfect. It is whether there is a lender whose criteria fit your current circumstances, affordability and chosen vehicle.

Van Finance Company can review the information you provide and submit an application where an appropriate lender route is available. That does not mean approval is certain, but it avoids treating past credit problems as an automatic dead end.

## I’m Self-Employed and Have Bad Credit. Can I Apply?

Yes. Self-employed people, sole traders and company directors can apply for van finance, including where there have been previous credit difficulties.

The lender may want a clearer picture of current trading and affordability. Depending on the application, this can include information such as recent bank statements, tax or accounting evidence, business details or proof of income.

There is no single document list or minimum trading period that applies to every lender.

## What If I Have Only Been Trading for a Short Time?

A short trading history does not automatically prevent an application. It may reduce the number of lenders whose criteria fit, or mean that additional evidence is needed.

For a newer business, a lender may pay particular attention to:

- Recent income and bank activity
- Existing business and personal commitments
- Previous experience in the same trade
- Current contracts or invoices, where requested
- The affordability of the proposed monthly payment
- The vehicle price and amount being financed

If you have only been trading for six months, for example, it may still be worth discussing the application rather than assuming that finance is impossible.

## Will Bad Credit Mean a Higher Rate or Deposit?

It can affect the terms available, but there is no fixed bad-credit rate or deposit that applies to everybody.

Depending on the lender and application, previous credit difficulties may affect:

- The interest rate
- The deposit requested
- The amount a lender is prepared to finance
- The agreement term
- Which vehicles fit the lender’s criteria
- Whether additional documents are needed

You should judge any offer using the actual quotation, including the monthly payment and total amount payable, rather than relying on a generic advertised rate.

## What Can I Do Before Applying?

A few practical checks can make the application easier to assess:

1. Check that the information on your credit reports is accurate.
2. Use realistic income and expenditure figures.
3. Be clear about existing commitments and previous credit issues.
4. Choose a van and monthly budget that appear affordable.
5. Have supporting documents available if a lender requests them.
6. Read the exact quotation and agreement before committing.

Avoid making assumptions about approval based on one previous decline or one credit-score number. Different lenders can have different criteria, but repeated applications should still be considered carefully rather than submitted at random.

## Does Van Finance Company Guarantee Bad-Credit Finance?

No. Van Finance Company is a credit broker, not a lender, and cannot guarantee acceptance, a particular rate, deposit or monthly payment.

Every application remains subject to the lender’s criteria, credit checks, affordability assessment and final approval.

## Frequently Asked Questions

### Can I get van finance if I have bad credit?

It may be possible. Poor credit does not automatically prevent an application, but approval and terms depend on the lender, affordability, current circumstances and vehicle.

### Can I apply if I have a CCJ?

Yes. Some applications with CCJs can still be considered. The age, status and value of the CCJ may be relevant, alongside the rest of your credit profile and affordability.

### Is a satisfied CCJ better for my application?

It may be taken into account, but there is no universal lender rule and it does not guarantee approval.

### Can self-employed customers with poor credit apply?

Yes. The lender may request evidence of current income, trading and affordability, depending on the application.

### I have only been trading for six months. Is it worth applying?

It can be. A short trading history may limit lender choice or require more evidence, but it is not an automatic rejection across every lender.

### Will bad credit always mean a bigger deposit or higher rate?

Not always. Credit history can influence the terms available, but the exact deposit, rate and agreement depend on the lender and complete application.

### Is approval guaranteed?

No. All applications are subject to lender criteria, credit checks, affordability and approval.

## Next Step

If you need a van and want to understand whether your current circumstances may fit one of our lenders, view the available vans and apply when you are ready. The team can then assess the application using your actual circumstances rather than a generic credit-score assumption.`;

const CREDIT_FAQ = [
  { question: "Can I get van finance if I have bad credit?", answer: "It may be possible. Poor credit does not automatically prevent an application, but approval and terms depend on the lender, affordability, current circumstances and vehicle." },
  { question: "Can I apply for van finance if I have a CCJ?", answer: "Yes. Some applications with CCJs can still be considered. The age, status and value of the CCJ may be relevant alongside the rest of your credit profile and affordability." },
  { question: "Does a satisfied CCJ improve my chances?", answer: "It may be relevant to a lender's assessment, but there is no universal rule and a satisfied CCJ does not guarantee approval." },
  { question: "Can self-employed customers with poor credit apply?", answer: "Yes. A lender may request evidence of current income, trading and affordability depending on the application." },
  { question: "I have only been trading for six months. Is it worth applying?", answer: "It can be. A short trading history may limit lender choice or require more evidence, but it is not an automatic rejection across every lender." },
  { question: "Will bad credit always mean a larger deposit or higher rate?", answer: "Not always. Credit history can influence the terms available, but the exact deposit, rate and agreement depend on the lender and complete application." },
  { question: "Is bad-credit van finance guaranteed?", answer: "No. All applications are subject to lender criteria, credit checks, affordability and approval." },
];

function authorised(request) {
  const token = String(request.query?.token || "");
  if (!token) return false;
  const digest = crypto.createHash("sha256").update(token).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(TOKEN_HASH));
}

function getSupabase() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("Supabase is not configured.");
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}

function assertExact(record, expectedStatus, label) {
  if (!record) throw new Error(`${label} was not found.`);
  if (record.status !== expectedStatus) throw new Error(`${label} status changed; expected ${expectedStatus}, found ${record.status}.`);
}

async function insertEvent(supabase, payload) {
  const { error } = await supabase.from("knowledge_assistant_opportunity_events").insert(payload);
  if (error) throw error;
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  if (request.method !== "GET") return response.status(405).json({ ok: false, message: "Method not allowed." });
  if (!authorised(request)) return response.status(401).json({ ok: false, message: "Unauthorised." });
  if (process.env.VERCEL_ENV !== "production" || process.env.VERCEL_GIT_COMMIT_REF !== "main") return response.status(403).json({ ok: false, message: "Production main only." });
  if (process.env.VERCEL_PROJECT_ID && process.env.VERCEL_PROJECT_ID !== MARKETING_PROJECT_ID) return response.status(403).json({ ok: false, message: "Wrong project." });

  const supabase = getSupabase();
  const now = new Date().toISOString();
  try {
    const ids = [TRANSIT_DRAFT_ID, CREDIT_DUPLICATE_DRAFT_ID, CREDIT_CANONICAL_ID];
    const { data: articles, error: articleLoadError } = await supabase.from("knowledge_articles").select("*").in("id", ids);
    if (articleLoadError) throw articleLoadError;
    const byId = new Map((articles || []).map((article) => [article.id, article]));
    const transitDraft = byId.get(TRANSIT_DRAFT_ID);
    const creditDuplicate = byId.get(CREDIT_DUPLICATE_DRAFT_ID);
    const canonical = byId.get(CREDIT_CANONICAL_ID);
    assertExact(transitDraft, "draft", "Transit duplicate draft");
    assertExact(creditDuplicate, "draft", "Credit duplicate draft");
    assertExact(canonical, "approved", "Canonical bad-credit article");

    const { data: opportunities, error: opportunityLoadError } = await supabase.from("knowledge_assistant_opportunities").select("*").in("id", [TRANSIT_OPPORTUNITY_ID, CREDIT_OPPORTUNITY_ID]);
    if (opportunityLoadError) throw opportunityLoadError;
    const opportunityById = new Map((opportunities || []).map((item) => [item.id, item]));
    const transitOpportunity = opportunityById.get(TRANSIT_OPPORTUNITY_ID);
    const creditOpportunity = opportunityById.get(CREDIT_OPPORTUNITY_ID);
    assertExact(transitOpportunity, "draft_created", "Transit opportunity");
    assertExact(creditOpportunity, "draft_created", "Credit opportunity");

    const { error: transitArchiveError } = await supabase.from("knowledge_articles").update({ status: "archived", updated_at: now }).eq("id", TRANSIT_DRAFT_ID).eq("status", "draft");
    if (transitArchiveError) throw transitArchiveError;
    const transitReason = "Customer evidence is primarily stock and vehicle-choice conversation rather than a distinct evergreen content gap. Existing vehicle guides and live stock context cover the intent, so the overlapping generated draft was archived.";
    const { data: savedTransitOpportunity, error: transitOpportunityError } = await supabase.from("knowledge_assistant_opportunities").update({ status: "no_action_required", no_action_at: now, closed_at: now, closure_reason: transitReason, updated_at: now }).eq("id", TRANSIT_OPPORTUNITY_ID).eq("status", "draft_created").select().single();
    if (transitOpportunityError) throw transitOpportunityError;
    await insertEvent(supabase, { opportunity_id: TRANSIT_OPPORTUNITY_ID, event_type: "status_changed", from_status: "draft_created", to_status: "no_action_required", user_action: "Knowledge Opportunity consolidation", notes: transitReason, linked_article_id: TRANSIT_DRAFT_ID, details: { manual: true, duplicate_draft_archived: true, wix_calls: 0, publishing_actions: 0 } });

    const updatedCanonical = {
      title: "Van Finance for Bad Credit: What Options Are Available in the UK?",
      seo_title: "Bad Credit Van Finance & CCJs: Can You Still Apply?",
      meta_description: "Poor credit or a CCJ does not automatically rule out van finance. See what lenders may assess, what can affect terms, and when applying may still be worthwhile.",
      excerpt: "Poor credit, CCJs or a short trading history do not automatically rule out van finance. See what lenders may assess and when applying can still be worthwhile.",
      content_markdown: CREDIT_CONTENT,
      content_html: markdownToKnowledgeHtml(CREDIT_CONTENT),
      faq_json: CREDIT_FAQ,
      cta: "View available vans and apply when you are ready to explore the finance options available for your circumstances.",
      updated_at: now,
    };
    updatedCanonical.quality_checks = calculateKnowledgeQualityChecks({ ...canonical, ...updatedCanonical }, 1000);
    const { data: savedCanonical, error: canonicalUpdateError } = await supabase.from("knowledge_articles").update(updatedCanonical).eq("id", CREDIT_CANONICAL_ID).eq("status", "approved").select().single();
    if (canonicalUpdateError) throw canonicalUpdateError;

    const { error: creditArchiveError } = await supabase.from("knowledge_articles").update({ status: "archived", updated_at: now }).eq("id", CREDIT_DUPLICATE_DRAFT_ID).eq("status", "draft");
    if (creditArchiveError) throw creditArchiveError;
    const creditReason = "Genuine customer and Search Console demand is already served by the existing live bad-credit article. The canonical article was strengthened around poor credit, CCJs, short trading history and whether applying is still worthwhile; the overlapping generated draft was archived to avoid cannibalisation.";
    const { data: savedCreditOpportunity, error: creditOpportunityError } = await supabase.from("knowledge_assistant_opportunities").update({ status: "resolved", linked_article_id: CREDIT_CANONICAL_ID, resolved_at: now, closure_reason: creditReason, updated_at: now }).eq("id", CREDIT_OPPORTUNITY_ID).eq("status", "draft_created").select().single();
    if (creditOpportunityError) throw creditOpportunityError;
    await insertEvent(supabase, { opportunity_id: CREDIT_OPPORTUNITY_ID, event_type: "article_linked_and_resolved", from_status: "draft_created", to_status: "resolved", user_action: "Knowledge Opportunity consolidation", notes: creditReason, linked_article_id: CREDIT_CANONICAL_ID, details: { manual: true, existing_article_improved: true, duplicate_draft_archived: true, automatic_publication: false } });

    const wixResult = await publishKnowledgeArticleToWix({ supabase, articleId: CREDIT_CANONICAL_ID });

    return response.status(200).json({
      ok: true,
      transit: { opportunity_id: savedTransitOpportunity.id, status: savedTransitOpportunity.status, archived_draft_id: TRANSIT_DRAFT_ID },
      credit: { opportunity_id: savedCreditOpportunity.id, status: savedCreditOpportunity.status, canonical_article: { id: savedCanonical.id, title: savedCanonical.title, slug: savedCanonical.slug, status: savedCanonical.status, quality_checks: savedCanonical.quality_checks }, archived_duplicate_draft_id: CREDIT_DUPLICATE_DRAFT_ID, wix: wixResult.wix },
      safeguards: { exact_ids_only: true, wix_publication: false, approval_actions: 0, live_publish_actions: 0 },
    });
  } catch (error) {
    return response.status(500).json({ ok: false, message: error.message || "Consolidation failed." });
  }
}
