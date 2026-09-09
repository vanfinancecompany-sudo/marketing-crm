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

export default defineConfig({
  plugins: [react(), retireDuplicateVercelRuntimePlugin()],
});
