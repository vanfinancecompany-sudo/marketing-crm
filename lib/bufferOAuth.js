import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { del, list, put } from "@vercel/blob";
import {
  BUFFER_API_URL,
  BUFFER_ORGANIZATION_ID,
} from "./bufferPublishing.js";

export const BUFFER_OAUTH_AUTH_URL = "https://auth.buffer.com/auth";
export const BUFFER_OAUTH_TOKEN_URL = "https://auth.buffer.com/token";
export const BUFFER_OAUTH_DEFAULT_REDIRECT_URI = "https://marketing-crm-six.vercel.app/api/buffer-oauth/callback";
export const BUFFER_OAUTH_SCOPE = "account:read posts:read posts:write offline_access";

const TOKEN_PATH = "buffer-runtime-v2/oauth/app-client-token.json";
const TRANSACTION_PREFIX = "buffer-runtime-v2/oauth/transactions/";
const REFRESH_LOCK_PREFIX = "buffer-runtime-v2/oauth/refresh-locks/";
const TRANSACTION_TTL_MS = 15 * 60 * 1000;
const ACCESS_TOKEN_SAFETY_MS = 2 * 60 * 1000;
const REFRESH_WAIT_INTERVAL_MS = 250;
const REFRESH_WAIT_ATTEMPTS = 40;
let refreshPromise = null;

function clean(value) {
  return String(value ?? "").trim();
}

function blobAvailable() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID);
}

function oauthConfig() {
  return {
    clientId: clean(process.env.BUFFER_OAUTH_CLIENT_ID),
    clientSecret: clean(process.env.BUFFER_OAUTH_CLIENT_SECRET),
    redirectUri: clean(process.env.BUFFER_OAUTH_REDIRECT_URI) || BUFFER_OAUTH_DEFAULT_REDIRECT_URI,
  };
}

export function bufferOAuthConfigured() {
  const config = oauthConfig();
  return Boolean(config.clientId && config.clientSecret && config.redirectUri);
}

function requireOAuthConfig() {
  const config = oauthConfig();
  if (!config.clientId || !config.clientSecret) {
    throw new Error("Buffer App Client OAuth is not configured on the server.");
  }
  if (!/^https:\/\//i.test(config.redirectUri)) {
    throw new Error("BUFFER_OAUTH_REDIRECT_URI must be an HTTPS URL.");
  }
  return config;
}

function encryptionKey(secret) {
  return createHash("sha256")
    .update(`vfc-marketing-crm:buffer-oauth:${clean(secret)}`)
    .digest();
}

export function encryptBufferOAuthPayload(value, secret) {
  if (!clean(secret)) throw new Error("An encryption secret is required.");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(secret), iv);
  const plaintext = Buffer.from(JSON.stringify(value), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    version: 1,
    algorithm: "aes-256-gcm",
    iv: iv.toString("base64url"),
    tag: tag.toString("base64url"),
    ciphertext: ciphertext.toString("base64url"),
  };
}

export function decryptBufferOAuthPayload(envelope, secret) {
  if (!envelope || Number(envelope.version) !== 1 || envelope.algorithm !== "aes-256-gcm") {
    throw new Error("Unsupported Buffer OAuth storage envelope.");
  }
  if (!clean(secret)) throw new Error("An encryption secret is required.");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(secret),
    Buffer.from(String(envelope.iv || ""), "base64url"),
  );
  decipher.setAuthTag(Buffer.from(String(envelope.tag || ""), "base64url"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(String(envelope.ciphertext || ""), "base64url")),
    decipher.final(),
  ]);
  return JSON.parse(plaintext.toString("utf8"));
}

async function findBlob(pathname) {
  if (!blobAvailable()) return null;
  const result = await list({ prefix: pathname, limit: 10 });
  return (result?.blobs || []).find((item) => item?.pathname === pathname) || null;
}

