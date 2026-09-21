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
export const GROUP_POST_STATUS_EVENT = "VFC_GROUP_POST_STATUS_EVENT";
export const GROUP_POST_STATUS_EVENT_ACK = "VFC_GROUP_POST_STATUS_EVENT_ACK";
export const FACEBOOK_HELPER_PING = "VFC_FACEBOOK_HELPER_PING";
export const FACEBOOK_HELPER_PONG = "VFC_FACEBOOK_HELPER_PONG";

const GROUP_STORAGE_KEY = "marketingFacebookGroupsAgentV1";
const DISCOVERY_ROTATION_KEY = "marketingFacebookGroupDiscoveryRotationV1";

export const FACEBOOK_GROUP_PRODUCTS = Object.freeze({
  finance: "finance",
  rent2buy: "rent2buy",
});

const SEED_GROUPS = Object.freeze([
  { name: "Vans Only for Sale Swaps & Wanted", url: "https://www.facebook.com/groups/360871827417794/", area: "UK", segment: "Van/Vehicle", finance: true, rent2buy: true, members: "75K", status: "Amber", score: 72 },
  { name: "UK Car, Van, Truck, Motorbike & Parts Swaps & Sales", url: "https://www.facebook.com/groups/ukcarswaps/", area: "UK", segment: "Van/Vehicle", finance: true, rent2buy: true, members: "38K", status: "Amber", score: 70 },
  { name: "Southampton-Portsmouth UK Online Sales", url: "https://www.facebook.com/groups/Southamptoncommunitysales", area: "Southampton / Portsmouth", segment: "Local Marketplace", finance: true, rent2buy: true, members: "62,676", status: "Amber", score: 78 },
  { name: "Buy And Sell-Portsmouth Havant Waterlooville!", url: "https://www.facebook.com/groups/296917307036835", area: "Portsmouth / Havant / Waterlooville", segment: "Local Marketplace", finance: true, rent2buy: true, members: "25,969", status: "Amber", score: 77 },
  { name: "Buy & Sell Portsmouth, Southampton & Waterlooville", url: "https://www.facebook.com/groups/leabaysouthampton", area: "Portsmouth / Southampton / Waterlooville", segment: "Local Marketplace", finance: true, rent2buy: true, members: "7,838", status: "Amber", score: 75 },
  { name: "Facebay Portsmouth & Surrounding Areas", url: "https://www.facebook.com/groups/Facebay-Portsmouth-%26-Surrounding-Areas-288347711259127", area: "Portsmouth / Havant / Fareham", segment: "Local Marketplace", finance: true, rent2buy: true, members: "3,264", status: "Amber", score: 72 },
  { name: "Whats On In And Around Portsmouth (UK) For Our Children", url: "https://www.facebook.com/groups/403455093086902", area: "Portsmouth", segment: "Local Community", finance: true, rent2buy: true, members: "13,494", status: "Green", score: 81 },
  { name: "Buy, Sell, Swap And Exchange In Portsmouth And Hampshire (No Drama)", url: "https://www.facebook.com/groups/buyandsellportsmouthandhampshire", area: "Portsmouth / Hampshire", segment: "Local Marketplace", finance: true, rent2buy: true, members: "2,795", status: "Amber", score: 73 },
  { name: "Weston Super Mare Sell And Buy No Rules", url: "https://www.facebook.com/groups/953513678002756", area: "Weston-super-Mare", segment: "Local Marketplace", finance: true, rent2buy: true, members: "27,775", status: "Green", score: 78 },
  { name: "Weston Super Mare Market Place", url: "https://www.facebook.com/groups/449987541693194", area: "Weston-super-Mare", segment: "Local Marketplace", finance: true, rent2buy: true, members: "6,907", status: "Green", score: 76 },
  { name: "Weston-Super-Mare Buy, Sell, Swap No Rules", url: "https://www.facebook.com/groups/682664651809559", area: "Weston-super-Mare", segment: "Local Marketplace", finance: true, rent2buy: true, members: "2,411", status: "Green", score: 74 },
  { name: "Elite Trades Community", url: "https://www.facebook.com/groups/1821484254786832", area: "UK", segment: "Trades", finance: true, rent2buy: true, members: "170,000+", status: "Amber", score: 82 },
  { name: "Couriers TV Facebook Group", url: "https://www.facebook.com/groups/2753926601567404", area: "UK", segment: "Courier/Delivery", finance: true, rent2buy: true, members: "300+ vetted couriers", status: "Green", score: 86 },
  { name: "Transport Managers CPC UK", url: "https://facebook.com/groups/cpc.tm", area: "UK", segment: "Transport", finance: true, rent2buy: true, members: "33,000 reported", status: "Amber", score: 75 },
  { name: "Great Small Biz Community", url: "https://www.facebook.com/search/groups/?q=Great%20Small%20Biz%20Community", area: "UK", segment: "Small Business", finance: true, rent2buy: true, members: "", status: "Amber", score: 64 },
]);

