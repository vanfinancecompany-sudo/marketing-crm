(() => {
  if (window.__VFC_MARKETPLACE_HELPER_BOOTED__) return;
  window.__VFC_MARKETPLACE_HELPER_BOOTED__ = true;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const report = [];
  let currentJob = null;

  function fold(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[’'`]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function visible(element) {
    if (!element) return false;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
  }

  function record(field, ok, detail = "") {
    report.push({ field, ok, detail });
  }

  function allControls() {
    return [...document.querySelectorAll(
      'input, textarea, [role="combobox"], [role="button"], [contenteditable="true"]',
    )].filter(visible);
  }

  function controlByLabel(label) {
    const wanted = fold(label);
    const direct = allControls().find((element) => {
      const haystack = fold([
        element.getAttribute("aria-label"),
        element.getAttribute("placeholder"),
        element.getAttribute("name"),
      ].filter(Boolean).join(" "));
      return haystack === wanted || haystack.includes(wanted);
    });
    if (direct) return direct;

    const labels = [...document.querySelectorAll("label, span, div")]
      .filter(visible)
      .filter((element) => fold(element.innerText || element.textContent) === wanted);

    for (const labelElement of labels) {
      let node = labelElement;
      for (let depth = 0; depth < 6 && node; depth += 1, node = node.parentElement) {
        const candidates = [...node.querySelectorAll(
          'input, textarea, [role="combobox"], [role="button"], [contenteditable="true"]',
        )].filter(visible);
        if (candidates.length === 1) return candidates[0];
        const placeholderMatch = candidates.find(
          (element) => fold(element.getAttribute("placeholder")) === wanted,
        );
        if (placeholderMatch) return placeholderMatch;
      }
    }
    return null;
  }

  function currentValue(element) {
    if (!element) return "";
    if (element.tagName === "INPUT" || element.tagName === "TEXTAREA") return String(element.value || "");
    if (element.isContentEditable) return String(element.innerText || element.textContent || "");
    return String(element.innerText || element.textContent || "");
  }

  function reactSetValue(element, value) {
    if (!element) return;
    const oldValue = currentValue(element);

    if (element.tagName === "TEXTAREA") {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      setter ? setter.call(element, value) : (element.value = value);
    } else if (element.tagName === "INPUT") {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter ? setter.call(element, value) : (element.value = value);
    } else if (element.isContentEditable) {
      element.textContent = value;
    }

    if (element._valueTracker) {
      try { element._valueTracker.setValue(oldValue); } catch {}
    }

    try {
      element.dispatchEvent(new InputEvent("input", {
        bubbles: true,
        inputType: "insertText",
        data: String(value),
      }));
    } catch {
      element.dispatchEvent(new Event("input", { bubbles: true }));
    }
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function optionCandidates() {
    return [...document.querySelectorAll(
      '[role="option"], [role="menuitem"], [role="menuitemradio"], [role="radio"], [role="listbox"] *, div[tabindex="0"]',
    )].filter(visible);
  }

  function findOption(values) {
    const wanted = (Array.isArray(values) ? values : [values]).map(fold);
    const candidates = optionCandidates();
    for (const target of wanted) {
      const exact = candidates.find((element) => fold(element.innerText || element.textContent) === target);
      if (exact) return exact;
    }
    for (const target of wanted) {
      const partial = candidates.find((element) => fold(element.innerText || element.textContent).includes(target));
      if (partial) return partial;
    }
    return null;
  }

  function fireRealisticClick(element) {
    if (!element) return;
    try { element.scrollIntoView({ block: "center" }); } catch {}
    try { element.focus(); } catch {}
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
      try {
        const EventConstructor = type.startsWith("pointer") && window.PointerEvent ? PointerEvent : MouseEvent;
        element.dispatchEvent(new EventConstructor(type, {
          bubbles: true,
          cancelable: true,
          view: window,
          button: 0,
          buttons: type.endsWith("down") ? 1 : 0,
          pointerType: "mouse",
        }));
      } catch {
        try { element.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true })); } catch {}
      }
    }
  }

  async function choose(label, values, { type = false, attempts = 4 } = {}) {
    const wanted = Array.isArray(values) ? values : [values];
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const control = controlByLabel(label);
      if (!control) {
        await sleep(350);
        continue;
      }
      try {
        control.scrollIntoView({ block: "center" });
        control.focus();
        control.click();
        await sleep(300);
        if (type && control.tagName === "INPUT") {
          reactSetValue(control, wanted[0]);
          await sleep(500);
        }
        const option = findOption(wanted);
        if (option) {
          const chosenText = String(option.innerText || option.textContent || "").trim();
          fireRealisticClick(option);
          try { option.click(); } catch {}
          await sleep(650);
          record(label, true, chosenText || wanted[0]);
          return true;
        }
      } catch {}
      await sleep(400);
    }
    record(label, false, `could not choose ${wanted.join(" / ")}`);
    return false;
  }

  async function setTextVerified(label, value, { attempts = 4, settle = 650 } = {}) {
    if (!String(value || "").trim()) return true;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const control = controlByLabel(label);
      if (!control) {
        await sleep(350);
        continue;
      }
      try {
        control.scrollIntoView({ block: "center" });
        control.focus();
        reactSetValue(control, String(value));
        await sleep(settle);
        const refreshed = controlByLabel(label);
        const refreshedValue = fold(currentValue(refreshed));
        if (refreshedValue === fold(value) || refreshedValue.includes(fold(value))) {
          record(label, true, String(value).slice(0, 90));
          return true;
        }
      } catch {}
      await sleep(400);
    }
    record(label, false, "value did not stick");
    return false;
  }

  async function waitFor(label, timeoutMs = 8000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (controlByLabel(label)) return true;
      await sleep(250);
    }
    return false;
  }

  async function chooseVehicleTypeCarTruck() {
    const wanted = "car/truck";
    const displayContainsSelection = () => [...document.querySelectorAll('[role="button"], [role="combobox"], button, div[tabindex="0"]')]
      .filter(visible)
      .some((element) => fold([
        element.innerText,
        element.textContent,
        element.getAttribute?.("aria-label"),
      ].filter(Boolean).join(" ")).includes(wanted));

    if (displayContainsSelection()) {
      record("Vehicle type", true, "Car/Truck already selected");
      return true;
    }

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      let control = controlByLabel("Vehicle type");
      if (!control) {
        const label = [...document.querySelectorAll("span, div")]
          .filter(visible)
          .find((element) => fold(element.innerText || element.textContent) === "vehicle type");
        let node = label;
        for (let depth = 0; depth < 6 && node; depth += 1, node = node.parentElement) {
          const role = node.getAttribute?.("role");
          const tabIndex = node.getAttribute?.("tabindex");
          if (role === "button" || role === "combobox" || node.tagName === "BUTTON" || tabIndex === "0") {
            control = node;
            break;
          }
        }
      }
      if (!control) {
        await sleep(400);
        continue;
      }

      fireRealisticClick(control);
      await sleep(600);
      const option = optionCandidates()
        .filter((element) => fold(element.innerText || element.textContent) === wanted)
        .sort((first, second) => {
          const firstRect = first.getBoundingClientRect();
          const secondRect = second.getBoundingClientRect();
          return firstRect.width * firstRect.height - secondRect.width * secondRect.height;
        })[0];
      if (option) {
        fireRealisticClick(option);
        try { option.click(); } catch {}
        await sleep(900);
        if (displayContainsSelection()) {
          record("Vehicle type", true, "Car/Truck");
          return true;
        }
      }
      await sleep(450);
    }
    record("Vehicle type", false, "Car/Truck could not be selected");
    return false;
  }

  function dataUrlToFile(dataUrl, filename) {
    const [header, base64] = String(dataUrl || "").split(",");
    const mime = header?.match(/data:([^;]+)/)?.[1] || "image/jpeg";
    const binary = atob(base64 || "");
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return new File([bytes], filename, { type: mime });
  }

  async function uploadImages(job) {
    const input = [...document.querySelectorAll('input[type="file"]')]
      .find((element) => String(element.accept || "").includes("image") || !element.accept);
    if (!input) {
      record("Photos", false, "file input not found");
      return false;
    }

    const transfer = new DataTransfer();
    const imageUrls = (job.images || []).slice(0, 20);
    for (let index = 0; index < imageUrls.length; index += 1) {
      const result = await chrome.runtime.sendMessage({
        type: "FETCH_MARKETPLACE_IMAGE",
        url: imageUrls[index],
      });
      if (!result?.ok || !result.dataUrl) {
        record("Photos", false, `image ${index + 1} failed: ${result?.error || "download failed"}`);
        return false;
      }
      transfer.items.add(dataUrlToFile(result.dataUrl, `${job.registration}-${String(index + 1).padStart(2, "0")}.jpg`));
    }

    input.files = transfer.files;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await sleep(Math.max(1200, imageUrls.length * 150));
    record("Photos", true, `${imageUrls.length} CMS images attached in order`);
    return true;
  }

  async function setModel(job) {
    if (await setTextVerified("Model", job.model, { attempts: 2, settle: 900 })) return true;
    if (report.at(-1)?.field === "Model" && !report.at(-1)?.ok) report.pop();
    const control = controlByLabel("Model");
    if (!control) {
      record("Model", false, "control not found");
      return false;
    }

    const baseModel = String(job.model || "")
      .split(/\s+-\s+(?:Visit us at|VANFINANCECOMPANY\.co\.uk)/i)[0]
      .trim();
    try {
      control.focus();
      control.click();
      reactSetValue(control, baseModel);
      await sleep(650);
      const suggestion = findOption([baseModel]);
      if (suggestion) {
        fireRealisticClick(suggestion);
        try { suggestion.click(); } catch {}
        await sleep(700);
      }
      const refreshed = controlByLabel("Model");
      refreshed?.focus();
      reactSetValue(refreshed, job.model);
      await sleep(900);
      if (fold(currentValue(controlByLabel("Model"))).includes(fold(job.model))) {
        record("Model", true, job.model);
        return true;
      }
    } catch {}
    record("Model", false, "custom model text did not stick");
    return false;
  }

  function showReport(job) {
    document.getElementById("vfc-marketplace-helper-report")?.remove();
    const succeeded = report.filter((item) => item.ok).length;
    const failed = report.filter((item) => !item.ok);
    const panel = document.createElement("div");
    panel.id = "vfc-marketplace-helper-report";
    panel.style.cssText = [
      "position:fixed",
      "right:18px",
      "bottom:18px",
      "z-index:2147483647",
      "width:min(420px,calc(100vw - 36px))",
      "max-height:65vh",
      "overflow:auto",
      "background:#111",
      "color:#fff",
      "border:2px solid #e31b23",
      "border-radius:12px",
      "padding:14px",
      "font:14px/1.4 Arial,sans-serif",
      "box-shadow:0 12px 35px rgba(0,0,0,.45)",
    ].join(";");
    const priceSummary = job.pipeline === "finance"
      ? `£${job.price} cash price${job.monthlyPrice ? ` • from £${job.monthlyPrice}/month` : ""}`
      : `£${job.price}/month`;

    panel.innerHTML = `
      <div style="font-size:16px;font-weight:700">VFC Marketplace Helper</div>
      <div>${job.registration} • ${priceSummary} • ${job.location}</div>
      <div style="margin-top:8px"><b>${succeeded}/${report.length}</b> verified items succeeded.</div>
      ${failed.length
        ? `<div style="margin-top:8px;color:#ffd5d5"><b>Needs attention:</b><br>${failed.map((item) => `• ${item.field}: ${item.detail}`).join("<br>")}</div>`
        : `<div style="margin-top:8px;color:#bfffc8"><b>Everything attempted and verified successfully.</b></div>`}
      <div style="margin-top:10px;color:#ddd"><b>Nothing has been published.</b> Check the listing, then click Facebook's Publish button yourself.</div>
      <button id="vfc-marketplace-helper-close" style="margin-top:10px;border:0;border-radius:8px;padding:8px 12px;font-weight:700;cursor:pointer">Close</button>
    `;
    document.body.appendChild(panel);
    panel.querySelector("#vfc-marketplace-helper-close")?.addEventListener("click", () => panel.remove());
  }

  function publishClickListener(event) {
    if (!currentJob) return;
    const button = event.target?.closest?.('button, [role="button"]');
    if (!button || !visible(button)) return;
    const text = fold(button.innerText || button.textContent || button.getAttribute?.("aria-label"));
    if (text !== "publish" && !text.startsWith("publish ")) return;
    const disabled = button.disabled || button.getAttribute?.("aria-disabled") === "true";
    if (disabled) return;
    chrome.runtime.sendMessage({
      type: "MARKETPLACE_PUBLISH_CLICKED",
      jobId: currentJob.id,
    }).catch(() => {});
  }

  async function freshVehicleForm() {
    const started = Date.now();
    while (Date.now() - started < 10000) {
      if (!location.pathname.startsWith("/marketplace/create/vehicle")) return false;
      const bodyText = document.body?.innerText || "";
      if (/vehicle type/i.test(bodyText) && (/add photos/i.test(bodyText) || document.querySelector('input[type="file"]'))) {
        const price = controlByLabel("Price");
        return !String(currentValue(price) || "").trim();
      }
      await sleep(300);
    }
    return false;
  }

  async function run(job) {
    currentJob = job;
    document.addEventListener("click", publishClickListener, true);
    await chrome.runtime.sendMessage({ type: "MARKETPLACE_JOB_STARTED", jobId: job.id });

    const vehicleTypeReady = await chooseVehicleTypeCarTruck();
    if (!vehicleTypeReady) {
      showReport(job);
      return;
    }

    const expanded = await waitFor("Mileage", 8000);
    record("Expanded vehicle form", expanded, expanded ? "ready" : "Mileage field never appeared");
    if (!expanded) {
      showReport(job);
      return;
    }

    await uploadImages(job);
    await choose("Location", job.location, { type: true, attempts: 5 });
    await choose("Year", job.year, { attempts: 5 });
    await choose("Make", [job.make], { type: true, attempts: 5 });
    await sleep(900);
    await waitFor("Model", 5000);
    await setModel(job);
    await setTextVerified("Mileage", job.mileage);
    await setTextVerified("Price", job.price);
    await choose("Body style", job.bodyStyle || "Other", { attempts: 5 });
    if (job.exteriorColor) await choose("Exterior color", job.exteriorColor, { attempts: 4 });
    await choose("Vehicle condition", job.vehicleCondition || "Very good", { attempts: 5 });
    if (job.fuelType) await choose("Fuel type", job.fuelType, { attempts: 5 });
    if (job.transmission) await choose("Transmission", job.transmission, { attempts: 5 });
    await setTextVerified("Description", job.description, { attempts: 5, settle: 900 });

    showReport(job);
    await chrome.runtime.sendMessage({
      type: "MARKETPLACE_FILL_COMPLETED",
      jobId: job.id,
      report: {
        total: report.length,
        succeeded: report.filter((item) => item.ok).length,
        failed: report.filter((item) => !item.ok),
      },
    });
  }

  (async () => {
    if (!(await freshVehicleForm())) return;
    const result = await chrome.runtime.sendMessage({ type: "GET_PENDING_MARKETPLACE_JOB" });
    const pending = result?.pending;
    const job = pending?.job;
    if (!job?.id || !job?.registration || !Array.isArray(job.images) || !job.images.length) return;
    const sessionKey = `vfcMarketplaceJob:${job.id}`;
    if (sessionStorage.getItem(sessionKey)) return;
    sessionStorage.setItem(sessionKey, "started");
    await run(job);
  })().catch((error) => {
    console.error("VFC Marketplace Helper failed", error);
    if (currentJob) {
      record("Helper", false, String(error?.message || error));
      showReport(currentJob);
    }
  });
})();
