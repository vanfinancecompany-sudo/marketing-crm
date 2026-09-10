import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { retireDuplicateVercelRuntime } from "./scripts/retire-duplicate-vercel-runtime.mjs";
import { runDealerKitAdapterPreviewSmoke } from "./scripts/dealerkit-adapter-preview-smoke.mjs";

function retireDuplicateVercelRuntimePlugin() {
  return {
    name: "retire-duplicate-vercel-runtime",
    closeBundle() {
      retireDuplicateVercelRuntime();
    },
  };
}

function dealerKitAdapterPreviewSmokePlugin() {
  return {
    name: "dealerkit-adapter-preview-smoke",
    async closeBundle() {
      const isTargetBranch = process.env.VERCEL_GIT_COMMIT_REF === "feature/dealerkit-source-adapter";
      const isPreview = process.env.VERCEL_ENV === "preview";
      if (!isTargetBranch || !isPreview) return;
      await runDealerKitAdapterPreviewSmoke();
    },
  };
}

export default defineConfig({
  plugins: [react(), retireDuplicateVercelRuntimePlugin(), dealerKitAdapterPreviewSmokePlugin()],
});