const RENT2BUY_QUERY_BANK = Object.freeze([
  { query: "vans for sale Hampshire", segment: "Van/Vehicle" },
  { query: "vans buy sell swap Hampshire", segment: "Van/Vehicle" },
  { query: "Southampton buy sell", segment: "Local Marketplace" },
  { query: "Portsmouth buy sell", segment: "Local Marketplace" },
  { query: "Bournemouth buy sell", segment: "Local Marketplace" },
  { query: "Hampshire buy sell", segment: "Local Marketplace" },
  { query: "Southampton builders", segment: "Trades" },
  { query: "Hampshire builders", segment: "Trades" },
  { query: "Portsmouth electricians plumbers", segment: "Trades" },
  { query: "Southampton courier drivers", segment: "Courier/Delivery" },
  { query: "Hampshire courier drivers", segment: "Courier/Delivery" },
  { query: "Southampton self employed", segment: "Small Business" },
  { query: "Hampshire small business owners", segment: "Small Business" },
  { query: "Basingstoke buy sell", segment: "Local Marketplace" },
  { query: "Winchester buy sell", segment: "Local Marketplace" },
  { query: "Salisbury buy sell", segment: "Local Marketplace" },
  { query: "Reading buy sell vans", segment: "Local Marketplace" },
  { query: "Guildford buy sell vans", segment: "Local Marketplace" },
  { query: "Chichester buy sell", segment: "Local Marketplace" },
  { query: "Andover buy sell", segment: "Local Marketplace" },
]);

const FINANCE_QUERY_BANK = Object.freeze([
  { query: "vans for sale UK", segment: "Van/Vehicle" },
  { query: "commercial vans for sale UK", segment: "Van/Vehicle" },
  { query: "vans buy sell swap UK", segment: "Van/Vehicle" },
  { query: "commercial vehicles buy sell UK", segment: "Van/Vehicle" },
  { query: "van classifieds UK", segment: "Classifieds" },
  { query: "builders UK", segment: "Trades" },
  { query: "electricians UK", segment: "Trades" },
  { query: "plumbers UK", segment: "Trades" },
  { query: "courier drivers UK", segment: "Courier/Delivery" },
  { query: "owner drivers UK", segment: "Courier/Delivery" },
  { query: "man and van UK", segment: "Removals" },
  { query: "removal companies UK", segment: "Removals" },
  { query: "self employed UK", segment: "Small Business" },
  { query: "small business owners UK", segment: "Small Business" },
  { query: "London vans for sale", segment: "Local Marketplace" },
  { query: "Birmingham vans for sale", segment: "Local Marketplace" },
  { query: "Manchester vans for sale", segment: "Local Marketplace" },
  { query: "Leeds vans for sale", segment: "Local Marketplace" },
  { query: "Liverpool vans for sale", segment: "Local Marketplace" },
  { query: "Sheffield vans for sale", segment: "Local Marketplace" },
  { query: "Bristol vans for sale", segment: "Local Marketplace" },
  { query: "Nottingham vans for sale", segment: "Local Marketplace" },
  { query: "Leicester vans for sale", segment: "Local Marketplace" },
  { query: "Newcastle vans for sale", segment: "Local Marketplace" },
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

function productAllowed(group, productKey) {
  if (productKey === "rent2buy") return Boolean(group?.rent2buy);
  return Boolean(group?.finance);
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
  if (/\bvan|commercial vehicle/.test(text)) score += 14;
  if (/buy|sell|swap|classified|marketplace/.test(text)) score += 8;
  if (/builder|electrician|plumber|trade|courier|owner driver|removal|self employed|small business/.test(text)) score += 7;
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
    const local = /southampton|portsmouth|hampshire|bournemouth|basingstoke|winchester|salisbury|reading|guildford|chichester|andover|farnborough|woking|worthing|weston|bath|swindon|bristol/.test(text);
    if (local) score += 12;
    if (/liverpool|manchester|leeds|newcastle|warrington|wigan|nottingham|birmingham|suffolk/.test(text)) score -= 18;
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

export function saveFacebookGroups(groups) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(GROUP_STORAGE_KEY, JSON.stringify(groups || []));
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
      finance: group.finance ?? previous.finance ?? true,
      rent2buy: group.rent2buy ?? previous.rent2buy ?? true,
    });
  }
  return [...map.values()];
}

