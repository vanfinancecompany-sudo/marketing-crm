// Google Vehicle Ads inventory controls. Vehicle IDs are those in DealerKit's CSV,
// not registrations inferred from titles.
export function normalizeVehicleId(value) {
  return String(value ?? "").trim().toUpperCase();
}

export function parseVehicleCsv(text) {
  const input = String(text ?? "").replace(/^\uFEFF/, "");
  const rows = [];
  let row = [], cell = "", quoted = false;
  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (quoted) {
      if (char === '"' && input[i + 1] === '"') { cell += '"'; i += 1; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") { row.push(cell); cell = ""; }
    else if (char === "\n") { row.push(cell.replace(/\r$/, "")); rows.push(row); row = []; cell = ""; }
    else cell += char;
  }
  if (quoted) throw new Error("DealerKit vehicle CSV has unmatched quotes.");
  if (cell.length || row.length) { row.push(cell.replace(/\r$/, "")); rows.push(row); }
  return rows;
}

function csvCell(value) {
  const string = String(value ?? "");
  return /[",\r\n]/.test(string) ? '"' + string.replace(/"/g, '""') + '"' : string;
}

export function csvToString(rows) {
  return rows.map(row => row.map(csvCell).join(",")).join("\n") + "\n";
}

export function getGoogleVehicleRows(csv) {
  const rows = parseVehicleCsv(csv);
  const columns = rows[0]?.map(h => String(h).trim().toLowerCase()) || [];
  const idIndex = columns.indexOf("id");
  if (idIndex < 0) throw new Error("DealerKit vehicle feed is missing its id column.");
  const output = [];
  for (const row of rows.slice(1)) {
    if (row.length === 1 && !row[0]) continue;
    const id = normalizeVehicleId(row[idIndex]);
    if (!id) continue;
    const value = (name) => String(row[columns.indexOf(name)] ?? "").trim();
    output.push({
      id,
      title: value("title"),
      price: value("price"),
      imageUrl: value("image_link"),
      vehicleUrl: value("link"),
      storeCode: value("store_code"),
    });
  }
  return output;
}

export function selectedGoogleVehicleCsv(csv, selectedIds) {
  const rows = parseVehicleCsv(csv);
  const headers = rows[0]?.map(h => String(h).trim().toLowerCase()) || [];
  const idIndex = headers.indexOf("id");
  if (idIndex < 0) throw new Error("DealerKit vehicle feed is missing its id column.");
  const wanted = new Set((selectedIds || []).map(normalizeVehicleId).filter(Boolean));
  if (!wanted.size) throw new Error("No vehicles selected for Google Vehicle Ads.");
  const matching = rows.slice(1).filter(row => wanted.has(normalizeVehicleId(row[idIndex])));
  if (!matching.length) throw new Error("None of the selected vehicles exist in the current DealerKit feed.");
  return { csv: csvToString([rows[0], ...matching]), vehicleCount: matching.length };
}

export function validatedSelectedVehicleIds(values, availableIds) {
  if (!Array.isArray(values) || values.length > 1200) throw new Error("Invalid vehicle selection.");
  const valid = new Set((availableIds || []).map(normalizeVehicleId));
  const selected = Array.from(new Set(values.map(normalizeVehicleId).filter(Boolean)));
  if (selected.some(id => !valid.has(id))) throw new Error("Selection contains a vehicle no longer present in DealerKit.");
  return selected;
}

/** Shared stock exclusion logic for the feed and CRM preview. */
export function googleVehicleFeedExclusion(id, { stock, blockedIds = [], pendingRemovalIds = [] } = {}) {
  const key = normalizeVehicleId(id);
  if ([...blockedIds, ...pendingRemovalIds].some(value => normalizeVehicleId(value) === key)) return "blocked";
  const status = String(stock?.last_status || stock?.source_status || "").trim().toLowerCase().replace(/[\\s-]+/g, "_");
  return ["sold", "reserved", "deposit_taken", "awaiting_delivery", "removed_from_dealerkit"].includes(status)
    ? "unavailable" : "";
}

/**
 * The automatic Merchant Center feed is rebuilt from DealerKit on every fetch.
 * Only explicit lifecycle evidence or an operator block can remove a vehicle.
 * A missing Stock Watch observation is NOT proof of a sale, and new DealerKit
 * vehicles are included without needing to edit the saved manual shortlist.
 */
export function filteredGoogleVehicleCsv(csv, {
  mode = "all",
  selectedIds = [],
  blockedIds = [],
  pendingRemovalIds = [],
  stockById = new Map(),
} = {}) {
  if (!["all", "selected"].includes(mode)) throw new Error("Unknown Google vehicle feed mode.");
  const rows = parseVehicleCsv(csv);
  const headers = rows[0]?.map(h => String(h).trim().toLowerCase()) || [];
  const idIndex = headers.indexOf("id");
  if (idIndex < 0) throw new Error("DealerKit vehicle feed is missing its id column.");
  const wanted = new Set(selectedIds.map(normalizeVehicleId).filter(Boolean));
  if (mode === "selected" && wanted.size === 0) throw new Error("No vehicles selected for Google Vehicle Ads.");
  const blocked = new Set([...blockedIds, ...pendingRemovalIds].map(normalizeVehicleId).filter(Boolean));
  const eligible = [];
  let excludedUnavailable = 0;
  let excludedBlocked = 0;
  for (const row of rows.slice(1)) {
    if (row.length === 1 && !row[0]) continue;
    const id = normalizeVehicleId(row[idIndex]);
    if (!id || (mode === "selected" && !wanted.has(id))) continue;
    const reason = googleVehicleFeedExclusion(id, {
      stock: stockById.get(id),
      blockedIds: blocked.has(id) ? [id] : [],
    });
    if (reason === "blocked") { excludedBlocked += 1; continue; }
    if (reason === "unavailable") { excludedUnavailable += 1; continue; }
    eligible.push(row);
  }
  // Do not publish an empty inventory on a transient source/status fault:
  // the primary feed would otherwise remove every vehicle from Merchant Center.
  if (!eligible.length) throw new Error("No safely available Google vehicles in the current DealerKit feed.");
  return {
    csv: csvToString([rows[0], ...eligible]),
    vehicleCount: eligible.length,
    excludedUnavailable,
    excludedBlocked,
  };
}
