import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function loaderSource() {
  return readFile(new URL("../public/wix-ai-assistant/site-loader.js", import.meta.url), "utf8");
}

test("desktop assistant stays bounded while mobile open state owns the full viewport", async () => {
  const loader = await loaderSource();

  assert.match(loader, /\.panel-frame\s*\{[\s\S]*?width:380px; height:610px/);
  assert.match(loader, /@media \(max-width:520px\)[\s\S]*?\.panel-frame,\s*\.panel-frame\.is-open\s*\{/);
  assert.match(loader, /\.panel-frame,\s*\.panel-frame\.is-open\s*\{[\s\S]*?inset:0;[\s\S]*?width:100vw;[\s\S]*?height:100dvh;[\s\S]*?border-radius:0;[\s\S]*?box-shadow:none;/);
  assert.doesNotMatch(loader, /height:min\(682px, calc\(100dvh - 112px\)\)/);
});

test("opening the assistant locks the page behind it and closing restores page scrolling", async () => {
  const loader = await loaderSource();

  assert.match(loader, /function lockPageScroll\(\)/);
  assert.match(loader, /function unlockPageScroll\(\)/);
  assert.match(loader, /html\.style\.setProperty\("overflow", "hidden", "important"\)/);
  assert.match(loader, /body\.style\.setProperty\("overflow", "hidden", "important"\)/);
  assert.match(loader, /currentFrame\.classList\.add\("is-open"\);\s*lockPageScroll\(\);/);
  assert.match(loader, /restoreCompetingWhatsAppControl\(\);\s*unlockPageScroll\(\);/);
});

test("WhatsApp control is hidden only while Ask Me is open and restored on close", async () => {
  const loader = await loaderSource();

  assert.match(loader, /WHATSAPP_SELECTOR/);
  assert.match(loader, /data-vfc-ai-whatsapp-hidden/);
  assert.match(loader, /function hideCompetingWhatsAppControl\(\)/);
  assert.match(loader, /function restoreCompetingWhatsAppControl\(\)/);
  assert.match(loader, /currentFrame\.classList\.add\("is-open"\);[\s\S]*?hideCompetingWhatsAppControl\(\);/);
  assert.match(loader, /restoreCompetingWhatsAppControl\(\);[\s\S]*?frame\?\.classList\.remove\("is-open"\);/);
  assert.match(loader, /new MutationObserver\(\(\) => scanAndHideWhatsAppControls\(\)\)/);
});
