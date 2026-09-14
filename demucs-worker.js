/* ============================================================
   demucs-worker.js
   Classic web worker for on-device source separation.
   - Uses onnxruntime-web via importScripts (works in all browsers).
   - DSP fallback (band-wise onset slicing) when no model is loaded.
   - Real HTDemucs inference via overlap-add when a model URL is set.
   ============================================================ */
/* global importScripts */
let ort = null;
let session = null;
let modelReady = false;
let quality = "fast";
let modelInitAttempted = false;
let queue = []; // buffered messages until ORT init is attempted
let ortAvailable = false;

// Helper to post safely
function post(o){ try{self.postMessage(o)}catch(e){} }

/* helpers */
function absMax(x){let m=0;for(let i=0;i<x.length;i++){const a=Math.abs(x[i]);if(a>m)m=a}return m}
function applyFade(x,nFs,nFe){
  for(let i=0;i<nFs;i++){const k=i/nFs;x[i*2]*=k;x[i*2+1]*=k}
  for(let i=0;i<nFe;i++){const k=1-i/nFe;const j=x.length/2-1-i;x[j*2]*=k;x[j*2+1]*=k}
}
function interleave(L,R){const N=Math.min(L.length,R.length);const out=new Float32Array(N*2);for(let i=0;i<N;i++){out[i*2]=L[i];out[i*2+1]=R[i]}return out}

/* ---- try to load onnxruntime-web via importScripts ---- */
function tryLoadORTSync(){
  if(ort) return true;
  if(modelInitAttempted) return false;
  modelInitAttempted = true;
  try{
    // wasm backend has fewer compatibility surprises than webgpu in workers;
    // we will try webgpu EP via session options if available.
    self.ORT_WASM_PATHS={
      wasmPaths:{
        "ort-wasm.wasm":"https://cdn.jsdelivr.net/npm/onnxruntime-web@1.19.2/dist/ort-wasm.wasm",
        "ort-wasm-simd.wasm":"https://cdn.jsdelivr.net/npm/onnxruntime-web@1.19.2/dist/ort-wasm-simd.wasm",
        "ort-wasm-threaded.wasm":"https://cdn.jsdelivr.net/npm/onnxruntime-web@1.19.2/dist/ort-wasm-threaded.wasm",
        "ort-wasm-simd-threaded.wasm":"https://cdn.jsdelivr.net/npm/onnxruntime-web@1.19.2/dist/ort-wasm-simd-threaded.wasm"
      }
    };
    importScripts("https://cdn.jsdelivr.net/npm/onnxruntime-web@1.19.2/dist/ort.min.js");
    ort = self.ort;
    if(ort && ort.env){
      ort.env.wasm = ort.env.wasm || {};
      ort.env.wasm.numThreads = Math.min(4, (self.navigator && self.navigator.hardwareConcurrency) || 4);
      ort.env.wasm.simd = true;
      ort.env.wasm.proxy = false;
      if(self.ORT_WASM_PATHS && self.ORT_WASM_PATHS.wasmPaths){
        ort.env.wasm.wasmPaths = self.ORT_WASM_PATHS.wasmPaths;
      }
    }
    return !!ort;
  }catch(e){
    // ORT not available; continue with DSP fallback.
    self.postMessage({type:"status",msg:"DSP MODE (onnxruntime not loaded: "+String(e.message).slice(0,80)+")",pct:10});
    return false;
  }
}

async function initModel(q){
  quality = q || quality;
  const modelUrl = self.DEMUCS_MODEL_URL || null;
  if(!modelUrl) return false;
  const ok = tryLoadORTSync();
  if(!ok) return false;
  if(session){ try{await session.release()}catch(e){} session=null; modelReady=false; }
  const tryEPs = ["wasm"];
  // attempt webgpu if available
  try{
    if(self.ort && self.ort.WebGPUExecutionProvider) tryEPs.unshift("webgpu");
  }catch(e){}
  for(const ep of tryEPs){
    try{
      session = await ort.InferenceSession.create(modelUrl,{
        executionProviders:[ep],
        graphOptimizationLevel:"all",
      });
      modelReady = true;
      return true;
    }catch(e){ /* try next */ }
  }
  modelReady = false;
  return false;
}

