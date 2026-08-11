import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function loaderSource() {
  return readFile(new URL("../public/wix-ai-assistant/site-loader.js", import.meta.url), "utf8");
}

test("open site-wide assistant grows by about ten percent and reclaims the WhatsApp gap", async () => {
  const loader = await loaderSource();

  assert.match(loader, /\.panel-frame\.is-open\s*\{/);
  assert.match(loader, /bottom:18px/);
  assert.match(loader, /height:min\(671px, calc\(100dvh - 110px\)\)/);
  assert.match(loader, /bottom:12px/);
  assert.match(loader, /height:min\(682px, calc\(100dvh - 112px\)\)/);
});

test("WhatsApp control is hidden only while Ask Me is open and restored on close", async () => {
  const loader = await loaderSource();

  assert.match(loader, /WHATSAPP_SELECTOR/);
  assert.match(loader, /data-vfc-ai-whatsapp-hidden/);
  assert.match(loader, /function hideCompetingWhatsAppControl\(\)/);
  assert.match(loader, /function restoreCompetingWhatsAppControl\(\)/);
  assert.match(loader, /currentFrame\.classList\.add\("is-open"\);\s*hideCompetingWhatsAppControl\(\);/);
  assert.match(loader, /restoreCompetingWhatsAppControl\(\);\s*frame\?\.classList\.remove\("is-open"\);/);
  assert.match(loader, /new MutationObserver\(\(\) => scanAndHideWhatsAppControls\(\)\)/);
});
