import { spawn } from "node:child_process";
import ffmpegPath from "ffmpeg-static";
import { VANSCO_EMAIL_LOGO_WEBP } from "../lib/vanscoEmailLogo.js";

const pngHeader=Buffer.from([137,80,78,71,13,10,26,10]);
function convertWebpToPng(input) {
  return new Promise((resolve,reject)=>{
    const args=["-hide_banner","-loglevel","error","-i","pipe:0","-frames:v","1","-f","image2pipe","-vcodec","png","pipe:1"];
    const proc=spawn(ffmpegPath,args,{stdio:["pipe","pipe","pipe"]});
    const parts=[];let size=0,failed=false;
    const timeout=setTimeout(()=>{failed=true;proc.kill("SIGKILL")},9000);
    proc.stdout.on("data",chunk=>{size+=chunk.length;if(size>3_000_000){failed=true;proc.kill("SIGKILL")}else parts.push(chunk)});
    proc.stderr.on("data",()=>{});
    proc.on("error",error=>{clearTimeout(timeout);reject(error)});
    proc.on("close",code=>{
      clearTimeout(timeout);
      const result=Buffer.concat(parts);
      if(failed||code!==0||!result.subarray(0,8).equals(pngHeader))return reject(new Error("Vansco logo PNG conversion failed."));
      resolve(result);
    });
    proc.stdin.on("error",()=>{});
    proc.stdin.end(input);
  });
}

export default async function handler(req,res){
  if(!["GET","HEAD"].includes(req.method))return res.status(405).end();
  try{
    const response=await fetch(VANSCO_EMAIL_LOGO_WEBP,{
      headers:{"Accept":"image/webp,image/*;q=0.8","User-Agent":"VanscoEmailStudio/1.0"},
      signal:AbortSignal.timeout(8000),
    });
    if(!response.ok)throw new Error("Vansco logo source unavailable.");
    const size=Number(response.headers.get("content-length")||0);
    if(size>1_500_000)throw new Error("Vansco logo file oversized.");
    const body=Buffer.from(await response.arrayBuffer());
    if(body.length<16||body.length>1_500_000||body.toString("ascii",0,4)!=="RIFF"||body.toString("ascii",8,12)!=="WEBP"){
      throw new Error("Vansco logo source is not WebP.");
    }
    const png=await convertWebpToPng(body);
    // Simple diagnostics so the PNG conversion can be verified without sending an email.
    if(req.query?.check==="1")return res.status(200).json({ok:true,format:"png",bytes:png.length});
    res.setHeader("Content-Type","image/png");
    res.setHeader("Cache-Control","public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800");
    res.setHeader("X-Content-Type-Options","nosniff");
    return res.status(200).end(req.method==="HEAD"?undefined:png);
  }catch(error){
    console.error("[Vansco email logo conversion]",String(error.message||error).slice(0,140));
    if(req.query?.check==="1")return res.status(502).json({ok:false,message:"Logo conversion is unavailable."});
    // Original is preferable to a missing logo if the conversion service is temporarily unavailable.
    res.setHeader("Cache-Control","no-store");
    return res.redirect(302,VANSCO_EMAIL_LOGO_WEBP);
  }
}
