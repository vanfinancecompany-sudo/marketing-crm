import { contactHasPermanentSuppression, normalizeEmailIdentity } from "./customerDatabaseCleanse.js";

export const CLEANED_IMPORT_COUNT_KEYS = [
  "newActiveContacts", "promotedContacts", "restoredContacts", "alreadyActive",
  "suppressedContacts", "invalidRows", "duplicateUploadRows", "otherRejectedRows",
];

export function emptyCleanedImportCounts(rowsImported = 0) {
  return Object.fromEntries([["rowsImported", Number(rowsImported || 0)], ...CLEANED_IMPORT_COUNT_KEYS.map((key) => [key, 0])]);
}

export function addCleanedImportCounts(left = {}, right = {}) {
  return Object.fromEntries(["rowsImported", ...CLEANED_IMPORT_COUNT_KEYS].map((key) => [key, Number(left[key] || 0) + Number(right[key] || 0)]));
}

export function isPermanentlySuppressedContact(contact = {}) {
  return contactHasPermanentSuppression(contact)
    || ["suppressed", "unsubscribed"].includes(String(contact.marketing_status || "active"));
}

export function decideCleanedImportAction(existing) {
  if (!existing) return { result: "new_active", reason: "New verified contact created as Active", countKey: "newActiveContacts", nextLifecycle: "active" };
  const lifecycle = String(existing.lifecycle_status || "active");
  if (isPermanentlySuppressedContact(existing)) return { result: "suppressed", reason: "Permanent suppression preserved; contact was not reactivated", countKey: "suppressedContacts", nextLifecycle: lifecycle };
  if (lifecycle === "awaiting_verification") return { result: "promoted", reason: "Cleaned verified email promoted from Awaiting Verification", countKey: "promotedContacts", nextLifecycle: "active" };
  if (lifecycle === "archived") return { result: "restored", reason: "Archived contact restored under the existing safe restoration rule", countKey: "restoredContacts", nextLifecycle: "active" };
  if (lifecycle === "active") return { result: "already_active", reason: "Verified email is already Active; no duplicate created", countKey: "alreadyActive", nextLifecycle: "active" };
  return { result: "rejected", reason: `Unsupported lifecycle status: ${lifecycle || "unknown"}`, countKey: "otherRejectedRows", nextLifecycle: lifecycle };
}

export function buildImportResult({ email = "", action, previousLifecycle = "", customerId = "" }) {
  return {
    email: normalizeEmailIdentity(email),
    result: action.result,
    reason: action.reason,
    previous_lifecycle_status: previousLifecycle || "",
    new_lifecycle_status: action.nextLifecycle || previousLifecycle || "",
    existing_customer_id: customerId || "",
  };
}

export function buildPossibleDuplicateResult(email, possible = {}) {
  return buildImportResult({
    email,
    action: {
      result: "possible_duplicate",
      reason: "Same normalized name and postcode",
      nextLifecycle: "active",
    },
    previousLifecycle: possible.lifecycle_status || "",
    customerId: possible.customer_id || "",
  });
}

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function importResultsToCsv(rows = []) {
  const columns = ["email", "result", "reason", "previous_lifecycle_status", "new_lifecycle_status", "existing_customer_id"];
  return [columns.join(","), ...rows.map((row) => columns.map((column) => csvEscape(row[column])).join(","))].join("\n");
}
