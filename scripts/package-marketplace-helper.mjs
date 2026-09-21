import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_EXTENSION_ROOT,
  validateExtensionRoot,
  validateZipRoot,
} from "./validate-marketplace-helper.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : "";
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function writeStoredZip(zipPath, files) {
  const localParts = [];
  const centralParts = [];
  let localOffset = 0;

  for (const file of files) {
    const name = Buffer.from(file.name.replaceAll("\\", "/"), "utf8");
    const data = fs.readFileSync(file.absolute);
    const checksum = crc32(data);
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0x0021, 12);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(data.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    localHeader.writeUInt16LE(0, 28);
    localParts.push(localHeader, name, data);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0x0021, 14);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(data.length, 20);
    centralHeader.writeUInt32LE(data.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(localOffset, 42);
    centralParts.push(centralHeader, name);

    localOffset += localHeader.length + name.length + data.length;
  }

  const centralSize = centralParts.reduce((total, part) => total + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(localOffset, 16);
  end.writeUInt16LE(0, 20);
  fs.writeFileSync(zipPath, Buffer.concat([...localParts, ...centralParts, end]));
}

const sourceRoot = path.resolve(argumentValue("--source") || DEFAULT_EXTENSION_ROOT);
const outputBase = path.resolve(argumentValue("--out-dir") || path.join(REPO_ROOT, "dist", "marketplace-helper"));
const validated = validateExtensionRoot(sourceRoot);
const folderName = `VFC-Facebook-Helper-v${validated.manifest.version}`;
const outputRoot = path.join(outputBase, folderName);
const zipPath = path.join(outputBase, `${folderName}.zip`);

fs.rmSync(outputBase, { recursive: true, force: true });
fs.mkdirSync(outputRoot, { recursive: true });

for (const file of validated.requiredFiles) {
  const destination = path.join(outputRoot, ...file.split("/"));
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(path.join(sourceRoot, ...file.split("/")), destination);
}

const packaged = validateExtensionRoot(outputRoot);
const zipFiles = packaged.requiredFiles.map((name) => ({
  name,
  absolute: path.join(outputRoot, ...name.split("/")),
}));
writeStoredZip(zipPath, zipFiles);
const zipEntries = validateZipRoot(zipPath, packaged.requiredFiles);

console.log(JSON.stringify({
  ok: true,
  version: packaged.manifest.version,
  folder: outputRoot,
  zip: zipPath,
  files: packaged.requiredFiles,
  zipEntries,
}, null, 2));
