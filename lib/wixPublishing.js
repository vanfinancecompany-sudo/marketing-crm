const DEFAULT_WIX_API_BASE_URL = "https://www.wixapis.com";
export const WIX_KNOWLEDGE_COLLECTION_ID = "Import3";
export const WIX_KNOWLEDGE_PAYLOAD_VERSION = "1";

const clean = (value, limit = 10000) => String(value || "").trim().slice(0, limit);

export class WixPublishingError extends Error {
  constructor(type, message, status = 400, details = {}) {
    super(message);
    this.name = "WixPublishingError";
    this.type = type;
    this.status = status;
    this.details = details;
  }
}

export function wixPublishingConfiguration(environment = process.env) {
  const apiKey = clean(environment.WIX_API_KEY, 10000);
  const siteId = clean(environment.WIX_SITE_ID, 500);
  const collectionId = clean(environment.WIX_KNOWLEDGE_COLLECTION_ID, 500);
  const missing = [
    !apiKey && "WIX_API_KEY",
    !siteId && "WIX_SITE_ID",
    !collectionId && "WIX_KNOWLEDGE_COLLECTION_ID",
  ].filter(Boolean);
  if (missing.length) {
    throw new WixPublishingError(
      "configuration",
      `Wix publishing is not configured. Missing ${missing.join(", ")}.`,
      500,
      { missing }
    );
  }
  if (collectionId !== WIX_KNOWLEDGE_COLLECTION_ID) {
    throw new WixPublishingError(
      "configuration",
      `WIX_KNOWLEDGE_COLLECTION_ID must be ${WIX_KNOWLEDGE_COLLECTION_ID}.`,
      500
    );
  }
  return {
    apiKey,
    siteId,
    collectionId,
    apiBaseUrl: clean(environment.WIX_API_BASE_URL, 1000) || DEFAULT_WIX_API_BASE_URL,
    dashboardUrl:
      clean(environment.WIX_KNOWLEDGE_DASHBOARD_URL, 2000) ||
      `https://manage.wix.com/dashboard/${encodeURIComponent(siteId)}/database/${encodeURIComponent(collectionId)}`,
  };
}

export function validateWixArticle(article = {}) {
  if (article.status !== "approved") {
    throw new WixPublishingError(
      "validation",
      "Only approved Knowledge Hub articles can be sent to Wix.",
      400
    );
  }
  const required = [
    ["title", "Article title"],
    ["slug", "Slug"],
    ["content_markdown", "Article body"],
    ["seo_title", "SEO title"],
    ["meta_description", "Meta description"],
  ];
  const missing = required.filter(([field]) => !clean(article[field])).map(([, label]) => label);
  if (!clean(article.id)) missing.push("CRM article ID");
  if (missing.length) {
    throw new WixPublishingError(
      "validation",
      `Complete these article fields before creating a Wix draft: ${missing.join(", ")}.`,
      400,
      { missing }
    );
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(clean(article.slug))) {
    throw new WixPublishingError(
      "validation",
      "The Wix slug must contain lowercase letters, numbers and hyphens only.",
      400
    );
  }
  return article;
}

