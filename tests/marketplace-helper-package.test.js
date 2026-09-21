import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_EXTENSION_ROOT,
  readZipEntries,
  validateExtensionRoot,
  validateZipRoot,
} from "../scripts/validate-marketplace-helper.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGE_SCRIPT = path.join(REPO_ROOT, "scripts", "package-marketplace-helper.mjs");

test("Manifest V3 points at a real, non-empty background service worker", () => {
  const result = validateExtensionRoot(DEFAULT_EXTENSION_ROOT);
  assert.equal(result.manifest.manifest_version, 3);
  assert.equal(result.manifest.background.service_worker, "background.js");
  assert.ok(result.requiredFiles.includes("background.js"));
  assert.ok(fs.statSync(path.join(DEFAULT_EXTENSION_ROOT, "background.js")).size > 0);
  assert.deepEqual(result.jsFiles, ["background.js", "crm-bridge.js", "facebook-groups.js", "facebook.js"]);
});

test("Validation rejects the exact missing-background package failure", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vfc-helper-invalid-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, "manifest.json"), JSON.stringify({
    manifest_version: 3,
    name: "Broken helper",
    version: "1.0.0",
    background: { service_worker: "background.js" },
    content_scripts: [],
  }));
  assert.throws(
    () => validateExtensionRoot(root),
    /background\.service_worker does not exist: background\.js/,
  );
});

test("Extension packager emits one clean folder and a flat, loadable ZIP", (t) => {
  const outputBase = fs.mkdtempSync(path.join(os.tmpdir(), "vfc-helper-package-"));
  t.after(() => fs.rmSync(outputBase, { recursive: true, force: true }));
  const result = spawnSync(process.execPath, [PACKAGE_SCRIPT, "--out-dir", outputBase], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const folder = path.join(outputBase, "VFC-Facebook-Helper-v1.2.12");
  const zip = `${folder}.zip`;
  const validated = validateExtensionRoot(folder);
  const entries = validateZipRoot(zip, validated.requiredFiles);

  assert.deepEqual(entries, validated.requiredFiles);
  assert.equal(entries[entries.length - 1], "manifest.json");
  assert.equal(entries.some((entry) => entry.includes("/")), false);
  assert.deepEqual(readZipEntries(zip), entries);
  assert.deepEqual(
    fs.readdirSync(folder).sort((a, b) => a.localeCompare(b)),
    validated.requiredFiles,
  );
});
