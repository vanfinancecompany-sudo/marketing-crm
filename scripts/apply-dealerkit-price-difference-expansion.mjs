import { readFile, writeFile } from "node:fs/promises";

const pageUrl = new URL("../pages/VanscoStockWatchPage.jsx", import.meta.url);
let source = await readFile(pageUrl, "utf8");

function replaceOrThrow(pattern, replacement, label) {
  if (typeof pattern === "string") {
    if (!source.includes(pattern)) throw new Error(`DealerKit price-difference transform could not find ${label}.`);
    source = source.replace(pattern, replacement);
    return;
  }
  if (!pattern.test(source)) throw new Error(`DealerKit price-difference transform could not find ${label}.`);
  source = source.replace(pattern, replacement);
}

if (!source.includes("calculatePublishedRent2BuyPricing")) {
  const importAnchor = `import {\n  fetchVanscoCacheRecords,\n  processVanscoCacheBatch,\n  refreshVanscoCacheUrls,\n  saveVanscoWatchAction,\n} from "../services/vanscoStockCache.js";`;
  replaceOrThrow(importAnchor, `${importAnchor}\nimport { calculatePublishedRent2BuyPricing } from "../lib/dealerKitPublishedPrice.js";`, "published Rent2Buy pricing import");
}

if (!source.includes('from "../lib/dealerKitCarsPublishedListing.js"')) {
  const presenceImport = 'import { fetchStockWatchWixListingPresence } from "../services/stockWatchWixListingPresence.js";';
  replaceOrThrow(
    presenceImport,
    `${presenceImport}\nimport { mergeCarsPublishedListingVehicles } from "../lib/dealerKitCarsPublishedListing.js";`,
    "Cars published listing merge import",
  );
}

if (!source.includes("mergeCarsPublishedListingVehicles(vehicles, presence.vehicles || [])")) {
  const liveVehicleFilter = `            effectiveVehicles = vehicles.filter((vehicle) => {\n              const registration = normalizeLocalStockRegistration(vehicle.reg || vehicle.registration || vehicle.title || vehicle.name);\n              return Boolean(registration && liveRegistrationSet.has(registration));\n            });`;
  replaceOrThrow(
    liveVehicleFilter,
    `            effectiveVehicles = pipeline === "cars"\n              ? mergeCarsPublishedListingVehicles(vehicles, presence.vehicles || [])\n              : vehicles.filter((vehicle) => {\n                const registration = normalizeLocalStockRegistration(vehicle.reg || vehicle.registration || vehicle.title || vehicle.name);\n                return Boolean(registration && liveRegistrationSet.has(registration));\n              });`,
    "Cars live CARFINANCE price snapshot",
  );
}

replaceOrThrow(
  /function filtersForPipeline\(pipeline\) \{[\s\S]*?\n\}/,
  `function filtersForPipeline(pipeline) {\n  if (!["finance", "rent2buy", "cars"].includes(pipeline)) return BASE_FILTERS;\n  return [\n    ...BASE_FILTERS.slice(0, 2),\n    { value: "price_difference", label: "Price differences" },\n    ...BASE_FILTERS.slice(2),\n  ];\n}`,
  "pipeline filters",
);

