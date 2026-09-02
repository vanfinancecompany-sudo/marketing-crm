const SENDGRID_MAIL_SEND_URL = "https://api.sendgrid.com/v3/mail/send";
export const SENDGRID_SENDER_EMAIL = "sales@vanfinancecompany.co.uk";
export const SENDGRID_SENDER_NAME = "Van Finance Company";
export const SENDGRID_TEST_SENDER_EMAIL = SENDGRID_SENDER_EMAIL;
export const SENDGRID_TEST_SENDER_NAME = SENDGRID_SENDER_NAME;

export class SendGridProviderError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "SendGridProviderError";
    this.statusCode = 502;
    this.provider = "sendgrid";
    this.providerStatusCode = options.providerStatusCode || 0;
    this.ambiguous = Boolean(options.ambiguous);
  }
}

function cleanText(value, limit = 1000) {
  return String(value || "").trim().slice(0, limit);
}

export function sendGridApiKeyFormatValid(value) {
  const apiKey = cleanText(value, 512);
  return /^SG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{20,}$/.test(apiKey);
}

function scalarCustomArgs(values = {}) {
  if (!values || typeof values !== "object" || Array.isArray(values)) {
    throw new SendGridProviderError("SendGrid custom arguments must be an object.");
  }
  return Object.fromEntries(Object.entries(values).flatMap(([key, value]) => {
    const safeKey = cleanText(key, 100);
    const safeValue = cleanText(value, 255);
    return safeKey && safeValue ? [[safeKey, safeValue]] : [];
  }));
}

function scalarHeaders(values = {}) {
  if (!values || typeof values !== "object" || Array.isArray(values)) {
    throw new SendGridProviderError("SendGrid headers must be an object.");
  }
  return Object.fromEntries(Object.entries(values).flatMap(([key, value]) => {
    const safeKey = cleanText(key, 100).replace(/[\r\n:]/g, "");
    const safeValue = cleanText(value, 1000).replace(/[\r\n]/g, "");
    return safeKey && safeValue ? [[safeKey, safeValue]] : [];
  }));
}

function safeCategories(values) {
  const categories = Array.isArray(values) ? values : ["marketing-crm", "sendgrid-test"];
  return [...new Set(categories.map((value) => cleanText(value, 255)).filter(Boolean))].slice(0, 10);
}

function safeAttachments(values = []) {
  if (!Array.isArray(values)) throw new SendGridProviderError("SendGrid attachments must be an array.");
  return values.slice(0, 10).map((attachment) => {
    const content = String(attachment?.content || "").trim();
    const filename = cleanText(attachment?.filename, 120).replace(/[\r\n"]/g, "") || "document";
    const type = cleanText(attachment?.type, 100).replace(/[\r\n;]/g, "");
    if (!content || content.length > 5_000_000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(content)) {
      throw new SendGridProviderError("SendGrid attachment content is invalid.");
    }
    return {
      content,
      filename,
      ...(type ? { type } : {}),
      disposition: "attachment",
    };
  });
}

export async function sendSendGridEmail({
  apiKey,
  to,
  toName = "",
  subject,
  html,
  text = "",
  customArgs = {},
  headers = {},
  categories,
  attachments = [],
  replyToEmail = "",
  replyToName = "",
  fromEmail = SENDGRID_SENDER_EMAIL,
  fromName = SENDGRID_SENDER_NAME,
  fetchImpl = globalThis.fetch,
  timeoutMs = 15000,
}) {
  if (!apiKey) throw new SendGridProviderError("SendGrid API key is not configured.", { providerStatusCode: 400 });
  if (typeof fetchImpl !== "function") throw new SendGridProviderError("SendGrid transport is unavailable.");

  const safeAttachmentList = safeAttachments(attachments);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(SENDGRID_MAIL_SEND_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
      body: JSON.stringify({
        personalizations: [{
          to: [{ email: cleanText(to, 254), name: cleanText(toName, 200) }],
          subject: cleanText(subject, 998),
          custom_args: scalarCustomArgs(customArgs),
          headers: scalarHeaders(headers),
        }],
        from: { email: cleanText(fromEmail, 254), name: cleanText(fromName, 200) },
        ...(replyToEmail ? { reply_to: { email: cleanText(replyToEmail, 254), name: cleanText(replyToName, 200) } } : {}),
        subject: cleanText(subject, 998),
        content: [
          ...(text ? [{ type: "text/plain", value: String(text) }] : []),
          { type: "text/html", value: String(html || "") },
        ],
        ...(safeAttachmentList.length ? { attachments: safeAttachmentList } : {}),
        categories: safeCategories(categories),
        tracking_settings: {
          click_tracking: { enable: true, enable_text: true },
          open_tracking: { enable: true },
        },
      }),
    });

    const responseText = await response.text().catch(() => {
      throw new SendGridProviderError("SendGrid response could not be read after submission.", { ambiguous: true });
    });
    if (!response.ok) {
      throw new SendGridProviderError(
        `SendGrid rejected the email submission with HTTP ${response.status}.`,
        { providerStatusCode: response.status }
      );
    }
    const messageId = cleanText(response.headers?.get?.("x-message-id"), 500);
    if (!messageId) {
      throw new SendGridProviderError("SendGrid accepted the message without returning an X-Message-Id.", {
        providerStatusCode: response.status,
        ambiguous: true,
      });
    }
    return { messageId, response: { status: response.status, body: responseText } };
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new SendGridProviderError("SendGrid request timed out after submission was attempted.", { ambiguous: true });
    }
    if (error instanceof SendGridProviderError) throw error;
    throw new SendGridProviderError("SendGrid submission outcome is unknown due to a network error.", { ambiguous: true });
  } finally {
    clearTimeout(timeout);
  }
}
