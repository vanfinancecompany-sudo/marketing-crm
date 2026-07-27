import test from "node:test";
import assert from "node:assert/strict";
import { evaluatePublishingSafety, assertPublishingSafe } from "../lib/publishingSafety.js";
import { evaluateRent2BuyRule, RENT2BUY_SEPARATION_SENTENCE, RENT2BUY_COLLECTION_SENTENCE, validateMarkdownStructure, validateRent2BuySemantics, withPermanentRent2BuyKnowledge } from "../lib/rent2BuyRules.js";
import { buildCorrectionPreview, buildSafetyCorrectionPrompt } from "../lib/publishingCorrections.js";
const filler="Customers should review the agreement carefully and make sure the arrangement suits their circumstances before proceeding. ".repeat(24);
const rent2buy=(content,overrides={})=>({id:"r2b",title:"Rent2Buy vans",category:"Rent2Buy",status:"draft",content_markdown:content,content_html:"<p>Clean output</p>",faq_json:[],cta:"Apply for Rent2Buy",...overrides});
const finance=(content)=>({id:"fin",title:"Van finance guide",category:"Van Finance",status:"draft",content_markdown:content,content_html:"<p>Clean output</p>",faq_json:[],cta:"View finance vans"});
const approved=`## How Rent2Buy works\n\n${RENT2BUY_SEPARATION_SENTENCE}\n\nRent2Buy has its own eligibility process and agreement terms.\n\n## Collection\n\n${RENT2BUY_COLLECTION_SENTENCE}\n\n${filler}`;

for (const [label,content] of [
  ["introduction","If you are concerned about traditional finance options, read on."],
  ["body paragraph","This route differs from finance agreements and lender panels."],
  ["bullet","- New to finance\n- Review eligibility"],
  ["summary","In summary, unlike traditional finance, this route may suit you."],
]) test(`finance wording is detected in the ${label}`,()=>{const result=validateRent2BuySemantics(rent2buy(`${approved}\n\n## Extra\n\n${content}`));assert.equal(result.rent2buy_semantic_valid,false);assert.ok(result.rent2buy_semantic_errors.some((item)=>item.category==="finance"));});

test("trial wording is detected across sections",()=>{const article=rent2buy(`${approved}\n\n## Vehicle details\n\nYou can test if the van meets your requirements before buying.\n\n- Decide after trying it`);const result=validateRent2BuySemantics(article);assert.equal(result.rent2buy_semantic_valid,false);assert.ok(result.rent2buy_semantic_errors.every((item)=>item.section));assert.ok(result.rent2buy_semantic_errors.some((item)=>item.category==="trial"));});

test("negative delivery wording is detected",()=>{const result=validateRent2BuySemantics(rent2buy(`${approved}\n\nDelivery is unavailable and there are no delivery options.`));assert.equal(result.rent2buy_semantic_valid,false);assert.ok(result.prohibited_terms_remaining.some((item)=>/delivery/i.test(item)));});

test("close semantic variations are detected, not only exact phrases",()=>{const result=validateRent2BuySemantics(rent2buy(`${approved}\n\nTraditional finance barriers and lease finance may concern some readers.`));assert.equal(result.rent2buy_semantic_valid,false);assert.ok(result.rent2buy_semantic_errors.some((item)=>/traditional finance barriers/i.test(item.phrase)));assert.ok(result.rent2buy_semantic_errors.some((item)=>/lease finance/i.test(item.phrase)));});

test("location-aware semantic errors include phrase section category and excerpt",()=>{const result=validateRent2BuySemantics(rent2buy(`${approved}\n\n## Eligibility\n\nA finance application is not required.`));const error=result.rent2buy_semantic_errors.find((item)=>/finance application/i.test(item.phrase));assert.equal(error.section,"Eligibility");assert.equal(error.category,"finance");assert.match(error.excerpt,/finance application/i);});

test("safe replacement language and required facts pass",()=>{const content=`## Introduction\n\nIf you are looking for a different route to van ownership, Rent2Buy may suit your circumstances.\n\n${RENT2BUY_SEPARATION_SENTENCE}\n\n## Eligibility\n\nRent2Buy has its own eligibility process and agreement terms.\n\n## Vehicle review\n\nYou should review the vehicle details and agreement terms carefully before proceeding.\n\n## Collection\n\n${RENT2BUY_COLLECTION_SENTENCE}\n\n${filler}`;const result=evaluateRent2BuyRule(rent2buy(content));assert.equal(result.passed,true);assert.equal(result.rent2buy_semantic_valid,true);});

test("exact Southampton collection sentence is preserved",()=>{assert.match(approved,new RegExp(`(?:^|\\n)${RENT2BUY_COLLECTION_SENTENCE.replace(".","\\.")}(?:\\n|$)`));assert.equal(evaluateRent2BuyRule(rent2buy(approved)).passed,true);});

