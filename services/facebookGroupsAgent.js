import {
  buildRent2BuyDiscoveryQueries,
  looksNational,
  mentionsCoveragePlace,
  mentionsOutsidePlace,
} from "../lib/rent2buyCoverage.js";

export const GROUP_AGENT_DISCOVERY_START = "VFC_GROUP_DISCOVERY_START";
export const GROUP_AGENT_DISCOVERY_ACK = "VFC_GROUP_DISCOVERY_ACK";
export const GROUP_AGENT_DISCOVERY_COMPLETE = "VFC_GROUP_DISCOVERY_COMPLETE";
export const GROUP_AGENT_INSPECTION_START = "VFC_GROUP_INSPECTION_START";
export const GROUP_AGENT_INSPECTION_ACK = "VFC_GROUP_INSPECTION_ACK";
export const GROUP_AGENT_INSPECTION_COMPLETE = "VFC_GROUP_INSPECTION_COMPLETE";
export const GROUP_POST_JOB = "VFC_GROUP_POST_JOB";
export const GROUP_POST_JOB_ACK = "VFC_GROUP_POST_JOB_ACK";
export const GROUP_POST_SUBMITTED = "VFC_GROUP_POST_SUBMITTED";
export const GROUP_POST_EVENT_ACK = "VFC_GROUP_POST_EVENT_ACK";
export const GROUP_POST_STATUS_START = "VFC_GROUP_POST_STATUS_START";
export const GROUP_POST_STATUS_ACK = "VFC_GROUP_POST_STATUS_ACK";
export const GROUP_POST_STATUS_COMPLETE = "VFC_GROUP_POST_STATUS_COMPLETE";
export const GROUP_POST_STATUS_PROGRESS = "VFC_GROUP_POST_STATUS_PROGRESS";
export const GROUP_POST_STATUS_EVENT = "VFC_GROUP_POST_STATUS_EVENT";
export const GROUP_POST_STATUS_EVENT_ACK = "VFC_GROUP_POST_STATUS_EVENT_ACK";
export const FACEBOOK_HELPER_PING = "VFC_FACEBOOK_HELPER_PING";
export const FACEBOOK_HELPER_PONG = "VFC_FACEBOOK_HELPER_PONG";
export const GROUP_RECOVERY_REQUEST = "VFC_GROUP_RECOVERY_REQUEST";
export const GROUP_RECOVERY_RESPONSE = "VFC_GROUP_RECOVERY_RESPONSE";
export const GROUP_AGENT_INSPECTION_PROGRESS = "VFC_GROUP_INSPECTION_PROGRESS";
export const GROUP_AGENT_CANCEL = "VFC_GROUP_AGENT_CANCEL";
export const GROUP_AGENT_CANCEL_ACK = "VFC_GROUP_AGENT_CANCEL_ACK";

const GROUP_STORAGE_KEY = "marketingFacebookGroupsAgentV1";
const DISCOVERY_ROTATION_KEY = "marketingFacebookGroupDiscoveryRotationV1";
const GROUP_STATE_ENDPOINT = "/api/facebook-groups-state";
let remoteWriteChain = Promise.resolve();
let remoteSyncReady = false;

export const FACEBOOK_GROUP_PRODUCTS = Object.freeze({
  finance: "finance",
  rent2buy: "rent2buy",
});

const SEED_GROUPS = Object.freeze([
  { name: "Vans Only for Sale Swaps & Wanted", url: "https://www.facebook.com/groups/360871827417794/", area: "UK", segment: "Van/Vehicle", finance: true, rent2buy: false, members: "75K", status: "Amber", score: 72 },
  { name: "UK Car, Van, Truck, Motorbike & Parts Swaps & Sales", url: "https://www.facebook.com/groups/ukcarswaps/", area: "UK", segment: "Van/Vehicle", finance: true, rent2buy: false, members: "38K", status: "Amber", score: 70 },
  { name: "Southampton-Portsmouth UK Online Sales", url: "https://www.facebook.com/groups/Southamptoncommunitysales", area: "Southampton / Portsmouth", segment: "Local Marketplace", finance: true, rent2buy: true, members: "62,676", status: "Amber", score: 78 },
  { name: "Buy And Sell-Portsmouth Havant Waterlooville!", url: "https://www.facebook.com/groups/296917307036835", area: "Portsmouth / Havant / Waterlooville", segment: "Local Marketplace", finance: true, rent2buy: true, members: "25,969", status: "Amber", score: 77 },
  { name: "Buy & Sell Portsmouth, Southampton & Waterlooville", url: "https://www.facebook.com/groups/leabaysouthampton", area: "Portsmouth / Southampton / Waterlooville", segment: "Local Marketplace", finance: true, rent2buy: true, members: "7,838", status: "Amber", score: 75 },
  { name: "Facebay Portsmouth & Surrounding Areas", url: "https://www.facebook.com/groups/Facebay-Portsmouth-%26-Surrounding-Areas-288347711259127", area: "Portsmouth / Havant / Fareham", segment: "Local Marketplace", finance: true, rent2buy: true, members: "3,264", status: "Amber", score: 72 },
  { name: "Whats On In And Around Portsmouth (UK) For Our Children", url: "https://www.facebook.com/groups/403455093086902", area: "Portsmouth", segment: "Local Community", finance: true, rent2buy: true, members: "13,494", status: "Green", score: 81 },
  { name: "Buy, Sell, Swap And Exchange In Portsmouth And Hampshire (No Drama)", url: "https://www.facebook.com/groups/buyandsellportsmouthandhampshire", area: "Portsmouth / Hampshire", segment: "Local Marketplace", finance: true, rent2buy: true, members: "2,795", status: "Amber", score: 73 },
  { name: "Weston Super Mare Sell And Buy No Rules", url: "https://www.facebook.com/groups/953513678002756", area: "Weston-super-Mare", segment: "Local Marketplace", finance: true, rent2buy: true, members: "27,775", status: "Green", score: 78 },
  { name: "Weston Super Mare Market Place", url: "https://www.facebook.com/groups/449987541693194", area: "Weston-super-Mare", segment: "Local Marketplace", finance: true, rent2buy: true, members: "6,907", status: "Green", score: 76 },
  { name: "Weston-Super-Mare Buy, Sell, Swap No Rules", url: "https://www.facebook.com/groups/682664651809559", area: "Weston-super-Mare", segment: "Local Marketplace", finance: true, rent2buy: true, members: "2,411", status: "Green", score: 74 },
  { name: "Elite Trades Community", url: "https://www.facebook.com/groups/1821484254786832", area: "UK", segment: "Trades", finance: true, rent2buy: false, members: "170,000+", status: "Amber", score: 82 },
  { name: "Couriers TV Facebook Group", url: "https://www.facebook.com/groups/2753926601567404", area: "UK", segment: "Courier/Delivery", finance: true, rent2buy: false, members: "300+ vetted couriers", status: "Green", score: 86 },
  { name: "Transport Managers CPC UK", url: "https://facebook.com/groups/cpc.tm", area: "UK", segment: "Transport", finance: true, rent2buy: false, members: "33,000 reported", status: "Amber", score: 75 },
  { name: "Great Small Biz Community", url: "https://www.facebook.com/search/groups/?q=Great%20Small%20Biz%20Community", area: "UK", segment: "Small Business", finance: true, rent2buy: false, members: "", status: "Amber", score: 64 },
]);

