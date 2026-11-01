// Rollout switches are deliberately absent from deployment configuration.
// Only the literal "true" enables one existing brand's Story artwork path.
export const STORY_ARTWORK_FLAGS = Object.freeze({
  vanFinance: "STORY_ARTWORK_VFC_ENABLED",
  rent2buy: "STORY_ARTWORK_RENT2BUY_ENABLED",
  vansco: "STORY_ARTWORK_VANSCO_ENABLED",
});
export function storyArtworkEnabled(brandKey, env = process.env) {
  return Boolean(STORY_ARTWORK_FLAGS[brandKey] && env[STORY_ARTWORK_FLAGS[brandKey]] === "true");
}
export function storyRegistration(value) {
  const registration = String(value || "").toUpperCase().replace(/[\s-]/g, "");
  if (!/^[A-Z0-9]{5,8}$/.test(registration)) throw Error("story_identity_invalid");
  return registration;
}
export function ownedStoryArtworkUrl(value, brandKey, registration) {
  try {
    const u = new URL(value);
    const reg = storyRegistration(registration);
    return u.protocol === "https:" && !u.username && !u.password && !u.port && !u.search && !u.hash
      && /^[a-z0-9-]+\.public\.blob\.vercel-storage\.com$/.test(u.hostname)
      && new RegExp("^/story-artwork/v1/" + brandKey + "/" + reg + "/[a-f0-9]{64}/[a-f0-9]{64}\\.png$").test(u.pathname)
      ? u.href : "";
  } catch { return ""; }
}
