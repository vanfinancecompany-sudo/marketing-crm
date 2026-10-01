export function normalizeStockRegistration(value) {
  if (typeof value !== "string") throw new ImageLookupError("Enter a valid UK registration.", 400);
  const registration = value.trim().toUpperCase().replace(/[\s-]/g, "");
  if (!/^(?:[A-Z]{2}[0-9]{2}[A-Z]{3}|[A-Z][0-9]{1,3}[A-Z]{3}|[A-Z]{3}[0-9]{1,3}[A-Z]|[A-Z]{1,3}[0-9]{1,4}|[0-9]{1,4}[A-Z]{1,3})$/.test(registration)) {
    throw new ImageLookupError("Enter a valid UK registration.", 400);
  }
  return registration;
}

export class ImageLookupError extends Error {
  constructor(message, status = 502) { super(message); this.status = status; }
}

export function publicImageGallery(vehicle) {
  const seen = new Set();
  return (Array.isArray(vehicle.images) ? vehicle.images : [])
    .map((image, index) => ({ url: typeof image?.url === "string" ? image.url.trim() : "", order: Number.isFinite(image?.order) ? image.order : index }))
    .sort((a, b) => a.order - b.order)
    .filter(image => {
      try {
        const url = new URL(image.url);
        if (url.protocol !== "https:" || url.username || url.password || seen.has(image.url)) return false;
        seen.add(image.url); return true;
      } catch { return false; }
    }).map((image, order) => ({ url: image.url, order }));
}


export function createStockImageLookup({ fetchSnapshot, fetchDetail, now = Date.now }) {
  let snapshotCache;
  let snapshotPending;
  let failureUntil = 0;
  const details = new Map();
  const pending = new Map();
  const ttl = 5 * 60 * 1000;
  async function snapshot() {
    if (snapshotCache && snapshotCache.expires > now()) return snapshotCache.value;
    if (snapshotPending) return snapshotPending;
    if (failureUntil > now()) throw new ImageLookupError("DealerKit stock is temporarily unavailable.", 503);
    snapshotPending = fetchSnapshot({ allowPartial: true }).then(value => {
      snapshotCache = { value, expires: now() + ttl }; return value;
    }).catch(() => {
      failureUntil = now() + 30000;
      throw new ImageLookupError("DealerKit stock is temporarily unavailable.", 503);
    }).finally(() => { snapshotPending = null; });
    return snapshotPending;
  }
  return async registrationValue => {
    const registration = normalizeStockRegistration(registrationValue);
    const stock = await snapshot();
    const matches = (stock.vehicles || []).filter(vehicle => vehicle.registration === registration);
    const duplicates = stock.diagnostics?.duplicateRegistrations || [];
    if (matches.length > 1 || duplicates.some(item => item.registration === registration)) {
      throw new ImageLookupError("Multiple DealerKit vehicles use this registration.", 409);
    }
    if (!stock.complete && !stock.diagnostics?.knownSourceFaults?.baselineOnly) {
      throw new ImageLookupError("DealerKit snapshot is incomplete. No vehicle was attached.", 503);
    }
    const match = matches[0];
    if (!match || !["available", "reserved", "deposit_taken"].includes(match.status)) {
      throw new ImageLookupError("No exact public DealerKit stock match.", 404);
    }
    const id = match.supplierStockId;
    if (typeof id !== "string" || !id) throw new ImageLookupError("DealerKit stock identity is missing.", 503);
    let vehicle = details.get(id);
    if (!vehicle || vehicle.expires <= now()) {
      if (!pending.has(id)) {
        pending.set(id, fetchDetail(id, { specifications: false }).then(value => {
          details.set(id, { value, expires: now() + ttl });
          while (details.size > 300) details.delete(details.keys().next().value);
          return value;
        }).catch(() => { throw new ImageLookupError("DealerKit gallery is temporarily unavailable.", 503); })
          .finally(() => pending.delete(id)));
      }
      vehicle = { value: await pending.get(id) };
    }
    const detail = vehicle.value;
    if (detail.registration !== registration || detail.supplierStockId !== id ||
        !["available", "reserved", "deposit_taken"].includes(detail.status)) {
      details.delete(id);
      throw new ImageLookupError("DealerKit stock identity or availability changed.", 409);
    }
    const images = publicImageGallery(detail);
    if (!images.length) throw new ImageLookupError("No DealerKit images for this registration.", 404);
    return { ok: true, registration, supplierStockId: id, primaryImage: images[0].url, images };
  };
}

export function createStockImageHandler(lookup) {
  return async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    if (request.method !== "GET") {
      response.setHeader("Allow", "GET");
      return response.status(405).json({ ok: false, message: "Method not allowed." });
    }
    try { return response.status(200).json(await lookup(request.query?.registration)); }
    catch (error) {
      return response.status(error instanceof ImageLookupError ? error.status : 503)
        .json({ ok: false, message: error instanceof ImageLookupError ? error.message : "DealerKit images are unavailable." });
    }
  };
}