// Every place inside the Rent2Buy 100-mile area x every relevant group type
// (local buy & sell, marketplace, classifieds, vans, cars & vans, trades, business).
const RENT2BUY_QUERY_BANK = Object.freeze(buildRent2BuyDiscoveryQueries());

const FINANCE_QUERY_BANK = Object.freeze([
  { query: "vans for sale UK", segment: "Van/Vehicle" },
  { query: "used vans for sale UK", segment: "Van/Vehicle" },
  { query: "van sales UK", segment: "Van/Vehicle" },
  { query: "commercial vans for sale UK", segment: "Van/Vehicle" },
  { query: "commercial vehicles for sale UK", segment: "Van/Vehicle" },
  { query: "vans buy sell swap UK", segment: "Van/Vehicle" },
  { query: "cars vans buy sell swap UK", segment: "Classifieds" },
  { query: "van classifieds UK", segment: "Classifieds" },
  { query: "car and van classifieds UK", segment: "Classifieds" },
  { query: "vehicle classifieds UK", segment: "Classifieds" },
  { query: "commercial vehicle classifieds UK", segment: "Classifieds" },
  { query: "van marketplace UK", segment: "Classifieds" },
  { query: "London van sales classifieds", segment: "Classifieds" },
  { query: "Birmingham van sales classifieds", segment: "Classifieds" },
  { query: "Manchester van sales classifieds", segment: "Classifieds" },
  { query: "Leeds van sales classifieds", segment: "Classifieds" },
  { query: "Liverpool van sales classifieds", segment: "Classifieds" },
  { query: "Sheffield van sales classifieds", segment: "Classifieds" },
  { query: "Bristol van sales classifieds", segment: "Classifieds" },
  { query: "Nottingham van sales classifieds", segment: "Classifieds" },
  { query: "Leicester van sales classifieds", segment: "Classifieds" },
  { query: "Newcastle van sales classifieds", segment: "Classifieds" },
]);

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export function preserveFacebookGroupCaption(value) {
  return String(value ?? "").replace(/\r\n?/g, "\n").trim();
}

