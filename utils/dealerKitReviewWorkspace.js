import {
  buildMarketingAccessHeaders,
  parseMarketingJsonResponse,
} from "../services/marketingAccess.js";

const WORKSPACE_ATTRIBUTE = "data-dealerkit-review-workspace";
const BUTTON_ATTRIBUTE = "data-dealerkit-review-button";
let scanQueued = false;
let activeRequest = 0;

function clean(value) {
  return String(value ?? "").trim();
}

function formatPrice(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "–";
  return `£${number.toLocaleString("en-GB", { maximumFractionDigits: 2 })}`;
}

function formatNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "–";
  return number.toLocaleString("en-GB");
}

function vatLabel(value) {
  const labels = {
    plus_vat: "+ VAT",
    inc_vat: "VAT included",
    no_vat: "No VAT",
    unknown: "VAT unknown",
  };
  return labels[value] || clean(value) || "VAT unknown";
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

function detail(label, value) {
  const node = element("div", "dealerkit-review__detail");
  node.append(element("span", "", label), element("strong", "", value || "–"));
  return node;
}

function localCard(label, local) {
  const card = element("section", "dealerkit-review__local-card");
  const top = element("div", "dealerkit-review__local-top");
  top.append(
    element("strong", "", label),
    element("span", local ? "dealerkit-review__present" : "dealerkit-review__absent", local ? "MATCHED" : "NOT MATCHED"),
  );
  card.appendChild(top);
  if (!local) {
    card.appendChild(element("p", "", `No active ${label} record currently matches this registration.`));
    return card;
  }

  const bits = [];
  if (Number.isFinite(Number(local.price))) bits.push(`Retail ${formatPrice(local.price)}`);
  if (local.vat) bits.push(local.vat);
  if (Number.isFinite(Number(local.monthly))) bits.push(`Monthly ${formatPrice(local.monthly)}`);
  if (Number.isFinite(Number(local.week))) bits.push(`Weekly ${formatPrice(local.week)}`);
  if (Number.isFinite(Number(local.initialRental))) bits.push(`Initial ${formatPrice(local.initialRental)}`);
  card.appendChild(element("p", "", bits.join(" · ") || "Active local record found."));

  if (local.url) {
    const link = element("a", "dealerkit-review__link", "Open current advert");
    link.href = local.url;
    link.target = "_blank";
    link.rel = "noreferrer";
    card.appendChild(link);
  }
  return card;
}

function specSection(title, items) {
  const section = element("details", "dealerkit-review__spec-section");
  const summary = element("summary", "", `${title} (${Array.isArray(items) ? items.length : 0})`);
  section.appendChild(summary);
  const grid = element("div", "dealerkit-review__spec-grid");
  for (const item of Array.isArray(items) ? items : []) {
    const row = element("div", "dealerkit-review__spec-row");
    row.append(
      element("strong", "", item?.name || "Specification"),
      element("span", "", item?.value || "Included"),
    );
    grid.appendChild(row);
  }
  if (!grid.childElementCount) grid.appendChild(element("p", "dealerkit-review__empty", "No items returned by DealerKit."));
  section.appendChild(grid);
  return section;
}

function renderVehicle(workspace, payload) {
  const vehicle = payload?.vehicle || {};
  const local = payload?.local || {};
  const body = workspace.querySelector("[data-dealerkit-review-body]");
  const title = workspace.querySelector("[data-dealerkit-review-title]");
  const subtitle = workspace.querySelector("[data-dealerkit-review-subtitle]");
  if (!body || !title || !subtitle) return;

  title.textContent = vehicle.registration || "DealerKit vehicle";
  subtitle.textContent = vehicle.title || [vehicle.make, vehicle.model, vehicle.derivative].filter(Boolean).join(" ") || "Vehicle review";
  body.replaceChildren();

  const hero = element("section", "dealerkit-review__hero");
  const primary = vehicle.images?.[0]?.url || "";
  if (primary) {
    const image = document.createElement("img");
    image.src = primary;
    image.alt = vehicle.registration || vehicle.title || "DealerKit vehicle";
    image.loading = "eager";
    hero.appendChild(image);
  } else {
    hero.appendChild(element("div", "dealerkit-review__hero-placeholder", "No DealerKit image"));
  }

  const facts = element("div", "dealerkit-review__facts");
  facts.append(
    detail("DealerKit status", vehicle.sourceStatus || "Unknown"),
    detail("Retail", Number.isFinite(Number(vehicle.retailPrice)) ? formatPrice(vehicle.retailPrice) : "–"),
    detail("VAT", vatLabel(vehicle.vatStatus)),
    detail("Mileage", Number.isFinite(Number(vehicle.mileage)) ? `${formatNumber(vehicle.mileage)} miles` : "–"),
    detail("Year", vehicle.year),
    detail("Transmission", vehicle.transmission),
    detail("Fuel", vehicle.fuel),
    detail("Body", vehicle.bodyType),
    detail("Images", vehicle.imageCount),
    detail("Colour", vehicle.colour),
    detail("BHP", vehicle.bhp),
    detail("MOT expiry", vehicle.motExpiry),
  );
  hero.appendChild(facts);
  body.appendChild(hero);

  const localGrid = element("div", "dealerkit-review__local-grid");
  localGrid.append(localCard("Van Finance", local.finance), localCard("Rent2Buy", local.rent2buy));
  body.appendChild(localGrid);

  const gallerySection = element("section", "dealerkit-review__section");
  gallerySection.appendChild(element("h3", "", `DealerKit images (${vehicle.images?.length || 0})`));
  const gallery = element("div", "dealerkit-review__gallery");
  for (const [index, imageData] of (vehicle.images || []).entries()) {
    const figure = element("figure", "dealerkit-review__image-card");
    const image = document.createElement("img");
    image.src = imageData.url;
    image.alt = `${vehicle.registration || "Vehicle"} image ${index + 1}`;
    image.loading = "lazy";
    figure.append(image, element("figcaption", "", index === 0 ? "Primary source image" : `Source image ${index + 1}`));
    gallery.appendChild(figure);
  }
  if (!gallery.childElementCount) gallery.appendChild(element("p", "dealerkit-review__empty", "No source images returned."));
  gallerySection.appendChild(gallery);
  body.appendChild(gallerySection);

  if (vehicle.attentionGrabber || vehicle.description) {
    const copy = element("section", "dealerkit-review__section");
    copy.appendChild(element("h3", "", "DealerKit advert copy"));
    if (vehicle.attentionGrabber) copy.appendChild(element("strong", "dealerkit-review__grabber", vehicle.attentionGrabber));
    if (vehicle.description) copy.appendChild(element("p", "dealerkit-review__description", vehicle.description));
    body.appendChild(copy);
  }

  const specs = element("section", "dealerkit-review__section");
  specs.appendChild(element("h3", "", "Vehicle specification"));
  specs.append(
    specSection("Standard specification", vehicle.specifications?.standard),
    specSection("Options", vehicle.specifications?.options),
    specSection("Technical specification", vehicle.specifications?.technical),
  );
  body.appendChild(specs);

  const future = element("section", "dealerkit-review__future");
  future.append(
    element("strong", "", "Review workspace · read-only stage"),
    element("p", "", "This screen is for checking DealerKit data against our current stock. Image selection, category decisions, Rent2Buy routing and publish controls will be enabled only after this review layer is proven. Nothing can be saved or published from here yet."),
  );
  if (vehicle.sourceUrl) {
    const link = element("a", "dealerkit-review__link", "Open DealerKit vehicle");
    link.href = vehicle.sourceUrl;
    link.target = "_blank";
    link.rel = "noreferrer";
    future.appendChild(link);
  }
  body.appendChild(future);
}

function setLoading(workspace, registration) {
  const title = workspace.querySelector("[data-dealerkit-review-title]");
  const subtitle = workspace.querySelector("[data-dealerkit-review-subtitle]");
  const body = workspace.querySelector("[data-dealerkit-review-body]");
  if (title) title.textContent = registration || "Vehicle review";
  if (subtitle) subtitle.textContent = "Loading DealerKit vehicle data…";
  if (body) body.replaceChildren(element("div", "dealerkit-review__loading", "Reading DealerKit and matching current CRM stock…"));
}

function setError(workspace, message) {
  const subtitle = workspace.querySelector("[data-dealerkit-review-subtitle]");
  const body = workspace.querySelector("[data-dealerkit-review-body]");
  if (subtitle) subtitle.textContent = "Could not load vehicle review";
  if (body) body.replaceChildren(element("div", "dealerkit-review__error", message || "Vehicle review failed. No stock data was changed."));
}

function closeWorkspace(workspace) {
  workspace.hidden = true;
  workspace.setAttribute("aria-hidden", "true");
  document.body.classList.remove("dealerkit-review-open");
}

function createWorkspace() {
  const overlay = element("div", "dealerkit-review");
  overlay.setAttribute(WORKSPACE_ATTRIBUTE, "true");
  overlay.setAttribute("aria-hidden", "true");
  overlay.hidden = true;

  const shade = element("button", "dealerkit-review__shade");
  shade.type = "button";
  shade.setAttribute("aria-label", "Close DealerKit vehicle review");

  const panel = element("aside", "dealerkit-review__panel");
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  panel.setAttribute("aria-label", "DealerKit vehicle review");

  const header = element("header", "dealerkit-review__header");
  const heading = element("div", "dealerkit-review__heading");
  heading.append(
    element("span", "dealerkit-review__eyebrow", "DEALERKIT · REVIEW ONLY"),
    element("strong", "dealerkit-review__title", "Vehicle review"),
    element("span", "dealerkit-review__subtitle", "",),
  );
  heading.children[1].setAttribute("data-dealerkit-review-title", "true");
  heading.children[2].setAttribute("data-dealerkit-review-subtitle", "true");

  const close = element("button", "dealerkit-review__close", "Close");
  close.type = "button";
  header.append(heading, close);

  const body = element("div", "dealerkit-review__body");
  body.setAttribute("data-dealerkit-review-body", "true");
  panel.append(header, body);
  overlay.append(shade, panel);

  shade.addEventListener("click", () => closeWorkspace(overlay));
  close.addEventListener("click", () => closeWorkspace(overlay));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !overlay.hidden) closeWorkspace(overlay);
  });
  document.body.appendChild(overlay);
  return overlay;
}