export function acceptedInternalLinks(suggestions = []) {
  const seen = new Set();
  return (Array.isArray(suggestions) ? suggestions : [])
    .filter((item) => item?.status === "accepted")
    .map((item) => ({
      anchorText: clean(item.anchor_text, 200),
      url: clean(item.destination_url, 2000),
    }))
    .filter((item) => item.anchorText && /^(?:https:\/\/|\/(?!\/))/i.test(item.url))
    .filter((item) => {
      const key = item.url.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function applyAcceptedInternalLinks(markdown, suggestions = []) {
  let output = clean(markdown, 200000);
  const links = acceptedInternalLinks(suggestions);
  for (const link of links) {
    if (output.includes(`](${link.url})`)) continue;
    const expression = new RegExp(
      `(^|[^\\[])(${escapeRegExp(link.anchorText)})(?![^\\[]*\\]\\([^)]*\\))`,
      "im"
    );
    output = output.replace(expression, (_, prefix, anchor) => `${prefix}[${anchor}](${link.url})`);
  }
  return output;
}

function inlineNodes(value, nextId) {
  const text = String(value || "");
  const nodes = [];
  const linkPattern = /\[([^\]]+)\]\((https?:\/\/[^)\s]+|\/[^)\s]+)\)/g;
  let cursor = 0;
  let match;
  while ((match = linkPattern.exec(text))) {
    if (match.index > cursor) {
      nodes.push({
        type: "TEXT",
        id: nextId(),
        textData: { text: text.slice(cursor, match.index), decorations: [] },
      });
    }
    nodes.push({
      type: "TEXT",
      id: nextId(),
      textData: {
        text: match[1],
        decorations: [{
          type: "LINK",
          linkData: { link: { url: match[2] }, target: "BLANK" },
        }],
      },
    });
    cursor = linkPattern.lastIndex;
  }
  if (cursor < text.length || !nodes.length) {
    nodes.push({
      type: "TEXT",
      id: nextId(),
      textData: {
        text: text.slice(cursor)
          .replace(/\*\*([^*]+)\*\*/g, "$1")
          .replace(/\*([^*]+)\*/g, "$1"),
        decorations: [],
      },
    });
  }
  return nodes;
}

