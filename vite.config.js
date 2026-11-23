import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { retireDuplicateVercelRuntime } from "./scripts/retire-duplicate-vercel-runtime.mjs";

function retireDuplicateVercelRuntimePlugin() {
  return {
    name: "retire-duplicate-vercel-runtime",
    closeBundle() {
      retireDuplicateVercelRuntime();
    },
  };
}

export default defineConfig(async ({ command, mode, isPreview }) => {
  const plugins = [react(), retireDuplicateVercelRuntimePlugin()];
  if (command === "serve" && !isPreview && mode === "marketplace-reply-poc") {
    const { marketplaceReplyFixture } = await import("./dev/marketplace-reply-poc/plugin.mjs");
    plugins.push(marketplaceReplyFixture());
    return { plugins, server: { host: "127.0.0.1", port: 4617, strictPort: true } };
  }
  return { plugins };
});
