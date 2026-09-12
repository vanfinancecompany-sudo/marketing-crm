import fs from "node:fs";
import { fileURLToPath } from "node:url";

function patchFile(relativePath, patches) {
  const targetUrl = new URL(relativePath, import.meta.url);
  const targetPath = fileURLToPath(targetUrl);
  let source = fs.readFileSync(targetPath, "utf8");

  for (const { before, after, label, already } of patches) {
    if (already && source.includes(already)) continue;
    const first = source.indexOf(before);
    if (first === -1) throw new Error(`DealerKit manual media delete transform could not find: ${label}`);
    if (source.indexOf(before, first + before.length) !== -1) {
      throw new Error(`DealerKit manual media delete transform found duplicate anchor: ${label}`);
    }
    source = source.replace(before, after);
  }

  fs.writeFileSync(targetPath, source);
}

patchFile("../api/dealerkit-wix-manual-media.js", [
  {
    label: "manual media remove action",
    already: "async function removeUpload({ request, supabase, registration })",
    before: `export default async function handler(request, response) {`,
    after: `async function removeUpload({ request, supabase, registration }) {
  const stored = await loadManualMediaById(supabase, registration, request.body?.mediaId);
  const purpose = normaliseManualMediaPurpose(stored.purpose);
  if (!purpose) throw new ApiError(409, "The staged Wix media purpose is no longer supported.");

  const decision = await loadDecisionByRegistration(supabase, registration);
  await loadFreshVehicle(decision, registration);
  if (clean(stored.supplier_stock_id, 300) !== clean(decision.supplierStockId, 300)) {
    throw new ApiError(409, "The staged Wix image belongs to a different DealerKit stock identity. Removal is blocked.");
  }

  const configuration = siteConfiguration(purpose.key);
  if (clean(stored.wix_site_id, 500) !== configuration.siteId) {
    throw new ApiError(409, "The staged Wix image is bound to a different Wix site. Removal is blocked.");
  }

  const wasSelected = Boolean(stored.selected_at);
  const { data, error } = await supabase
    .from(DEALERKIT_MANUAL_MEDIA_TABLE)
    .delete()
    .eq("id", stored.id)
    .eq("registration", registration)
    .eq("supplier_stock_id", decision.supplierStockId)
    .eq("purpose", purpose.key)
    .eq("wix_site_id", configuration.siteId)
    .select("*")
    .single();
  if (error) throw new ApiError(502, \`Could not remove the staged Wix image: \${error.message || error}\`);

  return {
    action: "remove_media",
    registration,
    mediaId: stored.id,
    purpose: purpose.key,
    removedMedia: manualMediaRowToClient(data || stored),
    selectionRemoved: wasSelected,
    workspaceOnly: true,
    wixFileDeleted: false,
  };
}

export default async function handler(request, response) {`,
  },
  {
    label: "manual media action router",
    already: 'action === "remove_media"',
    before: `          : action === "select_media"
            ? await selectUpload({ request, supabase, registration })
            : null;`,
    after: `          : action === "select_media"
            ? await selectUpload({ request, supabase, registration })
            : action === "remove_media"
              ? await removeUpload({ request, supabase, registration })
              : null;`,
  },
]);

patchFile("../utils/dealerKitProductGalleryWorkspace.js", [
  {
    label: "manual media card delete control",
    already: '"Delete image"',
    before: `  copy.appendChild(actions);
  card.appendChild(copy);
  return card;
}`,
    after: `  const remove = element("button", "dealerkit-product-gallery__mini-button is-delete-action", "Delete image");
  remove.type = "button";
  remove.addEventListener("click", async () => {
    const registration = normaliseRegistration(state.registration);
    const displayName = item.displayName || "this uploaded image";
    const primaryWarning = selected
      ? "\\n\\nThis is currently PRODUCT PRIMARY. After it is removed, the saved DealerKit source primary will take over automatically if one is available."
      : "";
    const approved = window.confirm(
      \`Delete \${displayName} from \${PRODUCTS[product].label} for \${registration}?\\n\\nThis removes it from this vehicle's product gallery and publish plan. The Wix Media file itself is left untouched.\${primaryWarning}\`,
    );
    if (!approved) return;

    for (const button of actions.querySelectorAll("button")) button.disabled = true;
    setMessage(state, \`Removing uploaded \${PRODUCTS[product].label} image…\`);
    try {
      await postManualMedia(
        state.registration,
        { action: "remove_media", mediaId: item.id },
        "Could not remove this uploaded image.",
      );
      state.manualMedia = state.manualMedia.filter((value) => value?.id !== item.id);
      setMessage(
        state,
        selected
          ? \`Uploaded \${PRODUCTS[product].label} primary removed. The DealerKit source primary will be used if available.\`
          : \`Uploaded \${PRODUCTS[product].label} image removed from this vehicle.\`,
        "good",
      );
      renderActiveProduct(state);
    } catch (error) {
      for (const button of actions.querySelectorAll("button")) button.disabled = false;
      setMessage(state, error?.message || "Could not remove that uploaded image.", "warning");
    }
  });
  actions.appendChild(remove);

  copy.appendChild(actions);
  card.appendChild(copy);
  return card;
}`,
  },
]);

patchFile("../styles/dealerkit-product-gallery-workspace.css", [
  {
    label: "manual media delete button style",
    already: ".dealerkit-product-gallery__mini-button.is-delete-action",
    before: `.dealerkit-product-gallery__mini-button.is-primary-action {
  background: #0f172a;
  color: #fff;
}`,
    after: `.dealerkit-product-gallery__mini-button.is-primary-action {
  background: #0f172a;
  color: #fff;
}

.dealerkit-product-gallery__mini-button.is-delete-action {
  border: 1px solid #fecaca;
  background: #fff;
  color: #b91c1c;
}

.dealerkit-product-gallery__mini-button.is-delete-action:hover:not(:disabled) {
  background: #fff1f2;
}`,
  },
]);

console.log("Applied safe DealerKit manual image removal: product-card delete, exact vehicle/site checks, and workspace-only deletion with DealerKit source fallback.");