export function applyGroupInspection(groups, inspections, productKey) {
  const byKey = new Map((inspections || []).map((item) => [groupKey(item), item]));
  return (groups || []).map((group) => {
    const inspection = byKey.get(groupKey(group));
    if (!inspection) return group;
    const evidence = clean(inspection.ruleText || inspection.pageText || inspection.context || "");
    const classified = inspection.explicitStatus || ruleClassification(evidence);
    const unavailable = Boolean(inspection.unavailable);
    const next = {
      ...group,
      name: inspection.name || group.name,
      members: inspection.members || group.members,
      privacy: inspection.privacy || group.privacy,
      canPost: typeof inspection.canPost === "boolean" ? inspection.canPost : group.canPost,
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
    next.score = calculateScore(next, productKey);
    return next;
  });
}

export function mergeDiscoveredGroups(groups, candidates, productKey) {
  const incoming = (candidates || []).map((candidate) => {
    const querySegment = clean(candidate.segment || "Discovered");
    const next = {
      id: candidate.id || "",
      name: clean(candidate.name || candidate.title || "Facebook group"),
      url: normalizeFacebookGroupUrl(candidate.url || candidate.groupUrl),
      area: clean(candidate.area || ""),
      segment: querySegment,
      finance: productKey === "finance",
      rent2buy: productKey === "rent2buy",
      members: clean(candidate.members || ""),
      privacy: clean(candidate.privacy || ""),
      status: "Amber",
      seedScore: 50,
      source: "facebook-discovery",
      context: clean(candidate.context || "").slice(0, 1200),
      discoveredAt: new Date().toISOString(),
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
  }).filter((item) => item.url && item.name);
  return mergeFacebookGroups(groups, incoming);
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
      hostname: clean(message.hostname || ""),
    }))
    .catch(() => ({
      connected: false,
      version: "",
      capabilities: [],
      hostname: "",
    }));
}

