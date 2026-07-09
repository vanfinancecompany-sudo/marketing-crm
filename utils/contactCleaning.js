export const PIPELINE_OPTIONS = ["finance", "rent2buy", "both", "unknown"];
export const SOURCE_OPTIONS = ["manual", "wix", "supabase", "facebook", "crm", "other"];

const TITLE_PATTERN = /^(mr|mrs|miss|ms|dr)\.?\s+/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UK_MOBILE_PATTERN = /^(\+447|447|07)\d{9}$/;
const PHONEISH_PATTERN = /(?:\+?\d[\d\s().-]{7,}\d)/;

const FIELD_ALIASES = {
  firstName: ["first name", "firstname", "first_name", "forename", "given name"],
  lastName: ["last name", "lastname", "last_name", "surname", "family name"],
  fullName: ["name", "full name", "fullname", "customer name"],
  email: ["email", "email address", "e-mail", "e-mail address"],
  phone: ["phone", "telephone", "mobile", "mobile number", "tel", "contact number"],
  postcode: ["postcode", "post code", "zip", "postal code"],
  pipeline: ["pipeline", "product", "lead type", "lead_type", "application type", "application_type"],
  source: ["source", "lead source", "lead_source", "origin", "import source"],
  status: ["status", "lead status", "lead_status"],
  notes: ["notes", "note", "comments", "comment"],
};

function normalizeHeader(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function getField(row, aliases) {
  for (const alias of aliases) {
    const match = Object.keys(row).find((key) => normalizeHeader(key) === alias);
    if (match) return String(row[match] || "").trim();
  }
  return "";
}

function splitCsvLine(line) {
  const cells = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      cells.push(current);
      current = "";
    } else {
      current += char;
    }
  }

  cells.push(current);
  return cells.map((cell) => cell.trim());
}

export function parseCsv(text) {
  const lines = String(text || "")
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "");

  if (!lines.length) return [];

  const headers = splitCsvLine(lines[0]);
  return lines.slice(1).map((line, index) => {
    const cells = splitCsvLine(line);
    return headers.reduce(
      (row, header, cellIndex) => ({
        ...row,
        [header || `Column ${cellIndex + 1}`]: cells[cellIndex] || "",
      }),
      { _rowNumber: index + 2 }
    );
  });
}

function stripTitle(value) {
  return String(value || "").trim().replace(TITLE_PATTERN, "").trim();
}

function properCase(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\b([a-z])/g, (match) => match.toUpperCase())
    .replace(/\b(Mc)([a-z])/g, (_, prefix, letter) => `${prefix}${letter.toUpperCase()}`)
    .replace(/\b(O')([a-z])/g, (_, prefix, letter) => `${prefix}${letter.toUpperCase()}`);
}

function looksLikeEmail(value) {
  return EMAIL_PATTERN.test(String(value || "").trim().toLowerCase());
}

function looksLikePhone(value) {
  return PHONEISH_PATTERN.test(String(value || ""));
}

export function cleanEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  return looksLikeEmail(email) ? email : "";
}

export function cleanUkMobile(value) {
  const digits = String(value || "").replace(/[^\d+]/g, "");
  const normalized = digits.startsWith("+") ? digits : digits.replace(/^00/, "+");

  if (!UK_MOBILE_PATTERN.test(normalized)) return "";
  if (normalized.startsWith("+447")) return normalized;
  if (normalized.startsWith("447")) return `+${normalized}`;
  if (normalized.startsWith("07")) return `+44${normalized.slice(1)}`;
  return "";
}

export function cleanPostcode(value) {
  const compact = String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (compact.length < 5 || compact.length > 7) return String(value || "").trim().toUpperCase();
  return `${compact.slice(0, -3)} ${compact.slice(-3)}`;
}

