-- Knowledge Hub V2 Content Intelligence. Additive only; V1 and unrelated CRM data remain intact.

alter table public.knowledge_topics
  add column if not exists priority smallint not null default 3
    check (priority between 1 and 5),
  add column if not exists source text not null default 'manual',
  add column if not exists finder_metadata jsonb not null default '{}'::jsonb;

alter table public.knowledge_settings
  add column if not exists business_description text,
  add column if not exists products_services text,
  add column if not exists factual_guidance text,
  add column if not exists prohibited_claims text,
  add column if not exists target_audiences text[] not null default '{}',
  add column if not exists content_goals text[] not null default '{}',
  add column if not exists freshness_days integer not null default 180
    check (freshness_days between 30 and 730);

create index if not exists knowledge_topics_priority_status_idx
  on public.knowledge_topics (priority desc, status);

-- Keep every V1 template. Upgrade five existing templates with specialist instructions and
-- add a dedicated Vehicle Review template while leaving Vehicle Guide and Checklist available.
insert into public.knowledge_templates
  (name, key, description, prompt, default_tone, default_audience, active)
values
  (
    'Finance specialist',
    'finance-guide',
    'Explain UK van-finance subjects clearly without making credit or rate promises.',
    'Act as a careful UK van-finance content specialist. Answer the customer intent directly, explain relevant options and practical preparation, distinguish general guidance from lender-specific decisions, and flag any business-specific or regulatory statement that needs confirmation. Never promise acceptance, rates, repayments or outcomes.',
    'Professional, reassuring and plain English',
    'UK van buyers considering finance',
    true
  ),
  (
    'Rent2Buy specialist',
    'rent2buy-guide',
    'Explain Rent2Buy clearly using only confirmed business guidance.',
    'Act as a Rent2Buy content specialist. Explain the customer journey, suitability considerations and practical next steps using the supplied Business Settings as the only source for scheme-specific facts. Mark any missing term, payment, mileage, eligibility or ownership detail for review instead of inventing it.',
    'Supportive, direct and factual',
    'Customers considering Rent2Buy',
    true
  ),
  (
    'Buying Guide specialist',
    'buying-guide',
    'Help customers choose a suitable van using practical trade-offs.',
    'Act as a practical van buying-guide specialist. Structure the article around customer needs, payload, dimensions, driving use, operating considerations and decision trade-offs. Do not invent stock, price, specification or availability. Clearly distinguish general checks from model-specific facts that require review.',
    'Helpful and impartial',
    'UK van buyers and trades',
    true
  ),
  (
    'Comparison specialist',
    'comparison',
    'Compare products or vehicles fairly using explicit criteria.',
    'Act as a balanced comparison specialist. Compare the named options against consistent, relevant criteria; explain who each option may suit; show trade-offs; and avoid declaring a universal winner. Do not invent specifications, prices, rates, stock or scheme terms. Mark uncertain facts for review.',
    'Balanced and factual',
    'Customers comparing finance, schemes or vans',
    true
  ),
  (
    'FAQ specialist',
    'faq',
    'Answer a customer question directly and support it with concise FAQs.',
    'Act as a customer FAQ specialist. Give a direct plain-English answer first, then add concise supporting sections and useful FAQ entries. Use only confirmed Business Settings for company-specific claims and mark uncertainty for review. Avoid filler and repeated keyword variants.',
    'Clear, concise and reassuring',
    'UK van buyers',
    true
  ),
  (
    'Vehicle Review specialist',
    'vehicle-review',
    'Create a balanced vehicle review without inventing specifications or stock.',
    'Act as a balanced commercial-vehicle reviewer. Explain likely use cases, strengths, compromises and the checks a buyer should make. Only state specifications supplied in the topic or Business Settings; otherwise use neutral language or mark the detail for review. Never invent stock, condition, mileage, price or availability.',
    'Knowledgeable, balanced and practical',
    'Van buyers and trades',
    true
  )
on conflict (key) do update set
  name = excluded.name,
  description = excluded.description,
  prompt = excluded.prompt,
  default_tone = excluded.default_tone,
  default_audience = excluded.default_audience,
  active = true,
  updated_at = now();

update public.knowledge_settings
set
  business_description = coalesce(
    business_description,
    'Van Finance Company helps UK customers find suitable vans and understand available acquisition options.'
  ),
  target_audiences = case
    when cardinality(target_audiences) = 0
      then array['UK van buyers', 'Self-employed customers', 'Limited companies', 'Trades']
    else target_audiences
  end,
  content_goals = case
    when cardinality(content_goals) = 0
      then array['Answer real customer questions', 'Build useful coverage without keyword spam']
    else content_goals
  end,
  prohibited_claims = coalesce(
    prohibited_claims,
    'Do not promise approval, guaranteed rates, vehicle availability, prices, legal outcomes or unconfirmed business terms.'
  ),
  freshness_days = coalesce(freshness_days, 180),
  updated_at = now()
where settings_key = 'default';