export function startFacebookGroupDiscovery(productKey, options = {}) {
  const queries = rotatedQueries(productKey, options.queryCount || 8);
  const id = requestId("group-discovery");
  return messageRoundTrip(GROUP_AGENT_DISCOVERY_START, GROUP_AGENT_DISCOVERY_ACK, {
    id,
    job: {
      id,
      productKey,
      queries,
      maxGroups: Number(options.maxGroups || 60),
      startedAt: new Date().toISOString(),
    },
  });
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
  return messageRoundTrip(GROUP_AGENT_INSPECTION_START, GROUP_AGENT_INSPECTION_ACK, {
    id,
    job: {
      id,
      productKey,
      groups: targets.map((group) => ({ name: group.name, url: group.url })),
      startedAt: new Date().toISOString(),
    },
  });
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

export function prepareFacebookGroupPost({ group, vehicle, caption, productKey, captionCopied = false }) {
  if (!group?.url) return Promise.reject(new Error("Choose a Facebook group first."));
  if (!vehicle) return Promise.reject(new Error("Choose a van first."));
  const id = requestId("group-post");
  const job = {
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
  };
  return messageRoundTrip(GROUP_POST_JOB, GROUP_POST_JOB_ACK, { id, job });
}

export function markGroupPosted(groups, groupUrl, details = {}) {
  const key = normalizeFacebookGroupUrl(groupUrl).toLowerCase();
  const postedAt = details.postedAt || new Date().toISOString();
  return (groups || []).map((group) => {
    if (normalizeFacebookGroupUrl(group.url).toLowerCase() !== key) return group;
    return {
      ...group,
      lastPostedAt: postedAt,
      lastPostCheckAt: "",
      postStatus: details.approvalState === "accepted" ? "accepted" : "awaiting",
      pendingRegistration: clean(details.registration || group.pendingRegistration || ""),
      postCount: Number(group.postCount || 0) + (details.increment === false ? 0 : 1),
      pipeline: details.approvalState === "accepted" ? "proven" : group.pipeline === "proven" ? "proven" : "testing",
    };
  });
}

export function markGroupAccepted(groups, groupUrl, details = {}) {
  const key = normalizeFacebookGroupUrl(groupUrl).toLowerCase();
  const acceptedAt = details.acceptedAt || new Date().toISOString();
  return (groups || []).map((group) => {
    if (normalizeFacebookGroupUrl(group.url).toLowerCase() !== key) return group;
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
  const key = normalizeFacebookGroupUrl(result?.url || result?.groupUrl || "").toLowerCase();
  return (groups || []).map((group) => {
    if (normalizeFacebookGroupUrl(group.url).toLowerCase() !== key) return group;
    if (result?.declined) {
      return {
        ...group,
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
        status: "Red",
        postStatus: "unavailable",
        archived: true,
        archiveReason: "Facebook says this group/content is unavailable",
        archivedAt: result?.checkedAt || new Date().toISOString(),
        lastPostCheckAt: result?.checkedAt || new Date().toISOString(),
      };
    }
    if (result?.accepted) {
      return markGroupAccepted([group], group.url, {
        acceptedAt: result.checkedAt,
        registration: result.registration,
      })[0];
    }
    return {
      ...group,
      postStatus: result?.pending ? "pending" : "not_found",
      lastPostCheckAt: result?.checkedAt || new Date().toISOString(),
    };
  });
}

export function setGroupRepeatDays(groups, groupUrl, repeatDays) {
  const key = normalizeFacebookGroupUrl(groupUrl).toLowerCase();
  const days = Math.max(1, Math.min(90, Number(repeatDays || 7)));
  return (groups || []).map((group) =>
    normalizeFacebookGroupUrl(group.url).toLowerCase() === key ? { ...group, repeatDays: days } : group
  );
}

export function archiveFacebookGroup(groups, groupUrl, reason = "Removed from active group list") {
  const key = normalizeFacebookGroupUrl(groupUrl).toLowerCase();
  return (groups || []).map((group) =>
    normalizeFacebookGroupUrl(group.url).toLowerCase() === key
      ? { ...group, archived: true, archiveReason: reason, archivedAt: new Date().toISOString() }
      : group
  );
}

export function restoreFacebookGroup(groups, groupUrl) {
  const key = normalizeFacebookGroupUrl(groupUrl).toLowerCase();
  return (groups || []).map((group) =>
    normalizeFacebookGroupUrl(group.url).toLowerCase() === key
      ? { ...group, archived: false, archiveReason: "", unavailable: false, status: group.status === "Red" ? "Amber" : group.status }
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
  return messageRoundTrip(GROUP_POST_STATUS_START, GROUP_POST_STATUS_ACK, {
    id,
    job: {
      id,
      productKey,
      groups: targets.map((group) => ({
        name: group.name,
        url: group.url,
        registration: group.pendingRegistration,
        postedAt: group.lastPostedAt,
      })),
      startedAt: new Date().toISOString(),
    },
  });
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
