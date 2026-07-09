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

function cleanEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  return looksLikeEmail(email) ? email : "";
}

function cleanUkMobile(value) {
  const digits = String(value || "").replace(/[^\d+]/g, "");
  const normalized = digits.startsWith("+") ? digits : digits.replace(/^00/, "+");

  if (!UK_MOBILE_PATTERN.test(normalized)) return "";
  if (normalized.startsWith("+447")) return normalized;
  if (normalized.startsWith("447")) return `+${normalized}`;
  if (normalized.startsWith("07")) return `+44${normalized.slice(1)}`;
  return "";
}

function cleanPostcode(value) {
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

function duplicateKey(contact) {
  if (contact.email) return `email:${contact.email}`;
  if (contact.phone) return `phone:${contact.phone}`;
  return "";
}

export function cleanCustomerRows(rows) {
  const cleanContacts = [];
  const rejectedRows = [];
  const duplicateRows = [];
  const seen = new Set();

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
      sourceRow: row._rowNumber,
    };
    const key = duplicateKey(contact);

    if (key && seen.has(key)) {
      duplicateRows.push({
        ...contact,
        duplicateReason: key.startsWith("email:") ? "Duplicate email" : "Duplicate phone",
      });
      return;
    }

    if (key) seen.add(key);
    cleanContacts.push(contact);
  });

  return {
    cleanContacts,
    rejectedRows,
    duplicateRows,
    stats: {
      rowsImported: rows.length,
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

export function buildCustomerExports(cleanContacts, rejectedRows, duplicateRows) {
  return {
    master: toCsv(cleanContacts, [
      { key: "firstName", header: "first_name" },
      { key: "lastName", header: "last_name" },
      { key: "email", header: "email" },
      { key: "phone", header: "phone" },
      { key: "postcode", header: "postcode" },
      { key: "country", header: "country" },
    ]),
    facebook: toCsv(
      cleanContacts.map((contact) => ({
        email: contact.email,
        phone: contact.phone,
        fn: contact.firstName,
        ln: contact.lastName,
        zip: contact.postcode,
        country: "GB",
      })),
      [
        { key: "email", header: "email" },
        { key: "phone", header: "phone" },
        { key: "fn", header: "fn" },
        { key: "ln", header: "ln" },
        { key: "zip", header: "zip" },
        { key: "country", header: "country" },
      ]
    ),
    email: toCsv(cleanContacts.filter((contact) => contact.email), [
      { key: "email", header: "email" },
      { key: "firstName", header: "first_name" },
      { key: "lastName", header: "last_name" },
    ]),
    sms: toCsv(cleanContacts.filter((contact) => contact.phone), [
      { key: "phone", header: "phone" },
      { key: "firstName", header: "first_name" },
      { key: "lastName", header: "last_name" },
    ]),
    rejected: toCsv(rejectedRows, [
      { key: "_rowNumber", header: "source_row" },
      { key: "rejectionReason", header: "reason" },
    ]),
    duplicates: toCsv(duplicateRows, [
      { key: "sourceRow", header: "source_row" },
      { key: "email", header: "email" },
      { key: "phone", header: "phone" },
      { key: "duplicateReason", header: "reason" },
    ]),
  };
}
