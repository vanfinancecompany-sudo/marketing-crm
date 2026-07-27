const ALIGNMENT_CELL = /^:?-{3,}:?$/;

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function splitTableRow(line) {
  let source = String(line ?? "").trim();
  if (source.startsWith("|")) source = source.slice(1);
  if (source.endsWith("|")) source = source.slice(0, -1);
  const cells = [];
  let current = "";
  let escaped = false;
  for (const character of source) {
    if (escaped) {
      current += character;
      escaped = false;
    } else if (character === "\\") {
      escaped = true;
      current += character;
    } else if (character === "|") {
      cells.push(current.trim());
      current = "";
    } else {
      current += character;
    }
  }
  cells.push(current.trim());
  return cells.map((cell) => cell.replace(/\\\|/g, "|").trim());
}

function looksLikeTableRow(line) {
  const trimmed = String(line ?? "").trim();
  return trimmed.includes("|") && !/^```/.test(trimmed);
}

function isAlignmentRow(line) {
  const cells = splitTableRow(line);
  return cells.length >= 2 && cells.every((cell) => ALIGNMENT_CELL.test(cell.replace(/\s+/g, "")));
}

function inlineHtml(value) {
  let output = escapeHtml(value);
  output = output.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+|\/[^)\s]+)\)/g, (_match, label, url) =>
    `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${label}</a>`
  );
  output = output.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  output = output.replace(/__([^_]+)__/g, "<strong>$1</strong>");
  output = output.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  output = output.replace(/_([^_]+)_/g, "<em>$1</em>");
  output = output.replace(/`([^`]+)`/g, "<code>$1</code>");
  return output;
}

function normalizeRows(headers, rows) {
  return rows.map((row) => {
    const cells = [...row];
    while (cells.length < headers.length) cells.push("");
    return cells.slice(0, headers.length);
  });
}

export function parseMarkdownTable(lines, startIndex = 0) {
  const headerLine = lines[startIndex];
  const separatorLine = lines[startIndex + 1];
  if (!looksLikeTableRow(headerLine) || !isAlignmentRow(separatorLine)) return null;
  const headers = splitTableRow(headerLine);
  if (headers.length < 2 || headers.every((cell) => !cell)) return null;
  const rows = [];
  let cursor = startIndex + 2;
  while (cursor < lines.length && looksLikeTableRow(lines[cursor]) && String(lines[cursor]).trim()) {
    rows.push(splitTableRow(lines[cursor]));
    cursor += 1;
  }
  if (!rows.length) {
    return { valid: false, startIndex, endIndex: cursor, rawLines: lines.slice(startIndex, cursor), warning: "Markdown table has a header and separator but no readable body rows." };
  }
  return { valid: true, startIndex, endIndex: cursor, headers, rows: normalizeRows(headers, rows), rawLines: lines.slice(startIndex, cursor) };
}

function malformedTableCandidate(lines, startIndex) {
  if (!looksLikeTableRow(lines[startIndex])) return null;
  const collected = [];
  let cursor = startIndex;
  while (cursor < lines.length && looksLikeTableRow(lines[cursor]) && String(lines[cursor]).trim()) {
    collected.push(lines[cursor]);
    cursor += 1;
  }
  if (collected.length < 2) return null;
  return { valid: false, startIndex, endIndex: cursor, rawLines: collected, warning: "Malformed Markdown table was converted to a readable stacked list." };
}

export function splitMarkdownTableSegments(markdown) {
  const lines = String(markdown ?? "").replace(/\r\n?/g, "\n").split("\n");
  const segments = [];
  const warnings = [];
  let textLines = [];
  const flushText = () => {
    if (!textLines.length) return;
    segments.push({ type: "markdown", markdown: textLines.join("\n") });
    textLines = [];
  };
  let index = 0;
  while (index < lines.length) {
    const parsed = parseMarkdownTable(lines, index);
    const candidate = parsed || malformedTableCandidate(lines, index);
    if (!candidate) {
      textLines.push(lines[index]);
      index += 1;
      continue;
    }
    flushText();
    if (candidate.valid) segments.push({ type: "table", table: candidate });
    else {
      segments.push({ type: "table_fallback", table: candidate });
      warnings.push({ type: "table_conversion_warning", message: candidate.warning, line: index + 1 });
    }
    index = candidate.endIndex;
  }
  flushText();
  return { segments, warnings };
}

export function renderResponsiveTableHtml(table) {
  const headers = table.headers || [];
  const rows = table.rows || [];
  const desktopHead = `<thead><tr>${headers.map((cell) => `<th scope="col">${inlineHtml(cell)}</th>`).join("")}</tr></thead>`;
  const desktopBody = `<tbody>${rows.map((row) => `<tr>${row.map((cell, index) => index === 0 ? `<th scope="row">${inlineHtml(cell)}</th>` : `<td>${inlineHtml(cell)}</td>`).join("")}</tr>`).join("")}</tbody>`;
  const mobile = rows.map((row) => {
    const heading = inlineHtml(row[0] || headers[0] || "Item");
    const details = headers.slice(1).map((header, offset) => `<div class="kh-table-card__field"><strong>${inlineHtml(header || `Column ${offset + 2}`)}</strong><span>${inlineHtml(row[offset + 1] || "")}</span></div>`).join("");
    return `<section class="kh-table-card"><h4>${heading}</h4>${details}</section>`;
  }).join("");
  return `<div class="kh-responsive-table"><style>
.kh-responsive-table{max-width:100%;margin:1.25rem 0}.kh-responsive-table__scroll{overflow-x:auto;-webkit-overflow-scrolling:touch}.kh-responsive-table table{width:100%;border-collapse:collapse;table-layout:auto}.kh-responsive-table th,.kh-responsive-table td{border:1px solid #d7dce2;padding:.75rem;text-align:left;vertical-align:top;overflow-wrap:anywhere}.kh-responsive-table thead th{background:#f3f5f7;font-weight:700}.kh-responsive-table tbody th{font-weight:700}.kh-responsive-table__mobile{display:none}.kh-table-card{border:1px solid #d7dce2;border-radius:8px;padding:1rem;margin:.75rem 0;overflow-wrap:anywhere}.kh-table-card h4{margin:0 0 .75rem}.kh-table-card__field{display:grid;grid-template-columns:minmax(7rem,40%) 1fr;gap:.75rem;padding:.5rem 0;border-top:1px solid #e8ebee}.kh-table-card__field span{min-width:0;overflow-wrap:anywhere}@media(max-width:700px){.kh-responsive-table__scroll{display:none}.kh-responsive-table__mobile{display:block}.kh-table-card__field{grid-template-columns:1fr}.kh-table-card__field strong{margin-bottom:.15rem}}
</style><div class="kh-responsive-table__scroll"><table>${desktopHead}${desktopBody}</table></div><div class="kh-responsive-table__mobile">${mobile}</div></div>`;
}

function fallbackRows(rawLines = []) {
  return rawLines.filter((line) => !isAlignmentRow(line)).map(splitTableRow).filter((cells) => cells.some(Boolean));
}

export function renderMalformedTableHtml(table) {
  const rows = fallbackRows(table.rawLines);
  return `<div class="kh-table-fallback">${rows.map((cells, index) => `<section class="kh-table-card"><h4>${inlineHtml(cells[0] || `Row ${index + 1}`)}</h4>${cells.slice(1).map((cell, offset) => `<div class="kh-table-card__field"><strong>Column ${offset + 2}</strong><span>${inlineHtml(cell)}</span></div>`).join("")}</section>`).join("")}</div>`;
}

export function tableToStackedText(table) {
  const headers = table.headers || [];
  return (table.rows || []).map((row) => {
    const lines = [row[0] || headers[0] || "Item"];
    headers.slice(1).forEach((header, offset) => lines.push(`${header || `Column ${offset + 2}`}: ${row[offset + 1] || ""}`));
    return lines.join("\n");
  }).join("\n\n");
}

export function malformedTableToStackedText(table) {
  return fallbackRows(table.rawLines).map((cells, index) => {
    const lines = [cells[0] || `Row ${index + 1}`];
    cells.slice(1).forEach((cell, offset) => lines.push(`Column ${offset + 2}: ${cell}`));
    return lines.join("\n");
  }).join("\n\n");
}

function renderBasicMarkdownHtml(markdown) {
  const safe = String(markdown || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return safe.split(/\n{2,}/).map((block) => {
    if (/^### /.test(block)) return `<h3>${inlineHtml(block.slice(4))}</h3>`;
    if (/^## /.test(block)) return `<h2>${inlineHtml(block.slice(3))}</h2>`;
    if (/^# /.test(block)) return `<h1>${inlineHtml(block.slice(2))}</h1>`;
    const lines = block.split("\n");
    if (lines.every((line) => /^[-*] /.test(line))) return `<ul>${lines.map((line) => `<li>${inlineHtml(line.slice(2))}</li>`).join("")}</ul>`;
    return `<p>${lines.map(inlineHtml).join("<br />")}</p>`;
  }).join("\n");
}

export function renderKnowledgePreviewHtml(markdown) {
  const { segments, warnings } = splitMarkdownTableSegments(markdown);
  const html = segments.map((segment) => {
    if (segment.type === "table") return renderResponsiveTableHtml(segment.table);
    if (segment.type === "table_fallback") return renderMalformedTableHtml(segment.table);
    return renderBasicMarkdownHtml(segment.markdown);
  }).join("\n");
  return { html, warnings };
}