export function buildWixRichContent(markdown, suggestions = [], cta = "") {
  let sequence = 0;
  const nextId = () => `crm-${++sequence}`;
  const linkedMarkdown = applyAcceptedInternalLinks(markdown, suggestions);
  const blocks = linkedMarkdown
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);
  if (clean(cta) && !linkedMarkdown.includes(clean(cta))) {
    blocks.push(`## Next step\n${clean(cta, 2000)}`);
  }
  const nodes = [];
  for (const block of blocks) {
    const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
    for (const line of lines) {
      const heading = line.match(/^(#{1,6})\s+(.+)$/);
      const bullet = line.match(/^[-*]\s+(.+)$/);
      const text = heading?.[2] || bullet?.[1] || line;
      nodes.push({
        type: heading ? "HEADING" : "PARAGRAPH",
        id: nextId(),
        nodes: inlineNodes(bullet ? `• ${text}` : text, nextId),
        ...(heading
          ? {
              headingData: {
                level: Math.min(6, heading[1].length),
                textStyle: { textAlignment: "AUTO" },
                indentation: 0,
              },
            }
          : {
              paragraphData: {
                textStyle: { textAlignment: "AUTO" },
                indentation: 0,
              },
            }),
      });
    }
  }
  const now = new Date().toISOString();
  return {
    nodes,
    metadata: {
      version: 1,
      createdTimestamp: now,
      updatedTimestamp: now,
    },
  };
}

export function buildWixArticleData(article, suggestions = []) {
  validateWixArticle(article);
  return {
    title: clean(article.title, 500),
    slug: clean(article.slug, 500),
    excerpt: clean(article.excerpt, 3000),
    content: buildWixRichContent(article.content_markdown, suggestions, article.cta),
    seoTitle: clean(article.seo_title, 500),
    metaDescription: clean(article.meta_description, 1000),
    category: clean(article.category, 300),
    ...(clean(article.featured_image, 3000)
      ? { featuredImage: clean(article.featured_image, 3000) }
      : {}),
    crmArticleId: clean(article.id, 500),
    syncStatus: "Draft",
  };
}

function safeWixMessage(payload, status) {
  const message = clean(
    payload?.message ||
      payload?.details?.applicationError?.description ||
      payload?.details?.validationError?.fieldViolations?.[0]?.description,
    500
  );
  if (status === 401 || status === 403) return "Wix rejected the API credentials or site access.";
  if (status === 400) return message || "Wix rejected the article data.";
  return message || `Wix API request failed with status ${status}.`;
}

export class WixCmsClient {
  constructor(configuration, fetchImpl = fetch) {
    this.configuration = configuration;
    this.fetchImpl = fetchImpl;
  }

  async request(path, { method = "GET", body } = {}) {
    let response;
    try {
      response = await this.fetchImpl(`${this.configuration.apiBaseUrl}${path}`, {
        method,
        headers: {
          Authorization: this.configuration.apiKey,
          "wix-site-id": this.configuration.siteId,
          "Content-Type": "application/json",
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch {
      throw new WixPublishingError(
        "api",
        "Wix could not be reached. Check the deployment network and retry.",
        502
      );
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const type = [401, 403].includes(response.status)
        ? "authentication"
        : response.status === 400
          ? "validation"
          : "api";
      throw new WixPublishingError(
        type,
        safeWixMessage(payload, response.status),
        type === "authentication" ? 502 : response.status,
        { wix_status: response.status }
      );
    }
    return payload;
  }

  async find(field, value) {
    const payload = await this.request("/wix-data/v2/items/query", {
      method: "POST",
      body: {
        dataCollectionId: this.configuration.collectionId,
        query: { filter: { [field]: { $eq: value } }, paging: { limit: 2 } },
      },
    });
    return payload.dataItems || [];
  }

  async create(data, itemId) {
    const payload = await this.request("/wix-data/v2/items", {
      method: "POST",
      body: {
        dataCollectionId: this.configuration.collectionId,
        dataItem: { id: itemId, data },
      },
    });
    return payload.dataItem;
  }

  async update(itemId, data) {
    const payload = await this.request(`/wix-data/v2/items/${encodeURIComponent(itemId)}`, {
      method: "PUT",
      body: {
        dataCollectionId: this.configuration.collectionId,
        dataItem: { id: itemId, data },
      },
    });
    return payload.dataItem;
  }
}

export async function createOrUpdateWixDraft({
  article,
  suggestions = [],
  configuration,
  fetchImpl = fetch,
}) {
  const data = buildWixArticleData(article, suggestions);
  const client = new WixCmsClient(configuration, fetchImpl);
  let itemId = clean(article.wix_item_id, 500);
  let operation = itemId ? "updated" : "created";

  if (!itemId) {
    const crmMatches = await client.find("crmArticleId", article.id);
    if (crmMatches.length > 1) {
      throw new WixPublishingError(
        "validation",
        "Wix contains more than one item for this CRM article. Resolve the duplicates in Wix before retrying.",
        409
      );
    }
    itemId = clean(crmMatches[0]?.id, 500);
    if (itemId) operation = "updated";
  }

  if (!itemId) {
    const slugMatches = await client.find("slug", article.slug);
    const conflicting = slugMatches.find(
      (item) => clean(item?.data?.crmArticleId, 500) !== clean(article.id, 500)
    );
    if (conflicting) {
      throw new WixPublishingError(
        "validation",
        "That slug already belongs to another Wix item. Change the article slug before retrying.",
        409
      );
    }
    itemId = clean(slugMatches[0]?.id, 500);
    if (itemId) operation = "updated";
  }

  let item;
  if (itemId) {
    item = await client.update(itemId, data);
  } else {
    try {
      item = await client.create(data, article.id);
    } catch (error) {
      if (error.details?.wix_status !== 409) throw error;
      const recovered = await client.find("crmArticleId", article.id);
      const recoveredId = clean(recovered[0]?.id, 500) || clean(article.id, 500);
      operation = "updated";
      item = await client.update(recoveredId, data);
    }
  }
  const savedItemId = clean(item?.id, 500);
  if (!savedItemId) {
    throw new WixPublishingError("api", "Wix did not return an item ID.", 502);
  }
  return {
    operation,
    itemId: savedItemId,
    collectionId: configuration.collectionId,
    dashboardUrl: configuration.dashboardUrl,
    syncStatus: "synced",
    payloadVersion: WIX_KNOWLEDGE_PAYLOAD_VERSION,
    data,
  };
}
