const DEFAULT_CONTACT_PHONE = "0330 133 6376";
const DEFAULT_CONTACT_EMAIL = "sales@vanfinancecompany.co.uk";
const DEFAULT_CONTACT_WEBSITE = "https://www.vanfinancecompany.co.uk";
const DEFAULT_RENT2BUY_CONTACT_PHONE = "0330 133 6376";
const DEFAULT_RENT2BUY_CONTACT_EMAIL = "sales@vanfinancecompany.co.uk";
const DEFAULT_RENT2BUY_CONTACT_WEBSITE = "https://www.rent2buyvans.co.uk";

export const APPLICATION_RECEIVED_TEMPLATE_NAME = "Application Received";
export const APPLICATION_RECEIVED_SUBJECT = "We've received your van finance application";
export const RENT2BUY_APPLICATION_RECEIVED_TEMPLATE_NAME = "Rent2Buy Application Received";
export const RENT2BUY_APPLICATION_RECEIVED_SUBJECT = "We've received your Rent2Buy application";

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

function normalizeApplicationType(value) {
  const normalized = cleanText(value, 100).toLowerCase().replace(/[^a-z0-9]/g, "");
  return normalized === "rent2buy" ? "rent2buy" : "finance";
}

export function normalizeApplicationReceivedPayload(value = {}) {
  const vehicle = value.vehicle && typeof value.vehicle === "object" ? value.vehicle : {};
  return {
    leadId: cleanText(value.lead_id || value.leadId, 120),
    applicationRef: cleanText(value.application_ref || value.applicationRef, 200),
    applicationType: normalizeApplicationType(value.application_type || value.applicationType || value.pipeline),
    customerName: cleanText(value.customer_name || value.customerName, 200),
    customerEmail: cleanText(value.customer_email || value.customerEmail, 254).toLowerCase(),
    vehicle: {
      title: cleanText(vehicle.title || vehicle.model, 300),
      registration: cleanText(vehicle.registration, 40).toUpperCase(),
      imageUrl: safeHttpUrl(vehicle.image_url || vehicle.imageUrl),
    },
  };
}

function getBrand(values, environment) {
  if (values.applicationType === "rent2buy") {
    const websiteUrl = safeHttpUrl(
      environment.RENT2BUY_APPLICATION_RECEIVED_CONTACT_WEBSITE || DEFAULT_RENT2BUY_CONTACT_WEBSITE
    ) || DEFAULT_RENT2BUY_CONTACT_WEBSITE;

    return {
      name: "Rent2Buy Vans",
      templateName: RENT2BUY_APPLICATION_RECEIVED_TEMPLATE_NAME,
      subject: RENT2BUY_APPLICATION_RECEIVED_SUBJECT,
      phone: cleanText(environment.RENT2BUY_APPLICATION_RECEIVED_CONTACT_PHONE || DEFAULT_RENT2BUY_CONTACT_PHONE, 100),
      contactEmail: cleanText(environment.RENT2BUY_APPLICATION_RECEIVED_CONTACT_EMAIL || DEFAULT_RENT2BUY_CONTACT_EMAIL, 254),
      websiteUrl,
      acknowledgementCopy: "Thank you for applying with Rent2Buy Vans. We’ve safely received your Rent2Buy application and one of our team will begin reviewing it shortly.",
    };
  }

  const websiteUrl = safeHttpUrl(environment.APPLICATION_RECEIVED_CONTACT_WEBSITE || DEFAULT_CONTACT_WEBSITE) || DEFAULT_CONTACT_WEBSITE;
  return {
    name: "Van Finance Company",
    templateName: APPLICATION_RECEIVED_TEMPLATE_NAME,
    subject: APPLICATION_RECEIVED_SUBJECT,
    phone: cleanText(environment.APPLICATION_RECEIVED_CONTACT_PHONE || DEFAULT_CONTACT_PHONE, 100),
    contactEmail: cleanText(environment.APPLICATION_RECEIVED_CONTACT_EMAIL || DEFAULT_CONTACT_EMAIL, 254),
    websiteUrl,
    acknowledgementCopy: "Thank you for applying with Van Finance Company. We’ve safely received your van finance application and one of our team will begin reviewing it shortly.",
  };
}

export function renderApplicationReceivedEmail(payload, environment = process.env) {
  const values = normalizeApplicationReceivedPayload(payload);
  const firstName = cleanText(values.customerName.split(/\s+/)[0], 100) || "there";
  const brand = getBrand(values, environment);
  const websiteLabel = brand.websiteUrl.replace(/^https?:\/\//, "").replace(/\/$/, "");
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
    brand.phone ? `<a href="tel:${escapeHtml(brand.phone.replace(/\s+/g, ""))}" style="color:#ffffff;text-decoration:none;">${escapeHtml(brand.phone)}</a>` : "",
    brand.contactEmail ? `<a href="mailto:${escapeHtml(brand.contactEmail)}" style="color:#ffffff;text-decoration:none;">${escapeHtml(brand.contactEmail)}</a>` : "",
    `<a href="${escapeHtml(brand.websiteUrl)}" style="color:#ffffff;text-decoration:none;">${escapeHtml(websiteLabel)}</a>`,
  ].filter(Boolean).join(" &nbsp;·&nbsp; ");

  return {
    templateName: brand.templateName,
    subject: brand.subject,
    html: `<!doctype html>
<html><body style="margin:0;padding:0;background:#f1f5f9;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 18px rgba(15,23,42,.08);">
        <tr><td style="padding:26px 32px;background:#172033;font-family:Arial,sans-serif;color:#ffffff;">
          <div style="font-size:22px;line-height:28px;font-weight:bold;">${escapeHtml(brand.name)}</div>
        </td></tr>
        <tr><td style="padding:30px 32px 14px;font-family:Arial,sans-serif;color:#172033;">
          <h1 style="margin:0;font-size:26px;line-height:34px;">Application received</h1>
        </td></tr>
        <tr><td style="padding:0 32px 22px;font-family:Arial,sans-serif;font-size:15px;line-height:24px;color:#334155;">
          Hi ${escapeHtml(firstName)},<br><br>
          ${escapeHtml(brand.acknowledgementCopy)}
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
