import { SENDGRID_SENDER_EMAIL, SENDGRID_SENDER_NAME } from "./sendgrid.js";

const MARKETING_EMAIL_PROVIDERS = new Set(["smtp2go", "brevo", "sendgrid"]);

export class MarketingEmailProviderConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = "MarketingEmailProviderConfigError";
    this.statusCode = 400;
  }
}

export function smtp2goSelected(environment = process.env) {
  return Boolean(environment.SMTP2GO_API_KEY || environment.SMTP2GO_SENDER_EMAIL || environment.SMTP2GO_SENDER_NAME);
}

export function activeEmailProvider(environment = process.env) {
  const configured = String(environment.MARKETING_EMAIL_PROVIDER || "").trim().toLowerCase();
  if (!configured) return smtp2goSelected(environment) ? "smtp2go" : "brevo";
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
    senderEmail: SENDGRID_SENDER_EMAIL,
    senderName: environment.SMTP2GO_SENDER_NAME || environment.BREVO_SENDER_NAME || SENDGRID_SENDER_NAME,
    webhookVerificationConfigured: Boolean(environment.SENDGRID_WEBHOOK_VERIFICATION_KEY),
  };
  throw new MarketingEmailProviderConfigError("Unsupported marketing email provider.");
}
