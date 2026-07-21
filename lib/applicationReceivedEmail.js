const DEFAULT_CONTACT_EMAIL = "sales@vanfinancecompany.co.uk";
const DEFAULT_CONTACT_WEBSITE = "https://www.vanfinancecompany.co.uk";

export const APPLICATION_RECEIVED_TEMPLATE_NAME = "Application Received";
export const APPLICATION_RECEIVED_SUBJECT = "We've received your van finance application";

function cleanText(value, limit = 1000) {
  return String(value || "").trim().slice(0, limit);
}

function escapeHtml(value) {
  return cleanText(value, 5000)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function safeHttpUrl(value) {
  const text = cleanText(value, 2000);
  if (!text) return "";
  try {
    const url = new URL(text);
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : "";
  } catch {
    return "";
  }
}

export function normalizeApplicationReceivedPayload(value = {}) {
  const vehicle = value.vehicle && typeof value.vehicle === "object" ? value.vehicle : {};
  return {
    leadId: cleanText(value.lead_id || value.leadId, 120),
    applicationRef: cleanText(value.application_ref || value.applicationRef, 200),
    customerName: cleanText(value.customer_name || value.customerName, 200),
    customerEmail: cleanText(value.customer_email || value.customerEmail, 254).toLowerCase(),
    vehicle: {
      title: cleanText(vehicle.title || vehicle.model, 300),
      registration: cleanText(vehicle.registration, 40).toUpperCase(),
      imageUrl: safeHttpUrl(vehicle.image_url || vehicle.imageUrl),
    },
  };
}

export function renderApplicationReceivedEmail(payload, environment = process.env) {
  const values = normalizeApplicationReceivedPayload(payload);
  const firstName = cleanText(values.customerName.split(/\s+/)[0], 100) || "there";
  const phone = cleanText(environment.APPLICATION_RECEIVED_CONTACT_PHONE, 100);
  const contactEmail = cleanText(environment.APPLICATION_RECEIVED_CONTACT_EMAIL || DEFAULT_CONTACT_EMAIL, 254);
  const websiteUrl = safeHttpUrl(environment.APPLICATION_RECEIVED_CONTACT_WEBSITE || DEFAULT_CONTACT_WEBSITE) || DEFAULT_CONTACT_WEBSITE;
  const websiteLabel = websiteUrl.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const hasVehicle = Boolean(values.vehicle.title || values.vehicle.registration || values.vehicle.imageUrl);

  const vehicleHtml = hasVehicle
    ? `<tr><td style="padding:0 32px 24px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;">
          ${values.vehicle.imageUrl ? `<tr><td><img src="${escapeHtml(values.vehicle.imageUrl)}" alt="${escapeHtml(values.vehicle.title || "Vehicle")}" width="536" style="display:block;width:100%;max-width:536px;height:auto;border:0;"></td></tr>` : ""}
          <tr><td style="padding:18px 20px;font-family:Arial,sans-serif;color:#172033;">
            <div style="font-size:12px;line-height:18px;font-weight:bold;text-transform:uppercase;letter-spacing:.08em;color:#64748b;">Vehicle</div>
            ${values.vehicle.title ? `<div style="margin-top:5px;font-size:18px;line-height:25px;font-weight:bold;">${escapeHtml(values.vehicle.title)}</div>` : ""}
            ${values.vehicle.registration ? `<div style="margin-top:5px;font-size:14px;line-height:21px;">Registration: <strong>${escapeHtml(values.vehicle.registration)}</strong></div>` : ""}
          </td></tr>
        </table>
      </td></tr>`
    : `<tr><td style="padding:0 32px 24px;font-family:Arial,sans-serif;font-size:15px;line-height:23px;color:#334155;">We’ll help you find the right van for your needs.</td></tr>`;

  const contactParts = [
    phone ? `<a href="tel:${escapeHtml(phone.replace(/\s+/g, ""))}" style="color:#ffffff;text-decoration:none;">${escapeHtml(phone)}</a>` : "",
    contactEmail ? `<a href="mailto:${escapeHtml(contactEmail)}" style="color:#ffffff;text-decoration:none;">${escapeHtml(contactEmail)}</a>` : "",
    `<a href="${escapeHtml(websiteUrl)}" style="color:#ffffff;text-decoration:none;">${escapeHtml(websiteLabel)}</a>`,
  ].filter(Boolean).join(" &nbsp;·&nbsp; ");

  return {
    templateName: APPLICATION_RECEIVED_TEMPLATE_NAME,
    subject: APPLICATION_RECEIVED_SUBJECT,
    html: `<!doctype html>
<html><body style="margin:0;padding:0;background:#f1f5f9;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 18px rgba(15,23,42,.08);">
        <tr><td style="padding:26px 32px;background:#172033;font-family:Arial,sans-serif;color:#ffffff;">
          <div style="font-size:22px;line-height:28px;font-weight:bold;">Van Finance Company</div>
        </td></tr>
        <tr><td style="padding:30px 32px 14px;font-family:Arial,sans-serif;color:#172033;">
          <h1 style="margin:0;font-size:26px;line-height:34px;">Application received</h1>
        </td></tr>
        <tr><td style="padding:0 32px 22px;font-family:Arial,sans-serif;font-size:15px;line-height:24px;color:#334155;">
          Hi ${escapeHtml(firstName)},<br><br>
          Thank you for applying with Van Finance Company. We’ve safely received your van finance application and one of our team will begin reviewing it shortly.
        </td></tr>
        ${vehicleHtml}
        <tr><td style="padding:0 32px 30px;font-family:Arial,sans-serif;font-size:15px;line-height:24px;color:#334155;">
          We’ll contact you as soon as possible. If we need any further information, we’ll let you know.
        </td></tr>
        <tr><td style="padding:20px 32px;background:#172033;font-family:Arial,sans-serif;font-size:13px;line-height:21px;color:#ffffff;text-align:center;">
          ${contactParts}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`,
  };
}

