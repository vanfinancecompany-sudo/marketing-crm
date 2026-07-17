import {
  buildMarketingAccessHeaders,
  parseMarketingJsonResponse,
} from "./marketingAccess.js";

export const MARKETING_CONTACTS_PAGE_SIZE = 50;
export const MARKETING_IMPORT_BATCH_SIZE = 500;

const API_ROUTE = "/api/marketing-contacts";
const IMPORT_API_ROUTE = "/api/marketing-contact-import";
const DATABASE_TOOLS_API_ROUTE = "/api/marketing-database-tools";

async function requestApi(route, action, payload = {}) {
  const response = await fetch(route, {
    method: "POST",
    headers: buildMarketingAccessHeaders({
      "Content-Type": "application/json",
    }),
    body: JSON.stringify({ action, ...payload }),
  });

  return parseMarketingJsonResponse(response, "Customer Database request failed.");
}

function requestMarketingContacts(action, payload = {}) {
  return requestApi(API_ROUTE, action, payload);
}

function requestMarketingImport(action, payload = {}) {
  return requestApi(IMPORT_API_ROUTE, action, payload);
}

export async function getMarketingContactStats(filters = {}) {
  const result = await requestMarketingContacts("stats", { filters });
  return result.stats;
}

export async function getMarketingActivityStats() {
  const result = await requestMarketingContacts("activityStats");
  return result.activity;
}

export async function listMarketingContacts({ page = 1, pageSize = MARKETING_CONTACTS_PAGE_SIZE, filters = {} } = {}) {
  const result = await requestMarketingContacts("list", { page, pageSize, filters });
  return {
    contacts: result.contacts || [],
    total: result.total || 0,
    stats: result.stats || {},
  };
}

export async function createMarketingContact(values) {
  const result = await requestMarketingContacts("create", { values });
  return result.contact;
}

export async function updateMarketingContact(existingContact, values) {
  const result = await requestMarketingContacts("update", { contact: existingContact, values });
  return result.contact;
}

export async function deleteMarketingContact(contact) {
  await requestMarketingContacts("delete", { contact });
}

export async function bulkAddMarketingTag(contacts, tag) {
  await requestMarketingContacts("bulk", { bulkAction: "addTag", contacts, tag });
}

export async function bulkRemoveMarketingTag(contacts, tag) {
  await requestMarketingContacts("bulk", { bulkAction: "removeTag", contacts, tag });
}

export async function bulkChangeMarketingPipeline(contacts, pipeline) {
  await requestMarketingContacts("bulk", { bulkAction: "changePipeline", contacts, pipeline });
}

export async function bulkDeleteMarketingContacts(contacts) {
  await requestMarketingContacts("bulk", { bulkAction: "delete", contacts });
}

export async function getMarketingExportCsv(key, scope = "all", filters = {}) {
  const result = await requestMarketingContacts("export", { key, scope, filters });
  return result.csv || "";
}

export async function createMarketingContactsBackup() {
  const result = await requestMarketingImport("backup");
  return result.backup;
}

export async function startMarketingImport({ filename, fileSize = 0, pipeline, totalRows, checksum = "", batchSize = MARKETING_IMPORT_BATCH_SIZE, backup = null }) {
  return requestMarketingImport("start", { filename, fileSize, pipeline, totalRows, checksum, batchSize, backup });
}

export async function processMarketingImportBatch({ importId, pipeline, batchIndex, rows, batchKey = "", importFingerprint = "" }) {
  return requestMarketingImport("batch", { importId, pipeline, batchIndex, rows, batchKey, importFingerprint });
}

export async function completeMarketingImport({ importId, failed = false, error = "" }) {
  return requestMarketingImport("complete", { importId, failed, error });
}

export async function fetchMarketingImportHistory() {
  const result = await requestMarketingImport("history");
  return result.imports || [];
}

export async function fetchMarketingImportReports(importId = "") {
  const result = await requestMarketingImport("reports", { importId });
  return {
    rejectedRows: result.rejectedRows || [],
    duplicateRows: result.duplicateRows || [],
    restoredRows: result.restoredRows || [],
    suppressedRows: result.suppressedRows || [],
    invalidEmailRows: result.invalidEmailRows || [],
    possibleDuplicates: result.possibleDuplicates || [],
  };
}

export async function getCustomerDatabaseToolsOverview() {
  const result = await requestApi(DATABASE_TOOLS_API_ROUTE, "overview");
  return result.counts || {};
}

export async function getCustomerDatabaseSafetyExport(action) {
  if (action === "exportFull") {
    const chunks = [];
    let page = 0;
    let current;
    do {
      const result = await requestApi(DATABASE_TOOLS_API_ROUTE, action, { page });
      current = result.export || {};
      if (current.csv) chunks.push(current.csv);
      page += 1;
    } while (!current.done);
    return { ...current, page: 0, done: true, csv: chunks.join("\n") };
  }
  const result = await requestApi(DATABASE_TOOLS_API_ROUTE, action);
  return result.export;
}

export async function prepareCustomerDatabaseClear(confirmedExports) {
  return requestApi(DATABASE_TOOLS_API_ROUTE, "prepareClear", { confirmedExports });
}

export async function clearActiveCustomerDatabase(operationId, confirmation) {
  return requestApi(DATABASE_TOOLS_API_ROUTE, "clearActive", { operationId, confirmation });
}

export async function getCustomerCampaignHistory(contact) {
  const result = await requestApi(DATABASE_TOOLS_API_ROUTE, "contactCampaignHistory", { customerId: contact?.customer_id || "", email: contact?.email || "" });
  return result.history || [];
}