function cleanNameParts(row) {
  let firstName = stripTitle(getField(row, FIELD_ALIASES.firstName));
  let lastName = stripTitle(getField(row, FIELD_ALIASES.lastName));
  const fullName = stripTitle(getField(row, FIELD_ALIASES.fullName));

  if (!firstName && fullName) firstName = fullName;

  if (firstName && !lastName && firstName.includes(" ")) {
    const parts = firstName.split(/\s+/).filter(Boolean);
    firstName = parts.shift() || "";
    lastName = parts.join(" ");
  }

  if (looksLikeEmail(firstName) || looksLikePhone(firstName)) firstName = "";
  if (looksLikeEmail(lastName) || looksLikePhone(lastName)) lastName = "";

  return {
    firstName: properCase(firstName),
    lastName: properCase(lastName),
  };
}

function normalizePipeline(value) {
  const text = String(value || "").trim().toLowerCase();
  if (!text) return "unknown";
  const hasRent = /rent\s*2\s*buy|rent2buy|r2b/.test(text);
  const hasFinance = /finance|van finance|vanfinance/.test(text);
  if (hasRent && hasFinance) return "both";
  if (hasRent) return "rent2buy";
  if (hasFinance) return "finance";
  if (text === "both") return "both";
  return "unknown";
}

function detectPipeline(row) {
  const pipelineText = [
    getField(row, FIELD_ALIASES.pipeline),
    getField(row, FIELD_ALIASES.source),
    getField(row, FIELD_ALIASES.status),
  ]
    .filter(Boolean)
    .join(" ");

  return normalizePipeline(pipelineText);
}

function normalizeSource(value) {
  const text = String(value || "").trim().toLowerCase();
  if (/wix/.test(text)) return "wix";
  if (/supabase/.test(text)) return "supabase";
  if (/facebook|meta/.test(text)) return "facebook";
  if (/\bcrm\b/.test(text)) return "crm";
  if (/manual/.test(text)) return "manual";
  return text ? "other" : "other";
}

function detectSource(row) {
  return normalizeSource(getField(row, FIELD_ALIASES.source));
}

function mergePipeline(current, next) {
  if (current === next) return current;
  if (current === "both" || next === "both") return "both";
  if (
    (current === "finance" && next === "rent2buy") ||
    (current === "rent2buy" && next === "finance")
  ) {
    return "both";
  }
  if (current === "unknown") return next || "unknown";
  if (next === "unknown") return current || "unknown";
  return current || next || "unknown";
}

function mergeSources(current, next) {
  const sources = new Set(
    String(current || "")
      .split(";")
      .concat(String(next || "").split(";"))
      .map((item) => item.trim())
      .filter(Boolean)
  );
  return [...sources].join(";") || "other";
}

function duplicateKey(contact) {
  if (contact.email) return `email:${contact.email}`;
  if (contact.phone) return `phone:${contact.phone}`;
  return "";
}

export function cleanManualContact(values) {
  const now = new Date().toISOString();
  const email = cleanEmail(values.email);
  const phone = cleanUkMobile(values.phone);
  const firstName = properCase(stripTitle(values.firstName));
  const lastName = properCase(stripTitle(values.lastName));

  if (!email && !phone) {
    return { contact: null, error: "Add a valid email or UK mobile." };
  }

  return {
    contact: {
      firstName: looksLikeEmail(firstName) || looksLikePhone(firstName) ? "" : firstName,
      lastName: looksLikeEmail(lastName) || looksLikePhone(lastName) ? "" : lastName,
      email,
      phone,
      postcode: cleanPostcode(values.postcode),
      country: "GB",
      pipeline: PIPELINE_OPTIONS.includes(values.pipeline) ? values.pipeline : "unknown",
      source: SOURCE_OPTIONS.includes(values.source) ? values.source : "manual",
      notes: String(values.notes || "").trim(),
      sourceRow: "manual",
      created_at: now,
      updated_at: now,
      last_seen_at: now,
    },
    error: "",
  };
}