/* ---- DSP fallback separator (stable, well-behaved IIRs) ---- */
function dspSeparate(left,right,sr){
  const N=Math.min(left.length,right.length);
  const drums=new Float32Array(N*2), bass=new Float32Array(N*2),
        other=new Float32Array(N*2), vocals=new Float32Array(N*2);
  // single-pole IIR state
  let s_kick=0, s_bass=0, s_voxHP=0, s_voxLP=0, s_hhat=0, s_prev=0;
  const freq = (f)=>{const rc=1/(2*Math.PI*f);return dt/(rc+dt)};
  const dt=1/sr;
  const aK=freq(180), aB=freq(260), aHHhp=freq(3500),
        aVhp=1/(1/(2*Math.PI*180*dt)+1), // high-pass coefficient form
        aVlp=freq(3200);
  // Use stable high-pass: y[i] = a*(y[i-1] + x[i] - x[i-1])
  const aV=1/(2*Math.PI*180/sr + 1);
  for(let i=0;i<N;i++){
    const l=left[i], r=right[i];
    const mid=(l+r)*0.5, side=(l-r)*0.5;
    // kick/sub: lowpass ~180 Hz
    s_kick += (mid - s_kick)*aK;
    // bass: lowpass ~260 Hz minus a bit of kick
    s_bass += (mid - s_bass)*aB;
    const b = Math.max(0, s_bass - s_kick*0.55);
    // hats: highpass ~3.5 kHz (transient fast stuff)
    const hhat = mid - (s_hhat += (mid - s_hhat)*(1-aHHhp));
    // drums combine kick + hat transients
    const env = Math.min(1, Math.abs(hhat)*3.5);
    const dC = s_kick*0.95 + hhat*env*0.95;
    const dL = dC + side*0.3;
    const dR = dC - side*0.3;
    // vocals: bandpass center (180–3200 Hz) minus drum transients
    const vhp = aV*(s_voxHP + mid - s_prev); s_voxHP=vhp; s_prev=mid;
    s_voxLP += (vhp - s_voxLP)*aVlp;
    const v = Math.max(-0.95, Math.min(0.95, s_voxLP*0.85 - hhat*env*0.25));
    // other = remainder
    const oL = l - dL - b*0.5 - v*0.4;
    const oR = r - dR - b*0.5 - v*0.4;
    drums[i*2]=dL; drums[i*2+1]=dR;
    bass[i*2]=b;  bass[i*2+1]=b;
    vocals[i*2]=v;vocals[i*2+1]=v;
    other[i*2]=oL;other[i*2+1]=oR;
  }
  // soft normalize to prevent clipping
  [drums,bass,vocals,other].forEach(buf=>{
    let m=0;for(let i=0;i<buf.length;i++){const a=Math.abs(buf[i]);if(a>m)m=a}
    if(m>0.001){const g=0.8/m;for(let i=0;i<buf.length;i++)buf[i]*=g}
  });
  return {drums,bass,other,vocals};
}

