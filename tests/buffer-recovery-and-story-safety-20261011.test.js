import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { selectVanFinanceInstagramMirrors } from "../lib/bufferInstagramMirror.js";
import { storyImageWithinBufferLimit, inspectStoryImage, compactWixBrandedStoryImageUrl } from "../api/buffer-facebook-story-automation.js";
import { preflightPublicMedia } from "../api/buffer-instagram-mirror.js";

function fbReel(dueAt, status = "sent") {
  return {
    id: "fb-1", channelId: "finance-fb", status, dueAt,
    text: "REGISTRATION: AB12CDE",
    assets: [{ mimeType: "video/mp4", source: "https://example.com/ab12cde.mp4" }],
  };
}

test("Instagram catches up a sent Facebook reel missed by the last refill without creating duplicates", () => {
  const now = Date.parse("2026-10-11T14:40:00Z");
  const facebookPosts = [fbReel("2026-10-11T14:20:00Z")];
  const input = { facebookPosts, facebookChannelId: "finance-fb", now };
  const recovered = selectVanFinanceInstagramMirrors(input);
  assert.equal(recovered.length, 1);
  assert.equal(recovered[0].recovery, true);
  assert.equal(recovered[0].dueAt, "2026-10-11T14:45:00.000Z");

  const instagramPosts = [{ ...facebookPosts[0], id: "ig-1", channelId: "ig", status: "scheduled",
    dueAt: recovered[0].dueAt }];
  assert.deepEqual(selectVanFinanceInstagramMirrors({ ...input, instagramPosts }), []);
});

test("Instagram does not catch up unpublished or previous-day media, or reshare already published media", () => {
  const now = Date.parse("2026-10-11T14:40:00Z");
  const previousDay = fbReel("2026-10-10T16:00:00Z");
  const unpublished = fbReel("2026-10-11T14:20:00Z", "scheduled");
  const today = fbReel("2026-10-11T14:20:00Z");
  const base = { facebookChannelId: "finance-fb", now };
  assert.deepEqual(selectVanFinanceInstagramMirrors({ ...base, facebookPosts: [previousDay] }), []);
  assert.deepEqual(selectVanFinanceInstagramMirrors({ ...base, facebookPosts: [unpublished] }), []);
  assert.deepEqual(selectVanFinanceInstagramMirrors({
    ...base, facebookPosts: [today],
    instagramPosts: [{ ...today, id: "ig-sent", channelId: "ig", dueAt: "2026-10-11T14:30:00Z" }],
  }), []);
});

test("Facebook Story preflight rejects confirmed oversized images and keeps reasonable CDN images", async () => {
  const fakeHead = (size, status = 200) => async () => ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (header) => header === "content-length" ? size : null },
  });
  assert.equal(await storyImageWithinBufferLimit("https://example.com/large.png", fakeHead("5347738")), false);
  assert.equal(await storyImageWithinBufferLimit("https://example.com/small.jpg", fakeHead("1200000")), true);
  assert.equal(await storyImageWithinBufferLimit("https://example.com/no-header.jpg", fakeHead(null)), true);
  assert.equal(await storyImageWithinBufferLimit("https://example.com/unavailable.jpg", fakeHead(null, 500)), false);
});

