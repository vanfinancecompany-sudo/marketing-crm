export function validateWixStockPage(
  payload,
  {
    source = "Wix stock",
    offset = 0,
    pageSize = 100,
    maxRows = 2000,
    expectedTotal = null,
  } = {}
) {
  const fail = (reason) => {
    throw new Error(`${source} snapshot is incomplete (${reason}). Existing synced stock was left unchanged.`);
  };

  if (!payload || !Array.isArray(payload.dataItems)) {
    fail(`invalid page at offset ${offset}`);
  }

  const total = Number(payload?.pagingMetadata?.total);
  if (!Number.isInteger(total) || total < 0) {
    fail(`missing or invalid total at offset ${offset}`);
  }
  if (total > maxRows) {
    fail(`reported ${total} rows, above the ${maxRows}-row safety limit`);
  }
  if (expectedTotal !== null && total !== expectedTotal) {
    fail(`total changed from ${expectedTotal} to ${total} while paging`);
  }

  const items = payload.dataItems;
  if (items.length > pageSize) {
    fail(`page at offset ${offset} returned ${items.length} rows, above page size ${pageSize}`);
  }
  if (offset > total || offset + items.length > total) {
    fail(`page at offset ${offset} exceeds reported total ${total}`);
  }

  const complete = offset + items.length === total;
  if (!complete && items.length < pageSize) {
    fail(`page ended early at ${offset + items.length} of ${total} rows`);
  }

  return { items, total, complete };
}

export async function loadCompleteWixStockSnapshot({
  queryPage,
  source = "Wix stock",
  pageSize = 100,
  maxRows = 2000,
} = {}) {
  if (typeof queryPage !== "function") {
    throw new Error(`${source} snapshot loader requires a page query function.`);
  }

  const items = [];
  let expectedTotal = null;

  for (let offset = 0; offset < maxRows; offset += pageSize) {
    const payload = await queryPage(offset);
    const page = validateWixStockPage(payload, {
      source,
      offset,
      pageSize,
      maxRows,
      expectedTotal,
    });

    if (expectedTotal === null) expectedTotal = page.total;
    items.push(...page.items);

    if (page.complete) {
      return { items, total: page.total };
    }
  }

  throw new Error(
    `${source} snapshot exceeded the ${maxRows}-row safety limit. Existing synced stock was left unchanged.`
  );
}
