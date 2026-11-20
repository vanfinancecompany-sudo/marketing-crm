import { randomUUID } from "node:crypto";
import { ControlledPublishError } from "./_dealerkit-controlled-publish-state.js";
import { getSupabaseServiceAdmin } from "./_vansco-cache-utils.js";

export function isDealerKitPreview(environment = process.env) {
  return environment.VERCEL_ENV === "preview" || environment.VERCEL_TARGET_ENV === "preview";
}

export function blockDealerKitPreviewWrite(request, response, environment = process.env) {
  if (!isDealerKitPreview(environment) || !["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) return false;
  response.setHeader("Cache-Control", "no-store, max-age=0");
  response.status(403).json({
    ok: false,
    message: "DealerKit publishing and repair are read-only on this Preview.",
    details: { code: "dealerkit_preview_read_only" },
  });
  return true;
}

export async function acquireDealerKitPublishLease(registration, supabase = getSupabaseServiceAdmin()) {
  const owner = randomUUID();
  const { data, error } = await supabase.rpc("dealerkit_acquire_publish_lease", {
    p_registration: registration, p_owner: owner,
  });
  if (error) {
    throw new ControlledPublishError(503, "DealerKit could not reserve this registration for publishing.", {
      code: "dealerkit_publish_lease_unavailable",
    });
  }
  if (data !== true) {
    throw new ControlledPublishError(409, "A DealerKit operation is already in progress for this registration. Try again when it finishes.", {
      code: "dealerkit_publish_in_progress",
    });
  }
  let released = false;
  return async () => {
    if (released) return;
    released = true;
    try {
      const { error: releaseError } = await supabase.from("dealerkit_publish_leases").delete()
        .eq("registration", registration).eq("owner", owner);
      if (releaseError) console.warn("DealerKit could not release a publish lease.", releaseError.code);
    } catch {
      // The database expires the lease if the function ends before releasing it.
      console.warn("DealerKit publish lease release failed.");
    }
  };
}
