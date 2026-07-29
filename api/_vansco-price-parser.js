import { compactWhitespace, decodeHtml } from "./_vansco-cache-utils.js";

const MONEY_PATTERN = /£\s*([0-9]{1,3}(?:,[0-9]{3})+|[0-9]{4,6})(?:\.([0-9]{2}))?/i;
const EXCLUDED_CONTEXT = /\b(per\s+(?:month|week)|monthly|weekly|deposit|repayment|payment|finance\s+from|save|saving|warranty|admin\s+fee)\b/i;

function parseMoney(text) {
  const match = String(text || "").match(MONEY_PATTERN);
  if (!match) return null;
  const whole = Number(String(match[1]).replace(/,/g, ""));
  const decimal = Number(match[2] || 0) / 100;
  const value = whole + decimal;
  return Number.isFinite(value) && value > 0 ? value : null;
}

function classifyVat(text) {
  const value = compactWhitespace(text).toUpperCase();
  if (!value) return "unknown";
  if (/\bNO\s+VAT\b|\bVAT\s+FREE\b/.test(value)) return "no_vat";
  if (/\+\s*VAT\b|\bPLUS\s+VAT\b|\bEX(?:CLUDING)?\s+VAT\b/.test(value)) return "plus_vat";
  if (/\bVAT\s+INCLUDED\b|\bINC(?:LUDING)?\s+VAT\b/.test(value)) return "vat_included";
  return "unknown";
}

function candidateFromText(text, { requireVat = false } = {}) {
  const clean = compactWhitespace(decodeHtml(text));
  if (!clean || EXCLUDED_CONTEXT.test(clean)) return null;
  const advertisedPrice = parseMoney(clean);
  if (advertisedPrice === null) return null;
  const vatStatus = classifyVat(clean);
  if (requireVat && vatStatus === "unknown") return null;
  const moneyText = clean.match(MONEY_PATTERN)?.[0] || "";
  const vatText = vatStatus === "no_vat"
    ? clean.match(/\b(?:NO\s+VAT|VAT\s+FREE)\b/i)?.[0] || "NO VAT"
    : vatStatus === "plus_vat"
      ? clean.match(/(?:\+\s*VAT|PLUS\s+VAT|EX(?:CLUDING)?\s+VAT)/i)?.[0] || "+ VAT"
      : vatStatus === "vat_included"
        ? clean.match(/(?:VAT\s+INCLUDED|INC(?:LUDING)?\s+VAT)/i)?.[0] || "VAT included"
        : "";
  return {
    advertised_price: advertisedPrice,
    vat_status: vatStatus,
    advertised_price_text: compactWhitespace([moneyText, vatText].filter(Boolean).join(" ")),
  };
}

function structuredOfferCandidates(html) {
  const candidates = [];
  const source = String(html || "");
  const jsonScripts = source.match(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi) || [];

  for (const script of jsonScripts) {
    const raw = script.replace(/^<script\b[^>]*>/i, "").replace(/<\/script>$/i, "").trim();
    try {
      const parsed = JSON.parse(raw);
      const queue = Array.isArray(parsed) ? [...parsed] : [parsed];
      while (queue.length) {
        const item = queue.shift();
        if (!item || typeof item !== "object") continue;
        if (Array.isArray(item)) {
          queue.push(...item);
          continue;
        }
        const offers = item.offers;
        if (offers && typeof offers === "object") {
          const offerList = Array.isArray(offers) ? offers : [offers];
          for (const offer of offerList) {
            const rawPrice = offer?.price ?? offer?.lowPrice;
            const numericPrice = Number(String(rawPrice ?? "").replace(/[^0-9.]/g, ""));
            if (Number.isFinite(numericPrice) && numericPrice > 0) {
              const context = compactWhitespace(`${offer?.priceCurrency || "GBP"} ${offer?.description || ""} ${item?.description || ""}`);
              candidates.push({
                advertised_price: numericPrice,
                vat_status: classifyVat(context),
                advertised_price_text: compactWhitespace(`£${numericPrice.toLocaleString("en-GB")} ${classifyVat(context) === "plus_vat" ? "+ VAT" : classifyVat(context) === "no_vat" ? "NO VAT" : classifyVat(context) === "vat_included" ? "VAT included" : ""}`),
              });
            }
          }
        }
        queue.push(...Object.values(item).filter((value) => value && typeof value === "object"));
      }
    } catch {
      // Ignore malformed third-party JSON-LD and continue with visible page content.
    }
  }

  return candidates;
}

function dedicatedPriceCandidates(html) {
  const source = String(html || "");
  const candidates = [];
  const elementPattern = /<(?:div|span|p|strong|h2|h3)[^>]*(?:class|id)=["'][^"']*(?:price|vehicle-price|cash-price|selling-price)[^"']*["'][^>]*>([\s\S]*?)<\/(?:div|span|p|strong|h2|h3)>/gi;
  let match;
  while ((match = elementPattern.exec(source))) {
    const candidate = candidateFromText(match[1]);
    if (candidate) candidates.push(candidate);
  }
  return candidates;
}

export function extractAdvertisedPriceAndVat(html) {
  const structured = structuredOfferCandidates(html).find((candidate) => candidate.advertised_price);
  if (structured) return structured;

  const dedicated = dedicatedPriceCandidates(html).find((candidate) => candidate.advertised_price);
  if (dedicated) return dedicated;

  const visibleText = decodeHtml(html);
  const fallbackPatterns = [
    /£\s*[0-9]{1,3}(?:,[0-9]{3})+(?:\.[0-9]{2})?\s*(?:\+\s*VAT|PLUS\s+VAT|NO\s+VAT|VAT\s+FREE|VAT\s+INCLUDED|INC(?:LUDING)?\s+VAT)/i,
    /(?:NO\s+VAT|VAT\s+FREE|\+\s*VAT|PLUS\s+VAT|VAT\s+INCLUDED|INC(?:LUDING)?\s+VAT)\s*[-:]?\s*£\s*[0-9]{1,3}(?:,[0-9]{3})+(?:\.[0-9]{2})?/i,
  ];

  for (const pattern of fallbackPatterns) {
    const match = visibleText.match(pattern);
    const candidate = match?.[0] ? candidateFromText(match[0], { requireVat: true }) : null;
    if (candidate) return candidate;
  }

  return {
    advertised_price: null,
    vat_status: "unknown",
    advertised_price_text: "",
  };
}
