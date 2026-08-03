const clean = (value, limit = 50000) => String(value || "").trim().slice(0, limit);

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function plainExcerpt(value) {
  return String(value || "")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*(?:[-*+] |\d+\.\s+)/gm, "")
    .replace(/[*_`~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function findInternalLinkAnchorMatches(markdown = "", anchorText = "", options = {}) {
  const source = String(markdown || "");
  const anchor = clean(anchorText, 500);
  const excerptRadius = Math.max(40, Math.min(Number(options.excerptRadius) || 90, 200));

  if (anchor.length < 2) {
    return {
      anchor_text: anchor,
      found: false,
      match_count: 0,
      excerpts: [],
      reason: "anchor_too_short",
    };
  }

  const pattern = new RegExp(`(^|[^\\w\\[])(${escapeRegExp(anchor)})(?=$|[^\\w])`, "gi");
  const matches = [];
  let match;

  while ((match = pattern.exec(source)) && matches.length < 20) {
    const anchorStart = match.index + match[1].length;
    const anchorEnd = anchorStart + match[2].length;
    const before = source.slice(Math.max(0, anchorStart - excerptRadius), anchorStart);
    const after = source.slice(anchorEnd, Math.min(source.length, anchorEnd + excerptRadius));
    matches.push({
      index: anchorStart,
      matched_text: match[2],
      excerpt: plainExcerpt(`${anchorStart > excerptRadius ? "…" : ""}${before}${match[2]}${after}${anchorEnd + excerptRadius < source.length ? "…" : ""}`),
    });

    if (pattern.lastIndex === match.index) pattern.lastIndex += 1;
  }

  return {
    anchor_text: anchor,
    found: matches.length > 0,
    match_count: matches.length,
    excerpts: matches.slice(0, 3),
    reason: matches.length ? (matches.length === 1 ? "single_match" : "multiple_matches") : "anchor_text_not_found",
  };
}