test("Story copy is distinct and a second suitable image is attempted after a recoverable rejection", async () => {
  const source = await readFile(new URL("../api/buffer-facebook-story-automation.js", import.meta.url), "utf8");
  assert.match(source, /RENT2BUY VANS · TODAY'S STORY/);
  assert.match(source, /VAN FINANCE COMPANY · TODAY'S STORY/);
  assert.match(source, /sourceImageCandidates/);
  assert.match(source, /RECOVERABLE_STORY_MEDIA_ERROR\.test/);
  assert.match(source, /STORY_IMAGE_LIMIT_BYTES = 4_000_000/);
  assert.match(source, /STORY_ALTERNATIVE_IMAGE_LIMIT = 8/);
});

test("Ready Rent2Buy reels are rechecked against active CRM stock before Buffer publication", async () => {
  const worker = await readFile(new URL("../api/buffer-facebook-automation-worker.js", import.meta.url), "utf8");
  const generator = await readFile(new URL("../api/youtube-daily-batch.js", import.meta.url), "utf8");
  assert.match(generator, /\.from\("rent_vehicles"\)[\s\S]{0,190}\.eq\("is_active", true\)/);
  assert.match(worker, /const activeRent2BuyStock = productKey === "rent2buy"/);
  assert.match(worker, /stillAdvertised\(reel\.registration\)/);
  assert.match(worker, /inactive_rent2buy_stock/);
});

test("Instagram rejects known 8.1MB vehicle images before creating Buffer posts", async () => {
  const fake = (length, kind="image/jpeg", range=null) => async () => ({
    ok:true,status:200,
    headers:{get(name){
      if(name==="content-type")return kind;
      if(name==="content-length")return length;
      if(name==="content-range")return range;
      return null;
    }},
  });
  await assert.rejects(preflightPublicMedia("https://example.com/oversize.jpg","image",fake("8100000")),/8.0 MB limit/);
  await assert.doesNotReject(preflightPublicMedia("https://example.com/ok.jpg","image",fake("7999999")));
  await assert.rejects(preflightPublicMedia("https://example.com/range.jpg","image",fake("1","image/jpeg","bytes 0-0/8100000")),/8.0 MB limit/);
  // Video reels retain their existing format and size rules, untouched.
  await assert.doesNotReject(preflightPublicMedia("https://example.com/reel.mp4","video",fake("20000000","video/mp4")));
});

test("Oversized normal Instagram images may use same-registration reviewed gallery; reels stay untouched", async () => {
  const mirror = await readFile(new URL("../api/buffer-instagram-mirror.js",import.meta.url),"utf8");
  assert.match(mirror,/mirror.mediaKind === "image"/);
  assert.match(mirror,/loadReviewedFacebookSecondaryImages\(supabase, "vanFinance", mirror.registration\)/);
  assert.match(mirror,/source: "reviewed_vehicle_gallery"/);
  assert.match(mirror,/INSTAGRAM_IMAGE_LIMIT_BYTES = 8_000_000/);
  assert.match(mirror,/for \(const candidate of reviewed.filter/);
  assert.match(mirror,/return mirror.mediaKind === "video"/);
});

test("Facebook Story branded fallback keeps the exact Wix primary image, at a smaller JPEG resolution", () => {
  const original = "https://static.wixstatic.com/media/5ef4b7_0c38b0ac28d64d2cb4ddec0d9f23387b~mv2.png";
  assert.equal(compactWixBrandedStoryImageUrl(original),
    original + "/v1/fit/w_1080,h_1350/file.jpg");
  assert.equal(compactWixBrandedStoryImageUrl("https://other.example.com/media/x.png"), "");
  assert.equal(compactWixBrandedStoryImageUrl("http://static.wixstatic.com/media/x.png"), "");
  assert.equal(compactWixBrandedStoryImageUrl("https://static.wixstatic.com/media/x.png?token=secret"),
    "https://static.wixstatic.com/media/x.png/v1/fit/w_1080,h_1350/file.jpg");
});

test("Facebook Story image preflight classifies oversized PNG and accepts genuine smaller JPEG", async () => {
  const response=(status,length,range=null)=>({
    ok:status===200||status===206,status,
    headers:{get(key){return key==="content-length"?length:key==="content-range"?range:null;}},
  });
  const source="https://static.wixstatic.com/media/brand.png";
  assert.deepEqual(await inspectStoryImage(source,async()=>response(200,"5100000")),
    {ok:false,reason:"oversized",size:5100000});
  assert.deepEqual(await inspectStoryImage(source,async()=>response(200,"1200000")),
    {ok:true,reason:"head_verified",size:1200000});
  let methods=[];
  const fallback=async(_url,init)=>{
    methods.push(init.method);
    return init.method==="HEAD"?response(405,null):response(206,"1","bytes 0-0/1200000");
  };
  assert.deepEqual(await inspectStoryImage(source,fallback),
    {ok:true,reason:"range_verified",size:1200000});
  assert.deepEqual(methods,["HEAD","GET"]);
  const hugeRange=async(_url,init)=>init.method==="HEAD"?response(405,null):response(206,"1","bytes 0-0/5800000");
  assert.deepEqual(await inspectStoryImage(source,hugeRange),
    {ok:false,reason:"oversized",size:5800000});
});

test("Story image preflight fails closed on unknown range sizes and trusted fallback never crosses registrations", async () => {
  const source="https://static.wixstatic.com/media/brand.png";
  const fake=async(_url,init)=>init.method==="HEAD"
    ? {ok:false,status:403,headers:{get:()=>null}}
    : {ok:true,status:206,headers:{get:(key)=>key==="content-length"?"1":null}};
  assert.equal((await inspectStoryImage(source,fake)).ok,false);
  const worker=await readFile(new URL("../api/buffer-facebook-story-automation.js",import.meta.url),"utf8");
  assert.match(worker,/productKey === "vanFinance"/);
  assert.match(worker,/\.eq\("is_active", true\)/);
  assert.match(worker,/\.in\("title", wanted\)/);
  assert.match(worker,/if \(!wanted.includes\(reg\) \|\| row.is_active !== true\) continue/);
  assert.match(worker,/brandedImageOverride: smallerImage/);
  assert.match(worker,/mediaSource: result.mediaSource/);
});
