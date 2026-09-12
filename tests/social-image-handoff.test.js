import test from "node:test";
import assert from "node:assert/strict";
import {
  assertPublicHttpsImageUrl,
  handoffBufferImageVariables,
  prepareSocialImageForBuffer,
} from "../lib/socialImageHandoff.js";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00]);

function response({ url, status = 200, contentType = "image/png", body = PNG, contentLength } = {}) {
  const headers = new Map([
    ["content-type", contentType],
    ["content-length", String(contentLength ?? body.length)],
  ]);
  return {
    ok: status >= 200 && status < 300,
    status,
    url,
    headers: { get: (name) => headers.get(String(name).toLowerCase()) || null },
    arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
  };
}

test("controlled handoff downloads, validates, stores and rechecks an image before Buffer sees it", async () => {
  const fetches = [];
  const uploads = [];
  const fetchImpl = async (url, init) => {
    fetches.push({ url, init });
    if (url === "https://supplier.example/van.png") {
      return response({ url: "https://supplier.example/van.png" });
    }
    if (url === "https://safe.public.blob.vercel-storage.com/buffer-social-images/van.png") {
      return response({ url, status: 206 });
    }
    throw new Error(`Unexpected URL ${url}`);
  };
  const putImpl = async (pathname, bytes, options) => {
    uploads.push({ pathname, bytes: Buffer.from(bytes), options });
    return {
      pathname,
      url: "https://safe.public.blob.vercel-storage.com/buffer-social-images/van.png",
    };
  };

  const result = await prepareSocialImageForBuffer({
    sourceUrl: "https://supplier.example/van.png",
    fetchImpl,
    putImpl,
  });

  assert.equal(fetches.length, 2);
  assert.equal(uploads.length, 1);
  assert.match(uploads[0].pathname, /^buffer-social-images\/[a-f0-9]{64}\.png$/);
  assert.deepEqual(uploads[0].bytes, PNG);
  assert.equal(uploads[0].options.contentType, "image/png");
  assert.equal(uploads[0].options.addRandomSuffix, false);
  assert.equal(uploads[0].options.allowOverwrite, true);
  assert.equal(result.url, "https://safe.public.blob.vercel-storage.com/buffer-social-images/van.png");
  assert.equal(result.contentType, "image/png");
  assert.equal(result.sizeBytes, PNG.length);
});

test("Buffer image variables are replaced with the controlled URL without changing video assets", async () => {
  const source = {
    input: {
      text: "AB12CDE",
      assets: [
        { image: { url: "https://supplier.example/van.png" } },
        { video: { url: "https://video.example/reel.mp4" } },
      ],
    },
  };
  const fetchImpl = async (url) => url.includes("blob.vercel-storage.com")
    ? response({ url, status: 206 })
    : response({ url });
  const putImpl = async (pathname) => ({
    pathname,
    url: "https://safe.public.blob.vercel-storage.com/buffer-social-images/controlled.png",
  });

  const prepared = await handoffBufferImageVariables(source, { fetchImpl, putImpl });

  assert.notEqual(prepared, source);
  assert.equal(source.input.assets[0].image.url, "https://supplier.example/van.png");
  assert.equal(prepared.input.assets[0].image.url, "https://safe.public.blob.vercel-storage.com/buffer-social-images/controlled.png");
  assert.equal(prepared.input.assets[1].video.url, "https://video.example/reel.mp4");
});

test("preflight rejects non-image responses before any upload", async () => {
  let uploaded = false;
  await assert.rejects(
    prepareSocialImageForBuffer({
      sourceUrl: "https://supplier.example/van.jpg",
      fetchImpl: async (url) => response({ url, contentType: "text/html", body: Buffer.from("not an image") }),
      putImpl: async () => {
        uploaded = true;
        return {};
      },
    }),
    /rejected content type text\/html/,
  );
  assert.equal(uploaded, false);
});

test("preflight rejects private or local image URLs", () => {
  assert.throws(() => assertPublicHttpsImageUrl("https://127.0.0.1/van.jpg"), /not publicly routable/);
  assert.throws(() => assertPublicHttpsImageUrl("https://192.168.1.10/van.jpg"), /not publicly routable/);
  assert.throws(() => assertPublicHttpsImageUrl("https://localhost/van.jpg"), /not publicly routable/);
  assert.throws(() => assertPublicHttpsImageUrl("http://supplier.example/van.jpg"), /must use HTTPS/);
});

test("preflight rejects files whose bytes do not match their advertised image type", async () => {
  await assert.rejects(
    prepareSocialImageForBuffer({
      sourceUrl: "https://supplier.example/van.png",
      fetchImpl: async (url) => response({ url, body: Buffer.from("definitely not png") }),
      putImpl: async () => ({ url: "https://safe.public.blob.vercel-storage.com/x.png" }),
    }),
    /bytes do not match image\/png/,
  );
});
