import CanvasKitInit from 'canvaskit-wasm';
import { outlineStrokeGeometryWithKit } from '../vector-geometry-kernel.js';
import { VectorGeometryError, VECTOR_GEOMETRY_LIMITS } from '../vector-geometry-contract.js';
import { VECTOR_GEOMETRY_RUNTIME_ARTIFACTS as artifacts } from '../vector-geometry-artifacts.js';

let runtime = null; let initializing = null; let busy = false;
async function initialize() {
  if (runtime) return runtime;
  if (initializing) return initializing;
  initializing = (async () => {
    const url = new URL('./vector-geometry.wasm',import.meta.url);
    const response = await fetch(url,{credentials:'same-origin'});
    if (!response.ok) throw new VectorGeometryError('The local vector runtime could not be loaded. Reload the app and retry.','VECTOR_GEOMETRY_UNAVAILABLE');
    const declared = Number(response.headers.get('content-length'));
    if (declared > artifacts.wasmSizeBytes) throw new VectorGeometryError('The local vector runtime exceeds its audited size.','VECTOR_GEOMETRY_INTEGRITY');
    let bytes;
    if (response.body?.getReader) {
      const reader=response.body.getReader(); const chunks=[]; let length=0;
      try { while (true) { const next=await reader.read();if(next.done)break;
        if ((length+=next.value.byteLength)>artifacts.wasmSizeBytes)throw new VectorGeometryError('The local vector runtime exceeds its audited size.','VECTOR_GEOMETRY_INTEGRITY');
        chunks.push(next.value);
      } } catch(error) { await reader.cancel().catch(()=>{});throw error; }
      bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
    } else bytes=new Uint8Array(await response.arrayBuffer());
    if(bytes.byteLength!==artifacts.wasmSizeBytes)throw new VectorGeometryError('The local vector runtime is incomplete. Reload the app and retry.','VECTOR_GEOMETRY_INTEGRITY');
    const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));
    const hash=Array.from(digest,value=>value.toString(16).padStart(2,'0')).join('');
    if(hash!==artifacts.wasmSha256)throw new VectorGeometryError('The local vector runtime failed its integrity check. Reload the app and retry.','VECTOR_GEOMETRY_INTEGRITY');
    // CanvasKit0.42's loader no longer consumes wasmBinary/instantiateWasm.
    // Supply its fetch from these already verified bytes inside this isolated
    // worker, avoiding an unverified second network read or a Blob/data URL.
    const originalFetch=globalThis.fetch;const verifiedFile='tiny-image-star-verified-vector-geometry.wasm';
    globalThis.fetch=async requested=>{
      if(String(requested)!==verifiedFile)throw new VectorGeometryError('The vector loader requested an unexpected runtime asset.','VECTOR_GEOMETRY_INTEGRITY');
      return new Response(bytes,{headers:{'content-type':'application/wasm'}});
    };
    try{runtime=await CanvasKitInit({locateFile:()=>verifiedFile});}
    finally{globalThis.fetch=originalFetch;}
    return runtime;
  })();
  try{return await initializing;}finally{initializing=null;}
}

self.addEventListener('message',async event=>{
  const message=event.data;
  if(!Number.isSafeInteger(message?.id)||message.id<1)return;
  if(busy){self.postMessage({id:message.id,ok:false,error:{message:'The local vector worker is already processing a job.',code:'VECTOR_GEOMETRY_BUSY'}});return;}
  busy=true;
  try{
    if(!['initialize','outline-stroke'].includes(message.type))throw new VectorGeometryError('The local vector worker received an unsupported operation.');
    const kit=await initialize();
    if(message.type==='initialize')self.postMessage({id:message.id,ok:true,value:{package:artifacts.package,version:artifacts.version,heapBytes:kit.HEAPU8.byteLength}});
    else if(message.type==='outline-stroke'){
      const value=outlineStrokeGeometryWithKit(kit,message.geometry,message.stroke);
      self.postMessage({id:message.id,ok:true,value},[value.commands.buffer]);
    }else throw new VectorGeometryError('The local vector worker received an unsupported operation.');
  }catch(error){
    self.postMessage({id:message.id,ok:false,fatal:!runtime||runtime.HEAPU8.byteLength>VECTOR_GEOMETRY_LIMITS.maxHeapBytes,
      error:{message:error?.message||'The local vector operation failed.',code:error?.code||'VECTOR_GEOMETRY_FAILED'}});
  }finally{busy=false;}
});
