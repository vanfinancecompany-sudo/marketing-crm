const EMOJI_RE = /[\p{Extended_Pictographic}\p{Emoji_Presentation}\u2600-\u27BF\uFE0F\u200D\u20E3]/gu;

function stripEmoji(value) {
  return String(value ?? "")
    .replace(EMOJI_RE, " ")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ *\n */g, "\n")
    .trim();
}

function parseCsv(csvText) {
  const text = String(csvText ?? "").replace(/^\uFEFF/, "");
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];

    if (inQuotes) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += character;
      }
      continue;
    }

    if (character === '"') {
      inQuotes = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }

  if (inQuotes) {
    throw new Error("DealerKit GVA feed contains an unterminated quoted field.");
  }

  if (field.length || row.length) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }

  return rows;
}

function csvCell(value) {
  const text = String(value ?? "");
  if (!/[",\r\n]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

function serializeCsv(rows) {
  return `${rows.map((row) => row.map(csvCell).join(",")).join("\n")}\n`;
}

export function cleanDealerKitGoogleVehicleAdsCsv(csvText) {
  const rows = parseCsv(csvText);
  if (!rows.length) {
    throw new Error("DealerKit GVA feed is empty.");
  }

  const headers = rows[0].map((header) => String(header ?? "").trim());
  const descriptionIndex = headers.indexOf("description");

  if (descriptionIndex < 0) {
    throw new Error("DealerKit GVA feed is missing the description column.");
  }

  let cleanedDescriptionCount = 0;

  for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    while (row.length < headers.length) row.push("");

    const before = row[descriptionIndex] ?? "";
    const after = stripEmoji(before);
    if (after !== before) cleanedDescriptionCount += 1;
    row[descriptionIndex] = after;
  }

  return {
    csv: serializeCsv(rows),
    vehicleCount: Math.max(0, rows.length - 1),
    cleanedDescriptionCount,
  };
}
