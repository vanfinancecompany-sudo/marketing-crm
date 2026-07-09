export const PIPELINE_OPTIONS = ["finance", "rent2buy", "both", "unknown"];
export const SOURCE_OPTIONS = ["manual", "csv", "wix", "crm", "facebook", "supabase", "other"];
export const DEFAULT_TAGS = [
  "lead",
  "customer",
  "application",
  "approved",
  "declined",
  "purchased",
  "vip",
  "no_email",
  "no_mobile",
  "facebook_ready",
  "email_ready",
  "sms_ready",
];

const TITLE_PATTERN = /^(mr|mrs|miss|ms|dr)\.?\s+/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UK_MOBILE_PATTERN = /^(\+447|447|07)\d{9}$/;
const PHONEISH_PATTERN = /(?:\+?\d[\d\s().-]{7,}\d)/;

const FIELD_ALIASES = {
  first_name: ["first name", "firstname", "first_name", "forename", "given name"],
  last_name: ["last name", "lastname", "last_name", "surname", "family name"],
  full_name: ["name", "full name", "fullname", "customer name"],
  email: ["email", "email address", "e-mail", "e-mail address"],
  phone: ["phone", "telephone", "mobile", "mobile number", "tel", "contact number"],
  postcode: ["postcode", "post code", "zip", "postal code"],
  company: ["company", "business", "business name", "company name", "organisation", "organization"],
  pipeline: ["pipeline", "product", "lead type", "lead_type", "application type", "application_type"],
  source: ["source", "lead source", "lead_source", "origin", "import source"],
  status: ["status", "lead status", "lead_status"],
  notes: ["notes", "note", "comments", "comment"],
  tags: ["tags", "tag"],
};

