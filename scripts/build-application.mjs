import path from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "vite";

import viteConfig from "../vite.config.js";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

await build({
  ...viteConfig,
  configFile: false,
  root: repositoryRoot,
});
