import fs from "node:fs";
import { fileURLToPath } from "node:url";

const targetPath = fileURLToPath(new URL("../pages/VanscoStockWatchPage.jsx", import.meta.url));
let source = fs.readFileSync(targetPath, "utf8");

function replaceOnce(before, after, label) {
  const first = source.indexOf(before);
  if (first === -1) throw new Error(`DealerKit image-ready view stability transform could not find: ${label}`);
  if (source.indexOf(before, first + before.length) !== -1) {
    throw new Error(`DealerKit image-ready view stability transform found duplicate anchor: ${label}`);
  }
  source = source.replace(before, after);
}

if (!source.includes("const IMAGE_READY_RENDER_BATCH = 18;")) {
  replaceOnce(
    `const DEFAULT_FILTERS = { finance: "missing", rent2buy: "missing", cars: "missing" };`,
    `const DEFAULT_FILTERS = { finance: "missing", rent2buy: "missing", cars: "missing" };\nconst IMAGE_READY_RENDER_BATCH = 18;`,
    "image-ready render batch constant"
  );
}

if (!source.includes('loading="lazy" decoding="async" fetchPriority="low"')) {
  replaceOnce(
    `function ImageReadyCard({ record }) {\n  return (\n    <article className="vansco-card">\n      <div className="vansco-card__image-wrap">\n        {record.imageUrl ? <img src={record.imageUrl} alt={record.title || "Vehicle"} className="vansco-card__image" />`,
    `function ImageReadyCard({ record }) {\n  return (\n    <article className="vansco-card">\n      <div className="vansco-card__image-wrap">\n        {record.imageUrl ? <img loading="lazy" decoding="async" fetchPriority="low" src={record.imageUrl} alt={record.title || "Vehicle"} className="vansco-card__image" />`,
    "lazy DealerKit readiness image"
  );
}

if (!source.includes("const [imageReadyVisibleByPipeline, setImageReadyVisibleByPipeline]")) {
  replaceOnce(
    `  const [imageReadyErrorByPipeline, setImageReadyErrorByPipeline] = useState({ finance: "", rent2buy: "", cars: "" });`,
    `  const [imageReadyErrorByPipeline, setImageReadyErrorByPipeline] = useState({ finance: "", rent2buy: "", cars: "" });\n  const [imageReadyVisibleByPipeline, setImageReadyVisibleByPipeline] = useState({ finance: IMAGE_READY_RENDER_BATCH, rent2buy: IMAGE_READY_RENDER_BATCH, cars: IMAGE_READY_RENDER_BATCH });`,
    "image-ready visible-count state"
  );
}

if (!source.includes("const visibleFilteredRecords = useMemo")) {
  replaceOnce(
    `  const lastCheckedAt = useMemo(() => currentRawRecords.reduce((latest, record) => {`,
    `  const visibleFilteredRecords = useMemo(() => {\n    if (activeFilter !== "images_ready") return filteredRecords;\n    const visibleCount = imageReadyVisibleByPipeline[selectedPipeline] || IMAGE_READY_RENDER_BATCH;\n    return filteredRecords.slice(0, visibleCount);\n  }, [activeFilter, filteredRecords, imageReadyVisibleByPipeline, selectedPipeline]);\n\n  const lastCheckedAt = useMemo(() => currentRawRecords.reduce((latest, record) => {`,
    "bounded image-ready records"
  );
}

if (!source.includes("Show 18 more photo-ready vehicles")) {
  const before = `{filteredRecords.map((record) => record.displayStatus === "price_difference" ? <PriceDifferenceCard key={record.id} record={record} /> : record.displayStatus === "images_ready" ? <ImageReadyCard key={record.id} record={record} /> : <WatchCard key={normalizeWatchRegistration(record.registration) || record.stockUrl || record.localStockUrl || record.id} record={record} selectedPipeline={selectedPipeline} onRecordSaved={handleRecordSaved} />)}`;
  const after = `{visibleFilteredRecords.map((record) => record.displayStatus === "price_difference" ? <PriceDifferenceCard key={record.id} record={record} /> : record.displayStatus === "images_ready" ? <ImageReadyCard key={record.id} record={record} /> : <WatchCard key={normalizeWatchRegistration(record.registration) || record.stockUrl || record.localStockUrl || record.id} record={record} selectedPipeline={selectedPipeline} onRecordSaved={handleRecordSaved} />)}{activeFilter === "images_ready" && visibleFilteredRecords.length < filteredRecords.length ? <div className="card-actions"><button className="button button--ghost" type="button" onClick={() => setImageReadyVisibleByPipeline((prev) => ({ ...prev, [selectedPipeline]: (prev[selectedPipeline] || IMAGE_READY_RENDER_BATCH) + IMAGE_READY_RENDER_BATCH }))}>Show 18 more photo-ready vehicles</button></div> : null}`;
  replaceOnce(before, after, "bounded image-ready card grid");
}

fs.writeFileSync(targetPath, source);
console.log("Applied DealerKit image-ready view stability: lazy images and bounded 18-card rendering batches.");
