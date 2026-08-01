import { SENDGRID_SENDER_EMAIL, SENDGRID_SENDER_NAME, sendGridApiKeyFormatValid } from "./sendgrid.js";

const MARKETING_EMAIL_PROVIDERS = new Set(["smtp2go", "brevo", "sendgrid"]);

export class MarketingEmailProviderConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = "MarketingEmailProviderConfigError";
    this.statusCode = 400;
  }
}

// Retained only for compatibility with existing imports. SMTP2GO is no longer auto-selected.
export function smtp2goSelected() {
  return false;
}

export function activeEmailProvider(environment = process.env) {
  const configured = String(environment.MARKETING_EMAIL_PROVIDER || "sendgrid").trim().toLowerCase();
  if (!MARKETING_EMAIL_PROVIDERS.has(configured)) {
    throw new MarketingEmailProviderConfigError("MARKETING_EMAIL_PROVIDER must be smtp2go, brevo or sendgrid.");
  }
  return configured;
}

export function emailProviderConfig(provider = activeEmailProvider(), environment = process.env) {
  if (provider === "smtp2go") return {
    id: provider,
    provider: "SMTP2GO",
    apiKey: environment.SMTP2GO_API_KEY,
    senderEmail: environment.SMTP2GO_SENDER_EMAIL,
    senderName: environment.SMTP2GO_SENDER_NAME,
    webhookVerificationConfigured: Boolean(environment.SMTP2GO_WEBHOOK_SECRET),
  };
  if (provider === "brevo") return {
    id: provider,
    provider: "Brevo",
    apiKey: environment.BREVO_API_KEY,
    senderEmail: environment.BREVO_SENDER_EMAIL,
    senderName: environment.BREVO_SENDER_NAME,
    webhookVerificationConfigured: Boolean(environment.BREVO_WEBHOOK_SECRET),
  };
  if (provider === "sendgrid") return {
    id: provider,
    provider: "SendGrid",
    apiKey: environment.SENDGRID_API_KEY,
    apiKeyFormatValid: sendGridApiKeyFormatValid(environment.SENDGRID_API_KEY),
    senderEmail: SENDGRID_SENDER_EMAIL,
    senderName: SENDGRID_SENDER_NAME,
    webhookVerificationConfigured: Boolean(environment.SENDGRID_WEBHOOK_VERIFICATION_KEY),
  };
  throw new MarketingEmailProviderConfigError("Unsupported marketing email provider.");
}