async function readEncryptedBlob(pathname, clientSecret) {
  if (!blobAvailable()) return null;
  try {
    const blob = await findBlob(pathname);
    if (!blob?.url) return null;
    const response = await fetch(`${blob.url}?oauth=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) return null;
    const envelope = await response.json();
    return decryptBufferOAuthPayload(envelope, clientSecret);
  } catch (error) {
    console.warn("[buffer-oauth] encrypted state read deferred", {
      pathname,
      message: error?.message || String(error),
    });
    return null;
  }
}

async function writeEncryptedBlob(pathname, value, clientSecret) {
  if (!blobAvailable()) {
    throw new Error("Vercel Blob is required for Buffer OAuth token storage.");
  }
  const envelope = encryptBufferOAuthPayload(value, clientSecret);
  await put(pathname, JSON.stringify(envelope), {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 1,
  });
}

async function deleteBlob(pathname) {
  if (!blobAvailable()) return;
  try {
    const blob = await findBlob(pathname);
    if (blob?.url) await del(blob.url);
  } catch (error) {
    console.warn("[buffer-oauth] transaction cleanup deferred", {
      pathname,
      message: error?.message || String(error),
    });
  }
}

function transactionPath(state) {
  return `${TRANSACTION_PREFIX}${state}.json`;
}

function refreshLockPath(refreshToken) {
  const fingerprint = createHash("sha256")
    .update(clean(refreshToken))
    .digest("hex")
    .slice(0, 32);
  return `${REFRESH_LOCK_PREFIX}${fingerprint}.json`;
}

async function acquireRefreshLock(refreshToken) {
  const pathname = refreshLockPath(refreshToken);
  const marker = {
    version: 1,
    created_at: new Date().toISOString(),
  };

  try {
    await put(pathname, JSON.stringify(marker), {
      access: "public",
      contentType: "application/json",
      addRandomSuffix: false,
      allowOverwrite: false,
      cacheControlMaxAge: 60,
    });
    return true;
  } catch (error) {
    // A fixed pathname per refresh-token fingerprint acts as a distributed
    // single-use marker across Vercel runtimes. If it exists, another runtime
    // has already claimed this refresh token and this runtime must not reuse it.
    const existing = await findBlob(pathname);
    if (existing) return false;
    throw error;
  }
}

function base64UrlSha256(value) {
  return createHash("sha256").update(value).digest("base64url");
}

export function buildBufferOAuthAuthorizeUrl({
  clientId,
  redirectUri,
  state,
  codeChallenge,
  scope = BUFFER_OAUTH_SCOPE,
} = {}) {
  const params = new URLSearchParams({
    client_id: clean(clientId),
    redirect_uri: clean(redirectUri),
    response_type: "code",
    scope: clean(scope),
    state: clean(state),
    code_challenge: clean(codeChallenge),
    code_challenge_method: "S256",
    prompt: "consent",
  });
  return `${BUFFER_OAUTH_AUTH_URL}?${params.toString()}`;
}

export async function createBufferOAuthAuthorization() {
  const config = requireOAuthConfig();
  const state = randomBytes(32).toString("base64url");
  const codeVerifier = randomBytes(48).toString("base64url");
  const codeChallenge = base64UrlSha256(codeVerifier);
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + TRANSACTION_TTL_MS).toISOString();

  await writeEncryptedBlob(transactionPath(state), {
    state,
    codeVerifier,
    redirectUri: config.redirectUri,
    createdAt,
    expiresAt,
  }, config.clientSecret);

  return {
    authorizeUrl: buildBufferOAuthAuthorizeUrl({
      clientId: config.clientId,
      redirectUri: config.redirectUri,
      state,
      codeChallenge,
    }),
    expiresAt,
  };
}

async function tokenRequest(form) {
  const response = await fetch(BUFFER_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams(form),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.error) {
    const error = new Error(
      clean(payload?.error_description) || clean(payload?.error) || `Buffer OAuth returned HTTP ${response.status}.`,
    );
    error.code = clean(payload?.error) || `HTTP_${response.status}`;
    error.status = response.status;
    throw error;
  }
  if (!clean(payload?.access_token)) throw new Error("Buffer OAuth did not return an access token.");
  return payload;
}

function normaliseGrant(tokens, previous = {}) {
  const expiresIn = Math.max(60, Number(tokens?.expires_in) || 3600);
  const refreshToken = clean(tokens?.refresh_token) || clean(previous?.refresh_token);
  if (!refreshToken) {
    throw new Error("Buffer OAuth did not return a refresh token. Reconnect with offline access enabled.");
  }
  return {
    access_token: clean(tokens?.access_token),
    refresh_token: refreshToken,
    token_type: clean(tokens?.token_type) || "Bearer",
    scope: clean(tokens?.scope) || clean(previous?.scope) || BUFFER_OAUTH_SCOPE,
    expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  };
}

async function loadGrant(config = oauthConfig()) {
  if (!config.clientSecret) return null;
  return readEncryptedBlob(TOKEN_PATH, config.clientSecret);
}

async function saveGrant(grant, config) {
  await writeEncryptedBlob(TOKEN_PATH, grant, config.clientSecret);
  return grant;
}

async function assertExpectedBufferOrganization(accessToken) {
  const response = await fetch(BUFFER_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      query: `query VerifyBufferAccount { account { id email organizations { id name } } }`,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  const graphMessage = clean(payload?.errors?.[0]?.message);
  if (!response.ok || graphMessage) {
    throw new Error(graphMessage || `Could not verify the Buffer account (HTTP ${response.status}).`);
  }
  const organizations = Array.isArray(payload?.data?.account?.organizations)
    ? payload.data.account.organizations
    : [];
  const matched = organizations.some((organization) => clean(organization?.id) === BUFFER_ORGANIZATION_ID);
  if (!matched) {
    throw new Error("This Buffer account is not the Van Finance Company Buffer organization.");
  }
  return true;
}

export async function exchangeBufferOAuthCode({ code, state } = {}) {
  const config = requireOAuthConfig();
  const cleanCode = clean(code);
  const cleanState = clean(state);
  if (!cleanCode || !cleanState) throw new Error("Buffer did not return a valid authorization code and state.");

  const path = transactionPath(cleanState);
  const transaction = await readEncryptedBlob(path, config.clientSecret);
  if (!transaction || transaction.state !== cleanState) {
    throw new Error("Buffer OAuth state could not be verified. Start the connection again.");
  }
  const expiresAtMs = new Date(transaction.expiresAt || 0).getTime();
  if (!Number.isFinite(expiresAtMs) || expiresAtMs < Date.now()) {
    await deleteBlob(path);
    throw new Error("Buffer OAuth setup expired. Start the connection again.");
  }

  try {
    const tokens = await tokenRequest({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: "authorization_code",
      code: cleanCode,
      redirect_uri: transaction.redirectUri || config.redirectUri,
      code_verifier: clean(transaction.codeVerifier),
    });
    const grant = normaliseGrant(tokens);
    await assertExpectedBufferOrganization(grant.access_token);
    await saveGrant(grant, config);
    return {
      connected: true,
      expiresAt: grant.expires_at,
      scope: grant.scope,
    };
  } finally {
    await deleteBlob(path);
  }
}

function grantHasRotated(grant, originalRefreshToken) {
  return Boolean(
    grant?.refresh_token
      && clean(grant.refresh_token) !== clean(originalRefreshToken)
      && new Date(grant.expires_at || 0).getTime() > Date.now() + ACCESS_TOKEN_SAFETY_MS,
  );
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForRotatedGrant(config, originalRefreshToken) {
  for (let attempt = 0; attempt < REFRESH_WAIT_ATTEMPTS; attempt += 1) {
    if (attempt > 0) await wait(REFRESH_WAIT_INTERVAL_MS);
    const latest = await loadGrant(config);
    if (grantHasRotated(latest, originalRefreshToken)) return latest;
  }
  return null;
}

async function refreshGrantOnce(config, grant) {
  const originalRefreshToken = clean(grant?.refresh_token);
  if (!originalRefreshToken) throw new Error("Buffer OAuth refresh token is missing. Reconnect Buffer.");

  const latestBeforeLock = await loadGrant(config);
  if (grantHasRotated(latestBeforeLock, originalRefreshToken)) return latestBeforeLock;

  const ownsRefreshToken = await acquireRefreshLock(originalRefreshToken);
  if (!ownsRefreshToken) {
    const latest = await waitForRotatedGrant(config, originalRefreshToken);
    if (latest) return latest;
    const pending = new Error("Buffer authorization refresh is already in progress. Please retry shortly.");
    pending.code = "BUFFER_OAUTH_REFRESH_IN_PROGRESS";
    throw pending;
  }

  // Re-read after claiming the token so a refresh completed by an older
  // deployment during rollout cannot make this runtime reuse a stale token.
  const latestAfterLock = await loadGrant(config);
  if (grantHasRotated(latestAfterLock, originalRefreshToken)) return latestAfterLock;

  try {
    const tokens = await tokenRequest({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: "refresh_token",
      refresh_token: originalRefreshToken,
    });
    const nextGrant = normaliseGrant(tokens, grant);
    await saveGrant(nextGrant, config);
    console.info("[buffer-oauth] access token refreshed safely", {
      expiresAt: nextGrant.expires_at,
    });
    return nextGrant;
  } catch (error) {
    if (error?.code === "invalid_grant") {
      // Another runtime may have rotated the single-use token immediately
      // before this deployment became active. Give its encrypted grant time
      // to become visible before declaring the authorization dead.
      const latest = await waitForRotatedGrant(config, originalRefreshToken);
      if (latest) return latest;
      const wrapped = new Error("Buffer authorization needs to be reconnected.");
      wrapped.code = "BUFFER_OAUTH_REAUTHORIZE";
      throw wrapped;
    }
    throw error;
  }
}

async function refreshGrant(config, grant) {
  if (!refreshPromise) {
    refreshPromise = refreshGrantOnce(config, grant).finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

export async function getBufferAppClientAccessToken() {
  if (!bufferOAuthConfigured()) return null;
  const config = requireOAuthConfig();
  let grant = await loadGrant(config);
  if (!grant?.access_token) return null;

  const expiresAtMs = new Date(grant.expires_at || 0).getTime();
  if (Number.isFinite(expiresAtMs) && expiresAtMs > Date.now() + ACCESS_TOKEN_SAFETY_MS) {
    return grant.access_token;
  }

  grant = await refreshGrant(config, grant);
  return clean(grant?.access_token) || null;
}

export async function resolveBufferCredential(fallbackToken = "") {
  if (bufferOAuthConfigured()) {
    const appClientToken = await getBufferAppClientAccessToken();
    if (appClientToken) {
      return {
        token: appClientToken,
        source: "app_client_oauth",
      };
    }
  }

  const personalToken = clean(fallbackToken) || clean(process.env.BUFFER_API_KEY);
  if (!personalToken) {
    throw new Error("No Buffer API credential is configured on the server.");
  }
  return {
    token: personalToken,
    source: "personal_access",
  };
}

export async function getBufferOAuthStatus() {
  const configured = bufferOAuthConfigured();
  const config = oauthConfig();
  const grant = configured ? await loadGrant(config) : null;
  return {
    configured,
    authorized: Boolean(grant?.access_token && grant?.refresh_token),
    credentialSource: grant?.access_token ? "app_client_oauth" : "personal_access",
    expiresAt: grant?.expires_at || null,
    scope: grant?.scope || null,
    redirectUri: config.redirectUri || BUFFER_OAUTH_DEFAULT_REDIRECT_URI,
  };
}
