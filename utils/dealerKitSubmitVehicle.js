const MEDIA_BLOCKERS = new Set([
  "car_media_not_ready", "vfc_media_not_prepared", "vfc_media_not_ready",
  "rent2buy_media_not_prepared", "rent2buy_template_not_ready", "rent2buy_gallery_not_ready",
]);

const VEHICLE_ROUTES = { cars: "/cars/", finance: "/vans/", rent2buy: "/rent2buy/vans/" };

export function dealerKitPublishedVehicleUrl(product, registration) {
  const route = VEHICLE_ROUTES[product];
  const plate = String(registration || "").replace(/\s+/g, "").toLowerCase();
  return typeof route === "string" && /^[a-z0-9]{5,8}$/.test(plate)
    ? "https://www.vanfinancecompany.co.uk" + route + plate
    : null;
}

export async function submitDealerKitVehicle({
  save, upload, read, prepare, publish, status, isCurrent,
  wait = () => new Promise(resolve => setTimeout(resolve, 3000)),
}) {
  const ensureCurrent = () => {
    if (!isCurrent()) throw new Error("This vehicle review is no longer open. Reopen it to continue.");
  };
  const nonMediaBlockers = state => (state.plan?.blockers || []).filter(item => !MEDIA_BLOCKERS.has(item.code));
  const describe = blockers => blockers.map(item => item.message || item.code).join(" ");
  let step = "Saving vehicle";
  try {
    status(step);
    ensureCurrent();
    await save();
    ensureCurrent();
    let state = await read();
    const blockers = nonMediaBlockers(state);
    if (blockers.length) throw new Error(describe(blockers));
    step = "Preparing photographs";
    status(step);
    ensureCurrent();
    await upload();
    ensureCurrent();
    state = await read();
    if (nonMediaBlockers(state).length) throw new Error(describe(nonMediaBlockers(state)));
    if (state.media?.unpreparedDealerKitImageIds?.length) {
      await prepare();
      ensureCurrent();
      state = await read();
    }
    for (let attempt = 0; attempt < 12 && !state.plan?.canPublish; attempt++) {
      if (nonMediaBlockers(state).length || !state.media?.processingDealerKitImageIds?.length) break;
      await wait();
      ensureCurrent();
      state = await read();
    }
    if (!state.plan?.canPublish || !state.plan.confirmation) {
      throw new Error(describe(state.plan?.blockers || []) || "The publish plan is not ready. Check the primary photo and retry.");
    }
    step = "Publishing and verifying advert";
    status(step);
    ensureCurrent();
    const result = await publish(state.plan);
    if (!result.verified) throw new Error(result.message || "Wix did not verify the publication.");
    return result;
  } catch (error) {
    throw new Error(step + ": " + error.message, { cause: error });
  }
}