test("full article passes only when no prohibited concepts remain",()=>{const unsafe=rent2buy(`${approved}\n\n## Summary\n\nTraditional finance options are not used.`);const preview=buildCorrectionPreview({originalArticle:unsafe,proposed:{...unsafe,changes:[],removed_links:[],manual_confirmation_required:[],removed_sections:[],removal_reasons:[],removed_section_word_counts:[]},safetyOptions:{ignoreAssessmentFreshness:true}});assert.equal(preview.rent2buy_semantic_valid,false);assert.equal(preview.correction_complete,false);assert.ok(preview.prohibited_terms_remaining.length>0);});

test("regeneration receives only unresolved semantic failures",()=>{const unsafe=rent2buy(`${approved}\n\n## Summary\n\nUnlike traditional finance, delivery is unavailable.`);const preview=buildCorrectionPreview({originalArticle:unsafe,proposed:{...unsafe,changes:[],removed_links:[],manual_confirmation_required:[],removed_sections:[],removal_reasons:[],removed_section_word_counts:[]},safetyOptions:{ignoreAssessmentFreshness:true}});const semanticReasons=preview.unresolved_reasons.filter((item)=>typeof item==="object"&&item.type==="rent2buy_semantic_failure");assert.ok(semanticReasons.length>=2);const prompt=buildSafetyCorrectionPrompt({article:unsafe,safety:preview.safety_after,unresolvedReasons:semanticReasons});assert.match(prompt,/rent2buy_semantic_failure/);assert.doesNotMatch(prompt,/Large unexplained content reduction/);});

test("rewritten prohibited wording does not count as unexplained removal",()=>{const original=rent2buy(`${approved}\n\n## Eligibility\n\nRent2Buy is available without the usual credit checks associated with finance agreements.`);const proposed={...original,content_markdown:`${approved}\n\n## Eligibility\n\nRent2Buy has its own eligibility process and agreement terms.`,changes:["Rewrote prohibited wording"],removed_links:[],manual_confirmation_required:[],removed_sections:[],removal_reasons:[],removed_section_word_counts:[]};const preview=buildCorrectionPreview({originalArticle:original,proposed,safetyOptions:{ignoreAssessmentFreshness:true}});assert.equal(preview.rent2buy_semantic_valid,true);assert.ok(preview.unexplained_content_loss_percent<=20);});

test("whole prohibited sections count as valid removed words",()=>{const comparison="APR lenders finance agreements. ".repeat(35);const original=rent2buy(`${approved}\n\n## How Rent2Buy compares to traditional finance\n\n${comparison}`);const proposed={...original,content_markdown:approved,changes:["Removed finance comparison"],removed_links:[],manual_confirmation_required:[],removed_sections:["How Rent2Buy compares to traditional finance"],removal_reasons:["finance comparison section"],removed_section_word_counts:[comparison.trim().split(/\s+/).length+7]};const preview=buildCorrectionPreview({originalArticle:original,proposed,safetyOptions:{ignoreAssessmentFreshness:true}});assert.ok(preview.valid_removed_word_count>0);assert.ok(preview.unexplained_content_loss_percent<=20);});

test("Markdown structure remains valid",()=>{const markdown=`## Benefits\n\n- One\n- Two\n\n## Practical Next Steps\n\n1. Apply\n2. Review eligibility\n3. Collect\n\n---\n\n${RENT2BUY_COLLECTION_SENTENCE}`;assert.equal(validateMarkdownStructure(markdown,"").markdown_structure_valid,true);});

test("Van Finance remains unaffected",()=>assert.equal(evaluateRent2BuyRule(finance(`## Finance options\n\nHire Purchase, APR and lenders may be discussed.\n\n${filler}`)).applies,false));

test("original remains unchanged until acceptance and no Wix approval occurs",()=>{const original=rent2buy(approved);const snapshot=structuredClone(original);buildCorrectionPreview({originalArticle:original,proposed:{...original,changes:[],removed_links:[],manual_confirmation_required:[],removed_sections:[],removal_reasons:[],removed_section_word_counts:[]},safetyOptions:{ignoreAssessmentFreshness:true}});assert.deepEqual(original,snapshot);assert.equal(original.wix_sync_status,undefined);assert.notEqual(original.status,"approved");});

test("Wix export independently blocks prohibited Rent2Buy wording",()=>assert.throws(()=>assertPublishingSafe(rent2buy(`${approved}\n\nFinance agreements remain.`),{ignoreAssessmentFreshness:true}),/Rent2Buy/));

test("permanent rule preserves existing Business Knowledge",()=>{const sections=withPermanentRent2BuyKnowledge([{section_key:"compliance",title:"Compliance",active:true,entries:[{label:"Existing",value:"Keep this"}]}]);assert.equal(sections[0].entries.some((entry)=>entry.label==="Existing"),true);});