/* ---- ONNX demucs overlap-add (only if session ready) ---- */
async function demucsChunk(mix,sr){
  if(!session||!modelReady) return null;
  // detect input/output shape
  const inName = session.inputNames[0];
  const outName = session.outputNames[0];
  // Expect input [1,2,N] or [1,2,N,...]; we'll use 7.8s chunks like Demucs standard.
  const chunkSec = 7.8;
  let chunkLen = Math.floor(sr*chunkSec);
  // We need to match the model's expected length if it's fixed (common for ONNX ports = 78080*something).
  // Fall back to whatever the model reports, otherwise 7.8s.
  try{
    const inShape = session.input(0).shape;
    if(inShape && inShape[2] && typeof inShape[2]==='number' && inShape[2]>0) chunkLen = inShape[2];
  }catch(e){}
  const N = mix.length/2;
  const out = {
    drums:new Float32Array(N*2), bass:new Float32Array(N*2),
    other:new Float32Array(N*2), vocals:new Float32Array(N*2)
  };
  const hop = Math.floor(chunkLen*0.75);
  const win = new Float32Array(chunkLen);
  for(let i=0;i<chunkLen;i++) win[i] = Math.sin(Math.PI*i/(chunkLen-1));
  const shifts = quality==="high"?2:1;
  const normalize=v=>Math.max(-1,Math.min(1,v));
  for(let shift=0;shift<shifts;shift++){
    const offset = shift*Math.floor(chunkLen*0.5) % Math.max(1,hop);
    for(let start=offset; start<N; start+=hop){
      const end = Math.min(start+chunkLen, N);
      const len = end-start;
      const inp = new Float32Array(2*chunkLen);
      for(let i=0;i<len;i++){inp[i*2]=mix[(start+i)*2]||0; inp[i*2+1]=mix[(start+i)*2+1]||0}
      let arr=null, dims=null;
      try{
        const t = new ort.Tensor("float32", inp, [1,2,chunkLen]);
        const res = await session.run({[inName]:t});
        const ot = res[outName];
        arr = ot.data; dims = ot.dims;
      }catch(e){continue}
      // read dims: common Demucs ONNX outputs are:
      //   [1,4,samples]   -> 4 mono stems
      //   [1,2,4,samples] -> 2ch × 4 stems (or [1,4,2,samples])
      // We handle each permutation defensively.
      const readStem=(stem,ch)=>{
        if(!arr) return 0;
        if(dims.length===4 && dims[1]===4 && dims[2]===2){
          // [1,4,2,samples]
          const idx=(stem*2+ch)*chunkLen + i;
          return (idx>=0&&idx<arr.length)?arr[idx]:0;
        }
        if(dims.length===4 && dims[1]===2 && dims[2]===4){
          // [1,2,4,samples]
          const idx=(ch*4+stem)*chunkLen + i;
          return (idx>=0&&idx<arr.length)?arr[idx]:0;
        }
        if(dims.length===3 && dims[1]===4){
          const idx=stem*chunkLen+i;
          return (idx>=0&&idx<arr.length)?arr[idx]:0;
        }
        return 0;
      };
      for(let i=0;i<len;i++){
        const w = win[i]/shifts;
        const sd = readStem(0,0), sr_ = (dims.length===4?readStem(0,1):sd);
        const bs = readStem(1,0), br_ = (dims.length===4?readStem(1,1):bs);
        const os = readStem(2,0), or__= (dims.length===4?readStem(2,1):os);
        const vs = readStem(3,0), vr_ = (dims.length===4?readStem(3,1):vs);
        out.drums[(start+i)*2] += normalize(sd)*w;
        out.drums[(start+i)*2+1] += normalize(sr_)*w;
        out.bass[(start+i)*2] += normalize(bs)*w;
        out.bass[(start+i)*2+1] += normalize(br_)*w;
        out.other[(start+i)*2] += normalize(os)*w;
        out.other[(start+i)*2+1] += normalize(or__)*w;
        out.vocals[(start+i)*2] += normalize(vs)*w;
        out.vocals[(start+i)*2+1] += normalize(vr_)*w;
      }
      if(start%(hop*2)===0){
        self.postMessage({type:"status",msg:"MODEL INFERENCE…",pct:Math.floor(20+60*(start/Math.max(1,N)))});
      }
      await new Promise(r=>setTimeout(r,0));
    }
  }
  return out;
}

/* ---- onset detection & slicing ---- */
function detectSlices(stemData,sr,stemName){
  const N=stemData.length/2;
  const params = {
    drums: {hp:80,lp:9000,thr:0.08,minGap:0.06,minLen:0.05,maxLen:0.7},
    bass:  {hp:40,lp:320,thr:0.05,minGap:0.10,minLen:0.08,maxLen:0.9},
    other: {hp:600,lp:7000,thr:0.06,minGap:0.12,minLen:0.10,maxLen:1.2},
    vocals:{hp:120,lp:5000,thr:0.08,minGap:0.20,minLen:0.15,maxLen:2.5},
  }[stemName]||{hp:200,lp:6000,thr:0.06,minGap:0.1,minLen:0.08,maxLen:1.0};

  // envelope via cheap HP->LP abs chain
  const env=new Float32Array(N);
  let lp=0,hpz=0,prev=0;
  const rcHP=1/(2*Math.PI*params.hp), rcLP=1/(2*Math.PI*Math.min(params.lp,sr/2-100));
  const dt=1/sr, aHP=rcHP/(rcHP+dt), aLP=dt/(rcLP+dt);
  for(let i=0;i<N;i++){
    const m=(stemData[i*2]+stemData[i*2+1])*0.5;
    hpz=aHP*(hpz+m-prev); prev=m;
    lp += (Math.abs(hpz)-lp)*aLP;
    env[i]=lp;
  }
  const sm=Math.max(1,Math.floor(sr*0.006));
  const smooth=new Float32Array(N);
  {let sum=0;for(let i=0;i<N;i++){sum+=env[i];if(i>=sm)sum-=env[i-sm];smooth[i]=sum/sm}}
  let mx=0;for(let i=0;i<N;i++)if(smooth[i]>mx)mx=smooth[i];
  const thr=Math.max(0.0008, mx*params.thr);
  const minGapS=Math.floor(sr*params.minGap);
  const onsets=[];let last=-minGapS;
  for(let i=sm;i<N-1;i++){
    if(smooth[i]>thr && smooth[i]>smooth[i-1]*1.25 && smooth[i]>=smooth[i+1] && i-last>minGapS){
      onsets.push(i);last=i;
    }
  }
  const slices=[];
  const minLen=Math.floor(sr*params.minLen),maxLen=Math.floor(sr*params.maxLen);
  for(let k=0;k<onsets.length;k++){
    const s=Math.max(0,onsets[k]-Math.floor(sr*0.015));
    let e=(k<onsets.length-1)?Math.min(onsets[k+1]-Math.floor(sr*0.02),s+maxLen):s+maxLen;
    if(e-s<minLen)e=s+minLen;
    e=Math.min(N,e);
    const len=e-s;
    const buf=new Float32Array(len*2);
    for(let i=0;i<len;i++){buf[i*2]=stemData[(s+i)*2];buf[i*2+1]=stemData[(s+i)*2+1]}
    const f=Math.min(80,Math.floor(len/6));applyFade(buf,f,f);
    let cat=stemName;
    if(stemName==="drums"){
      let lo=0,mid=0,hi=0;
      for(let i=0;i<len;i++){const v=Math.abs(buf[i*2]);const t=i/sr;if(t<0.07)lo+=v;else if(t<0.18)mid+=v;else hi+=v}
      const tot=lo+mid+hi||1;
      if(lo/tot>0.55)cat="kick";
      else if(mid/tot>0.38)cat="snare";
      else if(hi/tot>0.45)cat="hat";
      else cat="perc";
    }else if(stemName==="other")cat="melody";
    else if(stemName==="vocals")cat="vox";
    slices.push({start:s/sr,duration:len/sr,category:cat,data:buf});
  }
  return {slices,sr};
}

