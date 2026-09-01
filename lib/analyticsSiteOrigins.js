export const ANALYTICS_SITE_ORIGINS = Object.freeze({
  vfc: 'https://www.vanfinancecompany.co.uk',
  rent2buy: 'https://www.rent2buyvans.co.uk',
});

const SITE_ALIASES = new Map([
  ['https://www.vanfinancecompany.co.uk', ANALYTICS_SITE_ORIGINS.vfc],
  ['https://vanfinancecompany.co.uk', ANALYTICS_SITE_ORIGINS.vfc],
  ['https://www.rent2buyvans.co.uk', ANALYTICS_SITE_ORIGINS.rent2buy],
  ['https://rent2buyvans.co.uk', ANALYTICS_SITE_ORIGINS.rent2buy],
]);

export function canonicalAnalyticsSiteOrigin(value, fallback = ANALYTICS_SITE_ORIGINS.vfc) {
  const origin = String(value || '').trim().replace(/\/$/, '');
  return SITE_ALIASES.get(origin) || fallback;
}
