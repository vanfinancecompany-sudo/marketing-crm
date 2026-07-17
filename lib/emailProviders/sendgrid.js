const SENDGRID_MAIL_SEND_URL = "https://api.sendgrid.com/v3/mail/send";
export const SENDGRID_TEST_SENDER_EMAIL = "sales@vanfinancecompany.co.uk";
export const SENDGRID_TEST_SENDER_NAME = "Van Finance Company";

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

export async function sendSendGridEmail({
  apiKey,
  to,
  toName = "",
  subject,
  html,
  customArgs = {},
  fetchImpl = globalThis.fetch,
  timeoutMs = 15000,
}) {
  if (!apiKey) throw new SendGridProviderError("SendGrid API key is not configured.", { providerStatusCode: 400 });
  if (typeof fetchImpl !== "function") throw new SendGridProviderError("SendGrid transport is unavailable.");

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
        }],
        from: { email: SENDGRID_TEST_SENDER_EMAIL, name: SENDGRID_TEST_SENDER_NAME },
        subject: cleanText(subject, 998),
        content: [{ type: "text/html", value: String(html || "") }],
        categories: ["marketing-crm", "sendgrid-test"],
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
        `SendGrid HTTP ${response.status}: ${cleanText(responseText || "Empty response body.")}`,
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
    return { messageId, response: { status: response.status } };
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
