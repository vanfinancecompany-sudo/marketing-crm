export const MARKETING_CONTACTS_PAGE_SIZE = 50;

const API_ROUTE = "/api/marketing-contacts";
const API_KEY_STORAGE_KEY = "marketingCustomerDatabaseApiKey";

function getApiKey() {
  if (typeof window === "undefined") return "";
  return window.sessionStorage.getItem(API_KEY_STORAGE_KEY) || window.localStorage.getItem(API_KEY_STORAGE_KEY) || "";
}

async function requestMarketingContacts(action, payload = {}) {
  const apiKey = getApiKey();
  const response = await fetch(API_ROUTE, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(apiKey ? { "x-marketing-customer-database-key": apiKey } : {}),
    },
    body: JSON.stringify({ action, ...payload }),
  });
  const result = await response.json().catch(() => ({}));

  if (!response.ok || result.ok === false) {
    throw new Error(result.message || "Customer Database request failed.");
  }

  return result;
}

export async function getMarketingContactStats(filters = {}) {
  const result = await requestMarketingContacts("stats", { filters });
  return result.stats;
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
