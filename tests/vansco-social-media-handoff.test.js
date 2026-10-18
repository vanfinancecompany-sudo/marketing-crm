import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { prepareVanscoBufferImages as actualPrepareVanscoBufferImages, loadVanscoImageStorageUsage, VANSCO_BLOB_PREFIX, VANSCO_OWNED_BLOB_PREFIX, VANSCO_LEASE_PREFIX, vanscoVehicleMediaToken } from "../lib/vanscoSocialMediaHandoff.js";

const VALID_JPEG = Buffer.from([0xff,0xd8,0xff,0xe0,0x01,0x02,0xff,0xd9]);
const OTH_JPEG = Buffer.from([0xff,0xd8,0xff,0xe0,0x03,0x04,0xff,0xd9]);
const THIRD_JPEG = Buffer.from([0xff,0xd8,0xff,0xe0,0x05,0x06,0xff,0xd9]);
const vansco = n => "https://acdn.uk/vansco/i/image-" + n + ".jpeg";
const expectedPublic = pathname => "https://test-storage.public.blob.vercel-storage.com/" + pathname;
const vehicleId = "c500e0856a9b0eef55ec3";
const dueAt = "2026-10-20T11:00:00.000Z";
const leaseLog=[];
const prepareForTest = (urls,opts={}) =>
  actualPrepareVanscoBufferImages(urls,{vehicleId,dueAt,leasePutImpl:async(pathname,content,options)=>{
    leaseLog.push({pathname,content,options}); return {pathname};
  },...opts});


function fixture(images = new Map([[vansco(1),VALID_JPEG],[vansco(2),OTH_JPEG],[vansco(3),THIRD_JPEG]])) {
  const blobs = new Map();
  const operations = { fetches:[], writes:[], heads:[] };
  const deps = {
    fetchImpl: async (url, init) => {
      operations.fetches.push({url,init});
      const b = images.get(url);
      if (!b) return new Response("not found", { status: 404 });
      return new Response(b, { headers: {"Content-Type":"image/jpeg","Content-Length":String(b.length)} });
    },
    listImpl: async ({prefix,cursor}) => {
      assert.equal(prefix,"vansco-buffer-images/");
      assert.equal(cursor,undefined);
      return {blobs:[...blobs.entries()].map(([pathname,obj])=>({pathname,size:obj.size||8})),hasMore:false};
    },
    headImpl: async pathname => {
      operations.heads.push(pathname);
      if (!blobs.has(pathname)) {
        const e = new Error("blob not found"); e.name = "BlobNotFoundError"; throw e;
      }
      return blobs.get(pathname);
    },
    putImpl: async (pathname, bytes, opts) => {
      operations.writes.push({pathname,bytes,opts});
      if (blobs.has(pathname)) throw new Error("Existing blob must never be overwritten");
      const obj = {url:expectedPublic(pathname),pathname,contentType:opts.contentType,size:bytes.length};
      blobs.set(pathname,obj);
      return obj;
    },
  };
  return { deps, operations, blobs, images };
}

test("Vansco three images get isolated, deterministic public URLs in the right order", async () => {
  const {deps,operations,blobs} = fixture();
  const urls = await prepareForTest([vansco(1),vansco(2),vansco(3)],deps);
  assert.equal(urls.length,3);
  assert.equal(new Set(urls).size,3);
  assert.equal(blobs.size,3);
  assert.ok(urls.every(u=>u.includes("/"+VANSCO_OWNED_BLOB_PREFIX+"/")));
  assert.ok(urls.every(u=>!u.includes("/buffer-social-images/")));
  assert.equal(operations.writes.length,3);
  assert.ok(operations.writes.every(x=>x.opts.access==="public"&&x.opts.allowOverwrite===false));
  assert.ok(operations.fetches.every(x=>x.init.method==="GET"&&x.init.redirect==="error"));
});

test("Another Vansco channel reuses exact existing Blob URL without upload", async () => {
  const fx=fixture();
  const a=await prepareForTest([vansco(1),vansco(2),vansco(3)],fx.deps);
  const b=await prepareForTest([vansco(1)],fx.deps);
  const c=await prepareForTest([vansco(1),vansco(2)],fx.deps);
  assert.equal(b[0],a[0]);
  assert.deepEqual(c,a.slice(0,2));
  assert.equal(fx.operations.writes.length,3);
  assert.equal(fx.blobs.size,3);
});