/* ---- main message handler ---- */
self.onmessage=async function(e){
  const msg=e.data;
  try{
    if(msg.type==="init"){
      quality=msg.quality||quality;
      self.postMessage({type:"status",msg:"ENGINE WARMING UP…",pct:5});
      initModel(quality).then(ok=>{
        self.postMessage({type:"status",msg:ok?"htdemucs MODEL LOADED":"DSP MODE · ADD MODEL URL FOR FULL DEMUCS",pct:100});
      }).catch(()=>self.postMessage({type:"status",msg:"DSP MODE READY",pct:100}));
      return;
    }
    if(msg.type==="setModelUrl"){
      self.DEMUCS_MODEL_URL=msg.url;
      modelInitAttempted=false;modelReady=false;session=null;
      initModel(quality).then(ok=>{
        if(ok)self.postMessage({type:"status",msg:"htdemucs MODEL LOADED",pct:100});
      });
      return;
    }
    if(msg.type==="separate"){
      const {left,right,sr}=msg; quality=msg.quality||quality;
      self.postMessage({type:"status",msg:"ANALYZING AUDIO…",pct:8});
      let stems;
      if(session && modelReady){
        self.postMessage({type:"status",msg:"RUNNING htdemucs…",pct:20});
        const mix=interleave(left,right);
        const promise=demucsChunk(mix,sr);
        stems = (promise && typeof promise.then==="function") ? await promise : promise;
        if(!stems) stems=dspSeparate(left,right,sr);
      }else{
        stems=dspSeparate(left,right,sr);
      }
      self.postMessage({type:"status",msg:"SLICING DRUMS…",pct:35});
      const d=detectSlices(stems.drums,sr,"drums");
      self.postMessage({type:"stemReady",stem:"drums",data:stems.drums,sr});
      self.postMessage({type:"slices",stem:"drums",slices:d.slices,sr});
      self.postMessage({type:"status",msg:"SLICING BASS…",pct:60});
      const b=detectSlices(stems.bass,sr,"bass");
      self.postMessage({type:"stemReady",stem:"bass",data:stems.bass,sr});
      self.postMessage({type:"slices",stem:"bass",slices:b.slices,sr});
      self.postMessage({type:"status",msg:"SLICING OTHER…",pct:80});
      const o=detectSlices(stems.other,sr,"other");
      self.postMessage({type:"stemReady",stem:"other",data:stems.other,sr});
      self.postMessage({type:"slices",stem:"other",slices:o.slices,sr});
      self.postMessage({type:"status",msg:"SLICING VOCALS…",pct:92});
      const v=detectSlices(stems.vocals,sr,"vocals");
      self.postMessage({type:"stemReady",stem:"vocals",data:stems.vocals,sr});
      self.postMessage({type:"slices",stem:"vocals",slices:v.slices,sr});
      self.postMessage({type:"status",msg:"READY",pct:100});
      return;
    }
  }catch(err){
    self.postMessage({type:"error",msg:String((err&&err.message)||err)});
  }
};
