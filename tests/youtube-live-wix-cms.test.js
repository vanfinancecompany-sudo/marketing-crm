import test from "node:test";
import assert from "node:assert/strict";

import {
  parseYoutubeCmsUploadText,
  resolveYouTubeImageOrder,
} from "../utils/youtubeImageResolution.js";

test("live Wix image manifest resolves by registration and normalizes Wix image URLs", () => {
  const rows = parseYoutubeCmsUploadText(JSON.stringify({
    product: "vanFinance",
    items: [
      {
        registration: "XGZ4865",
        title: "Vauxhall Vivaro Turbo D Dynamic",
        images: [
          "wix:image://v1/5ef4b7_00d2a197619b4efd81d9380647bd8eb9~mv2.png/FINANCE%2520XGZ4865.png#originWidth=960&originHeight=720",
          "wix:image://v1/5ef4b7_7a56473d94a04df889eec59ed87ae4aa~mv2.jpg/03.jpg#originWidth=1280&originHeight=960",
        ],
      },
    ],
  }));

  assert.equal(rows.length, 1);
  assert.equal(rows[0].registration, "XGZ4865");
  assert.equal(rows[0].imageRecords.length, 2);
  assert.equal(
    rows[0].imageRecords[0].url,
    "https://static.wixstatic.com/media/5ef4b7_00d2a197619b4efd81d9380647bd8eb9~mv2.png",
  );

  const resolved = resolveYouTubeImageOrder({
    vehicle: { reg: "XGZ 4865" },
    cmsUpload: { source: "live-wix", rows },
    imageSource: "auto",
    imageCount: 10,
  });

  assert.equal(resolved.sourceLabel, "Live Wix CMS");
  assert.equal(resolved.records.length, 2);
});