test("Identical bytes at different Vansco source paths create only one stored image",async()=>{
  const fx=fixture(new Map([[vansco(1),VALID_JPEG],[vansco(2),VALID_JPEG]]));
  const urls=await prepareForTest([vansco(1),vansco(2)],fx.deps);
  assert.equal(urls.length,1);
  assert.equal(fx.operations.writes.length,1);
});

test("One failed secondary image stops the entire upload before any Buffer attempt", async()=>{
  const fx=fixture(new Map([[vansco(1),VALID_JPEG],[vansco(2),OTH_JPEG]]));
  await assert.rejects(prepareForTest([vansco(1),vansco(2),vansco(3)],fx.deps),/HTTP 404/);
  assert.equal(fx.operations.writes.length,0);
});

test("Reject non-Vansco DealerKit paths, private IPs, HTTP and unrelated hosts without fetching",async()=>{
  const fx=fixture();
  const invalid=[
    "https://acdn.uk/vanfinancecompany/i/different.jpeg",
    "https://acdn.uk/rent2buy/i/different.jpeg",
    "https://127.0.0.1/internal.jpg",
    "https://not-vansco.example.com/i/pic.jpg",
    "http://acdn.uk/vansco/i/pic.jpeg",
    "https://acdn.uk/vansco/i/unsupported.webp",
  ];
  for(const value of invalid) await assert.rejects(prepareForTest([value],fx.deps),/approved public image host|Vansco DealerKit|JPEG or PNG|Vansco image URL|Only the Vansco DealerKit/);
  assert.equal(fx.operations.fetches.length,0);
  assert.equal(fx.operations.writes.length,0);
});

test("Reject corrupted/truncated bytes and wrong MIME before public storage",async()=>{
  const images=new Map([[vansco(1),Buffer.from([0xff,0xd8,0xff,0xe0,0x01,0x02])]]);
  const fx=fixture(images);
  await assert.rejects(prepareForTest([vansco(1)],fx.deps),/incomplete/);
  assert.equal(fx.operations.writes.length,0);
  fx.deps.fetchImpl=async()=>new Response("not an image",{headers:{"Content-Type":"text/html"}});
  await assert.rejects(prepareForTest([vansco(1)],fx.deps),/not a JPEG or PNG/);
  assert.equal(fx.operations.writes.length,0);
});

test("Reject oversized or malformed images; no partial uploads",async()=>{
  const fx=fixture();
  await assert.rejects(prepareForTest([vansco(1)],{...fx.deps,maxBytes:5}),/exceeds 8 MB/);
  assert.equal(fx.operations.writes.length,0);
  await assert.rejects(prepareForTest([],fx.deps),/one to three/);
  await assert.rejects(prepareForTest(Array(4).fill(vansco(1)),fx.deps),/one to three/);
});

test("Unexpected storage error fails closed; never overwrites or borrows another namespace",async()=>{
  const fx=fixture();
  fx.deps.headImpl=async()=>{throw new Error("Vercel unavailable")};
  await assert.rejects(prepareForTest([vansco(1)],fx.deps),/Vercel unavailable/);
  assert.equal(fx.operations.writes.length,0);
  fx.deps.headImpl=async pathname=>({url:"https://test-storage.public.blob.vercel-storage.com/buffer-social-images/wrong.jpg",pathname,contentType:"image/jpeg"});
  await assert.rejects(prepareForTest([vansco(1)],fx.deps),/dedicated public storage path/);
});

test("Refuses general Wix media even if public, to prevent cross-brand image contamination",async()=>{
  const fx=fixture();
  await assert.rejects(prepareForTest(["https://static.wixstatic.com/media/vanfinancecompany.jpg"],fx.deps),/approved public image host/);
  assert.equal(fx.operations.fetches.length,0);
});

