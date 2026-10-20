// Use a normal PNG for Gmail's image proxy, which can put a white matte behind this
// particular transparent source WebP. Preserve any other logo a user uploads.
export const VANSCO_EMAIL_LOGO_WEBP = "https://www.vansco.co.uk/dist/img/webp/logo-white.webp";
export const VANSCO_EMAIL_LOGO_PNG = "https://marketing-crm-six.vercel.app/api/vansco-email-logo-png";
export function emailCompatibleVanscoLogoUrl(url = "") {
  const original = String(url || "").trim();
  return original === VANSCO_EMAIL_LOGO_WEBP ? VANSCO_EMAIL_LOGO_PNG : original;
}
