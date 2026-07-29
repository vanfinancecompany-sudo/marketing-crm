const API_KEY_HEADER = "x-marketing-customer-database-key";

const SEO_FIELDS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["seo_title", "meta_description"],
  properties: {
    seo_title: { type: "string" },
    meta_description: { type: "string" },
  },
};

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function cleanText(value, maximum = 2000) {
  return String(value || "").trim().slice(0, maximum);
}

function authorize(request) {
  const expected = process.env.MARKETING_CUSTOMER_DATABASE_API_KEY;
  const header = request.headers[API_KEY_HEADER] || "";
  const authorization = request.headers.authorization || "";
  const bearer = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  return Boolean(expected && (header === expected || bearer === expected));
}

function parseBody(request) {
  if (!request.body) return {};
  if (typeof request.body === "string") {
    try {
      return JSON.parse(request.body);
    } catch {
      throw new ApiError(400, "Invalid JSON body.");
    }
  }
  return request.body;
}

function outputText(result) {
  return result.output_text || result.output
    ?.flatMap((item) => item.content || [])
    .find((item) => item.type === "output_text")?.text;
}

function validSeoFields(fields) {
  const titleLength = cleanText(fields?.seo_title, 500).length;
  const descriptionLength = cleanText(fields?.meta_description, 1000).length;
  return titleLength >= 30 && titleLength <= 60 && descriptionLength >= 120 && descriptionLength <= 160;
}

async function generateSeoFields({ title, intent, category }) {
  const apiKey = cleanText(process.env.OPENAI_API_KEY, 10000);
  if (!apiKey) throw new ApiError(500, "OPENAI_API_KEY is not available to this deployment.");
  const model = cleanText(process.env.OPENAI_MODEL, 200) || "gpt-4.1-mini";

  let lastFields = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        input: [
          {
            role: "system",
            content: "You are a careful UK SEO editor for a van-finance knowledge hub. Return only the two requested SEO fields and follow the character limits exactly.",
          },
          {
            role: "user",
            content: [
              `Article title: ${title}`,
              `Category: ${category || "Knowledge Hub"}`,
              `Customer intent: ${intent || title}`,
              "Create an SEO title of 30 to 60 characters.",
              "Create a meta description of 120 to 160 characters.",
              "Keep the same subject and do not add unsupported claims, rates, guarantees, stock claims or invented facts.",
              attempt > 1 ? `This is retry ${attempt}. Count every character before returning the JSON.` : "Count every character before returning the JSON.",
            ].join("\n"),
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "knowledge_hub_seo_fields",
            strict: true,
            schema: SEO_FIELDS_SCHEMA,
          },
        },
      }),
    });

    const result = await response.json();
    if (!response.ok) {
      console.error("KNOWLEDGE SEO FIELD HTTP ERROR", {
        status: response.status,
        code: result?.error?.code,
        message: result?.error?.message,
      });
      throw new ApiError(502, "The AI service could not prepare the SEO fields.");
    }

    const text = outputText(result);
    if (!text) throw new ApiError(502, "The AI returned no SEO fields.");

    try {
      lastFields = JSON.parse(text);
    } catch {
      throw new ApiError(502, "The AI returned invalid SEO field data.");
    }

    if (validSeoFields(lastFields)) {
      return {
        seo_title: cleanText(lastFields.seo_title, 60),
        meta_description: cleanText(lastFields.meta_description, 160),
      };
    }
  }

  throw new ApiError(502, "The AI could not produce SEO fields inside the required character limits.");
}

export default async function handler(request, response) {
  if (request.method !== "POST") {
    return response.status(405).json({ ok: false, message: "Method not allowed." });
  }
  if (!authorize(request)) {
    return response.status(401).json({ ok: false, message: "Access key not recognised." });
  }

  try {
    const body = parseBody(request);
    const title = cleanText(body.title, 240);
    if (!title) throw new ApiError(400, "An article title is required.");

    const fields = await generateSeoFields({
      title,
      intent: cleanText(body.intent, 1000),
      category: cleanText(body.category, 80),
    });

    return response.status(200).json({ ok: true, fields });
  } catch (error) {
    console.error("KNOWLEDGE SEO FIELD ERROR", { message: error.message });
    return response.status(error.status || 500).json({
      ok: false,
      message: error.status ? error.message : "Knowledge Hub SEO field generation failed.",
    });
  }
}