if (!source.includes("function buildCarPriceDifferences")) {
  const anchor = "\nfunction SummaryCard({ label, value, tone = \"default\", onClick }) {";
  const additions = `\nfunction buildCarPriceDifferences(dealerKitRecords, carVehicles) {\n  const localByRegistration = new Map();\n  dedupeLocalVehiclesByRegistration(carVehicles).forEach(({ vehicle, registration }) => localByRegistration.set(registration, vehicle));\n\n  return dealerKitRecords.flatMap((record) => {\n    const registration = normalizeWatchRegistration(record.registration);\n    if (!registration || record.isCurrentlyOnVansco === false || isReservedLikeStatus(record.sourceStatus)) return [];\n    const localVehicle = localByRegistration.get(registration);\n    if (!localVehicle) return [];\n    const dealerKitPrice = parsePrice(record.advertisedPrice);\n    const localPrice = parsePrice(localVehicle.price);\n    if (dealerKitPrice === null || localPrice === null || dealerKitPrice === localPrice) return [];\n    const difference = localPrice - dealerKitPrice;\n    return [{\n      ...record,\n      id: "price-difference-cars-" + registration,\n      pipeline: "cars",\n      displayStatus: "price_difference",\n      matchStatus: "price_difference",\n      localStockUrl: localVehicle.weblink || localVehicle.webLink || localVehicle.link || "",\n      imageUrl: localVehicle.image || localVehicle.picture || localVehicle.imageUrl || localVehicle.image_url || record.imageUrl,\n      localTitle: localVehicle.title || localVehicle.name || "",\n      localPrice,\n      localPriceText: formatPrice(localPrice),\n      priceDifference: Math.abs(difference),\n      vanscoIsLower: difference > 0,\n    }];\n  });\n}\n\nfunction buildRent2BuyPriceDifferences(dealerKitRecords, rentVehicles) {\n  const localByRegistration = new Map();\n  dedupeLocalVehiclesByRegistration(rentVehicles).forEach(({ vehicle, registration }) => localByRegistration.set(registration, vehicle));\n\n  return dealerKitRecords.flatMap((record) => {\n    const registration = normalizeWatchRegistration(record.registration);\n    if (!registration || record.isCurrentlyOnVansco === false || isReservedLikeStatus(record.sourceStatus)) return [];\n    const localVehicle = localByRegistration.get(registration);\n    if (!localVehicle) return [];\n    const pricing = calculatePublishedRent2BuyPricing({\n      retailPrice: record.advertisedPrice,\n      mileage: record.mileage,\n      vatStatus: record.vatStatus || "unknown",\n      pickup: false,\n    });\n    const publishedMonthly = parsePrice(localVehicle.monthly);\n    if (!pricing || publishedMonthly === null || pricing.monthly === publishedMonthly) return [];\n    const difference = publishedMonthly - pricing.monthly;\n    return [{\n      ...record,\n      id: "price-difference-rent2buy-" + registration,\n      pipeline: "rent2buy",\n      displayStatus: "price_difference",\n      matchStatus: "price_difference",\n      localStockUrl: localVehicle.weblink || localVehicle.webLink || localVehicle.link || "",\n      imageUrl: localVehicle.image || localVehicle.picture || localVehicle.imageUrl || localVehicle.image_url || record.imageUrl,\n      localTitle: localVehicle.title || localVehicle.name || record.title || "",\n      localPrice: publishedMonthly,\n      localPriceText: formatPrice(publishedMonthly),\n      expectedMonthly: pricing.monthly,\n      expectedMonthlyText: formatPrice(pricing.monthly),\n      priceDifference: Math.abs(difference),\n      vanscoIsLower: difference > 0,\n    }];\n  });\n}\n`;
  replaceOrThrow(anchor, `${additions}${anchor}`, "price difference builders");
}