export function cleanCustomerRows(rows) {
  const cleanContacts = [];
  const rejectedRows = [];
  const duplicateRows = [];
  const contactIndex = new Map();
  const now = new Date().toISOString();

  rows.forEach((row) => {
    const email = cleanEmail(getField(row, FIELD_ALIASES.email));
    const phone = cleanUkMobile(getField(row, FIELD_ALIASES.phone));
    const { firstName, lastName } = cleanNameParts(row);
    const postcode = cleanPostcode(getField(row, FIELD_ALIASES.postcode));

    if (!email && !phone) {
      rejectedRows.push({ ...row, rejectionReason: "No valid email or UK mobile" });
      return;
    }

    const contact = {
      firstName,
      lastName,
      email,
      phone,
      postcode,
      country: "GB",
      pipeline: detectPipeline(row),
      source: detectSource(row),
      notes: getField(row, FIELD_ALIASES.notes),
      sourceRow: row._rowNumber,
      created_at: now,
      updated_at: now,
      last_seen_at: now,
    };
    const key = duplicateKey(contact);

    if (key && contactIndex.has(key)) {
      const existing = cleanContacts[contactIndex.get(key)];
      existing.pipeline = mergePipeline(existing.pipeline, contact.pipeline);
      existing.source = mergeSources(existing.source, contact.source);
      existing.updated_at = now;
      existing.last_seen_at = now;
      duplicateRows.push({
        ...contact,
        duplicateReason: key.startsWith("email:") ? "Duplicate email" : "Duplicate phone",
        mergedPipeline: existing.pipeline,
      });
      return;
    }

    if (key) contactIndex.set(key, cleanContacts.length);
    cleanContacts.push(contact);
  });

  return buildCustomerResult(cleanContacts, rejectedRows, duplicateRows, rows.length);
}

export function addContactToResult(result, contact) {
  const cleanContacts = [...(result.cleanContacts || [])];
  const duplicateRows = [...(result.duplicateRows || [])];
  const rejectedRows = [...(result.rejectedRows || [])];
  const key = duplicateKey(contact);
  const duplicateIndex = key
    ? cleanContacts.findIndex((item) => duplicateKey(item) === key)
    : -1;

  if (duplicateIndex >= 0) {
    cleanContacts[duplicateIndex] = {
      ...cleanContacts[duplicateIndex],
      pipeline: mergePipeline(cleanContacts[duplicateIndex].pipeline, contact.pipeline),
      source: mergeSources(cleanContacts[duplicateIndex].source, contact.source),
      notes: [cleanContacts[duplicateIndex].notes, contact.notes].filter(Boolean).join("\n"),
      updated_at: contact.updated_at,
      last_seen_at: contact.last_seen_at,
    };
    duplicateRows.push({
      ...contact,
      duplicateReason: key.startsWith("email:") ? "Duplicate email" : "Duplicate phone",
      mergedPipeline: cleanContacts[duplicateIndex].pipeline,
    });
  } else {
    cleanContacts.push(contact);
  }

  return buildCustomerResult(
    cleanContacts,
    rejectedRows,
    duplicateRows,
    Number(result.stats?.rowsImported || 0) + 1
  );
}

export function filterContactsByPipeline(contacts, pipeline = "all") {
  if (pipeline === "all") return contacts;
  return contacts.filter((contact) => contact.pipeline === pipeline);
}

function buildCustomerResult(cleanContacts, rejectedRows, duplicateRows, rowsImported) {
  return {
    cleanContacts,
    rejectedRows,
    duplicateRows,
    stats: {
      rowsImported,
      cleanContacts: cleanContacts.length,
      duplicatesRemoved: duplicateRows.length,
      badRowsRejected: rejectedRows.length,
      emailReadyContacts: cleanContacts.filter((contact) => contact.email).length,
      smsReadyContacts: cleanContacts.filter((contact) => contact.phone).length,
      facebookReadyContacts: cleanContacts.filter((contact) => contact.email || contact.phone).length,
    },
  };
}

