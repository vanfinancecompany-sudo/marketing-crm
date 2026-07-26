# Knowledge Hub → Wix CMS Draft Publishing

PR107 adds a manual, server-side draft sync from an approved Knowledge Hub article to the
existing Wix CMS collection **Knowledge Hub Articles** (`Import3`).

It does not publish, schedule, approve or modify the live website. Wix remains the final review
and publication step.

## Wix collection

The Wix collection must keep Drafts enabled and new items must default to Draft.

| CRM value | Wix field ID | Wix type |
| --- | --- | --- |
| Article title | `title` | Text |
| Slug | `slug` | Text |
| Excerpt | `excerpt` | Text |
| Article body | `content` | Text or Rich Content (detected before every sync) |
| SEO title | `seoTitle` | Text |
| Meta description | `metaDescription` | Text |
| Category | `category` | Text |
| Featured image/reference | `featuredImage` | Image |
| CRM article ID | `crmArticleId` | Text |
| Sync status | `syncStatus` | Text |

Do not rename these fields. Adding a unique index to `crmArticleId` in Wix is recommended as a
second layer of duplicate protection.

## Vercel environment variables

Configure these as server-side variables for Preview and Production, then redeploy:

| Variable | Required | Value |
| --- | --- | --- |
| `WIX_API_KEY` | Yes | Wix API key with access to this site, permission to read/write CMS data items, and permission to read the CMS collection schema |
| `WIX_SITE_ID` | Yes | Wix site ID from the Wix dashboard URL |
| `WIX_KNOWLEDGE_COLLECTION_ID` | Yes | `Import3` |
| `WIX_KNOWLEDGE_DASHBOARD_URL` | No | Direct dashboard URL for the collection; a standard Wix dashboard URL is generated when omitted |
| `WIX_API_BASE_URL` | No | Override for isolated development tests; defaults to `https://www.wixapis.com` |

Only an account owner or co-owner can create a Wix API key. Create it in Wix API Keys Manager,
limit it to the Van Finance Company site, and grant only the CMS data permissions required to
query, insert and update collection items. The key must also allow **Get Data Collection**
(`WIX_DATA.GET_COLLECTION`; shown as **Manage Data Collections** in Wix) so the server can safely
detect the `content` field type. Never prefix these variables with `VITE_`.

The browser receives item IDs and safe status information only. It never receives the Wix API
key, Supabase service-role key or Wix authentication headers.

## User workflow

1. Save and approve the Knowledge Hub article.
2. Review internal-link suggestions. Only links marked **Accepted** are included.
3. Open the approved article and select **Create Wix Draft**.
4. Review the title, slug, SEO fields, article status, internal-link status and destination.
5. Confirm the action.
6. Open the returned Wix item and complete the Wix review manually.

If `wix_item_id` is already stored, the button becomes **Update Wix Draft**. The existing item is
updated; a second item is not created.

If the CRM ID was not saved after an interrupted request, the service queries Wix by
`crmArticleId`, then by slug, before creating anything. A conflicting slug produces a validation
error instead of overwriting another item.

## Payload and formatting

- Before every create or update, the server reads the `Import3` collection schema and detects
  whether `content` is a Text or Rich Content field.
- For Rich Content, article Markdown is converted to Wix Rich Content nodes.
- For Text, the body is sent as readable formatted plain text. Headings, paragraph spacing and
  bullet lists are preserved; accepted links use `Anchor text (URL)` so their destination remains
  visible without relying on unsupported Rich Content JSON.
- Any missing or unsupported `content` field type stops the sync with a configuration error.
- Headings and paragraphs remain structured where the Wix field supports structure.
- The CTA is appended as a reviewable “Next step” section.
- Accepted internal links are inserted as linked rich-text spans.
- Rejected, pending and superseded link suggestions are excluded.
- `featured_image` is transferred unchanged to `featuredImage`. Prefer a Wix image reference such
  as `wix:image://v1/...`; an HTTPS reference may be used when the collection accepts it.
- `syncStatus` is set to `Draft` in Wix.

## Stored CRM result

Successful syncs update:

- `wix_item_id`
- `wix_collection_id`
- `wix_draft_url`
- `wix_sync_status`
- `last_wix_sync_at`
- `wix_payload_version`
- `wix_last_error`

A system editorial event records whether the draft was created or updated. Creating a draft does
not set `live_wix_url`, `published_at` or `publication_verified_at`.

Failures store a safe error and set `wix_sync_status` to `error`. The editor displays whether the
failure is configuration, authentication, validation or Wix API related and provides Retry.

## What remains manual

- Reviewing the item in Wix
- Publishing the Wix item
- Confirming the final live URL and publication timestamp in AI Visibility
- Any future update to an already published page

After Wix publication, use **AI Visibility → Confirm Published Page** to record the verified live
URL. A draft sync alone never activates monitoring or claims that an article is public.