replaceOrThrow(
  /function PriceDifferenceCard\(\{ record \}\) \{[\s\S]*?\n\}\n\nfunction WatchCard/,
  `function PriceDifferenceCard({ record }) {\n  const pipeline = record.pipeline || "finance";\n  const isRent2Buy = pipeline === "rent2buy";\n  const currentLabel = pipeline === "cars" ? "Wix/Car price" : pipeline === "rent2buy" ? "Published monthly rental" : "Wix/Finance price";\n  return (\n    <article\n      className="vansco-card"\n      data-price-pipeline={pipeline}\n      data-price-registration={record.registration || ""}\n      data-supplier-stock-id={record.supplierStockId || ""}\n      data-price-retail={record.advertisedPrice ?? ""}\n      data-price-mileage={record.mileage ?? ""}\n      data-price-vat-status={record.vatStatus || ""}\n    >\n      <div className="vansco-card__image-wrap">\n        {record.imageUrl ? <img src={record.imageUrl} alt={record.title || "Vehicle"} className="vansco-card__image" /> : <div className="vansco-card__image vansco-card__image--placeholder">No image</div>}\n      </div>\n      <div className="vansco-card__body">\n        <div className="vansco-card__badges"><PipelineBadge pipeline={pipeline} /><DisplayStatusBadge status="price_difference" /></div>\n        <h3>{record.localTitle || record.title || "Untitled vehicle"}</h3>\n        <div className="vehicle-card__meta">Registration: {record.registration}</div>\n        <div className="vehicle-card__meta"><strong>{currentLabel}:</strong> {record.localPriceText}</div>\n        {isRent2Buy ? <div className="vehicle-card__meta"><strong>Expected monthly rental:</strong> {record.expectedMonthlyText || formatPrice(record.expectedMonthly)}</div> : <div className="vehicle-card__meta"><strong>DealerKit price:</strong> {record.advertisedPriceText || formatPrice(record.advertisedPrice)}</div>}\n        {isRent2Buy ? <div className="vehicle-card__meta"><strong>DealerKit retail:</strong> {record.advertisedPriceText || formatPrice(record.advertisedPrice)}</div> : null}\n        <div className="vehicle-card__meta"><strong>{record.vanscoIsLower ? (isRent2Buy ? "Expected rental is lower by" : "DealerKit is lower by") : (isRent2Buy ? "Expected rental is higher by" : "DealerKit is higher by")}:</strong> {formatPrice(record.priceDifference)}</div>\n        {pipeline === "finance" ? <div className="vehicle-card__meta">VAT basis matched: {record.vatStatus === "plus_vat" ? "+ VAT" : record.vatStatus === "no_vat" ? "NO VAT" : "VAT included"}</div> : null}\n        <div className="card-actions">\n          {record.localStockUrl ? <a className="button button--ghost" href={record.localStockUrl} target="_blank" rel="noreferrer">Open my stock page</a> : null}\n          <a className="button button--ghost" href={record.stockUrl || "#"} target="_blank" rel="noreferrer">Open DealerKit vehicle</a>\n        </div>\n      </div>\n    </article>\n  );\n}\n\nfunction WatchCard`,
  "pipeline-aware price card",
);

replaceOrThrow(
  '  const priceDifferenceRecords = useMemo(() => selectedPipeline === "finance" ? buildFinancePriceDifferences(currentRawRecords, activeLocalVehicles) : [], [activeLocalVehicles, currentRawRecords, selectedPipeline]);',
  `  const priceDifferenceRecords = useMemo(() => {\n    if (selectedPipeline === "finance") return buildFinancePriceDifferences(currentRawRecords, activeLocalVehicles).map((record) => ({ ...record, pipeline: "finance" }));\n    if (selectedPipeline === "cars") return buildCarPriceDifferences(currentRawRecords, activeLocalVehicles);\n    if (selectedPipeline === "rent2buy") return buildRent2BuyPriceDifferences(currentRawRecords, activeLocalVehicles);\n    return [];\n  }, [activeLocalVehicles, currentRawRecords, selectedPipeline]);`,
  "price difference memo",
);

replaceOrThrow(
  '{selectedPipeline === "finance" ? <SummaryCard label="Price differences" value={summary.priceDifference} tone="amber" onClick={() => setFiltersByPipeline((prev) => ({ ...prev, finance: "price_difference" }))} /> : null}',
  '<SummaryCard label="Price differences" value={summary.priceDifference} tone="amber" onClick={() => setFiltersByPipeline((prev) => ({ ...prev, [selectedPipeline]: "price_difference" }))} />',
  "price difference summary card",
);

replaceOrThrow(
  '{selectedPipeline === "finance" ? <div className="vansco-watch-note"><strong>Price differences:</strong> Van Finance only. It compares exact registration matches where both prices and VAT basis are clear. It never changes Wix or DealerKit prices.</div> : null}',
  '<div className="vansco-watch-note"><strong>Price differences:</strong> Finance and Cars compare the published cash price with DealerKit. Rent2Buy compares the published monthly rental with the current DealerKit-derived rental. Nothing changes until Update Wix price is previewed and confirmed.</div>',
  "price difference note",
);

replaceOrThrow(
  '      const priceText = pipeline === "finance" ? " Price differences recalculated from the refreshed Finance stock snapshot and saved Vansco cache." : "";',
  '      const priceText = " Price differences recalculated from the refreshed local stock snapshot and saved DealerKit cache.";',
  "refresh comparison price message",
);

await writeFile(pageUrl, source);
console.log("Applied DealerKit Price Differences across Finance, Rent2Buy and Cars with controlled published-price actions.");