function csvEscape(value) {
  const text = String(value ?? "");
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function toCsv(rows, columns) {
  return [
    columns.map((column) => csvEscape(column.header)).join(","),
    ...rows.map((row) => columns.map((column) => csvEscape(row[column.key])).join(",")),
  ].join("\n");
}

function pipelineRows(cleanContacts, pipeline) {
  if (pipeline === "finance") {
    return cleanContacts.filter((contact) => contact.pipeline === "finance" || contact.pipeline === "both");
  }
  if (pipeline === "rent2buy") {
    return cleanContacts.filter((contact) => contact.pipeline === "rent2buy" || contact.pipeline === "both");
  }
  return filterContactsByPipeline(cleanContacts, pipeline);
}

export function buildCustomerExports(cleanContacts, rejectedRows, duplicateRows, scope = "all") {
  const scopedContacts = scope === "all" ? cleanContacts : filterContactsByPipeline(cleanContacts, scope);
  const financeContacts = pipelineRows(cleanContacts, "finance");
  const rent2buyContacts = pipelineRows(cleanContacts, "rent2buy");

  const masterColumns = [
    { key: "firstName", header: "first_name" },
    { key: "lastName", header: "last_name" },
    { key: "email", header: "email" },
    { key: "phone", header: "phone" },
    { key: "postcode", header: "postcode" },
    { key: "country", header: "country" },
    { key: "pipeline", header: "pipeline" },
    { key: "source", header: "source" },
    { key: "notes", header: "notes" },
    { key: "created_at", header: "created_at" },
    { key: "updated_at", header: "updated_at" },
    { key: "last_seen_at", header: "last_seen_at" },
  ];
  const facebookColumns = [
    { key: "email", header: "email" },
    { key: "phone", header: "phone" },
    { key: "fn", header: "fn" },
    { key: "ln", header: "ln" },
    { key: "zip", header: "zip" },
    { key: "country", header: "country" },
  ];
  const emailColumns = [
    { key: "email", header: "email" },
    { key: "firstName", header: "first_name" },
    { key: "lastName", header: "last_name" },
    { key: "pipeline", header: "pipeline" },
  ];
  const smsColumns = [
    { key: "phone", header: "phone" },
    { key: "firstName", header: "first_name" },
    { key: "lastName", header: "last_name" },
    { key: "pipeline", header: "pipeline" },
  ];
  const toFacebookRows = (contacts) =>
    contacts.map((contact) => ({
      email: contact.email,
      phone: contact.phone,
      fn: contact.firstName,
      ln: contact.lastName,
      zip: contact.postcode,
      country: "GB",
    }));

  return {
    master: toCsv(scopedContacts, masterColumns),
    facebook: toCsv(toFacebookRows(scopedContacts), facebookColumns),
    email: toCsv(scopedContacts.filter((contact) => contact.email), emailColumns),
    sms: toCsv(scopedContacts.filter((contact) => contact.phone), smsColumns),
    financeFacebook: toCsv(toFacebookRows(financeContacts), facebookColumns),
    rent2buyFacebook: toCsv(toFacebookRows(rent2buyContacts), facebookColumns),
    fullFacebook: toCsv(toFacebookRows(cleanContacts), facebookColumns),
    financeEmail: toCsv(financeContacts.filter((contact) => contact.email), emailColumns),
    rent2buyEmail: toCsv(rent2buyContacts.filter((contact) => contact.email), emailColumns),
    financeSms: toCsv(financeContacts.filter((contact) => contact.phone), smsColumns),
    rent2buySms: toCsv(rent2buyContacts.filter((contact) => contact.phone), smsColumns),
    rejected: toCsv(rejectedRows, [
      { key: "_rowNumber", header: "source_row" },
      { key: "rejectionReason", header: "reason" },
    ]),
    duplicates: toCsv(duplicateRows, [
      { key: "sourceRow", header: "source_row" },
      { key: "email", header: "email" },
      { key: "phone", header: "phone" },
      { key: "pipeline", header: "pipeline" },
      { key: "mergedPipeline", header: "merged_pipeline" },
      { key: "duplicateReason", header: "reason" },
    ]),
  };
}
