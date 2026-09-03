import fs from "node:fs";
import { fileURLToPath } from "node:url";

const targetUrl = new URL("../pages/VanscoStockWatchPage.jsx", import.meta.url);
const targetPath = fileURLToPath(targetUrl);
let source = fs.readFileSync(targetPath, "utf8");

function replaceOnce(before, after, label) {
  const first = source.indexOf(before);
  if (first === -1) throw new Error(`Wix authoritative Stock Watch transform could not find: ${label}`);
  if (source.indexOf(before, first + before.length) !== -1) {
    throw new Error(`Wix authoritative Stock Watch transform found duplicate anchor: ${label}`);
  }
  source = source.replace(before, after);
}

if (!source.includes('from "../services/stockWatchWixListingPresence.js"')) {
  replaceOnce(
`} from "../services/vanscoStockCache.js";`,
`} from "../services/vanscoStockCache.js";
import { fetchStockWatchWixListingPresence } from "../services/stockWatchWixListingPresence.js";`,
    "Vansco stock cache import"
  );

  replaceOnce(
`  async function loadLocalStock(pipeline = selectedPipeline, isActive = () => true) {
    try {
      const vehicles = await fetchLocalVehiclesForPipeline(pipeline);
      if (!isActive()) return;
      const regs = vehicles.map((vehicle) => normalizeLocalStockRegistration(vehicle.reg || vehicle.registration || vehicle.title || vehicle.name)).filter(Boolean);
      setLocalVehiclesByPipeline((prev) => ({ ...prev, [pipeline]: vehicles }));
      setLocalRegistrationsByPipeline((prev) => ({ ...prev, [pipeline]: new Set(regs) }));
      setLocalLoadErrorByPipeline((prev) => ({ ...prev, [pipeline]: "" }));
      return vehicles;
    } catch (error) {
      if (!isActive()) return;
      setLocalVehiclesByPipeline((prev) => ({ ...prev, [pipeline]: [] }));
      setLocalRegistrationsByPipeline((prev) => ({ ...prev, [pipeline]: new Set() }));
      setLocalLoadErrorByPipeline((prev) => ({ ...prev, [pipeline]: error.message || \`Could not load \${pipelineLabel(pipeline)} local stock.\` }));
      throw error;
    }
  }`,
`  async function loadLocalStock(pipeline = selectedPipeline, isActive = () => true) {
    try {
      const vehicles = await fetchLocalVehiclesForPipeline(pipeline);
      const vehicleRegistrations = vehicles
        .map((vehicle) => normalizeLocalStockRegistration(vehicle.reg || vehicle.registration || vehicle.title || vehicle.name))
        .filter(Boolean);

      let effectiveRegistrations = vehicleRegistrations;
      let effectiveVehicles = vehicles;
      let presenceWarning = "";

      if (pipeline === "cars" || pipeline === "rent2buy") {
        try {
          const presence = await fetchStockWatchWixListingPresence(pipeline);
          if (presence.complete) {
            effectiveRegistrations = (presence.registrations || []).map(normalizeLocalStockRegistration).filter(Boolean);
            const liveRegistrationSet = new Set(effectiveRegistrations);
            effectiveVehicles = vehicles.filter((vehicle) => {
              const registration = normalizeLocalStockRegistration(vehicle.reg || vehicle.registration || vehicle.title || vehicle.name);
              return Boolean(registration && liveRegistrationSet.has(registration));
            });
          } else {
            presenceWarning = "Live Wix listing presence was only partially checked, so Stock Watch is temporarily using the Marketing CRM stock fallback.";
          }
        } catch (presenceError) {
          presenceWarning = \`Could not confirm live Wix listing presence, so Stock Watch is temporarily using the Marketing CRM stock fallback: \${presenceError?.message || "Wix check failed."}\`;
        }
      }

      if (!isActive()) return;
      setLocalVehiclesByPipeline((prev) => ({ ...prev, [pipeline]: effectiveVehicles }));
      setLocalRegistrationsByPipeline((prev) => ({ ...prev, [pipeline]: new Set(effectiveRegistrations) }));
      setLocalLoadErrorByPipeline((prev) => ({ ...prev, [pipeline]: presenceWarning }));
      return effectiveVehicles;
    } catch (error) {
      if (!isActive()) return;
      setLocalVehiclesByPipeline((prev) => ({ ...prev, [pipeline]: [] }));
      setLocalRegistrationsByPipeline((prev) => ({ ...prev, [pipeline]: new Set() }));
      setLocalLoadErrorByPipeline((prev) => ({ ...prev, [pipeline]: error.message || \`Could not load \${pipelineLabel(pipeline)} local stock.\` }));
      throw error;
    }
  }`,
    "loadLocalStock"
  );

  source = source
    .replace("This registration is currently in this CRM stock tab.", "This registration is currently live in the stock listing source used for this tab.")
    .replace("Local CRM regs loaded", "Live stock regs loaded")
    .replace("local CRM registrations loaded", "live stock registrations loaded")
    .replace("Cars local stock source is not confirmed yet. This page loaded {activeLocalRegistrations.size} local Cars registrations. Check the Cars Supabase table name/fields before relying on Cars results.", "Cars Stock Watch uses live CAR FINANCE Wix listing state as the authority. The Marketing CRM car table is used only for supporting card details.");
}

fs.writeFileSync(targetPath, source);
console.log("Applied authoritative live Wix listing presence to Cars and Rent2Buy Stock Watch comparisons.");