test("Vansco Blob inventory is scoped, paginated and fails on incomplete data",async()=>{
  let count=0;
  const result=await loadVanscoImageStorageUsage(async ({prefix,cursor})=>{
    assert.equal(prefix,VANSCO_BLOB_PREFIX+"/");
    count++;
    return cursor ? {blobs:[{pathname:prefix+"b.jpg",size:23}],hasMore:false}
      : {blobs:[{pathname:prefix+"a.jpg",size:12}],hasMore:true,cursor:"page-2"};
  });
  assert.equal(count,2);
  assert.deepEqual(result,{count:2,bytes:35});
  await assert.rejects(loadVanscoImageStorageUsage(async()=>({blobs:[],hasMore:true})),/pagination is incomplete/);
  await assert.rejects(loadVanscoImageStorageUsage(async()=>({blobs:[{pathname:"buffer-social-images/wrong.jpg",size:12}],hasMore:false})),/unrelated file/);
  await assert.rejects(loadVanscoImageStorageUsage(async()=>({blobs:null,hasMore:false})),/usage is unavailable/);
});

test("Vansco refuses additional storage beyond the 2 GB/4000 file cap; other brands unaffected",async()=>{
  const fx=fixture();
  fx.deps.listImpl=async()=>({blobs:[{pathname:VANSCO_BLOB_PREFIX+"/old.jpg",size:2_000_000_000}],hasMore:false});
  await assert.rejects(prepareForTest([vansco(1)],fx.deps),/storage cap reached/);
  assert.equal(fx.operations.writes.length,0);
  fx.deps.listImpl=async()=>({blobs:[{pathname:VANSCO_BLOB_PREFIX+"/old.jpg",size:0}],hasMore:false});
  const ok=await prepareForTest([vansco(1)],fx.deps);
  assert.equal(ok.length,1);
  assert.equal(fx.operations.writes.length,1);
});

test("Vansco-only code paths have the handoff, while VFC/Rent2Buy retain their default behaviour",()=>{
 const vanscoRuntime=readFileSync(new URL("../api/_vansco-buffer-runtime.js",import.meta.url),"utf8");
 const instaRuntime=readFileSync(new URL("../api/_vansco-instagram-runtime.js",import.meta.url),"utf8");
 const guard=readFileSync(new URL("../lib/bufferRuntimeGuard.js",import.meta.url),"utf8");
 const vfcRuntime=readFileSync(new URL("../api/buffer-facebook-automation-worker.js",import.meta.url),"utf8");
 const stories=readFileSync(new URL("../api/vansco-facebook-story-automation-worker.js",import.meta.url),"utf8");
 const instagram=readFileSync(new URL("../api/vansco-instagram-automation-worker.js",import.meta.url),"utf8");
 assert.match(vanscoRuntime,/prepareVanscoBufferImages\(urls, \{ vehicleId, dueAt \}\)/);
 assert.equal((vanscoRuntime.match(/prepareVanscoBufferImages\(\[compatibleImage\], \{ vehicleId, dueAt \}\)/g)||[]).length,2);
 assert.match(instaRuntime,/prepareVanscoBufferImages\(\[url\], \{vehicleId,dueAt\}\)/);
 assert.match(instaRuntime,/skipImageHandoff:true/);
 assert.match(guard,/skipImageHandoff = false/);
 assert.match(guard,/skipImageHandoff \? variables : await handoffBufferImageVariables\(variables\)/);
 assert.doesNotMatch(vfcRuntime,/prepareVanscoBufferImages|skipImageHandoff/);
 assert.match(stories,/preferLiveMetaImages: true/);
 assert.match(instagram,/preferLiveMetaImages: true/);
 assert.equal((vanscoRuntime.match(/source: "vansco-marketing-crm/g)||[]).length,3);
});

test("Vansco-owned image lease is written before Buffer receives a hosted URL", async()=>{
 const fx=fixture();
 leaseLog.length=0;
 const urls=await prepareForTest([vansco(1)],fx.deps);
 assert.equal(urls.length,1);
 assert.equal(leaseLog.length,1);
 assert.equal(leaseLog[0].pathname,VANSCO_LEASE_PREFIX+"/"+vanscoVehicleMediaToken(vehicleId)+"/20261020.json");
 assert.equal(leaseLog[0].options.allowOverwrite,true);
});

test("Vansco-only media storage refuses unknown DealerKit stock ownership",async()=>{
 const fx=fixture();
 await assert.rejects(actualPrepareVanscoBufferImages([vansco(1)],{...fx.deps,vehicleId:"",dueAt,leasePutImpl:async()=>{}}),/vehicle ID is required/);
 assert.equal(fx.operations.fetches.length,0);
});
