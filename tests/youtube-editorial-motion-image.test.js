import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { renderEditorialImpactPhotoSvg } from "../api/youtube-mp4-render.js";

test("Editorial Impact photo SVG preserves a PNG source MIME type", () => {
  const svg = renderEditorialImpactPhotoSvg({
    bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    contentType: "image/png",
  });

  assert.match(svg, /data:image\/png;base64,/);
  assert.doesNotMatch(svg, /data:image\/jpeg;base64,/);
});

test("Editorial Impact motion renderer passes the downloaded image object, not a forced JPEG", async () => {
  const source = await readFile(
    new URL("../api/youtube-mp4-render.js", import.meta.url),
    "utf8",
  );

  assert.match(
    source,
    /async function writeMotionImage\(image, outputPath, templateKey,/,
  );
  assert.match(
    source,
    /renderEditorialImpactPhotoSvg\(image\)/,
  );
  assert.match(
    source,
    /writeMotionImage\(sourceImage, motionImagePath, templateKey, index\)/,
  );
  assert.doesNotMatch(
    source,
    /renderEditorialImpactPhotoSvg\(\{\s*bytes,\s*contentType:\s*['"]image\/jpeg['"]/,
  );
});
