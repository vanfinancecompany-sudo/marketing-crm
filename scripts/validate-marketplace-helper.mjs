import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const DEFAULT_EXTENSION_ROOT = path.join(REPO_ROOT, "browser-extension", "marketplace-helper");

function fail(message) {
  throw new Error(`Marketplace helper validation failed: ${message}`);
}

function safeRelativeFile(root, value, label) {
  const relative = String(value || "").trim().replaceAll("\\", "/");
  if (!relative) fail(`${label} must be a non-empty filename.`);
  if (path.posix.isAbsolute(relative) || relative.split("/").includes("..")) {
    fail(`${label} must stay inside the extension root: ${relative}`);
  }
  const resolved = path.resolve(root, ...relative.split("/"));
  const relativeToRoot = path.relative(root, resolved);
  if (relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot)) {
    fail(`${label} resolves outside the extension root: ${relative}`);
  }
  if (!fs.statSync(resolved, { throwIfNoEntry: false })?.isFile()) {
    fail(`${label} does not exist: ${relative}`);
  }
  return relative;
}

function walkFiles(root) {
  const files = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...walkFiles(absolute));
    else if (entry.isFile()) files.push(absolute);
  }
  return files;
}

export function validateExtensionRoot(root = DEFAULT_EXTENSION_ROOT, options = {}) {
  const extensionRoot = path.resolve(root);
  const manifestPath = path.join(extensionRoot, "manifest.json");
  if (!fs.statSync(manifestPath, { throwIfNoEntry: false })?.isFile()) {
    fail(`manifest.json is not directly inside ${extensionRoot}`);
  }

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch (error) {
    fail(`manifest.json is not valid JSON (${error.message}).`);
  }

  if (manifest.manifest_version !== 3) fail("manifest_version must be 3.");
  const serviceWorker = safeRelativeFile(
    extensionRoot,
    manifest.background?.service_worker,
    "background.service_worker",
  );

  const requiredFiles = new Set(["manifest.json", serviceWorker]);
  for (const [index, contentScript] of (manifest.content_scripts || []).entries()) {
    for (const [fileIndex, file] of (contentScript.js || []).entries()) {
      requiredFiles.add(safeRelativeFile(extensionRoot, file, `content_scripts[${index}].js[${fileIndex}]`));
    }
    for (const [fileIndex, file] of (contentScript.css || []).entries()) {
      requiredFiles.add(safeRelativeFile(extensionRoot, file, `content_scripts[${index}].css[${fileIndex}]`));
    }
  }

  const optionalFiles = [
    [manifest.action?.default_popup, "action.default_popup"],
    [manifest.options_page, "options_page"],
    [manifest.options_ui?.page, "options_ui.page"],
    [manifest.devtools_page, "devtools_page"],
    [manifest.side_panel?.default_path, "side_panel.default_path"],
  ];
  for (const [file, label] of optionalFiles) {
    if (file) requiredFiles.add(safeRelativeFile(extensionRoot, file, label));
  }

  for (const [size, file] of Object.entries(manifest.icons || {})) {
    requiredFiles.add(safeRelativeFile(extensionRoot, file, `icons.${size}`));
  }
  for (const [size, file] of Object.entries(manifest.action?.default_icon || {})) {
    requiredFiles.add(safeRelativeFile(extensionRoot, file, `action.default_icon.${size}`));
  }

  const jsFiles = walkFiles(extensionRoot).filter((file) => file.toLowerCase().endsWith(".js"));
  if (options.checkSyntax !== false) {
    for (const file of jsFiles) {
      const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
      if (result.status !== 0) {
        fail(`${path.relative(extensionRoot, file)} has invalid JavaScript syntax.\n${result.stderr || result.stdout}`);
      }
    }
  }

  return {
    extensionRoot,
    manifest,
    requiredFiles: [...requiredFiles].sort((a, b) => a.localeCompare(b)),
    jsFiles: jsFiles.map((file) => path.relative(extensionRoot, file).replaceAll("\\", "/")).sort(),
  };
}

export function readZipEntries(zipPath) {
  const archive = fs.readFileSync(zipPath);
  const entries = [];
  let offset = 0;
  while (offset + 4 <= archive.length && archive.readUInt32LE(offset) === 0x04034b50) {
    if (offset + 30 > archive.length) fail("ZIP has a truncated local file header.");
    const flags = archive.readUInt16LE(offset + 6);
    if (flags & 0x08) fail("ZIP data descriptors are not supported by the package validator.");
    const compressedSize = archive.readUInt32LE(offset + 18);
    const nameLength = archive.readUInt16LE(offset + 26);
    const extraLength = archive.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const nextOffset = dataStart + compressedSize;
    if (nextOffset > archive.length) fail("ZIP entry extends past the end of the archive.");
    entries.push(archive.subarray(nameStart, nameStart + nameLength).toString("utf8"));
    offset = nextOffset;
  }
  if (!entries.length) fail("ZIP contains no files.");
  return entries;
}

export function validateZipRoot(zipPath, requiredFiles = []) {
  const entries = readZipEntries(zipPath);
  if (!entries.includes("manifest.json")) {
    fail("packaged ZIP must contain manifest.json directly at its root.");
  }
  if (entries.some((entry) => entry.includes("\\") || entry.startsWith("/") || entry.split("/").includes(".."))) {
    fail("packaged ZIP contains an unsafe or non-portable path.");
  }
  for (const file of requiredFiles) {
    if (!entries.includes(file.replaceAll("\\", "/"))) fail(`packaged ZIP is missing ${file}.`);
  }
  return entries;
}

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : "";
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    const root = argumentValue("--root") || DEFAULT_EXTENSION_ROOT;
    const result = validateExtensionRoot(root);
    const zip = argumentValue("--zip");
    const zipEntries = zip ? validateZipRoot(path.resolve(zip), result.requiredFiles) : [];
    console.log(JSON.stringify({
      ok: true,
      extensionRoot: result.extensionRoot,
      version: result.manifest.version,
      serviceWorker: result.manifest.background.service_worker,
      requiredFiles: result.requiredFiles,
      syntaxChecked: result.jsFiles,
      zipEntries,
    }, null, 2));
  } catch (error) {
    console.error(error.message || error);
    process.exitCode = 1;
  }
}