function normalizeHeader(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
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
  let first_name = stripTitle(getField(row, FIELD_ALIASES.first_name));
  let last_name = stripTitle(getField(row, FIELD_ALIASES.last_name));
  const full_name = stripTitle(getField(row, FIELD_ALIASES.full_name));

  if (!first_name && full_name) first_name = full_name;

  if (first_name && !last_name && first_name.includes(" ")) {
    const parts = first_name.split(/\s+/).filter(Boolean);
    first_name = parts.shift() || "";
    last_name = parts.join(" ");
  }

  if (looksLikeEmail(first_name) || looksLikePhone(first_name)) first_name = "";
  if (looksLikeEmail(last_name) || looksLikePhone(last_name)) last_name = "";

  return {
    first_name: properCase(first_name),
    last_name: properCase(last_name),
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
  return PIPELINE_OPTIONS.includes(text) ? text : "unknown";
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

function normalizeSource(value, fallback = "other") {
  const text = String(value || "").trim().toLowerCase();
  if (/wix/.test(text)) return "wix";
  if (/supabase/.test(text)) return "supabase";
  if (/facebook|meta/.test(text)) return "facebook";
  if (/\bcrm\b/.test(text)) return "crm";
  if (/manual/.test(text)) return "manual";
  if (/csv|spreadsheet|import/.test(text)) return "csv";
  return text && SOURCE_OPTIONS.includes(text) ? text : fallback;
}

function detectSource(row) {
  return normalizeSource(getField(row, FIELD_ALIASES.source), "csv");
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

function possibleDuplicateKey(contact) {
  const name = `${contact.first_name || ""} ${contact.last_name || ""}`.trim().toLowerCase();
  if (!name || !contact.postcode) return "";
  return `${name}:${contact.postcode.replace(/\s+/g, "").toLowerCase()}`;
}

export function createTimelineEvent(type, message, created_at = new Date().toISOString()) {
  return {
    event_id: `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type,
    message,
    created_at,
  };
}

function parseTags(value) {
  if (Array.isArray(value)) return value;
  return String(value || "")
    .split(/[;,]/)
    .map((tag) => tag.trim().toLowerCase().replace(/\s+/g, "_"))
    .filter(Boolean);
}

export function withAutoTags(contact) {
  const tags = new Set(parseTags(contact.tags));
  if (!contact.email) tags.add("no_email");
  if (!contact.phone) tags.add("no_mobile");
  if (contact.email) tags.add("email_ready");
  if (contact.phone) tags.add("sms_ready");
  if (contact.email || contact.phone) tags.add("facebook_ready");
  return { ...contact, tags: [...tags].filter(Boolean).sort() };
}

export function createCustomerId(existingContacts = []) {
  const maxNumber = existingContacts.reduce((max, contact) => {
    const match = String(contact?.customer_id || "").match(/^VFC(\d+)$/);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
  return `VFC${String(maxNumber + 1).padStart(6, "0")}`;
}

export function contactName(contact) {
  return [contact.first_name, contact.last_name].filter(Boolean).join(" ") || "Unnamed contact";
}

function normalizeContactShape(contact) {
  return {
    customer_id: contact.customer_id,
    first_name: contact.first_name || contact.firstName || "",
    last_name: contact.last_name || contact.lastName || "",
    company: contact.company || "",
    email: contact.email || "",
    phone: contact.phone || "",
    postcode: contact.postcode || "",
    pipeline: normalizePipeline(contact.pipeline),
    source: normalizeSource(contact.source),
    notes: contact.notes || "",
    tags: parseTags(contact.tags),
    created_at: contact.created_at || new Date().toISOString(),
    updated_at: contact.updated_at || new Date().toISOString(),
    last_seen_at: contact.last_seen_at || new Date().toISOString(),
    duplicate_count: Number(contact.duplicate_count || 0),
    timeline: Array.isArray(contact.timeline) ? contact.timeline : [],
  };
}

function buildContact(values, existingContacts = [], timelineType = "manual_created", message = "Manual contact created") {
  const now = new Date().toISOString();
  const email = cleanEmail(values.email);
  const phone = cleanUkMobile(values.phone);
  const first_name = properCase(stripTitle(values.first_name || values.firstName));
  const last_name = properCase(stripTitle(values.last_name || values.lastName));

  if (!email && !phone) {
    return { contact: null, error: "Add a valid email or UK mobile." };
  }

  const contact = normalizeContactShape({
    customer_id: values.customer_id || createCustomerId(existingContacts),
    first_name: looksLikeEmail(first_name) || looksLikePhone(first_name) ? "" : first_name,
    last_name: looksLikeEmail(last_name) || looksLikePhone(last_name) ? "" : last_name,
    company: String(values.company || "").trim(),
    email,
    phone,
    postcode: cleanPostcode(values.postcode),
    pipeline: normalizePipeline(values.pipeline),
    source: normalizeSource(values.source, "manual"),
    notes: String(values.notes || "").trim(),
    tags: parseTags(values.tags),
    created_at: values.created_at || now,
    updated_at: now,
    last_seen_at: now,
    duplicate_count: values.duplicate_count || 0,
    timeline: values.timeline || [createTimelineEvent(timelineType, message, now)],
  });

  return { contact: withAutoTags(contact), error: "" };
}

export function cleanManualContact(values, existingContacts = []) {
  return buildContact(values, existingContacts, "manual_created", "Manual contact created");
}

function mergeContact(existing, incoming, reason, now = new Date().toISOString()) {
  const timeline = [
    ...(existing.timeline || []),
    ...(incoming.timeline || []),
    createTimelineEvent("duplicate_merged", `Duplicate merged by matching ${reason}`, now),
  ];

  return withAutoTags({
    ...existing,
    first_name: existing.first_name || incoming.first_name,
    last_name: existing.last_name || incoming.last_name,
    company: existing.company || incoming.company,
    email: existing.email || incoming.email,
    phone: existing.phone || incoming.phone,
    postcode: existing.postcode || incoming.postcode,
    pipeline: mergePipeline(existing.pipeline, incoming.pipeline),
    source: mergeSources(existing.source, incoming.source),
    notes: [existing.notes, incoming.notes].filter(Boolean).join("\n"),
    tags: [...new Set([...(existing.tags || []), ...(incoming.tags || [])])],
    updated_at: now,
    last_seen_at: now,
    duplicate_count: Number(existing.duplicate_count || 0) + Number(incoming.duplicate_count || 0) + 1,
    timeline,
  });
}

function findDuplicateIndex(contacts, contact) {
  if (contact.email) {
    const index = contacts.findIndex((item) => item.email && item.email === contact.email);
    if (index >= 0) return { index, reason: "email" };
  }
  if (contact.phone) {
    const index = contacts.findIndex((item) => item.phone && item.phone === contact.phone);
    if (index >= 0) return { index, reason: "phone" };
  }
  return { index: -1, reason: "" };
}

function findPossibleDuplicate(contacts, contact) {
  const key = possibleDuplicateKey(contact);
  if (!key) return null;
  return contacts.find((item) => item.customer_id !== contact.customer_id && possibleDuplicateKey(item) === key) || null;
}

export function cleanCustomerRows(rows, options = {}) {
  const existingContacts = (options.existingContacts || []).map(normalizeContactShape).map(withAutoTags);
  const cleanContacts = [...existingContacts];
  const rejectedRows = [...(options.rejectedRows || [])];
  const duplicateRows = [...(options.duplicateRows || [])];
  const possibleDuplicates = [...(options.possibleDuplicates || [])];
  const now = new Date().toISOString();
  const filename = options.filename || "CSV file";
  let contactsCreated = 0;
  let duplicatesMerged = 0;

  rows.forEach((row) => {
    const { first_name, last_name } = cleanNameParts(row);
    const tags = parseTags(getField(row, FIELD_ALIASES.tags));
    const built = buildContact(
      {
        first_name,
        last_name,
        email: getField(row, FIELD_ALIASES.email),
        phone: getField(row, FIELD_ALIASES.phone),
        postcode: getField(row, FIELD_ALIASES.postcode),
        company: getField(row, FIELD_ALIASES.company),
        pipeline: detectPipeline(row),
        source: detectSource(row),
        notes: getField(row, FIELD_ALIASES.notes),
        tags,
        customer_id: createCustomerId(cleanContacts),
        timeline: [createTimelineEvent("csv_imported", `Imported from CSV file ${filename}`, now)],
      },
      cleanContacts,
      "csv_imported",
      `Imported from CSV file ${filename}`
    );

    if (built.error) {
      rejectedRows.push({ ...row, rejectionReason: "No valid email or UK mobile" });
      return;
    }

    const contact = built.contact;
    const duplicate = findDuplicateIndex(cleanContacts, contact);

    if (duplicate.index >= 0) {
      const existing = cleanContacts[duplicate.index];
      cleanContacts[duplicate.index] = mergeContact(existing, contact, duplicate.reason, now);
      duplicateRows.push({
        sourceRow: row._rowNumber,
        email: contact.email,
        phone: contact.phone,
        pipeline: contact.pipeline,
        mergedPipeline: cleanContacts[duplicate.index].pipeline,
        duplicateReason: duplicate.reason === "email" ? "Duplicate email" : "Duplicate phone",
        customer_id: existing.customer_id,
      });
      duplicatesMerged += 1;
      return;
    }

    const possibleDuplicate = findPossibleDuplicate(cleanContacts, contact);
    if (possibleDuplicate) {
      possibleDuplicates.push({
        sourceRow: row._rowNumber,
        customer_id: possibleDuplicate.customer_id,
        possible_customer_id: contact.customer_id,
        name: contactName(contact),
        postcode: contact.postcode,
        reason: "Same name and postcode",
      });
    }

    cleanContacts.push(contact);
    contactsCreated += 1;
  });

  return buildCustomerResult(cleanContacts, rejectedRows, duplicateRows, rows.length, possibleDuplicates, {
    contactsCreated,
    duplicatesMerged,
    possibleDuplicates: possibleDuplicates.length,
  });
}

export function addContactToResult(result, contact) {
  const cleanContacts = [...(result.cleanContacts || [])].map(normalizeContactShape).map(withAutoTags);
  const duplicateRows = [...(result.duplicateRows || [])];
  const rejectedRows = [...(result.rejectedRows || [])];
  const possibleDuplicates = [...(result.possibleDuplicates || [])];
  const duplicate = findDuplicateIndex(cleanContacts, contact);

  if (duplicate.index >= 0) {
    const existing = cleanContacts[duplicate.index];
    cleanContacts[duplicate.index] = mergeContact(existing, contact, duplicate.reason);
    duplicateRows.push({
      sourceRow: "manual",
      email: contact.email,
      phone: contact.phone,
      pipeline: contact.pipeline,
      mergedPipeline: cleanContacts[duplicate.index].pipeline,
      duplicateReason: duplicate.reason === "email" ? "Duplicate email" : "Duplicate phone",
      customer_id: existing.customer_id,
    });
  } else {
    const possibleDuplicate = findPossibleDuplicate(cleanContacts, contact);
    if (possibleDuplicate) {
      possibleDuplicates.push({
        sourceRow: "manual",
        customer_id: possibleDuplicate.customer_id,
        possible_customer_id: contact.customer_id,
        name: contactName(contact),
        postcode: contact.postcode,
        reason: "Same name and postcode",
      });
    }
    cleanContacts.push(contact);
  }

  return buildCustomerResult(
    cleanContacts,
    rejectedRows,
    duplicateRows,
    Number(result.stats?.rowsImported || 0) + 1,
    possibleDuplicates
  );
}

export function updateContactRecord(existingContact, values) {
  const previous = normalizeContactShape(existingContact);
  const built = buildContact(
    {
      ...values,
      customer_id: previous.customer_id,
      created_at: previous.created_at,
      duplicate_count: previous.duplicate_count,
      timeline: previous.timeline,
    },
    [previous],
    "contact_edited",
    "Contact edited"
  );

  if (built.error) return built;

  const now = new Date().toISOString();
  const next = { ...built.contact, updated_at: now, last_seen_at: now };
  const timeline = [...(previous.timeline || []), createTimelineEvent("contact_edited", "Contact edited", now)];

  if (previous.pipeline !== next.pipeline) {
    timeline.push(createTimelineEvent("pipeline_changed", `Pipeline changed from ${previous.pipeline} to ${next.pipeline}`, now));
  }

  const oldTags = new Set(previous.tags || []);
  const newTags = new Set(next.tags || []);
  [...newTags].filter((tag) => !oldTags.has(tag)).forEach((tag) => {
    timeline.push(createTimelineEvent("tag_added", `Tag added: ${tag}`, now));
  });
  [...oldTags].filter((tag) => !newTags.has(tag)).forEach((tag) => {
    timeline.push(createTimelineEvent("tag_removed", `Tag removed: ${tag}`, now));
  });

  return { contact: { ...next, timeline }, error: "" };
}

export function filterContactsByPipeline(contacts, pipeline = "all") {
  if (pipeline === "all") return contacts;
  return contacts.filter((contact) => contact.pipeline === pipeline);
}

export function buildCustomerResult(cleanContacts, rejectedRows, duplicateRows, rowsImported, possibleDuplicates = [], importStats = {}) {
  const normalizedContacts = cleanContacts.map(normalizeContactShape).map(withAutoTags);
  return {
    cleanContacts: normalizedContacts,
    rejectedRows,
    duplicateRows,
    possibleDuplicates,
    stats: {
      rowsImported,
      cleanContacts: normalizedContacts.length,
      duplicatesRemoved: duplicateRows.length,
      badRowsRejected: rejectedRows.length,
      emailReadyContacts: normalizedContacts.filter((contact) => contact.email).length,
      smsReadyContacts: normalizedContacts.filter((contact) => contact.phone).length,
      facebookReadyContacts: normalizedContacts.filter((contact) => contact.email || contact.phone).length,
    },
    importStats,
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

export function getExportContacts(cleanContacts, key, scope = "all") {
  const scopedContacts = scope === "all" ? cleanContacts : filterContactsByPipeline(cleanContacts, scope);
  const financeContacts = pipelineRows(cleanContacts, "finance");
  const rent2buyContacts = pipelineRows(cleanContacts, "rent2buy");

  if (key === "financeFacebook" || key === "financeEmail" || key === "financeSms") return financeContacts;
  if (key === "rent2buyFacebook" || key === "rent2buyEmail" || key === "rent2buySms") return rent2buyContacts;
  if (key === "fullFacebook") return cleanContacts;
  return scopedContacts;
}

export function buildCustomerExports(cleanContacts, rejectedRows, duplicateRows, scope = "all") {
  const scopedContacts = scope === "all" ? cleanContacts : filterContactsByPipeline(cleanContacts, scope);
  const financeContacts = pipelineRows(cleanContacts, "finance");
  const rent2buyContacts = pipelineRows(cleanContacts, "rent2buy");

  const masterColumns = [
    { key: "customer_id", header: "customer_id" },
    { key: "first_name", header: "first_name" },
    { key: "last_name", header: "last_name" },
    { key: "company", header: "company" },
    { key: "email", header: "email" },
    { key: "phone", header: "phone" },
    { key: "postcode", header: "postcode" },
    { key: "pipeline", header: "pipeline" },
    { key: "source", header: "source" },
    { key: "notes", header: "notes" },
    { key: "created_at", header: "created_at" },
    { key: "updated_at", header: "updated_at" },
    { key: "last_seen_at", header: "last_seen_at" },
    { key: "duplicate_count", header: "duplicate_count" },
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
    { key: "first_name", header: "first_name" },
    { key: "last_name", header: "last_name" },
    { key: "pipeline", header: "pipeline" },
  ];
  const smsColumns = [
    { key: "phone", header: "phone" },
    { key: "first_name", header: "first_name" },
    { key: "last_name", header: "last_name" },
    { key: "pipeline", header: "pipeline" },
  ];
  const toFacebookRows = (contacts) =>
    contacts.map((contact) => ({
      email: contact.email,
      phone: contact.phone,
      fn: contact.first_name,
      ln: contact.last_name,
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
      { key: "customer_id", header: "customer_id" },
      { key: "sourceRow", header: "source_row" },
      { key: "email", header: "email" },
      { key: "phone", header: "phone" },
      { key: "pipeline", header: "pipeline" },
      { key: "mergedPipeline", header: "merged_pipeline" },
      { key: "duplicateReason", header: "reason" },
    ]),
  };
}
