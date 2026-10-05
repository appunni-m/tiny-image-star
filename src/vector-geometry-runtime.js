import { normalizeVectorOutlineRequest, validateVectorOutlineResult, vectorGeometryAbortError, VectorGeometryError, VECTOR_GEOMETRY_LIMITS } from './vector-geometry-contract.js';

/** One lazy geometry worker with a bounded queue; idle termination releases its128MiB heap. */
export class LocalVectorGeometryClient {
  #workerFactory;#worker=null;#queue=[];#active=null;#nextId=1;#closed=false;#idleTimer=null;
  constructor({workerFactory=()=>new Worker(new URL('./workers/vector-geometry-worker.bundle.js',import.meta.url),{type:'module',name:'tiny-image-star-vector-geometry'}),
    timeoutMs=VECTOR_GEOMETRY_LIMITS.requestTimeoutMs,idleTimeoutMs=VECTOR_GEOMETRY_LIMITS.idleTimeoutMs,maxQueue=VECTOR_GEOMETRY_LIMITS.maxQueue}={}){
    if(typeof workerFactory!=='function'||!Number.isFinite(timeoutMs)||timeoutMs<=0||timeoutMs>60_000
      ||!Number.isFinite(idleTimeoutMs)||idleTimeoutMs<0||idleTimeoutMs>60_000||!Number.isSafeInteger(maxQueue)||maxQueue<1||maxQueue>VECTOR_GEOMETRY_LIMITS.maxQueue)throw new TypeError('The local vector worker options are invalid.');
    this.#workerFactory=workerFactory;this.timeoutMs=timeoutMs;this.idleTimeoutMs=idleTimeoutMs;this.maxQueue=maxQueue;
  }
  initialize({signal}={}){return this.#request('initialize',{},signal);}
  outlineStroke(geometry,stroke,{signal}={}){
    try{return this.#request('outline-stroke',normalizeVectorOutlineRequest(geometry,stroke),signal).then(validateVectorOutlineResult);}
    catch(error){return Promise.reject(error);}
  }
  close(){
    if(this.#closed)return;this.#closed=true;this.#disposeWorker();
    const error=new VectorGeometryError('The local vector worker is closed.','VECTOR_GEOMETRY_CLOSED');
    if(this.#active)this.#finish(this.#active,error);
    for(const job of this.#queue.splice(0))this.#settle(job,error);
  }
  #disposeWorker(){clearTimeout(this.#idleTimer);this.#idleTimer=null;this.#worker?.terminate?.();this.#worker=null;}
  #settle(job,error,value){clearTimeout(job.timer);job.signal?.removeEventListener('abort',job.abort);if(error)job.reject(error);else job.resolve(value);}
  #finish(job,error,value){
    if(this.#active!==job)return;this.#active=null;this.#settle(job,error,value);
    queueMicrotask(()=>this.#drain());
  }
  #request(type,payload,signal){
    if(this.#closed)return Promise.reject(new VectorGeometryError('The local vector worker is closed.','VECTOR_GEOMETRY_CLOSED'));
    if(signal?.aborted)return Promise.reject(vectorGeometryAbortError());
    if(this.#queue.length+(this.#active?1:0)>=this.maxQueue)return Promise.reject(new VectorGeometryError('The local vector queue is full. Finish or cancel the current operation first.','VECTOR_GEOMETRY_QUEUE_FULL'));
    return new Promise((resolve,reject)=>{
      const job={id:this.#nextId++,type,payload,signal,resolve,reject};
      job.abort=()=>{
        if(this.#active===job){this.#disposeWorker();this.#finish(job,vectorGeometryAbortError());}
        else{const index=this.#queue.indexOf(job);if(index!==-1){this.#queue.splice(index,1);this.#settle(job,vectorGeometryAbortError());}}
      };
      signal?.addEventListener('abort',job.abort,{once:true});this.#queue.push(job);this.#drain();
    });
  }
  #drain(){
    if(this.#closed||this.#active)return;
    clearTimeout(this.#idleTimer);this.#idleTimer=null;
    const job=this.#queue.shift();
    if(!job){if(this.#worker)this.#idleTimer=setTimeout(()=>this.#disposeWorker(),this.idleTimeoutMs);return;}
    this.#active=job;
    try{
      if(!this.#worker){
        const worker=this.#workerFactory();
        if(!worker||typeof worker.postMessage!=='function'||typeof worker.addEventListener!=='function')throw new VectorGeometryError('This browser cannot start the local vector worker.','VECTOR_GEOMETRY_UNAVAILABLE');
        this.#worker=worker;
        worker.addEventListener('message',event=>{
          if(this.#worker!==worker)return;const current=this.#active;const message=event.data;
          if(!current||message?.id!==current.id)return;
          if(message.ok)this.#finish(current,null,message.value);
          else{if(message.fatal)this.#disposeWorker();this.#finish(current,new VectorGeometryError(message.error?.message||'The local vector operation failed.',message.error?.code));}
        });
        worker.addEventListener('error',event=>{
          if(this.#worker!==worker)return;this.#disposeWorker();
          if(this.#active)this.#finish(this.#active,new VectorGeometryError(event.message||'The local vector worker stopped unexpectedly.','VECTOR_GEOMETRY_WORKER_FAILED'));
        });
        worker.addEventListener('messageerror',()=>{
          if(this.#worker!==worker)return;this.#disposeWorker();
          if(this.#active)this.#finish(this.#active,new VectorGeometryError('The local vector worker response could not be decoded.','VECTOR_GEOMETRY_WORKER_FAILED'));
        });
      }
      job.timer=setTimeout(()=>{this.#disposeWorker();this.#finish(job,new VectorGeometryError('The local vector operation exceeded its time limit. Simplify this shape and retry.','VECTOR_GEOMETRY_TIMEOUT'));},this.timeoutMs);
      this.#worker.postMessage({id:job.id,type:job.type,...job.payload});
    }catch(error){this.#disposeWorker();this.#finish(job,error);}
  }
}

let sharedClient=null;
const client=()=>sharedClient||=(new LocalVectorGeometryClient());
export const initializeVectorGeometry=options=>client().initialize(options);
export const outlineStrokeGeometry=(geometry,stroke,options)=>client().outlineStroke(geometry,stroke,options);
export function closeVectorGeometryRuntime(){sharedClient?.close();sharedClient=null;}
