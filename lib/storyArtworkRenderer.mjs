// Native renderer shared by dormant integration and credential-free review.
// Approved layout module is imported unchanged from PR #698.
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {createRequire} from "node:module";
import {Resvg} from "@resvg/resvg-js";
import opentype from "opentype.js";
import {renderStorySvg,escapeXml} from "../tools/story-previews/template.mjs";
const require=createRequire(import.meta.url);
const fontPaths=[400,700,900].map(weight=>require.resolve("@fontsource/inter/files/inter-latin-"+weight+"-normal.woff"));
const fonts={};
for (const [index,weight] of [400,700,900].entries()) {
 const bytes=await readFile(fontPaths[index]);
 fonts[weight]=opentype.parse(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
}
const font=fonts[900];
// Match the existing reel renderer's glyph-by-glyph width measurement.
// Avoid unsupported OpenType substitution tables in the bundled Inter font.
const measure=(text,size)=>Array.from(text).reduce((width,char)=>{
 const glyph=font.charToGlyph(char);
 return width+(glyph.advanceWidth||font.unitsPerEm*.5)*(size/font.unitsPerEm);
},0);
// SVG paths remain self-contained and render identically without installed fonts.
const drawText=(value,x,y,size,fill="#ffffff",weight=700)=>{
 const selected=fonts[weight]||fonts[700];let cursor=x;
 const paths=Array.from(String(value)).map(char=>{
  const glyph=selected.charToGlyph(char);
  const d=glyph.getPath(cursor,y,size).toPathData(2);
  cursor+=(glyph.advanceWidth||selected.unitsPerEm*.5)*(size/selected.unitsPerEm);
  return '<path d="'+d+'"/>';
 }).join("");
 return '<g aria-label="'+escapeXml(value)+'" fill="'+fill+'">'+paths+'</g>';
};
const render=svg=>new Resvg(svg,{font:{fontFiles:fontPaths,loadSystemFonts:false,defaultFontFamily:"Inter"}}).render().asPng();

function trimmedLogo(bytes,mime="image/png",white=false) {
 const uri="data:"+mime+";base64,"+bytes.toString("base64");
 const square=new Resvg('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800"><image href="'+uri+'" width="800" height="800" preserveAspectRatio="xMidYMid meet"/></svg>').render();
 const pixels=square.pixels;let left=800,top=800,right=0,bottom=0;
 for(let y=0;y<800;y++)for(let x=0;x<800;x++){
  const i=(y*800+x)*4;
  if(pixels[i+3]>32 && (white||Math.min(pixels[i],pixels[i+1],pixels[i+2])<230)){
   left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);
  }
 }
 assert.ok(right>left&&bottom>top,"The genuine logo has no visible artwork.");
 left=Math.max(0,left-8);top=Math.max(0,top-8);right=Math.min(799,right+8);bottom=Math.min(799,bottom+8);
 const svg='<svg xmlns="http://www.w3.org/2000/svg" width="'+(right-left+1)+'" height="'+(bottom-top+1)+'" viewBox="'+left+' '+top+' '+(right-left+1)+' '+(bottom-top+1)+'"><image href="'+uri+'" width="800" height="800" preserveAspectRatio="xMidYMid meet"/></svg>';
 return "data:image/png;base64,"+new Resvg(svg).render().asPng().toString("base64");
}

let logo;
export async function renderApprovedStory(model,{photoDataUrl,safeGuide=false}={}) {
 // Force the native decoder to prove that the complete first-image bytes render.
 // resvg otherwise silently ignores some corrupt embedded images.
 if(!/^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/]+=*$/.test(photoDataUrl||""))throw Error("story_raster_invalid");
 const decoded=new Resvg('<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><image href="'+photoDataUrl+'" width="96" height="96"/></svg>').render().pixels;
 if(!decoded.some((value,index)=>index%4===3&&value>0))throw Error("story_raster_decode_failed");
 if(model.brandKey==="vansco"&&!logo) logo=trimmedLogo(await readFile(new URL("../assets/vansco-logo.png",import.meta.url)),"image/png",true);
 const svg=renderStorySvg(model,{photoDataUrl,logoDataUrl:model.brandKey==="vansco"?logo:"",measure,drawText,safeGuide});
 const png=render(svg);
 assert.ok(png.length<=4_000_000,"story_png_exceeds_facebook_limit");
 assert.equal(png.readUInt32BE(16),1080); assert.equal(png.readUInt32BE(20),1920);
 return {png,svg};
}