function getWorkspace() {
  return document.querySelector(`[${WORKSPACE_ATTRIBUTE}]`) || createWorkspace();
}

async function openWorkspace(registration) {
  const workspace = getWorkspace();
  workspace.hidden = false;
  workspace.setAttribute("aria-hidden", "false");
  document.body.classList.add("dealerkit-review-open");
  setLoading(workspace, registration);

  const requestId = ++activeRequest;
  try {
    const response = await fetch(`/api/dealerkit-stock-detail?registration=${encodeURIComponent(registration)}`, {
      method: "GET",
      headers: buildMarketingAccessHeaders({ accept: "application/json" }),
      cache: "no-store",
    });
    const payload = await parseMarketingJsonResponse(response, "Could not load DealerKit vehicle review.");
    if (requestId !== activeRequest) return;
    renderVehicle(workspace, payload);
  } catch (error) {
    if (requestId !== activeRequest) return;
    setError(workspace, error?.message || "Could not load DealerKit vehicle review. No stock data was changed.");
  }
}

function installReviewButtons() {
  if (typeof window === "undefined" || window.location.pathname !== "/vansco-stock-watch") return;
  for (const row of document.querySelectorAll(".dealerkit-comparison__row")) {
    if (row.querySelector(`[${BUTTON_ATTRIBUTE}]`)) continue;
    const registration = clean(row.querySelector(".dealerkit-comparison__row-top strong")?.textContent).replace(/\s+/g, "");
    if (!registration || registration.toLowerCase() === "no registration") continue;

    const links = row.querySelector(".dealerkit-comparison__links") || element("div", "dealerkit-comparison__links");
    const button = element("button", "dealerkit-comparison__review-button", "Review vehicle");
    button.type = "button";
    button.setAttribute(BUTTON_ATTRIBUTE, "true");
    button.addEventListener("click", () => openWorkspace(registration));
    links.prepend(button);
    if (!links.parentElement) row.appendChild(links);
  }
}

function scheduleScan() {
  if (scanQueued) return;
  scanQueued = true;
  queueMicrotask(() => {
    scanQueued = false;
    installReviewButtons();
  });
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", scheduleScan, { once: true });
  else scheduleScan();
  window.addEventListener("popstate", scheduleScan);
  const observer = new MutationObserver(scheduleScan);
  observer.observe(document.documentElement, { childList: true, subtree: true });
}