export function normalizeFacebookGroupUrl(value) {
  const raw = clean(value);
  if (!raw) return "";
  try {
    const url = new URL(raw.startsWith("http") ? raw : `https://www.facebook.com${raw.startsWith("/") ? "" : "/"}${raw}`);
    const match = url.pathname.match(/^\/groups\/([^/?#]+)/i);
    if (!match) return raw;
    return `https://www.facebook.com/groups/${match[1]}/`;
  } catch {
    return raw;
  }
}

function groupKey(group) {
  return normalizeFacebookGroupUrl(group?.url || group?.groupUrl || "").toLowerCase()
    || clean(group?.name).toLowerCase();
}

// Facebook search shows the avatar link ("Profile photo of ...") and unavailable
// pages show a placeholder heading; neither is the group's name.
const UNAVAILABLE_NAME_PATTERN = /^(?:this content isn.t available(?: right now)?|content not found|facebook|log in or sign up.*)$/i;
export function cleanGroupName(value) {
  const name = clean(value).replace(/^profile photo of\s+/i, "").trim();
  return UNAVAILABLE_NAME_PATTERN.test(name) ? "" : name;
}

function groupSlug(value) {
  const match = normalizeFacebookGroupUrl(value).match(/^https:\/\/www\.facebook\.com\/groups\/([^/]+)\/$/i);
  if (!match) return "";
  try { return decodeURIComponent(match[1]).toLowerCase(); } catch { return match[1].toLowerCase(); }
}

// Facebook's numeric group ID: recorded by the helper, the URL itself, or the ID
// Facebook appends to some vanity names ("facebay-portsmouth-...-288347711259127").
export function facebookGroupNumericId(groupOrUrl) {
  const explicit = typeof groupOrUrl === "object" ? clean(groupOrUrl?.groupId) : "";
  if (/^\d{5,}$/.test(explicit)) return explicit;
  const slug = groupSlug(typeof groupOrUrl === "object" ? groupOrUrl?.url || groupOrUrl?.groupUrl : groupOrUrl);
  if (/^\d{5,}$/.test(slug)) return slug;
  return slug.match(/-(\d{8,})$/)?.[1] || "";
}

// Every identity a group record answers to: numeric ID, vanity/numeric URL slug and
// any alternative URLs already seen for it.
export function groupIdentityKeys(group) {
  const keys = new Set();
  const id = facebookGroupNumericId(group);
  if (id) keys.add(`id:${id}`);
  for (const url of [group?.url, group?.groupUrl, group?.requestedUrl, ...(Array.isArray(group?.aliasUrls) ? group.aliasUrls : [])]) {
    const slug = groupSlug(url);
    if (!slug) continue;
    keys.add(`slug:${slug}`);
    const aliasId = facebookGroupNumericId(url);
    if (aliasId) keys.add(`id:${aliasId}`);
  }
  return [...keys];
}

function identityIndex(groups) {
  const index = new Map();
  (groups || []).forEach((group, position) => {
    for (const key of groupIdentityKeys(group)) if (!index.has(key)) index.set(key, position);
  });
  return index;
}

function withAlias(group, url) {
  const alias = normalizeFacebookGroupUrl(url);
  if (!alias || !groupSlug(alias) || groupSlug(alias) === groupSlug(group.url)) return group;
  const aliases = new Set(Array.isArray(group.aliasUrls) ? group.aliasUrls : []);
  if (aliases.has(alias)) return group;
  return { ...group, aliasUrls: [...aliases, alias] };
}

function registrationKey(value) {
  return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

// Local to the Rent2Buy area: the group names or describes a place inside the
// 100-mile coverage area, or it came from a coverage-area search and does not
// name somewhere outside it (or present itself as UK-wide).
export function isRent2BuyLocalGroup(group) {
  const name = cleanGroupName(group?.name);
  const described = [name, group?.area, group?.context, group?.ruleEvidence];
  if (mentionsCoveragePlace(...described)) return true;
  if (!group?.query || !mentionsCoveragePlace(group.query)) return false;
  return !mentionsOutsidePlace(name, group?.context) && !looksNational(name);
}

const SELLING_GROUP_PATTERN = /\b(?:buy(?:ing)?|sell(?:ing)?|sales?|for\s+sale|swaps?|swapping|wanted|classifieds?|market\s*place|marketplace|facebay|bargains?|second\s*hand|pre[-\s]?loved|traders?|trading)\b/i;
const VEHICLE_GROUP_PATTERN = /\b(?:vans?|cars?|vehicles?|commercial\s+vehicles?|motors?|pickups?|trucks?|4x4s?|lcvs?)\b/i;
const TRADE_BUSINESS_PATTERN = /\b(?:trades?|tradesm[ae]n|tradespeople|tradies|business(?:es)?|self[-\s]?employed|builders?|building|construction|contractors?|plumbers?|plumbing|electricians?|roofers?|roofing|scaffold(?:ers|ing)?|landscap(?:ers?|ing)|gardeners?|gardening|handym[ae]n|carpenters?|joiners?|plasterers?|decorators?|cleaners?|cleaning|couriers?|delivery|removals?|man\s+(?:and|&)\s+van|mechanics?|garages?|motor\s+trade|entrepreneurs?|networking)\b/i;
const IRRELEVANT_GROUP_PATTERN = /\b(?:jobs?\s+(?:in|at|for|uk|vacancies)|job\s*seekers?|vacanc(?:y|ies)|recruit(?:ment|ing|ers?)?|hiring|support\s+group|mental\s+health|therapy|beauty|nails|lashes|hairdress\w*|fitness|gym|childcare|babysit\w*|nann(?:y|ies)|carers?|dating|singles|prayer|church|lost\s+(?:and|&)\s+found|missing\s+pets?|dog\s+walk\w*|rooms?\s+to\s+(?:rent|let)|house\s*share|flat\s*share|lettings?|estate\s+agents?|mortgages?|crypto|forex)\b/i;

// Useful for a van advert: local buying & selling, classifieds, marketplace,
// vehicle groups and trade/business groups. Only clearly unrelated audiences
// (jobs, support, beauty, dating, property lettings, ...) are rejected; whether a
// group accepts the advert is decided by testing a real post.
export function isRelevantAdvertisingGroup(group) {
  const text = clean([cleanGroupName(group?.name), group?.context, group?.ruleEvidence].filter(Boolean).join(" "));
  if (!text || IRRELEVANT_GROUP_PATTERN.test(text)) return false;
  return SELLING_GROUP_PATTERN.test(text) || VEHICLE_GROUP_PATTERN.test(text) || TRADE_BUSINESS_PATTERN.test(text);
}

// Earlier name kept for existing callers.
export const isVehicleClassifiedGroup = isRelevantAdvertisingGroup;

function productAllowed(group, productKey) {
  // A record folded into another (same Facebook group under a second URL) is history only.
  if (group?.mergedInto) return false;
  const belongsToProduct = productKey === "rent2buy"
    ? Boolean(group?.rent2buy)
    : Boolean(group?.finance);
  if (!belongsToProduct) return false;

  // Once Facebook has genuinely accepted a post, keep that group in Proven / Hot.
  // The tighter discovery filter is for finding NEW groups, not erasing known winners.
  const proven = !group?.archived && (
    group?.pipeline === "proven" ||
    Number(group?.acceptedPostCount || 0) > 0 ||
    group?.postStatus === "accepted"
  );
  if (proven) return true;

  const relevant = isVehicleClassifiedGroup(group);
  if (productKey === "rent2buy") {
    return relevant && isRent2BuyLocalGroup(group);
  }
  return relevant;
}

function parseMemberCount(value) {
  const text = clean(value).toLowerCase().replace(/,/g, "");
  if (!text) return 0;
  const match = text.match(/([0-9]+(?:\.[0-9]+)?)/);
  if (!match) return 0;
  let number = Number(match[1]) || 0;
  if (/\bk\b|000\+?\s*$/.test(text) || text.includes("k")) number *= 1000;
  return number;
}

function ruleClassification(text) {
  const haystack = clean(text).toLowerCase();
  const blockPatterns = [
    /no\s+(?:business|commercial)\s+(?:posts?|advertis(?:ing|ements?))/,
    /no\s+advertis(?:ing|ements?)/,
    /no\s+dealers?\b/,
    /dealers?\s+(?:are\s+)?not\s+allowed/,
    /no\s+promotional\s+posts?/,
  ];
  const allowPatterns = [
    /business(?:es)?\s+(?:are\s+)?welcome/,
    /business\s+advertis(?:ing|ements?)\s+(?:is\s+)?allowed/,
    /advertis(?:ing|ements?)\s+(?:is\s+)?allowed/,
    /promote\s+your\s+business/,
    /commercial\s+posts?\s+(?:are\s+)?allowed/,
  ];

  if (blockPatterns.some((pattern) => pattern.test(haystack))) return "Red";
  if (allowPatterns.some((pattern) => pattern.test(haystack))) return "Green";
  return "Amber";
}

function calculateScore(group, productKey) {
  let score = Number(group?.seedScore || group?.score || 45);
  const text = `${group?.name || ""} ${group?.segment || ""} ${group?.context || ""} ${group?.area || ""}`.toLowerCase();
  if (/\bvan|\bcar|commercial vehicle|\bvehicle/.test(text)) score += 14;
  if (/buy|sell|swap|classified|marketplace|for sale/.test(text)) score += 10;
  if (group?.canPost === true) score += 18;
  if (group?.joined === true) score += 6;
  if (group?.approvalRequired === true) score -= 2;
  if (group?.status === "Green") score += 16;
  if (group?.status === "Red") score -= 45;
  if (Number(group?.acceptedPostCount || 0) > 0) score += 18;
  if (group?.pipeline === "proven") score += 10;
  if (group?.postStatus === "rejected") score -= 12;
  if (group?.archived) score -= 70;

  const members = parseMemberCount(group?.members || group?.membersReported || "");
  if (members >= 50000) score += 8;
  else if (members >= 10000) score += 5;
  else if (members >= 2500) score += 2;

  if (productKey === "rent2buy") {
    if (mentionsCoveragePlace(text)) score += 12;
    else if (mentionsOutsidePlace(text)) score -= 18;
  }
  return Math.max(0, Math.min(100, Math.round(score)));
}

function normaliseSeed(group) {
  return {
    id: `seed-${groupKey(group).replace(/[^a-z0-9]+/g, "-").slice(0, 80)}`,
    name: group.name,
    url: normalizeFacebookGroupUrl(group.url),
    area: group.area || "",
    segment: group.segment || "Other",
    finance: Boolean(group.finance),
    rent2buy: Boolean(group.rent2buy),
    members: group.members || "",
    privacy: group.privacy || "",
    status: group.status || "Amber",
    seedScore: Number(group.score || 45),
    score: Number(group.score || 45),
    source: "seed",
    canPost: null,
    joined: null,
    membershipPending: false,
    approvalRequired: null,
    linksAllowed: null,
    ruleEvidence: "",
    lastCheckedAt: "",
    lastPostedAt: "",
    lastAcceptedAt: "",
    lastPostCheckAt: "",
    postStatus: "new",
    pipeline: "new",
    repeatDays: 7,
    pendingRegistration: "",
    postCount: 0,
    acceptedPostCount: 0,
    rejectedPostCount: 0,
    archived: false,
    archiveReason: "",
    leads: Number(group.leads || 0),
  };
}

export function loadFacebookGroups() {
  const seeds = SEED_GROUPS.map(normaliseSeed);
  if (typeof window === "undefined") return seeds;
  try {
    const saved = JSON.parse(window.localStorage.getItem(GROUP_STORAGE_KEY) || "[]");
    return mergeFacebookGroups(seeds, Array.isArray(saved) ? saved : []);
  } catch {
    return seeds;
  }
}

export async function fetchFacebookGroupsState() {
  if (typeof fetch !== "function") return [];
  const response = await fetch(GROUP_STATE_ENDPOINT, {
    method: "GET",
    headers: { accept: "application/json" },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Facebook group state returned HTTP ${response.status}`);
  const payload = await response.json();
  return Array.isArray(payload?.groups) ? payload.groups : [];
}

export async function persistFacebookGroupsRemote(groups) {
  if (typeof fetch !== "function") return { ok: false, skipped: true };
  const response = await fetch(GROUP_STATE_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ groups: Array.isArray(groups) ? groups : [] }),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Facebook group state save returned HTTP ${response.status}`);
  return response.json();
}

function queueRemoteFacebookGroupsSave(groups) {
  const snapshot = Array.isArray(groups) ? groups.map((group) => ({ ...group })) : [];
  remoteWriteChain = remoteWriteChain
    .catch(() => {})
    .then(() => persistFacebookGroupsRemote(snapshot));
  remoteWriteChain.catch((error) => {
    console.warn("Could not persist Facebook group state remotely.", error);
  });
  return remoteWriteChain;
}

export async function hydrateFacebookGroups(localGroups = loadFacebookGroups()) {
  try {
    const remoteGroups = await fetchFacebookGroupsState();
    // A status result may arrive while the server request is in flight.
    const latestLocalGroups = mergeFacebookGroups(localGroups, loadFacebookGroups());
    const merged = remoteGroups.length
      ? mergeFacebookGroupsByRecentPostState(latestLocalGroups, remoteGroups)
      : mergeFacebookGroups([], latestLocalGroups);
    saveFacebookGroups(merged, { remote: false });
    remoteSyncReady = true;
    queueRemoteFacebookGroupsSave(merged);
    return merged;
  } catch (error) {
    remoteSyncReady = false;
    console.warn("Could not load persistent Facebook group state; using browser cache.", error);
    return localGroups;
  }
}

export function saveFacebookGroups(groups, options = {}) {
  if (typeof window === "undefined") return;
  const snapshot = Array.isArray(groups) ? groups : [];
  window.localStorage.setItem(GROUP_STORAGE_KEY, JSON.stringify(snapshot));
  if (options.remote !== false && remoteSyncReady) queueRemoteFacebookGroupsSave(snapshot);
}

export function mergeFacebookGroups(existing, incoming) {
  const map = new Map();
  for (const group of [...(existing || []), ...(incoming || [])]) {
    const key = groupKey(group);
    if (!key) continue;
    const previous = map.get(key) || {};
    map.set(key, {
      ...previous,
      ...group,
      id: group.id || previous.id || `group-${key.replace(/[^a-z0-9]+/g, "-").slice(0, 80)}`,
      url: normalizeFacebookGroupUrl(group.url || group.groupUrl || previous.url),
      name: cleanGroupName(group.name) || cleanGroupName(previous.name) || group.name || previous.name || "Facebook group",
      finance: group.finance ?? previous.finance ?? true,
      rent2buy: group.rent2buy ?? previous.rent2buy ?? true,
    });
  }
  return consolidateFacebookGroups([...map.values()]);
}

const POST_HISTORY_FIELDS = Object.freeze([
  "lastPostedAt", "lastPostPermalink", "lastRenewalPostedAt", "postStatus", "pendingRegistration",
  "lastPostCheckAt", "lastPostDetectedState", "lastPostMatchMethod",
]);
const timeOf = (value) => Date.parse(value || "") || 0;
function historyRank(group) {
  if (group.archived) return 0;
  const pipeline = groupPipeline(group);
  return pipeline === "proven" ? 3 : pipeline === "testing" ? 2 : 1;
}

// Records that share a Facebook group ID are the same group stored under two URLs
// (vanity name and numeric ID). Keep one record with the combined posting and
// approval history; the other stays in the database marked mergedInto (history only).
export function consolidateFacebookGroups(groups, now = new Date()) {
  const list = groups || [];
  const byId = new Map();
  list.forEach((group, position) => {
    if (group?.mergedInto) return;
    const id = facebookGroupNumericId(group);
    if (!id) return;
    if (!byId.has(id)) byId.set(id, []);
    byId.get(id).push(position);
  });
  if (![...byId.values()].some((positions) => positions.length > 1)) return list;

  const result = [...list];
  for (const [id, positions] of byId) {
    if (positions.length < 2) continue;
    const records = positions.map((position) => result[position]);
    const ordered = [...records].sort((a, b) =>
      historyRank(b) - historyRank(a)
      || Number(b.postCount || 0) - Number(a.postCount || 0)
      || timeOf(b.lastPostedAt) - timeOf(a.lastPostedAt));
    const primary = ordered[0];
    const latestPost = [...records].sort((a, b) => timeOf(b.lastPostedAt) - timeOf(a.lastPostedAt))[0];
    const sum = (field) => records.reduce((total, record) => total + Number(record[field] || 0), 0);
    const latest = (field) => records.map((record) => record[field]).filter(Boolean).sort((a, b) => timeOf(b) - timeOf(a))[0] || "";
    const earliest = (field) => records.map((record) => record[field]).filter(Boolean).sort((a, b) => timeOf(a) - timeOf(b))[0] || "";
    let merged = {
      ...primary,
      groupId: id,
      finance: records.some((record) => record.finance !== false),
      rent2buy: records.some((record) => record.rent2buy !== false),
      postCount: sum("postCount"),
      acceptedPostCount: sum("acceptedPostCount"),
      rejectedPostCount: sum("rejectedPostCount"),
      lastAcceptedAt: latest("lastAcceptedAt"),
      lastCheckedAt: latest("lastCheckedAt"),
      discoveredAt: earliest("discoveredAt") || primary.discoveredAt || "",
      leads: sum("leads"),
    };
    if (latestPost !== primary && timeOf(latestPost.lastPostedAt) > timeOf(primary.lastPostedAt)) {
      for (const field of POST_HISTORY_FIELDS) merged[field] = latestPost[field] ?? merged[field];
    }
    for (const record of records) {
      if (record === primary) continue;
      merged = withAlias(merged, record.url);
      for (const alias of record.aliasUrls || []) merged = withAlias(merged, alias);
    }
    const mergedAt = now.toISOString();
    positions.forEach((position) => {
      const record = result[position];
      result[position] = record === primary ? merged : {
        ...record,
        mergedInto: primary.url,
        mergedAt: record.mergedAt || mergedAt,
        archived: true,
        archivedAt: record.archivedAt && record.archived ? record.archivedAt : mergedAt,
        archiveReason: `Same Facebook group as ${cleanGroupName(primary.name) || primary.url}`,
      };
    });
  }
  return result;
}

export function applyGroupInspection(groups, inspections, productKey) {
  // Match on any identity: Facebook may redirect a numeric URL to the vanity name.
  const byKey = new Map();
  for (const item of inspections || []) {
    for (const key of groupIdentityKeys({ url: item.url, requestedUrl: item.requestedUrl, groupId: item.groupId })) {
      if (!byKey.has(key)) byKey.set(key, item);
    }
  }
  return consolidateFacebookGroups((groups || []).map((group) => {
    const inspection = groupIdentityKeys(group).map((key) => byKey.get(key)).find(Boolean);
    if (!inspection) return group;
    const evidence = clean(inspection.ruleText || inspection.pageText || inspection.context || "");
    const classified = inspection.explicitStatus || ruleClassification(evidence);
    const unavailable = Boolean(inspection.unavailable);
    let next = {
      ...group,
      ...(/^\d{5,}$/.test(clean(inspection.groupId)) ? { groupId: clean(inspection.groupId) } : {}),
      name: cleanGroupName(inspection.name) || cleanGroupName(group.name) || group.name,
      members: inspection.members || group.members,
      privacy: inspection.privacy || group.privacy,
      canPost: typeof inspection.canPost === "boolean" ? inspection.canPost : group.canPost,
      // Posting eligibility read from the group page's visible controls (helper 1.2.45+).
      ...(POSTING_MODES.includes(inspection.postingMode) ? {
        postingMode: inspection.postingMode,
        postingEvidence: clean(inspection.postingEvidence || "").slice(0, 120),
        postingCheckedAt: new Date().toISOString(),
      } : {}),
      joined: typeof inspection.joined === "boolean" ? inspection.joined : group.joined,
      membershipPending: inspection.joined === true
        ? false
        : typeof inspection.membershipPending === "boolean"
          ? inspection.membershipPending
          : Boolean(group.membershipPending),
      approvalRequired: typeof inspection.approvalRequired === "boolean"
        ? inspection.approvalRequired
        : group.approvalRequired,
      linksAllowed: typeof inspection.linksAllowed === "boolean" ? inspection.linksAllowed : group.linksAllowed,
      ruleEvidence: clean(inspection.ruleEvidence || evidence).slice(0, 1400),
      status: unavailable ? "Red" : classified,
      lastCheckedAt: new Date().toISOString(),
      unavailable,
      archived: unavailable || classified === "Red" ? true : Boolean(group.archived),
      archiveReason: unavailable
        ? "Facebook says this group/content is unavailable"
        : classified === "Red"
          ? "Live rules say commercial/dealer/promotional posts are not allowed"
          : group.archiveReason || "",
      source: group.source === "seed" ? "seed+live-check" : "facebook-live",
    };
    next = withAlias(withAlias(next, inspection.url), inspection.requestedUrl);
    next.score = calculateScore(next, productKey);
    return next;
  }));
}

function discoveredRecord(candidate, productKey, discoveredAt) {
  const query = clean(candidate.query || "");
  const next = {
      id: candidate.id || "",
      name: cleanGroupName(candidate.name || candidate.title) || "Facebook group",
      url: normalizeFacebookGroupUrl(candidate.url || candidate.groupUrl),
      ...(/^\d{5,}$/.test(clean(candidate.groupId)) ? { groupId: clean(candidate.groupId) } : {}),
      area: clean(candidate.area || ""),
      query,
      segment: clean(candidate.segment || "Discovered"),
      finance: productKey === "finance",
      rent2buy: productKey === "rent2buy",
      members: clean(candidate.members || ""),
      privacy: clean(candidate.privacy || ""),
      status: "Amber",
      seedScore: 50,
      source: "facebook-discovery",
      context: clean(candidate.context || "").slice(0, 1200),
      discoveredAt,
      lastDiscoveredAt: discoveredAt,
      discoveryCount: 1,
      canPost: null,
      joined: null,
      membershipPending: false,
      approvalRequired: null,
      linksAllowed: null,
      ruleEvidence: "",
      lastCheckedAt: "",
      lastPostedAt: "",
      lastAcceptedAt: "",
      lastPostCheckAt: "",
      postStatus: "new",
      pipeline: "new",
      repeatDays: 7,
      pendingRegistration: "",
      postCount: 0,
      acceptedPostCount: 0,
      rejectedPostCount: 0,
      archived: false,
      archiveReason: "",
      leads: 0,
  };
  next.score = calculateScore(next, productKey);
  return next;
}

// A search result for a group already on record (any status, archived included,
// under any of its URLs or its numeric ID) only refreshes discovery metadata:
// pipeline, post history, approval history, status and archive state never change.
function touchKnownGroup(existing, found, productKey) {
  let next = {
    ...existing,
    lastDiscoveredAt: found.discoveredAt,
    discoveryCount: Number(existing.discoveryCount || 1) + 1,
    name: cleanGroupName(existing.name) || found.name || existing.name,
    members: existing.members || found.members,
    privacy: existing.privacy || found.privacy,
    ...(found.groupId && !existing.groupId ? { groupId: found.groupId } : {}),
  };
  next = withAlias(next, found.url);
  // A live group found by the other product's search becomes available to it too.
  if (!existing.archived && !existing[productKey] && isRelevantAdvertisingGroup(found)
    && (productKey !== "rent2buy" || isRent2BuyLocalGroup(found))) {
    next[productKey] = true;
  }
  return next;
}

// Returns the merged records and a report: how many search results were new,
// already known (and how many of those are archived), or outside scope.
export function mergeDiscoveredGroupsWithReport(groups, candidates, productKey, now = new Date()) {
  const discoveredAt = now.toISOString();
  const result = [...(groups || [])];
  const index = identityIndex(result);
  const seen = new Set();
  const report = { found: 0, added: 0, known: 0, knownArchived: 0, outOfScope: 0, addedUrls: [] };
  for (const candidate of candidates || []) {
    const found = discoveredRecord(candidate, productKey, discoveredAt);
    if (!found.url || !groupSlug(found.url)) continue;
    const keys = groupIdentityKeys(found);
    if (keys.some((key) => seen.has(key))) continue;
    keys.forEach((key) => seen.add(key));
    report.found += 1;

    const position = keys.map((key) => index.get(key)).find((value) => value !== undefined);
    if (position !== undefined) {
      const existing = result[position];
      report.known += 1;
      if (existing.archived) report.knownArchived += 1;
      result[position] = touchKnownGroup(existing, found, productKey);
      for (const key of groupIdentityKeys(result[position])) {
        if (!index.has(key)) index.set(key, position);
        seen.add(key); // later results for the same group in this run are the same find
      }
      continue;
    }
    if (!isRelevantAdvertisingGroup(found) || (productKey === "rent2buy" && !isRent2BuyLocalGroup(found))) {
      report.outOfScope += 1;
      continue;
    }
    result.push(found);
    for (const key of keys) index.set(key, result.length - 1);
    report.added += 1;
    report.addedUrls.push(found.url);
  }
  return { groups: mergeFacebookGroups([], result), report };
}

export function mergeDiscoveredGroups(groups, candidates, productKey) {
  return mergeDiscoveredGroupsWithReport(groups, candidates, productKey).groups;
}

function rotatedQueries(productKey, limit = 8) {
  const bank = productKey === "rent2buy" ? RENT2BUY_QUERY_BANK : FINANCE_QUERY_BANK;
  if (typeof window === "undefined") return bank.slice(0, limit);
  let state = {};
  try {
    state = JSON.parse(window.localStorage.getItem(DISCOVERY_ROTATION_KEY) || "{}");
  } catch {}
  const start = Number(state?.[productKey] || 0) % bank.length;
  const result = [];
  for (let index = 0; index < Math.min(limit, bank.length); index += 1) {
    result.push(bank[(start + index) % bank.length]);
  }
  const next = { ...state, [productKey]: (start + result.length) % bank.length };
  try { window.localStorage.setItem(DISCOVERY_ROTATION_KEY, JSON.stringify(next)); } catch {}
  return result;
}

function messageRoundTrip(type, ackType, payload, timeoutMs = 9000) {
  if (typeof window === "undefined") return Promise.reject(new Error("Facebook Groups agent requires a browser."));
  return new Promise((resolve, reject) => {
    const id = payload?.id;
    const timeout = window.setTimeout(() => {
      window.removeEventListener("message", onMessage);
      reject(new Error("Facebook helper did not acknowledge the request. Check that the latest extension is installed and enabled."));
    }, timeoutMs);

    function onMessage(event) {
      if (event.source !== window || event.origin !== window.location.origin) return;
      const message = event.data || {};
      if (message.source !== "vfc-facebook-helper" || message.type !== ackType) return;
      if (id && message.id && message.id !== id) return;
      window.clearTimeout(timeout);
      window.removeEventListener("message", onMessage);
      if (message.ok === false) reject(new Error(message.error || "Facebook helper rejected the request."));
      else resolve(message);
    }

    window.addEventListener("message", onMessage);
    window.postMessage({ source: "vfc-marketing-crm", type, ...payload }, window.location.origin);
  });
}

async function withJobId(jobId, pending) {
  const ack = await pending;
  return { ...ack, jobId };
}

function requestId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function getFacebookHelperStatus(timeoutMs = 2500) {
  const id = requestId("helper-health");
  return messageRoundTrip(FACEBOOK_HELPER_PING, FACEBOOK_HELPER_PONG, { id }, timeoutMs)
    .then((message) => ({
      connected: true,
      version: clean(message.version || ""),
      capabilities: Array.isArray(message.capabilities) ? message.capabilities : [],
      approvalMonitor: message.approvalMonitor || null,
      hostname: clean(message.hostname || ""),
    }))
    .catch(() => ({
      connected: false,
      version: "",
      capabilities: [],
      hostname: "",
    }));
}

export function requestFacebookGroupRecoverySnapshot(timeoutMs = 4000) {
  const id = requestId("group-recovery");
  return messageRoundTrip(GROUP_RECOVERY_REQUEST, GROUP_RECOVERY_RESPONSE, { id }, timeoutMs);
}

function recoveryGroupFromMonitor(item = {}) {
  const url = normalizeFacebookGroupUrl(item.groupUrl || item.url || "");
  if (!url) return null;
  const productKey = clean(item.productKey || "");
  return {
    id: `recovered-${groupKey({ url }).replace(/[^a-z0-9]+/g, "-").slice(0, 80)}`,
    name: clean(item.groupName || item.name || "Recovered Facebook group"),
    url,
    area: clean(item.area || ""),
    segment: clean(item.segment || "Recovered"),
    finance: productKey ? productKey === "finance" : true,
    rent2buy: productKey ? productKey === "rent2buy" : true,
    members: "",
    privacy: "",
    status: "Amber",
    seedScore: 50,
    score: 50,
    source: "extension-recovery",
    canPost: true,
    joined: true,
    membershipPending: false,
    approvalRequired: null,
    linksAllowed: null,
    ruleEvidence: "",
    lastCheckedAt: "",
    lastPostedAt: item.postedAt || "",
    lastAcceptedAt: "",
    lastPostCheckAt: item.lastCheckedAt || "",
    postStatus: item.lastResult === "pending" ? "pending" : "awaiting",
    pipeline: "testing",
    repeatDays: 7,
    pendingRegistration: clean(item.registration || ""),
    postCount: 1,
    acceptedPostCount: 0,
    rejectedPostCount: 0,
    archived: false,
    archiveReason: "",
    leads: 0,
  };
}

export function recoverFacebookGroupsFromSnapshot(groups, snapshot = {}) {
  let recovered = mergeFacebookGroups([], groups || []);
  const monitorItems = Array.isArray(snapshot.approvalItems) ? snapshot.approvalItems : [];
  const candidates = [...monitorItems];
  if (snapshot.lastPostEvent) candidates.push(snapshot.lastPostEvent);

  for (const item of candidates) {
    const next = recoveryGroupFromMonitor(item);
    if (!next) continue;
    const key = groupKey(next);
    const existing = recovered.find((group) => groupKey(group) === key);
    if (existing && ["proven", "archived"].includes(groupPipeline(existing))) continue;
    recovered = mergeFacebookGroups(recovered, [next]);
  }

  const statusEvent = snapshot.lastStatusEvent || null;
  if (statusEvent?.groupUrl || statusEvent?.url) {
    const fallback = recoveryGroupFromMonitor(statusEvent);
    if (fallback && !recovered.some((group) => groupKey(group) === groupKey(fallback))) {
      recovered = mergeFacebookGroups(recovered, [fallback]);
    }
    if (statusEvent.accepted) {
      recovered = markGroupAccepted(recovered, statusEvent.groupUrl || statusEvent.url, {
        acceptedAt: statusEvent.checkedAt,
        registration: statusEvent.registration,
      });
    } else if (statusEvent.declined || statusEvent.unavailable) {
      recovered = markGroupPostStatus(recovered, statusEvent);
    }
  }

  const batchResults = [
    ...(Array.isArray(snapshot.agentState?.results) ? snapshot.agentState.results : []),
    ...(Array.isArray(snapshot.lastStatusBatch?.results) ? snapshot.lastStatusBatch.results : []),
  ];
  for (const result of batchResults) recovered = markGroupPostStatus(recovered, result);

  return recovered;
}

function lastPostStateTime(group) {
  return Math.max(0, ...[
    group?.lastPostedAt,
    group?.lastPostCheckAt,
    group?.lastAcceptedAt,
    group?.archivedAt,
    group?.restoredAt,
  ].map((value) => Date.parse(value || "") || 0));
}

export function mergeFacebookGroupsByRecentPostState(localGroups, remoteGroups) {
  const localByKey = new Map((localGroups || []).map((group) => [groupKey(group), group]));
  const remoteByKey = new Map((remoteGroups || []).map((group) => [groupKey(group), group]));
  return mergeFacebookGroups(localGroups, remoteGroups).map((group) => {
    const key = groupKey(group);
    const local = localByKey.get(key);
    const remote = remoteByKey.get(key);
    return local && remote && lastPostStateTime(local) > lastPostStateTime(remote)
      ? { ...group, ...local }
      : group;
  });
}

export function startFacebookGroupDiscovery(productKey, options = {}) {
  const queries = rotatedQueries(productKey, options.queryCount || 8);
  const id = requestId("group-discovery");
  return withJobId(id, messageRoundTrip(GROUP_AGENT_DISCOVERY_START, GROUP_AGENT_DISCOVERY_ACK, {
    id,
    job: {
      id,
      productKey,
      queries,
      maxGroups: Number(options.maxGroups || 60),
      startedAt: new Date().toISOString(),
    },
  }));
}

export function startFacebookGroupInspection(groups, productKey, limit = 12) {
  const targets = (groups || [])
    .filter((group) =>
      group.url &&
      group.status !== "Red" &&
      /^https:\/\/www\.facebook\.com\/groups\//i.test(normalizeFacebookGroupUrl(group.url))
    )
    .sort((a, b) => {
      const aChecked = a.lastCheckedAt ? new Date(a.lastCheckedAt).getTime() : 0;
      const bChecked = b.lastCheckedAt ? new Date(b.lastCheckedAt).getTime() : 0;
      if (aChecked !== bChecked) return aChecked - bChecked;
      return Number(b.score || 0) - Number(a.score || 0);
    })
    .slice(0, Math.max(1, Math.min(25, Number(limit || 12))));

  if (!targets.length) return Promise.reject(new Error("There are no groups waiting for a live check."));

  const id = requestId("group-inspection");
  return withJobId(id, messageRoundTrip(GROUP_AGENT_INSPECTION_START, GROUP_AGENT_INSPECTION_ACK, {
    id,
    job: {
      id,
      productKey,
      groups: targets.map((group) => ({ name: group.name, url: group.url })),
      startedAt: new Date().toISOString(),
    },
  }));
}

// Posting eligibility, from the helper's live check of the group page.
export const POSTING_MODES = Object.freeze(["normal", "listing_only", "join_required", "membership_pending", "posting_off", "unavailable", "unknown"]);
const POSTING_LABELS = Object.freeze({
  normal: "Normal posting available",
  listing_only: "Marketplace listings only",
  join_required: "Join the group first",
  membership_pending: "Membership pending",
  posting_off: "Posting turned off",
  unavailable: "Group unavailable",
  unknown: "Posting not confirmed",
});
export function groupPostingLabel(group) {
  return POSTING_LABELS[group?.postingMode] || "Posting not checked yet";
}

// Ready to Test: an untested group where Facebook showed a normal post composer.
export function isReadyToTest(group) {
  return !group?.archived && !group?.mergedInto && groupPipeline(group) === "new" && group?.postingMode === "normal";
}

// Not suitable for a normal advert on the evidence Facebook showed (selling/listing
// controls only, or posting switched off). Kept, not archived; a later check can change it.
export function isUnsuitableForTesting(group) {
  return !group?.archived && groupPipeline(group) === "new" && ["listing_only", "posting_off"].includes(group?.postingMode);
}

// "Check All Groups": every active group not live-checked in the last
// GROUP_RECHECK_DAYS days, plus any group whose posting eligibility is not yet known.
export const GROUP_RECHECK_DAYS = 7;
export const CHECK_BATCH_SIZE = 25;
export function groupCheckQueue(groups, productKey, now = new Date()) {
  const staleBefore = now.getTime() - GROUP_RECHECK_DAYS * 86400000;
  return scoreFacebookGroups(groups, productKey)
    .filter((group) =>
      !group.archived &&
      group.status !== "Red" &&
      Boolean(groupSlug(group.url)) &&
      (timeOf(group.lastCheckedAt) < staleBefore || !group.postingCheckedAt))
    .sort((a, b) => timeOf(a.postingCheckedAt) - timeOf(b.postingCheckedAt)
      || timeOf(a.lastCheckedAt) - timeOf(b.lastCheckedAt) || Number(b.score || 0) - Number(a.score || 0));
}

// "Check All Awaiting Posts": every posted advert still awaiting an approval decision.
export function awaitingPostQueue(groups, productKey) {
  return (groups || [])
    .filter((group) =>
      productAllowed(group, productKey) &&
      !group.archived &&
      group.lastPostedAt &&
      ["awaiting", "pending", "not_found"].includes(group.postStatus) &&
      group.pendingRegistration &&
      Boolean(groupSlug(group.url)))
    .sort((a, b) => timeOf(a.lastPostCheckAt || a.lastPostedAt) - timeOf(b.lastPostCheckAt || b.lastPostedAt));
}

export function checkQueueKey(group) {
  return groupKey(group);
}

// Stops the helper's current inspection / post-check batch; it reports the
// results gathered so far as a normal completion.
export function cancelFacebookGroupAgentJob(jobId) {
  return messageRoundTrip(GROUP_AGENT_CANCEL, GROUP_AGENT_CANCEL_ACK, { id: requestId("group-cancel"), jobId }, 5000);
}

function vehicleRegistration(vehicle) {
  return clean(vehicle?.registration || vehicle?.reg || vehicle?.title).toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function vehicleImage(vehicle) {
  return clean(
    vehicle?.image ||
    vehicle?.picture ||
    vehicle?.photo ||
    vehicle?.mainImage ||
    vehicle?.imageUrl ||
    vehicle?.rent2buyData?.image ||
    vehicle?.rent2buyData?.picture ||
    "",
  );
}

export function groupDueState(group, now = new Date()) {
  if (!group || group.pipeline !== "proven" || !group.lastPostedAt) {
    return { due: false, daysSincePost: null, daysUntilDue: null };
  }
  const postedAt = new Date(group.lastPostedAt);
  if (Number.isNaN(postedAt.getTime())) return { due: false, daysSincePost: null, daysUntilDue: null };
  const daysSincePost = Math.floor((now.getTime() - postedAt.getTime()) / 86400000);
  const repeatDays = Math.max(1, Number(group.repeatDays || 7));
  return {
    due: daysSincePost >= repeatDays,
    daysSincePost,
    daysUntilDue: Math.max(0, repeatDays - daysSincePost),
  };
}

export function groupPipeline(group) {
  if (group?.archived) return "archived";
  if (group?.pipeline === "proven" || Number(group?.acceptedPostCount || 0) > 0) return "proven";
  if (group?.postStatus === "awaiting" || group?.postStatus === "pending" || group?.postStatus === "not_found") return "testing";
  if (group?.membershipPending) return "membership_pending";
  return "new";
}

export function requestGroupRenewalHelper(command, jobId, options = {}) {
  return messageRoundTrip("VFC_GROUP_RENEWAL_REQUEST", "VFC_GROUP_RENEWAL_RESPONSE", {
    id: requestId("group-renewal"), command, jobId, ...options,
  });
}

export function buildFacebookGroupPostJob({ group, vehicle, caption, productKey, captionCopied = false, renewal }) {
  if (!group?.url) throw new Error("Choose a Facebook group first.");
  if (!vehicle) throw new Error("Choose a van first.");
  const id = renewal?.jobId || requestId("group-post");
  return {
    id,
    productKey,
    groupUrl: normalizeFacebookGroupUrl(group.url),
    groupName: group.name || "Facebook group",
    registration: vehicleRegistration(vehicle),
    vehicleId: String(vehicle.id || ""),
    caption: preserveFacebookGroupCaption(caption || vehicle.caption || ""),
    captionCopied: Boolean(captionCopied),
    imageUrl: vehicleImage(vehicle),
    createdAt: new Date().toISOString(),
    ...(renewal && productKey === "rent2buy" ? { renewal: { date: renewal.date, ...(renewal.automatic ? { automatic: true } : {}) } } : {}),
  };
}

export async function prepareFacebookGroupPost(options) {
  const job = buildFacebookGroupPostJob(options);
  return messageRoundTrip(GROUP_POST_JOB, GROUP_POST_JOB_ACK, { id: job.id, job });
}

function sameGroupMatcher(groupUrl) {
  const wanted = new Set(groupIdentityKeys({ url: groupUrl }));
  return (group) => !group?.mergedInto && groupIdentityKeys(group).some((key) => wanted.has(key));
}

export function markGroupPosted(groups, groupUrl, details = {}) {
  const matches = sameGroupMatcher(groupUrl);
  const postedAt = details.postedAt || new Date().toISOString();
  return (groups || []).map((group) => {
    if (!matches(group)) return group;
    return {
      ...group,
      lastPostedAt: postedAt,
      lastPostPermalink: details.permalink || "",
      ...(details.renewalPost ? { lastRenewalPostedAt: postedAt } : {}),
      lastPostCheckAt: "",
      postStatus: details.approvalState === "accepted" ? "accepted" : details.renewalPost && details.approvalState === "pending" ? "pending" : "awaiting",
      lastPostDetectedState: "",
      lastPostMatchMethod: "",
      pendingRegistration: clean(details.registration || group.pendingRegistration || ""),
      postCount: Number(group.postCount || 0) + (details.increment === false ? 0 : 1),
      pipeline: details.approvalState === "accepted" ? "proven" : group.pipeline === "proven" ? "proven" : "testing",
    };
  });
}

export function markGroupAccepted(groups, groupUrl, details = {}) {
  const matches = sameGroupMatcher(groupUrl);
  const acceptedAt = details.acceptedAt || new Date().toISOString();
  return (groups || []).map((group) => {
    if (!matches(group)) return group;
    const alreadyAccepted = group.postStatus === "accepted" && group.pendingRegistration === clean(details.registration || group.pendingRegistration || "");
    return {
      ...group,
      status: "Green",
      pipeline: "proven",
      postStatus: "accepted",
      lastAcceptedAt: acceptedAt,
      lastPostCheckAt: acceptedAt,
      acceptedPostCount: Number(group.acceptedPostCount || 0) + (alreadyAccepted ? 0 : 1),
      pendingRegistration: clean(details.registration || group.pendingRegistration || ""),
      canPost: group.canPost === false ? group.canPost : true,
    };
  });
}

export function markGroupPostStatus(groups, result) {
  const matches = sameGroupMatcher(result?.url || result?.groupUrl || "");
  return (groups || []).map((group) => {
    if (!matches(group)) return group;
    // A delayed result from an older advert must never change the current advert.
    if (registrationKey(result?.registration) !== registrationKey(group.pendingRegistration)) return group;
    const checkedAt = Date.parse(result?.checkedAt || "");
    const postedAt = Date.parse(group.lastPostedAt || "");
    if (Number.isFinite(checkedAt) && Number.isFinite(postedAt) && checkedAt < postedAt) return group;
    const checkEvidence = {
      lastPostDetectedState: result?.accepted ? "accepted" : result?.declined ? "declined" : result?.unavailable ? "unavailable" : result?.pending ? "pending" : "not_found",
      lastPostMatchMethod: clean(result?.matchMethod || ""),
    };
    if (result?.declined) {
      return {
        ...group,
        ...checkEvidence,
        status: "Red",
        postStatus: "declined",
        archived: true,
        archiveReason: "Facebook declined/rejected the advert",
        archivedAt: result?.checkedAt || new Date().toISOString(),
        lastPostCheckAt: result?.checkedAt || new Date().toISOString(),
      };
    }
    if (result?.unavailable) {
      return {
        ...group,
        ...checkEvidence,
        status: "Red",
        postStatus: "unavailable",
        archived: true,
        archiveReason: "Facebook says this group/content is unavailable",
        archivedAt: result?.checkedAt || new Date().toISOString(),
        lastPostCheckAt: result?.checkedAt || new Date().toISOString(),
      };
    }
    if (result?.accepted) {
      return { ...markGroupAccepted([group], group.url, {
        acceptedAt: result.checkedAt,
        registration: result.registration,
      })[0], ...checkEvidence };
    }
    return {
      ...group,
      ...checkEvidence,
      postStatus: result?.pending ? "pending" : "not_found",
      lastPostCheckAt: result?.checkedAt || new Date().toISOString(),
    };
  });
}

export function setGroupRepeatDays(groups, groupUrl, repeatDays) {
  const matches = sameGroupMatcher(groupUrl);
  const days = Math.max(1, Math.min(90, Number(repeatDays || 7)));
  return (groups || []).map((group) =>
    matches(group) ? { ...group, repeatDays: days } : group
  );
}

export function archiveFacebookGroup(groups, groupUrl, reason = "Removed from active group list") {
  const matches = sameGroupMatcher(groupUrl);
  return (groups || []).map((group) =>
    matches(group)
      ? { ...group, archived: true, archiveReason: reason, archivedAt: new Date().toISOString() }
      : group
  );
}

export function restoreFacebookGroup(groups, groupUrl) {
  const matches = sameGroupMatcher(groupUrl);
  return (groups || []).map((group) =>
    matches(group)
      // restoredAt lets the saved state prefer this deliberate restore over the archive.
      ? { ...group, archived: false, archiveReason: "", unavailable: false, restoredAt: new Date().toISOString(), status: group.status === "Red" ? "Amber" : group.status }
      : group
  );
}

export function startFacebookPostStatusCheck(groups, productKey, limit = 12) {
  const targets = (groups || [])
    .filter((group) =>
      productAllowed(group, productKey) &&
      !group.archived &&
      group.lastPostedAt &&
      ["awaiting", "pending", "not_found"].includes(group.postStatus) &&
      group.pendingRegistration &&
      /^https:\/\/www\.facebook\.com\/groups\//i.test(normalizeFacebookGroupUrl(group.url))
    )
    .sort((a, b) => new Date(a.lastPostCheckAt || a.lastPostedAt || 0) - new Date(b.lastPostCheckAt || b.lastPostedAt || 0))
    .slice(0, Math.max(1, Math.min(25, Number(limit || 12))));

  if (!targets.length) return Promise.reject(new Error("There are no posted groups waiting for an acceptance check."));

  const id = requestId("group-post-status");
  return withJobId(id, messageRoundTrip(GROUP_POST_STATUS_START, GROUP_POST_STATUS_ACK, {
    id,
    job: {
      id,
      productKey,
      groups: targets.map((group) => ({
        name: group.name,
        url: group.url,
        registration: group.pendingRegistration,
        postedAt: group.lastPostedAt,
        ...(productKey === "rent2buy" && group.lastRenewalPostedAt === group.lastPostedAt ? { renewalPost: true, permalink: group.lastPostPermalink || "" } : {}),
      })),
      startedAt: new Date().toISOString(),
    },
  }));
}

export function scoreFacebookGroups(groups, productKey) {
  return (groups || [])
    .filter((group) => productAllowed(group, productKey))
    .map((group) => ({ ...group, score: calculateScore(group, productKey) }))
    .sort((a, b) => {
      const aDue = groupDueState(a).due ? 1 : 0;
      const bDue = groupDueState(b).due ? 1 : 0;
      if (aDue !== bDue) return bDue - aDue;
      if (groupPipeline(a) === "proven" && groupPipeline(b) !== "proven") return -1;
      if (groupPipeline(b) === "proven" && groupPipeline(a) !== "proven") return 1;
      return Number(b.score || 0) - Number(a.score || 0);
    });
}
