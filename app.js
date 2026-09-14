/* ============================================================
   BEAT IT v3.2 — Collision Engine
   - Low-latency AudioContext (interactive, 44.1kHz)
   - On-device source separation via demucs-worker.js (ONNX + DSP fallback)
   - Drag-to-rearrange slice timeline
   - All three modes: Beat it / Sound it / Rec it
   ============================================================ */

/* ---------- low-latency shared audio ---------- */
let ctx=null, masterGain=null;
function ensureCtx(){
  if(ctx) return;
  const AC = window.AudioContext||window.webkitAudioContext;
  ctx = new AC({ latencyHint:"interactive", sampleRate:44100 });
  masterGain = ctx.createGain();
  masterGain.gain.value = 0.7;
  masterGain.connect(ctx.destination);
}
const $=s=>document.querySelector(s);
const $$=s=>[...document.querySelectorAll(s)];

/* ---------- toast ---------- */
let toastT;
function toast(msg){
  const t=$("#toast");t.textContent=msg;t.classList.add("show");
  clearTimeout(toastT);toastT=setTimeout(()=>t.classList.remove("show"),1800);
}

/* ---------- nav ---------- */
$$(".modetab").forEach(b=>b.addEventListener("click",()=>{
  $$(".modetab").forEach(x=>x.classList.remove("active"));
  b.classList.add("active");
  const m=b.dataset.mode;
  $$(".view").forEach(v=>v.classList.remove("active"));
  $("#view-"+m).classList.add("active");
  // Tear down cross-view listeners / state
  if(rKeyHandler){document.removeEventListener("keydown",rKeyHandler);rKeyHandler=null}
  if(rTapHandler){const pad=$("#rpad");if(pad)pad.removeEventListener("pointerdown",rTapHandler);rTapHandler=null}
  rListen=false;
  if(m==="sound") setTimeout(initSound,80);
  if(m==="rec") setTimeout(initRec,80);
  if(m==="beat"){ if(typeof stopRec==="function") stopRec(); }
}));

/* ============================================================
   MODE 1 — BEAT IT (Collision Engine + Sketch Pad)
   ============================================================ */

const INSTRUMENTS = [
 {n:"mbira dzavadzimu",c:"Zimbabwe, Shona",e:"1000+ yrs",d:"interlocking kushaura/kutsinhira patterns",p:"hosho shakers",m:["minor pentatonic","hexatonic"]},
 {n:"Javanese gamelan",c:"Java",e:"900+ yrs",d:"detuned paired bronze metallophones with ombak beating",p:"kendang & gong ageng",m:["pelog","slendro"]},
 {n:"guembri sintir",c:"Morocco, Gnawa",e:"400+ yrs",d:"three-string bass lute, percussive thumb pluck",p:"qraqeb castanets",m:["maqam hijaz","phrygian dominant"]},
 {n:"Cristal Baschet",c:"France",e:"1952",d:"vibrating glass rods, clarion cry",p:"",m:["aeolian","lydian"]},
 {n:"tenor steel pan",c:"Trinidad",e:"1930s",d:"bright metallic pan riffing",p:"",m:["minor pentatonic","dorian"]},
 {n:"qanun",c:"Levant",e:"900+ yrs",d:"plucked zither with microtonal lever bends",p:"darbuka & riq",m:["maqam hijaz","maqam rast"]},
 {n:"nyckelharpa",c:"Sweden",e:"600+ yrs",d:"keyed fiddle with buzzing resonance strings",p:"",m:["dorian","aeolian"]},
 {n:"kora",c:"Gambia/Mali",e:"300+ yrs",d:"21-string harp-lute, thumb-lead & finger-bass",p:"",m:["major pentatonic","lydian"]},
 {n:"hurdy-gurdy",c:"Europe",e:"1000+ yrs",d:"wheel fiddle with buzzing trompette",p:"",m:["dorian","mixolydian"]},
 {n:"erhu",c:"China",e:"1000+ yrs",d:"two-string bowed fiddle, vocal slides",p:"",m:["minor pentatonic"]},
 {n:"berimbau",c:"Bahia",e:"Afro-Brazilian",d:"single-string musical bow with caxixi",p:"",m:["minor pentatonic","dorian"]},
 {n:"clawhammer banjo",c:"Appalachia",e:"1800s",d:"frailing banjo, thumb on the drone",p:"",m:["dorian","mixolydian"]},
 {n:"waterphone",c:"USA",e:"1960s",d:"water-tuned bronze rods, gliding overtones",p:"",m:["whole tone","aeolian"]},
 {n:"mridangam",c:"South India",e:"2000+ yrs",d:"double-headed barrel drum, konnakol phrasing",p:"",m:["carnatic bhairavi"]},
 {n:"taiko",c:"Japan",e:"ancient",d:"thunderous unison ensemble drums",p:"",m:["drone","phrygian"]},
 {n:"balafon",c:"Mali/Guinea",e:"800+ yrs",d:"gourd-resonated marimba with buzzing bridges",p:"",m:["minor pentatonic"]},
 {n:"duduk",c:"Armenia",e:"1500+ yrs",d:"double-reed, mournful and breathy",p:"",m:["phrygian dominant"]},
 {n:"shakuhachi",c:"Japan",e:"700+ yrs",d:"bamboo end-blown flute, meri-kari bends",p:"",m:["minor pentatonic"]},
 {n:"prepared piano",c:"20th c.",e:"1940s",d:"muted and rattling strings",p:"",m:["whole tone","lydian"]},
 {n:"Ondes Martenot",c:"France",e:"1928",d:"ribbon-controlled oscillator, ghostly glissando",p:"",m:["aeolian","whole tone"]},
];
const GENRES = [
 {n:"Memphis phonk",e:"2010s",o:"Memphis",per:"distorted cowbell and sliding 808",pro:"tape-saturated grit",bpm:[124,132],x:["EDM drop","modern pop"]},
 {n:"Atlanta trap",e:"2010s",o:"Atlanta",per:"sparse ticking hats & heavy 808",pro:"wide clean mix",bpm:[130,150],x:["four-on-the-floor"]},
 {n:"90s NY boom bap",e:"1990s",o:"New York",per:"dusty sampled drums & upright bass",pro:"12-bit crunch",bpm:[85,95],x:["autotune","808 slides"]},
 {n:"Jersey club",e:"2000s",o:"Newark",per:"triplet-swing claps and bed-squeak samples",pro:"bright, clipped",bpm:[130,145],x:["EDM drop"]},
 {n:"Chicago footwork",e:"2000s",o:"Chicago",per:"frenetic triplet percussion",pro:"raw and fast",bpm:[155,165],x:["four-on-the-floor"]},
 {n:"Detroit techno",e:"1980s",o:"Detroit",per:"shuffling 909",pro:"modular bleeps, analog chords",bpm:[124,132],x:["vocals","EDM drop"]},
 {n:"deep house",e:"2010s",o:"global",per:"four-on-the-floor",pro:"warm sub and dub chords",bpm:[118,124],x:["drop","trap"]},
 {n:"UK dub",e:"1970s",o:"Kingston/London",per:"one-drop",pro:"tape delay, spring reverb",bpm:[68,80],x:["distortion","EDM"]},
 {n:"synthwave",e:"1984",o:"global",per:"gated reverb snare & arpeggiated bass",pro:"neon pads, cinematic",bpm:[100,118],x:["dubstep","trap"]},
 {n:"UK drill",e:"2010s",o:"London",per:"skittering hats & sliding 808",pro:"dark piano, cold mix",bpm:[138,146],x:["EDM","four-on-the-floor"]},
 {n:"industrial techno",e:"2010s",o:"Berlin",per:"distorted kick & metal percussion",pro:"corroded, relentless",bpm:[128,140],x:["vocals","orchestral"]},
 {n:"amapiano",e:"2010s",o:"South Africa",per:"log drum bass & shakers",pro:"smooth, humid",bpm:[110,116],x:["EDM","trap"]},
 {n:"gqom",e:"2010s",o:"Durban",per:"broken kick patterns",pro:"dark, hollow, huge",bpm:[124,132],x:["EDM","four-on-the-floor"]},
 {n:"afrobeat",e:"1970s",o:"Lagos",per:"interlocking polyrhythm, horns",pro:"warm live room",bpm:[100,115],x:["EDM","trap"]},
 {n:"2-step garage",e:"1990s",o:"London",per:"skippy hats & shuffling 2-step",pro:"warm sub",bpm:[128,136],x:["four-on-the-floor"]},
 {n:"trip-hop",e:"1990s",o:"Bristol",per:"slow dusty breaks",pro:"cinematic, smoky",bpm:[80,95],x:["EDM drop"]},
 {n:"breakcore",e:"2000s",o:"global",per:"shredded Amen breaks",pro:"maximalist edits",bpm:[160,190],x:["four-on-the-floor"]},
 {n:"neo-soul",e:"1990s",o:"USA",per:"laid-back pocket drums",pro:"Rhodes, tape saturation",bpm:[72,92],x:["EDM","trap"]},
];
const MODES=["maqam hijaz","pelog","slendro","phrygian dominant","harmonic minor","minor pentatonic","major pentatonic","whole tone","dorian","lydian","aeolian","mixolydian","blues scale","hexatonic","open drone"];
const EXOTIC=["maqam hijaz","pelog","slendro","phrygian dominant","whole tone","hexatonic","harmonic minor"];
const METERS=["11/16 kopanitsa","7/8 aksak","5/4","9/8","6/8 trance","3-against-4 polyrhythm","12/8 Ewe bell"];
const KITS=["breath, tongue & chest thumps","qraqeb metal castanets","struck matchboxes & knuckle cracks","handclaps and stomps only","bones and struck wood","filing cabinets and metal scrap","typewriter keys & staplers","shuffling cards & tapped glass","bicycle spokes & thumb piano"];
const SUBTRACT=[
 {t:"kick drum",x:"kick drum"},{t:"snare",x:"snare, backbeat"},{t:"bass",x:"bass, sub bass, low end"},
 {t:"reverb",x:"reverb, wide pads"},{t:"percussion",x:"drums, percussion"},{t:"melody",x:"melody, leads, hooks"},
 {t:"any electronic element",x:"synths, electronic drums"},{t:"chords",x:"chords, harmony, pads"},
];
const MOODS=["dark and devotional","meditative and ominous","frenetic and festive","longing and expansive","primal and intimate","cavernous and shimmering","ecstatic and bright","cinematic and neon","driving and hypnotic","smoky and hypnotic","rustic and futurist","cold and sculptural","tender and weathered","triumphant and processional","unsettling and patient"];
const LEVERS=[
 {id:"century",k:"01",n:"Swap the Century",desc:"An ancient instrument meets a genre younger than smartphones."},
 {id:"scale",k:"02",n:"Swap the Scale",desc:"Dump 12-TET. Force a maqam, pelog, raga or pentatonic."},
 {id:"grid",k:"03",n:"Swap the Grid",desc:"Leave 4/4. Run it in 11/16, 7/8, or a polyrhythm."},
 {id:"kit",k:"04",n:"Swap the Kit",desc:"Delete the drum machine. Percuss with body, metal, bone."},
 {id:"subtract",k:"05",n:"Subtract",desc:"Remove one thing every producer treats as mandatory."},
];
const NAME_A=["OBSIDIAN","SALT","BONE","TIDE","EMBER","GHOST","HIVE","KILN","PARCHMENT","RAWHIDE","SILT","VERDIGRIS","WICK","ZINC","ANTLER","BASALT","CINDER","FLINT","MARROW","QUARTZ","RESIN","THORN","SLATE","HUSK","LOOM","RUIN","IRON"];
const NAME_B=["PHONK","DRIFT","BAP","CLUB","DUB","FOOTWORK","MACHINE","ENGINE","RITE","SIGNAL","PULSE","GROOVE","WEIGHT","HYMN","CIRCUIT","STATIC","FRACTURE","LATTICE","TIDE","GRID","SEAM","HARVEST","RELAY","RITUAL","VECTOR","NULL","HEX"];

const pick=a=>a[Math.floor(Math.random()*a.length)];
const ri=(a,b)=>Math.floor(Math.random()*(b-a+1))+a;
const cap=s=>s.charAt(0).toUpperCase()+s.slice(1);
const on={century:true,scale:false,grid:false,kit:false,subtract:false};
let current=null, history=JSON.parse(localStorage.getItem("beatit_history")||"[]");

/* levers */
const leversEl=$("#levers");
leversEl.innerHTML=LEVERS.map(l=>`
  <div class="lever${l.id==='century'?' on':''}" data-l="${l.id}">
    <div class="ltoggle"></div>
    <div class="lnum">${l.k}</div>
    <div class="ltitle">${l.n}</div>
    <div class="ldesc">${l.desc}</div>
    <div class="lpwr"><span class="pwr-dot"></span>${l.id==='century'?'ENGAGED':'STANDBY'}</div>
  </div>`).join("");
leversEl.addEventListener("click",e=>{
  const lv=e.target.closest(".lever");if(!lv)return;
  const id=lv.dataset.l;on[id]=!on[id];
  lv.classList.toggle("on",on[id]);
  lv.querySelector(".lpwr").innerHTML=`<span class="pwr-dot"></span>${on[id]?'ENGAGED':'STANDBY'}`;
});

/* seed fields */
const seedEl=$("#seedFields");
const seedOpts=[
  {id:"inst",label:"INSTRUMENT",arr:INSTRUMENTS,f:o=>`${o.n} · ${o.c}`},
  {id:"genre",label:"GENRE",arr:GENRES,f:o=>`${o.n} · ${o.o}`},
  {id:"mode",label:"MODE",arr:MODES,f:o=>o},
  {id:"mood",label:"MOOD",arr:MOODS,f:o=>o},
];
const seedVals={inst:"",genre:"",mode:"",mood:""};
seedEl.innerHTML=seedOpts.map(s=>`
  <div class="seed-field"><label>${s.label}</label>
    <select data-s="${s.id}"><option value="">— RANDOM —</option>
    ${s.arr.map((o,i)=>`<option value="${i}">${s.f(o)}</option>`).join("")}
    </select></div>`).join("");
seedEl.addEventListener("change",e=>{const s=e.target.dataset.s;if(s)seedVals[s]=e.target.value});

/* generate */
function generate(){
  const inst=seedVals.inst!==""?INSTRUMENTS[+seedVals.inst]:pick(INSTRUMENTS);
  const gen=seedVals.genre!==""?GENRES[+seedVals.genre]:pick(GENRES);
  let mode,meter=null,kit=null,sub=null;
  if(on.scale){const c=inst.m.filter(m=>EXOTIC.includes(m));mode=c.length?pick(c):pick(EXOTIC)}
  else mode=seedVals.mode!==""?MODES[+seedVals.mode]:(Math.random()<0.6?pick(inst.m):pick(MODES));
  if(on.grid)meter=pick(METERS);
  if(on.kit)kit=pick(KITS);
  if(on.subtract)sub=pick(SUBTRACT);
  const mood=seedVals.mood!==""?MOODS[+seedVals.mood]:pick(MOODS);
  let bpm=ri(gen.bpm[0],gen.bpm[1]);if(on.grid)bpm=Math.round(bpm/5)*5;
  const s=[];
  s.push("instrumental");s.push(`${inst.n}, ${inst.d}`);
  if(inst.p&&!on.kit)s.push(inst.p);
  s.push(gen.n);
  if(on.kit)s.push(`percussion performed entirely with ${kit}`);else s.push(gen.per);
  s.push(gen.pro);s.push(`${mode} mode`);
  if(meter)s.push(`in ${meter}`);if(sub)s.push(`no ${sub.t}`);s.push(mood);s.push(`${bpm} BPM`);
  const style=s.join(", ");
  const ex=["vocals","singing","choir","vocal chops"];
  gen.x.forEach(t=>{if(!ex.includes(t))ex.push(t)});
  if(sub)ex.unshift(sub.x);if(on.kit)ex.push("drum kit","snare drum","synths");
  const exclude=[...new Set(ex)].slice(0,6).join(", ");
  const name=`${pick(NAME_A)} ${pick(NAME_B)}`;
  const title=`${name} — ${cap(inst.n)} × ${cap(gen.n)} | ${bpm} BPM`;
  const levers=[];
  if(on.century)levers.push(`an instrument from ${inst.e}`);
  if(on.scale)levers.push(`${mode} instead of 12-TET`);
  if(on.grid)levers.push(meter.split(" ").pop().replace("/","-over-")+" meter");
  if(on.kit)levers.push("a kit made of things that aren't drums");
  if(on.subtract)levers.push(`no ${sub.t} at all`);
  const why=`The ${inst.n} is from ${inst.c}, ${inst.e} old. ${cap(gen.n)} was born in ${gen.o}, ${gen.e}. We lock them in a ${bpm}-BPM room`+(levers.length?`, and force ${levers.join(", ")}.`:` — no safety net.`);
  current={name,inst,gen,mode,bpm,mood,meter,kit,sub,style,exclude,title,why,when:Date.now()};
  renderResult();
  history.unshift(current);if(history.length>50)history=history.slice(0,50);
  localStorage.setItem("beatit_history",JSON.stringify(history));
  renderHistory();
}
function renderResult(){
  const c=current;
  $("#rName").textContent=c.name;
  $("#rColl").textContent=`${c.inst.n.toUpperCase()} (${c.inst.c}, ${c.inst.e})  ×  ${c.gen.n.toUpperCase()} (${c.gen.o}, ${c.gen.e})`;
  $("#rMetrics").innerHTML=`<span class="metric">${c.bpm} BPM</span><span class="metric k">${c.mode}</span>`+
    (c.meter?`<span class="metric d">${c.meter}</span>`:"")+
    (c.kit?`<span class="metric d">odd kit</span>`:"")+
    (c.sub?`<span class="metric d">NO ${c.sub.t}</span>`:"")+
    `<span class="metric">${c.mood}</span>`;
  $("#rStyle").textContent=c.style;$("#rExcl").textContent=c.exclude;$("#rTitle").textContent=c.title;$("#rWhy").textContent=c.why;
  $("#resultCard").classList.add("show");
  setTimeout(()=>$("#resultCard").scrollIntoView({behavior:"smooth",block:"nearest"}),60);
}
function renderHistory(){
  const el=$("#hist");
  if(!history.length){el.innerHTML=`<div class="hist-empty">No collisions yet.<br>Five levers. One button.<br>Make something dangerous.</div>`;return}
  el.innerHTML=history.slice(0,30).map((h,i)=>`
    <div class="hist-card" data-i="${i}">
      <div class="hn">${h.name}</div>
      <div class="hc">${cap(h.inst.n)} × ${cap(h.gen.n)} · ${h.bpm} BPM</div>
      <div class="hm"><span>${h.bpm}</span><span>${h.mode.split(" ")[0]}</span>${h.meter?`<span>${h.meter.split(" ").pop()}</span>`:""}</div>
    </div>`).join("");
}
$("#hist").addEventListener("click",e=>{
  const c=e.target.closest(".hist-card");if(!c)return;
  current=history[+c.dataset.i];renderResult();
});
$("#genBtn").addEventListener("click",()=>{ensureCtx();generate();toast("Collision forced.")});
$("#rerollBtn").addEventListener("click",generate);
$("#clearHist").addEventListener("click",()=>{if(confirm("Clear collision log?")){history=[];localStorage.removeItem("beatit_history");renderHistory()}});
$$(".copy-btn").forEach(b=>b.addEventListener("click",()=>{
  const k=b.dataset.t;const t=k==="style"?current.style:k==="excl"?current.exclude:current.title;
  if(!t){toast("Generate a collision first");return}
  navigator.clipboard.writeText(t).catch(()=>{});toast("Copied");
}));
$("#loadSketchBtn").addEventListener("click",()=>{
  if(!current){toast("Generate a collision first");return}
  ensureCtx();if(ctx.state==="suspended")ctx.resume();
  bpmEl.value=current.bpm;seqState.bpm=current.bpm;bpmVal.textContent=current.bpm;$("#bpmShow").textContent=current.bpm+" BPM";
  const wasPlaying=seqState.playing;if(wasPlaying)stopSeq();
  randomize();
  if(wasPlaying)playSeq();
  toast("Loaded to sketch pad · "+current.bpm+" BPM");
  const sk=document.querySelector(".sketch");if(sk)sk.scrollIntoView({behavior:"smooth",block:"start"});
});
$("#recSendBtn").addEventListener("click",()=>{
  if(!current){toast("Generate a collision first");return}
  window._sentToRec=current;
  $$(".modetab").forEach(x=>x.classList.remove("active"));
  document.querySelector('[data-mode="rec"]').classList.add("active");
  $$(".view").forEach(v=>v.classList.remove("active"));$("#view-rec").classList.add("active");
  setTimeout(initRec,80);
  toast("Sent to booth");
});
renderHistory();

/* ============================================================
   SKETCH PAD (drum sequencer + stem slice timeline)
   ============================================================ */
const DRUMS=[
 {id:"kick",name:"KICK",key:"1"},{id:"snare",name:"SNARE",key:"2"},{id:"chat",name:"CLAP",key:"3"},
 {id:"oh",name:"OPEN HAT",key:"4"},{id:"ch",name:"CLOSED HAT",key:"5"},{id:"rim",name:"RIM",key:"6"},
 {id:"tom",name:"TOM",key:"7"},{id:"crash",name:"CRASH",key:"8"},
];
const STEPS=16;
const seqState={playing:false,bpm:120,swing:0,currentStep:0,numSteps:16,
  pattern:Object.fromEntries(DRUMS.map(d=>[d.id,new Array(STEPS).fill(false)])),
  mute:Object.fromEntries(DRUMS.map(d=>[d.id,false])),
};
const seqEl=$("#seq");
DRUMS.forEach(d=>{
  const row=document.createElement("div");row.className="track";
  row.innerHTML=`<div class="tracklabel">
    <div class="tbtns"><button class="tbtn mute" data-m="${d.id}">M</button></div>
    <div class="trackname" data-aud="${d.id}"><span class="k">${d.key}</span>${d.name}</div>
  </div>`;
  const pads=document.createElement("div");pads.className="pads";
  for(let i=0;i<STEPS;i++){
    const p=document.createElement("div");
    p.className="pad"+(i%4===0?" beat":"");
    p.dataset.step=i;p.dataset.drum=d.id;
    pads.appendChild(p);
  }
  row.appendChild(pads);seqEl.appendChild(row);
});
seqEl.addEventListener("click",e=>{
  ensureCtx();if(ctx.state==="suspended")ctx.resume();
  const p=e.target.closest(".pad");
  if(p){const d=p.dataset.drum,s=+p.dataset.step;seqState.pattern[d][s]=!seqState.pattern[d][s];p.classList.toggle("on",seqState.pattern[d][s]);if(seqState.pattern[d][s])drumTrig(d,ctx.currentTime+0.01,0.7);return}
  const a=e.target.closest("[data-aud]");if(a){drumTrig(a.dataset.aud,ctx.currentTime+0.01,0.9);return}
  const m=e.target.closest("[data-m]");if(m){const id=m.dataset.m;seqState.mute[id]=!seqState.mute[id];m.classList.toggle("on",seqState.mute[id])}
});

/* drum synth */
let _noise;
function noiseBuf(){ensureCtx();if(_noise)return _noise;_noise=ctx.createBuffer(1,ctx.sampleRate*2,ctx.sampleRate);const d=_noise.getChannelData(0);for(let i=0;i<d.length;i++)d[i]=Math.random()*2-1;return _noise}
function env(t0,a,d,peak){const g=ctx.createGain();g.gain.setValueAtTime(0,t0);g.gain.linearRampToValueAtTime(peak,t0+a);g.gain.exponentialRampToValueAtTime(0.0001,t0+a+d);return g}
function tone(t0,{f=100,f2=null,d=0.3,a=0.001,decay=0.2,v=0.8,w="sine",lp=0}){
  const o=ctx.createOscillator();o.type=w;o.frequency.setValueAtTime(f,t0);if(f2)o.frequency.exponentialRampToValueAtTime(Math.max(f2,20),t0+decay);
  const g=env(t0,a,decay,v);
  if(lp){const filt=ctx.createBiquadFilter();filt.type="lowpass";filt.frequency.value=lp;o.connect(filt);filt.connect(g)}
  else{o.connect(g)}
  g.connect(masterGain);o.start(t0);o.stop(t0+d+0.05);
}
function noise(t0,{d=0.2,a=0.001,dec=0.15,hp=200,lp=8000,v=0.6,q=0.6}){
  const s=ctx.createBufferSource();s.buffer=noiseBuf();
  // highpass to cut sub rumble, then a gentle lowpass at `lp`, then a peak at `lp/2.5` for body
  const hpf=ctx.createBiquadFilter();hpf.type="highpass";hpf.frequency.value=hp;
  const lpf=ctx.createBiquadFilter();lpf.type="lowpass";lpf.frequency.value=lp;lpf.Q.value=0.6;
  const g=env(t0,a,dec,v);
  s.connect(hpf);hpf.connect(lpf);lpf.connect(g);
  g.connect(masterGain);
  s.start(t0);s.stop(t0+d+0.05);
}
function drumTrig(id,t0,vol=1){
  ensureCtx();
  switch(id){
    case "kick":tone(t0,{f:140,f2:45,d:0.4,decay:0.28,v:1,w:"sine"});tone(t0+0.002,{f:80,f2:30,d:0.5,decay:0.35,v:0.5,w:"sine"});break;
    case "snare":tone(t0,{f:220,f2:140,d:0.1,decay:0.07,v:0.5,w:"triangle"});noise(t0,{d:0.25,dec:0.18,hp:1500,lp:7000,v:0.55,q:0.7});break;
    case "chat":[0,0.01,0.02].forEach(d=>noise(t0+d,{d:0.05,dec:0.03,hp:1200,lp:6000,v:0.4,q:1}));noise(t0+0.03,{d:0.2,dec:0.15,hp:1200,lp:6000,v:0.35,q:0.7});break;
    case "ch":noise(t0,{d:0.06,dec:0.04,hp:6000,lp:10000,v:0.35,q:1.2});break;
    case "oh":noise(t0,{d:0.35,dec:0.25,hp:5000,lp:9000,v:0.3,q:0.8});break;
    case "rim":tone(t0,{f:1800,d:0.05,decay:0.02,v:0.3,w:"triangle"});noise(t0,{d:0.04,dec:0.02,hp:3000,lp:10000,v:0.25});break;
    case "tom":tone(t0,{f:180,f2:70,d:0.4,decay:0.25,v:0.6,w:"sine"});break;
    case "crash":noise(t0,{d:1.2,dec:0.9,hp:4000,lp:12000,v:0.3,q:0.4});tone(t0,{f:600,d:1.2,decay:0.9,v:0.1,w:"square",lp:8000});break;
  }
}
/* scheduler */
let nextT, lhTimer;
function stepDur(){return 60/seqState.bpm/4}
function scheduleStep(step,t){
  DRUMS.forEach(d=>{if(seqState.pattern[d.id][step]&&!seqState.mute[d.id])drumTrig(d.id,t,0.85)});
  const delay=Math.max(0,(t-ctx.currentTime)*1000);setTimeout(()=>highlight(step),delay);
}
function advance(){let d=stepDur();if(seqState.swing>0&&seqState.currentStep%2===1)d*=1+seqState.swing/100*0.5;else if(seqState.swing>0&&seqState.currentStep%2===0&&seqState.currentStep>0)d*=1-seqState.swing/100*0.5;nextT+=d;seqState.currentStep=(seqState.currentStep+1)%seqState.numSteps}
function schedLoop(){while(nextT<ctx.currentTime+0.1){scheduleStep(seqState.currentStep,nextT);advance()}}
function highlight(step){
  $$(".pad").forEach(p=>p.classList.remove("playing"));
  DRUMS.forEach(d=>{const row=seqEl.querySelector(`.track .pad[data-drum="${d.id}"]`)?.parentElement;if(row)row.querySelectorAll(".pad")[step].classList.add("playing")});
  // advance slice timeline playhead
  moveCue(step/STEPS);
}
function playSeq(){
  ensureCtx();if(ctx.state==="suspended")ctx.resume();
  if(seqState.playing) stopSeq(); // guard double-trigger
  seqState.playing=true;seqState.currentStep=0;nextT=ctx.currentTime+0.05;
  clearInterval(lhTimer);lhTimer=setInterval(schedLoop,25);
  $("#playBtn").classList.add("playing");$("#playIcon").setAttribute("d","M6 4h4v16H6zM14 4h4v16h-4z");
  // Only play stems if at least one stem buffer has arrived; else fall back to stripped loop.
  const hasStems = !!(stems.drums||stems.bass||stems.other||stems.vocals);
  let audioPlaying=false;
  if(stems.mix && hasStems){ if(!stems.playing) playStems(); audioPlaying=true; }
  else if(imp.buf && !impPlaying){ impOffset=0; impPlay(); audioPlaying=true; }
  if(impToggle()) impToggle().textContent=audioPlaying?"■ STOP BEAT":"▶ PLAY BEAT";
}
function stopSeq(){
  seqState.playing=false;clearInterval(lhTimer);
  $$(".pad").forEach(p=>p.classList.remove("playing"));
  $("#playBtn").classList.remove("playing");$("#playIcon").setAttribute("d","M8 5v14l11-7z");
  if(imp.playing)impStop(true);
  if(stems.playing) stopStems(true);
  moveCue(-1);
  if(impToggle()) impToggle().textContent="▶ PLAY BEAT";
}
const bpmEl=$("#bpm"),bpmVal=$("#bpmVal");
bpmEl.addEventListener("input",()=>{
  seqState.bpm=+bpmEl.value;bpmVal.textContent=seqState.bpm;$("#bpmShow").textContent=seqState.bpm+" BPM";
  // if playing, re-anchor nextT so new BPM kicks in immediately
  if(seqState.playing && ctx) nextT=ctx.currentTime+0.02;
});
const swingEl=$("#swing"),swingVal=$("#swingVal");
swingEl.addEventListener("input",()=>{seqState.swing=+swingEl.value;swingVal.textContent=seqState.swing+"%"});
$("#playBtn").addEventListener("click",()=>{if(seqState.playing)stopSeq();else playSeq()});
$("#clearBtn").addEventListener("click",()=>{DRUMS.forEach(d=>seqState.pattern[d.id].fill(false));$$(".pad").forEach(p=>p.classList.remove("on"))});
function randomize(){
  DRUMS.forEach(d=>seqState.pattern[d.id].fill(false));
  [0,4,8,12].forEach(i=>seqState.pattern.kick[i]=Math.random()<0.9);
  [2,6,10,14].forEach(i=>seqState.pattern.kick[i]=Math.random()<0.25);
  [4,12].forEach(i=>seqState.pattern.snare[i]=Math.random()<0.85);
  [4,12].forEach(i=>seqState.pattern.chat[i]=Math.random()<0.4);
  for(let i=0;i<16;i++)seqState.pattern.ch[i]=Math.random()<0.7;
  for(let i=1;i<16;i+=2)if(Math.random()<0.2)seqState.pattern.oh[i]=true;
  if(Math.random()<0.5)seqState.pattern.crash[0]=true;
  DRUMS.forEach(d=>{const pads=seqEl.querySelectorAll(`.pad[data-drum="${d.id}"]`);pads.forEach((p,i)=>p.classList.toggle("on",seqState.pattern[d.id][i]))});
}
$("#randBtn").addEventListener("click",randomize);

/* keyboard */
document.addEventListener("keydown",e=>{
  if(e.target.tagName==="INPUT"||e.target.tagName==="SELECT"||e.target.isContentEditable)return;
  const inBeat=$("#view-beat").classList.contains("active");
  const inRec=$("#view-rec").classList.contains("active");
  const inSound=$("#view-sound").classList.contains("active");
  if(e.code==="Space"){
    e.preventDefault();
    // If rhythm game is listening, it handles Space itself (e.stopPropagation still reaches us since same target).
    if(inSound && rListen) return;
    if(inBeat){if(seqState.playing)stopSeq();else playSeq()}
    return;
  }
  if(e.key==="r"||e.key==="R"){if(inRec)toggleRec();return}
  if(!inBeat)return;
  const d=DRUMS.find(x=>x.key===e.key);if(d){ensureCtx();drumTrig(d.id,ctx.currentTime,0.9)}
});

/* ---------- import / looped beat ---------- */
const imp={buf:null,vol:0.75,loop:true};
const dzTitle=()=>document.getElementById("dzTitle"),dzSub=()=>document.getElementById("dzSub"),
      impLoaded=()=>document.getElementById("impLoaded"),
      impName=()=>document.getElementById("impName"),impMeta=()=>document.getElementById("impMeta"),
      impToggle=()=>document.getElementById("impToggle"),impRemove=()=>document.getElementById("impRemove");
function stripVocals(buf,s=1,bk=0.8){
  ensureCtx();
  const sr=buf.sampleRate,len=buf.length,out=ctx.createBuffer(2,len,sr);
  if(buf.numberOfChannels<2){const c=out.getChannelData(0),s2=buf.getChannelData(0);for(let i=0;i<len;i++)c[i]=s2[i];return out}
  const L=buf.getChannelData(0),R=buf.getChannelData(1),oL=out.getChannelData(0),oR=out.getChannelData(1);
  const rc=1/(2*Math.PI*180),dt=1/sr,a=dt/(rc+dt);let lpL=0,lpR=0;
  for(let i=0;i<len;i++){const l=L[i],r=R[i];lpL+=(l-lpL)*a;lpR+=(r-lpR)*a;const bass=(lpL+lpR)*0.5*bk;const sides=(l-r)*0.5;const cent=(l+r)*0.5;const k=sides*2*s+cent*(1-s);oL[i]=k*0.5+bass;oR[i]=k*0.5+bass}
  return out;
}
let impSrc=null,impGain=null,impStartedAt=0,impPlaying=false,impOffset=0;
function impPlay(){
  if(!imp.buf)return;
  if(!impGain){impGain=ctx.createGain();impGain.gain.value=imp.vol;impGain.connect(masterGain)}
  impStop();
  const s=ctx.createBufferSource();s.buffer=imp.buf;s.loop=imp.loop;s.connect(impGain);
  const t0=ctx.currentTime+0.03;s.start(t0,impOffset%(imp.buf.duration||1));
  impSrc=s;impStartedAt=t0-impOffset;impPlaying=true;
  impToggle().textContent="■ STOP BEAT";
  s.onended=()=>{if(impSrc===s){impPlaying=false;impSrc=null;impOffset=0;if(impToggle())impToggle().textContent="▶ PLAY BEAT"}};
}
function impStop(pause){
  if(impSrc){
    try{if(pause)impOffset=(ctx.currentTime-impStartedAt)%(imp.buf.duration||1);else impOffset=0;impSrc.stop()}catch(e){}
    try{impSrc.disconnect()}catch(e){}
    impSrc=null;
  }
  impPlaying=false;
  const b=impToggle();if(b)b.textContent="▶ PLAY BEAT";
}
const dropzone=$("#dropzone"),fileInput=$("#fileInput"),qToggle=$(".quality-toggle");
["dragenter","dragover"].forEach(ev=>dropzone.addEventListener(ev,e=>{e.preventDefault();dropzone.classList.add("drag")}));
["dragleave","drop"].forEach(ev=>dropzone.addEventListener(ev,e=>{e.preventDefault();dropzone.classList.remove("drag")}));
dropzone.addEventListener("drop",e=>{const f=e.dataTransfer.files[0];if(f)loadImpFile(f)});
dropzone.addEventListener("click",e=>{if(e.target.closest(".quality-toggle")||e.target.closest(".q-btn")||e.target.closest(".imp-loaded"))return;fileInput.click()});
fileInput.addEventListener("change",e=>{const f=e.target.files[0];if(f)loadImpFile(f);fileInput.value=""});
if(qToggle){["dragenter","dragover","drop"].forEach(ev=>qToggle.addEventListener(ev,e=>{e.preventDefault();e.stopPropagation()}))}
/* quality toggle */
let sepQuality="fast";
$$(".q-btn").forEach(b=>b.addEventListener("click",e=>{e.stopPropagation();$$(".q-btn").forEach(x=>x.classList.remove("active"));b.classList.add("active");sepQuality=b.dataset.q;if(worker)worker.postMessage({type:"init",quality:sepQuality})}));

async function loadImpFile(file){
  ensureCtx();
  // stop any existing playback before loading new audio
  if(seqState.playing||impPlaying||stems.playing) stopSeq();
  impStop(false);
  dzTitle().textContent="PROCESSING…";dzSub().textContent="decoding audio";
  $("#stemProg").style.display="block";
  $("#stemLabel").textContent="DECODING…";$("#stemPct").textContent="0%";$("#stemFill").style.width="0%";
  try{
    const arr=await file.arrayBuffer();const raw=await ctx.decodeAudioData(arr.slice(0));
    imp.buf=stripVocals(raw);impOffset=0;
    dzTitle().textContent="✓ "+file.name;dzSub().textContent="BEAT READY · RUNNING SOURCE SEPARATION…";
    impName().textContent=file.name;
    impMeta().textContent=raw.duration.toFixed(1)+"s · vocals stripped · loops with sketch";
    impLoaded().style.display="flex";
    toast("Beat extracted");
    // Reset impToggle to play state
    if(impToggle()) impToggle().textContent="▶ PLAY BEAT";
    // Now run demucs worker on the RAW (non-stripped) audio for proper stem separation
    runSeparation(raw,file.name);
  }catch(e){
    console.error(e);dzTitle().textContent="⬆ Drop audio or click to upload";dzSub().textContent="COULDN'T DECODE";toast("Couldn't decode file");
    $("#stemProg").style.display="none";
  }
}
setTimeout(()=>{
  if(impToggle())impToggle().addEventListener("click",()=>{
    // PLAY BEAT = same as hitting the main transport play button.
    if(seqState.playing||impPlaying||stems.playing){ stopSeq(); }
    else{ playSeq(); }
  });
  if(impRemove())impRemove().addEventListener("click",()=>{
    impStop(false);imp.buf=null;impOffset=0;
    stopStems(false);stems.mix=null;stems.drums=stems.bass=stems.other=stems.vocals=null;
    stems.sources={};stems.gains={};
    // reset mute buttons
    $$(".stem-mute").forEach(b=>{b.classList.remove("muted");if(b.dataset.stem)stems.muted[b.dataset.stem]=false});
    impLoaded().style.display="none";
    dzTitle().textContent="⬆ Drop audio or click to upload";
    dzSub().textContent="htdemucs source separation · onset slicing · drag to rearrange";
    $("#stemProg").style.display="none";
    $("#sliceWrap").classList.remove("show");
    clearSlices();
  });
},100);

/* ============================================================
   SOURCE SEPARATION / ONSET SLICE PIPELINE (Web Worker)
   ============================================================ */
let worker=null;
const stems={drums:null,bass:null,other:null,vocals:null,muted:{drums:false,bass:false,other:false,vocals:false},sources:{},playing:false,gains:{},startedAt:0,offset:0};
function initWorker(){
  if(worker)return worker;
  worker = new Worker("demucs-worker.js");
  worker.postMessage({type:"init",quality:sepQuality});
  worker.onmessage=e=>{
    const m=e.data;
    if(m.type==="status"){
      $("#stemLabel").textContent=m.msg;
      $("#stemPct").textContent=m.pct+"%";
      $("#stemFill").style.width=m.pct+"%";
      if(m.pct>=100)setTimeout(()=>{$("#stemProg").style.display="none";dzSub().textContent="SLICES READY · DRAG TO REARRANGE"},500);
    }
    else if(m.type==="stemReady"){
      const buf=ctx.createBuffer(2,m.data.length/2,m.sr);
      const L=buf.getChannelData(0),R=buf.getChannelData(1);
      for(let i=0;i<m.data.length/2;i++){L[i]=m.data[i*2];R[i]=m.data[i*2+1]}
      stems[m.stem]=buf;
      createStemSource(m.stem,buf);
      // if transport is playing, hot-swap the stripped loop for the new stem bus
      if(seqState.playing && impPlaying && !stems.playing){
        impStop(true); // pause stripped at current offset
        stems.offset=impOffset; // align
        playStems();
        if(impToggle()) impToggle().textContent="■ STOP BEAT";
      }
    }
    else if(m.type==="slices"){
      renderSlices(m.stem,m.slices,m.sr);
    }
    else if(m.type==="error"){
      toast(m.msg);
      $("#stemProg").style.display="none";
      dzSub().textContent="SEPARATION ERROR · USING STRIPPED BEAT";
    }
  };
  return worker;
}
function runSeparation(audioBuf,fileName){
  initWorker();
  // stop any currently playing stems and tear down previous graph
  stopStems(false);
  Object.values(stems.gains).forEach(g=>{try{g.disconnect()}catch(e){}});
  clearSlices();
  stems.drums=stems.bass=stems.other=stems.vocals=null;stems.sources={};stems.gains={};
  // reset mute UI (all on)
  $$(".stem-mute").forEach(b=>{b.classList.remove("muted");if(b.dataset.stem)stems.muted[b.dataset.stem]=false});
  const sr=audioBuf.sampleRate;
  const L=audioBuf.getChannelData(0).slice();
  const R=audioBuf.numberOfChannels>1?audioBuf.getChannelData(1).slice():L.slice();
  stems.mix = audioBuf;
  // Transferable might fail if browser doesn't support it for this buffer; fall back to copy.
  try{
    worker.postMessage({type:"separate",left:L,right:R,sr,quality:sepQuality},[L.buffer,R.buffer]);
  }catch(e){
    worker.postMessage({type:"separate",left:L.slice(),right:R.slice(),sr,quality:sepQuality});
  }
}
function createStemSource(name,buf){
  if(stems.gains[name]) return;
  const g=ctx.createGain();g.gain.value=stems.muted[name]?0:0.6;g.connect(masterGain);
  stems.gains[name]=g;
}
function playStems(){
  if(!stems.mix)return;
  stopStems();
  // ensure gains exist for every stem we have
  ["drums","bass","other","vocals"].forEach(n=>{if(stems[n])createStemSource(n,stems[n])});
  stems.playing=true;
  const t0=ctx.currentTime+0.03;
  const dur=stems.mix.duration;
  ["drums","bass","other","vocals"].forEach(n=>{
    if(!stems[n]||!stems.gains[n])return;
    const s=ctx.createBufferSource();s.buffer=stems[n];s.loop=true;
    s.connect(stems.gains[n]);
    s.start(t0,stems.offset%dur);
    stems.sources[n]=s;
  });
  stems.startedAt=t0-stems.offset;
}
function stopStems(pause){
  const wasPlaying=stems.playing;
  stems.playing=false;
  // save offset once before clearing sources
  let newOffset=stems.offset;
  if(pause && wasPlaying && stems.mix) newOffset=(ctx.currentTime-stems.startedAt)%stems.mix.duration;
  else if(!pause) newOffset=0;
  Object.entries(stems.sources).forEach(([n,s])=>{
    try{s.stop()}catch(e){}
    try{s.disconnect()}catch(e){}
  });
  stems.sources={};
  stems.offset=newOffset;
}
/* stem mute toggles */
setTimeout(()=>{
  $$(".stem-mute").forEach(b=>b.addEventListener("click",()=>{
    const s=b.dataset.stem;stems.muted[s]=!stems.muted[s];
    b.classList.toggle("muted",stems.muted[s]);
    if(stems.gains[s])stems.gains[s].gain.setTargetAtTime(stems.muted[s]?0:0.6,ctx.currentTime,0.02);
  }));
},100);

/* ---------- SLICE TIMELINE (draggable blocks) ---------- */
const SLICE_COLORS = {
  kick:"#FF5C37", snare:"#ff9a7a", hat:"#ffbfaa", perc:"#7a5142",
  bass:"#ffd166", melody:"#5CE1E6", vox:"#c77dff",
  drums:"#FF5C37", other:"#5CE1E6", vocals:"#c77dff"
};
const sliceLanes = [
  {id:"kick",label:"KICK"},{id:"snare",label:"SNARE"},{id:"hat",label:"HI-HAT"},{id:"perc",label:"PERC"},
  {id:"bass",label:"BASS"},{id:"melody",label:"MELODY"}
];
let sliceDuration=0; // seconds shown
let sliceBuffers={}; // id -> {buf:AudioBuffer, color, lane}
function clearSlices(){
  sliceBuffers={};sliceDuration=0;
  const tl=$("#sliceTimeline");if(tl)tl.innerHTML="";
}
function buildLanes(){
  const tl=$("#sliceTimeline");tl.innerHTML="";
  sliceLanes.forEach(l=>{
    const lane=document.createElement("div");lane.className="slice-lane";lane.dataset.lane=l.id;
    lane.innerHTML=`<div class="lane-label"><span>${l.label}</span><span class="lane-dot" style="background:${SLICE_COLORS[l.id]}"></span></div><div class="lane-track" data-lane="${l.id}"><div class="lane-cue"></div></div>`;
    tl.appendChild(lane);
  });
}
function renderSlices(stem,slices,sr){
  const wrap=$("#sliceWrap");
  if(!wrap.classList.contains("show")){buildLanes();wrap.classList.add("show")}
  // compute duration based on mix buffer or latest slice end
  if(stems.mix) sliceDuration=Math.max(sliceDuration,stems.mix.duration);
  slices.forEach((sl,idx)=>{
    const end = sl.start+sl.duration;
    if(end>sliceDuration)sliceDuration=end;
    const laneId = sl.category || stem;
    // map vox→melody lane? Keep vocals off the lane grid so kick/snare/hat/perc/bass/melody stay clean; put misc on "perc" or "melody"
    const target = SLICE_COLORS[laneId]?laneId:(stem==="vocals"?"melody":"perc");
    // create audio buffer
    const abuf=ctx.createBuffer(2,sl.data.length/2,sr);
    const aL=abuf.getChannelData(0),aR=abuf.getChannelData(1);
    for(let i=0;i<sl.data.length/2;i++){aL[i]=sl.data[i*2];aR[i]=sl.data[i*2+1]}
    const id=`sl_${stem}_${idx}_${Math.random().toString(36).slice(2,7)}`;
    sliceBuffers[id]={buf:abuf,color:SLICE_COLORS[target]||SLICE_COLORS[stem],lane:target};
    // find lane track
    let track = $(`.lane-track[data-lane="${target}"]`);
    if(!track){
      // dynamic lane if missing (shouldn't happen)
      track = document.createElement("div");
    }
    const block=document.createElement("div");
    block.className="slice-block";block.dataset.id=id;
    block.style.background=`linear-gradient(180deg,${sliceBuffers[id].color},${shade(sliceBuffers[id].color,-25)})`;
    block.style.left= (sl.start/sliceDuration*100)+"%";
    block.style.width= Math.max(2,(sl.duration/sliceDuration*100))+"%";
    block.textContent=(sl.category||stem).toUpperCase();
    block.title=`${sl.category||stem} · ${sl.duration.toFixed(3)}s @ ${sl.start.toFixed(2)}s (click to preview)`;
    // click to preview
    block.addEventListener("mousedown",e=>{if(!e.shiftKey)startDrag(block,e)});
    block.addEventListener("click",e=>{if(!dragMoved)previewSlice(id)});
    track.appendChild(block);
  });
  $("#stemProg").style.display="none";
}
function shade(hex,amt){
  const c=hex.replace("#","");let n=parseInt(c,16);
  let r=(n>>16)+amt,g=((n>>8)&0xff)+amt,b=(n&0xff)+amt;
  r=Math.max(0,Math.min(255,r));g=Math.max(0,Math.min(255,g));b=Math.max(0,Math.min(255,b));
  return "#"+((r<<16)|(g<<8)|b).toString(16).padStart(6,"0");
}
let previewGain=null;
function previewSlice(id){
  const s=sliceBuffers[id];if(!s)return;
  if(!previewGain){previewGain=ctx.createGain();previewGain.gain.value=0.9;previewGain.connect(masterGain)}
  const src=ctx.createBufferSource();src.buffer=s.buf;src.connect(previewGain);src.start();
}

/* drag blocks */
let dragEl=null,dragStartX=0,dragStartLeft=0,dragMoved=false;
function getPoint(e){return (e.touches&&e.touches[0])||(e.changedTouches&&e.changedTouches[0])||e}
function startDrag(el,e){
  if(e.cancelable)e.preventDefault();
  dragEl=el;dragMoved=false;
  const rect=el.getBoundingClientRect();
  const p=getPoint(e);
  dragStartX=p.clientX;dragStartLeft=parseFloat(el.style.left);
  el.classList.add("dragging");
  document.addEventListener("mousemove",onDrag);document.addEventListener("mouseup",endDrag);
  document.addEventListener("touchmove",onDrag,{passive:false});document.addEventListener("touchend",endDrag);
}
function onDrag(e){
  if(!dragEl)return;
  if(e.cancelable)e.preventDefault();
  const p=getPoint(e);
  const track=dragEl.parentElement;const trackRect=track.getBoundingClientRect();
  const dx=(p.clientX-dragStartX)/trackRect.width*100;
  if(Math.abs(dx)>0.3)dragMoved=true;
  let left=Math.max(0,Math.min(100-parseFloat(dragEl.style.width),dragStartLeft+dx));
  dragEl.style.left=left+"%";
}
function endDrag(e){
  if(!dragEl)return;
  const el=dragEl;
  el.classList.remove("dragging");
  document.removeEventListener("mousemove",onDrag);document.removeEventListener("mouseup",endDrag);
  document.removeEventListener("touchmove",onDrag);document.removeEventListener("touchend",endDrag);
  const p=getPoint(e);
  const target=document.elementFromPoint(p.clientX,p.clientY);
  const newTrack = target?target.closest(".lane-track"):null;
  if(newTrack && newTrack!==el.parentElement){
    const id=el.dataset.id;
    const newLaneId=newTrack.dataset.lane;
    const rect=newTrack.getBoundingClientRect();
    const left=(p.clientX-rect.left)/rect.width*100;
    el.style.left=Math.max(0,Math.min(100-parseFloat(el.style.width),left))+"%";
    el.style.background=`linear-gradient(180deg,${SLICE_COLORS[newLaneId]},${shade(SLICE_COLORS[newLaneId],-25)})`;
    if(sliceBuffers[id]){sliceBuffers[id].color=SLICE_COLORS[newLaneId];sliceBuffers[id].lane=newLaneId}
    newTrack.appendChild(el);
    toast("Moved to "+newLaneId.toUpperCase());
  }
  setTimeout(()=>{dragMoved=false;dragEl=null},50);
}
function moveCue(pct){
  $$(".lane-cue").forEach(c=>{
    if(pct<0){c.style.display="none"}else{c.style.display="block";c.style.left=(pct*100)+"%"}
  });
}

randomize();
$("#bpmShow").textContent=seqState.bpm+" BPM";

/* ============================================================
   MODE 2 — SOUND IT (ear training)
   ============================================================ */
let soundInit=false;
let rPat=[],rUser=[],rListen=false,rKeyHandler=null,rTapHandler=null,rStart=0,rNeeded=0;
function initSound(){
  if(soundInit)return;soundInit=true;
  ensureCtx();
  /* interval game */
  const INTERVALS=[{n:"m2",s:1},{n:"M2",s:2},{n:"m3",s:3},{n:"M3",s:4},{n:"P4",s:5},{n:"tritone",s:6},{n:"P5",s:7},{n:"m6",s:8},{n:"M6",s:9},{n:"m7",s:10},{n:"M7",s:11},{n:"P8",s:12}];
  let ivCur=null,ivTotal=0,ivCorrect=0,ivStreak=0,ivBest=+localStorage.getItem("beatit_ivbest")||0;
  const ivBtns=$("#ivBtns"),ivTarget=$("#ivTarget"),ivFb=$("#ivFeedback"),ivStreakEl=$("#ivStreak"),ivBestEl=$("#ivBest"),ivAcc=$("#ivAcc");
  function pickIv(){ivCur=pick(INTERVALS.slice(0,8));ivTarget.textContent="?";ivFb.textContent="Press a button to answer";ivTarget.style.color=""}
  function playIv(){if(!ivCur)return pickIv();
    const base=220*Math.pow(2,Math.floor(Math.random()*3)-1);
    tone(ctx.currentTime,{f:base,d:0.8,decay:0.7,v:0.3,w:"sine"});
    tone(ctx.currentTime+0.6,{f:base*Math.pow(2,ivCur.s/12),d:0.8,decay:0.7,v:0.3,w:"sine"});
  }
  ivBtns.innerHTML=INTERVALS.slice(0,8).map(x=>`<button class="iv-btn" data-n="${x.n}">${x.n}</button>`).join("");
  ivBtns.addEventListener("click",e=>{
    const b=e.target.closest(".iv-btn");if(!b||!ivCur)return;
    ivTotal++;const right=b.dataset.n===ivCur.n;
    $$(".iv-btn",ivBtns).forEach(x=>x.classList.remove("correct","wrong"));
    if(right){ivCorrect++;ivStreak++;if(ivStreak>ivBest){ivBest=ivStreak;localStorage.setItem("beatit_ivbest",ivBest)}b.classList.add("correct");ivFb.textContent="CORRECT — "+ivCur.n;ivTarget.textContent=ivCur.n.toUpperCase();ivTarget.style.color="var(--green)";setTimeout(pickIv,900)}
    else{ivStreak=0;b.classList.add("wrong");ivFb.textContent="WRONG — it was "+ivCur.n;ivTarget.textContent=ivCur.n.toUpperCase();ivTarget.style.color="var(--red)";setTimeout(pickIv,1400)}
    ivStreakEl.textContent=ivStreak;ivBestEl.textContent=ivBest;ivAcc.textContent=Math.round(ivCorrect/Math.max(1,ivTotal)*100)+"%";
    const pct=Math.min(100,ivStreak*5);$("#pb1").style.width=pct+"%";$("#pb1v").textContent=ivCorrect;
  });
  $("#ivPlay").addEventListener("click",()=>{if(!ivCur)pickIv();playIv()});

  /* rhythm */
  function genPattern(){
    rPat=Array.from({length:8},()=>Math.random()<0.4);
    // ensure at least 2 hits so the game is never empty
    const hits=rPat.filter(x=>x).length;
    if(hits<2){const pick=()=>Math.floor(Math.random()*8);let a=pick();rPat[a]=true;let b=pick();while(b===a)b=pick();rPat[b]=true}
  }
  function rTap(t){
    if(!rListen)return;
    if(t-rStart>2.4){rListen=false;endR();return}
    const step=Math.round((t-rStart)/250); // 0.25s per step at 240BPM feel
    rUser.push(Math.max(0,Math.min(7,step)));
    if(rUser.length>=rNeeded){
      endR();
    }
  }
  function endR(){
    rListen=false;
    document.removeEventListener("keydown",rKeyHandler);
    const pad=$("#rpad");if(pad)pad.removeEventListener("pointerdown",rTapHandler);
    rKeyHandler=null;rTapHandler=null;
    // score: count how many expected hit slots had at least one tap near them
    let score=0;
    rPat.forEach((on,i)=>{
      if(!on)return;
      const hit=rUser.some(u=>Math.abs(u-i)<=0); // exact-step match
      // also accept off-by-one for forgiveness
      const near=rUser.some(u=>Math.abs(u-i)<=1);
      if(hit)score++;else if(near)score+=0.5;
    });
    // penalize extra taps
    const extras = Math.max(0, rUser.length - rPat.filter(x=>x).length);
    score = Math.max(0, score - extras*0.25);
    const total=rPat.filter(x=>x).length;
    const pct=total?Math.min(100,Math.round(score/total*100)):0;
    $("#rScore").textContent=pct;$("#rfb").textContent=pct>=80?"CLEAN.":pct>=50?"Close.":"Keep going.";
    $("#pb2").style.width=pct+"%";$("#pb2v").textContent=pct;
    $("#pb4").style.width=Math.min(100,(history.length*5))+"%";$("#pb4v").textContent=history.length;
    setTimeout(genPattern,600);
  }
  function playPattern(){
    rUser=[];const t0=ctx.currentTime;
    rPat.forEach((on,i)=>{if(on)tone(t0+i*0.25,{f:300,f2:150,d:0.12,decay:0.08,v:0.3,w:"square"})});
    const pad=$("#rpad");pad.innerHTML="";rPat.forEach((on,i)=>{if(on){const h=document.createElement("div");h.className="rhythm-hit";h.style.left=(i/8*100)+"%";pad.appendChild(h)}});
    setTimeout(()=>{pad.innerHTML=""},1200);
  }
  $("#rPlay").addEventListener("click",()=>{genPattern();playPattern();$("#rfb").textContent="Memorize it… then tap START";rListen=false;if(rKeyHandler){document.removeEventListener("keydown",rKeyHandler);rKeyHandler=null}if(rTapHandler){const pad=$("#rpad");if(pad)pad.removeEventListener("pointerdown",rTapHandler);rTapHandler=null}});
  $("#rStart").addEventListener("click",()=>{
    if(rListen)return;
    if(!rPat.length){genPattern();playPattern();$("#rfb").textContent="Memorize, then tap START again";setTimeout(()=>{$("#rfb").textContent="Ready? Tap START"},1400);return}
    rListen=true;rUser=[];rStart=performance.now();rNeeded=rPat.filter(x=>x).length;
    $("#rfb").textContent="TAP SPACE OR THE PAD";
    if(rKeyHandler)document.removeEventListener("keydown",rKeyHandler);
    rKeyHandler=function(e){
      if(e.code!=="Space")return;e.preventDefault();e.stopPropagation();
      rTap(performance.now());
    };
    document.addEventListener("keydown",rKeyHandler);
    // also allow pointer taps on the rhythm pad
    const pad=$("#rpad");
    if(rTapHandler)pad.removeEventListener("pointerdown",rTapHandler);
    rTapHandler=function(e){e.preventDefault();rTap(performance.now())};
    pad.addEventListener("pointerdown",rTapHandler);
  });

  /* genre */
  const ggrid=$("#genreGrid"),ginfo=$("#genreInfo");
  const specCanvas=$("#specCanvas"),specCtx=specCanvas.getContext("2d");
  function sizeSpec(){
    if(!specCanvas)return false;
    const r=specCanvas.parentElement.getBoundingClientRect();
    if(r.width<10||r.height<10)return false;
    specCanvas.width=r.width*(devicePixelRatio||1);specCanvas.height=r.height*(devicePixelRatio||1);
    specCtx.setTransform(1,0,0,1,0,0);specCtx.scale(devicePixelRatio||1,devicePixelRatio||1);
    return true;
  }
  let specRAF;
  function drawSpec(){
    if(!$("#view-sound").classList.contains("active")){specRAF=null;return}
    if(!sizeSpec()){specRAF=requestAnimationFrame(drawSpec);return}
    const w=specCanvas.clientWidth,h=specCanvas.clientHeight;
    specCtx.clearRect(0,0,w,h);const bars=48;const bw=w/bars;
    for(let i=0;i<bars;i++){const bh=(Math.sin(i*0.5+performance.now()*0.001)*0.3+Math.random()*0.5+0.2)*h*0.8;
      const grad=specCtx.createLinearGradient(0,h-bh,0,h);grad.addColorStop(0,"#5CE1E6");grad.addColorStop(1,"rgba(92,225,230,0.1)");
      specCtx.fillStyle=grad;specCtx.fillRect(i*bw+1,h-bh,bw-2,bh);}
    specRAF=requestAnimationFrame(drawSpec);
  }
  if(specRAF)cancelAnimationFrame(specRAF);
  requestAnimationFrame(drawSpec);
  ggrid.innerHTML=GENRES.slice(0,9).map((g,i)=>`<div class="gn" data-g="${i}">${g.n}</div>`).join("");
  ggrid.addEventListener("click",e=>{
    const b=e.target.closest(".gn");if(!b)return;
    $$(".gn").forEach(x=>x.classList.remove("active"));b.classList.add("active");
    const g=GENRES[+b.dataset.g];
    ginfo.innerHTML=`<div class="inst-row"><span>${g.per}</span><small>PERCUSSION</small></div>
      <div class="inst-row"><span>${g.pro}</span><small>PRODUCTION</small></div>
      <div class="inst-row"><span>${g.bpm[0]}–${g.bpm[1]} BPM</span><small>TEMPO</small></div>
      <div class="inst-row"><span>avoid: ${g.x.slice(0,2).join(", ")}</span><small>AVOID</small></div>`;
    const v=(+$("#pb3v").textContent||0)+1;$("#pb3").style.width=Math.min(100,v*4)+"%";$("#pb3v").textContent=v;
  });

  const coll=history.length;$("#pb4").style.width=Math.min(100,coll*5)+"%";$("#pb4v").textContent=coll;
  const lvl=coll>50?"BEAST":coll>20?"SAVAGE":coll>10?"PRODUCER":coll>3?"APPRENTICE":"NOVICE";
  $("#dLevel").textContent=lvl;$("#dStreak").textContent=(+localStorage.getItem("beatit_dstreak")||0)+" days";
}

/* ============================================================
   MODE 3 — REC IT (recording booth)
   ============================================================ */
let recInit=false,mediaRec,recStream,recAnalyser,recChunks=[],recStartTime,recRAF,recording=false,recAudio;
function initRec(){
  if(recInit)return;recInit=true;
  ensureCtx();
  const canvas=$("#recCanvas"),cx=canvas.getContext("2d");
  function resize(){const r=canvas.getBoundingClientRect();if(r.width<10||r.height<10)return;
    canvas.width=r.width*(devicePixelRatio||1);canvas.height=r.height*(devicePixelRatio||1);
    cx.setTransform(1,0,0,1,0,0);cx.scale(devicePixelRatio||1,devicePixelRatio||1);}
  requestAnimationFrame(()=>{resize();requestAnimationFrame(resize)});
  window.addEventListener("resize",resize);

  $$("#modeToggle .mt-btn").forEach(b=>b.addEventListener("click",()=>{
    $$("#modeToggle .mt-btn").forEach(x=>x.classList.remove("active"));b.classList.add("active");
    $("#recMode").textContent=b.dataset.m.toUpperCase();}));

  const PROMPTS=[
    "Flow over the beat like water finding cracks. No second takes. First thought, best thought.",
    "Start with a whisper. Build to a snarl. End with a laugh.",
    "Pretend you're 14 again yelling into a cheap mic in your bedroom. Mean it.",
    "Three flows in 60 seconds. Switch every 8 bars.",
    "Tell a secret. Don't look at the words.",
    "No rhyme. All rhythm.",
    "Invent a word. Repeat it until it means something.",
    "Mumble first pass. Mumble second pass. Teeth third pass.",
  ];
  function setPrompt(){
    const beat=window._sentToRec;
    if(beat){$("#promptText").innerHTML=`Loaded: <b>${beat.name}</b> — ${beat.inst.n} × ${beat.gen.n}, ${beat.bpm} BPM. ${beat.why}`;}
    else $("#promptText").textContent=pick(PROMPTS);
  }
  setPrompt();
  $("#newPromptBtn").addEventListener("click",()=>{window._sentToRec=null;setPrompt()});
  $("#loadBeatBtn").addEventListener("click",()=>{if(!current){toast("Generate a beat first");return}window._sentToRec=current;setPrompt();toast("Beat loaded to booth")});
  $("#addBeatBtn").addEventListener("click",()=>{if(!current){toast("Generate a beat in BEAT IT first");return}addTrack("beat",`${current.name} · ${current.bpm} BPM`)});

  $("#recBtn").addEventListener("click",toggleRec);
  async function toggleRec(){
    if(recording){stopRec();return}
    try{
      const stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:false,autoGainControl:false}});
      recStream=stream;recChunks=[];
      const mime=MediaRecorder.isTypeSupported("audio/webm;codecs=opus")?"audio/webm;codecs=opus":"audio/webm";
      mediaRec=new MediaRecorder(stream,{mimeType:mime,audioBitsPerSecond:192000});
      mediaRec.ondataavailable=e=>{if(e.data.size)recChunks.push(e.data)};
      mediaRec.onstop=async()=>{
        // remove the placeholder "● RECORDING…" row
        const liveRow=$("#tracks .rec-tr");if(liveRow)liveRow.remove();
        const blob=new Blob(recChunks,{type:mime});const arr=await blob.arrayBuffer();
        try{recAudio=await ctx.decodeAudioData(arr.slice(0));addTrack("vocals","Take "+($$("#tracks .vocals-tr, #tracks .rec-tr").length+1));}catch(e){toast("Recording failed to decode")}
        if(recStream){try{recStream.getTracks().forEach(t=>t.stop())}catch(e){}recStream=null}
      };
      const src=ctx.createMediaStreamSource(stream);
      recAnalyser=ctx.createAnalyser();recAnalyser.fftSize=512;src.connect(recAnalyser);
      mediaRec.start();recording=true;recStartTime=ctx.currentTime;
      $("#recBtn").classList.add("rec");$("#recLive").style.display="inline-flex";
      drawWave();meterLoop();addTrack("rec","● RECORDING…");
    }catch(e){toast("Mic access denied")}
  }
  function stopRec(){
    if(!recording)return;
    try{mediaRec.stop()}catch(e){}
    recording=false;
    $("#recBtn").classList.remove("rec");$("#recLive").style.display="none";
    cancelAnimationFrame(recRAF);
    if(recStream){try{recStream.getTracks().forEach(t=>t.stop())}catch(e){}recStream=null}
    recAnalyser=null;
  }
  window.stopRec=stopRec;
  function drawWave(){
    if(!recAnalyser)return;
    const w=canvas.clientWidth,h=canvas.clientHeight;cx.clearRect(0,0,w,h);
    const arr=new Uint8Array(recAnalyser.fftSize);recAnalyser.getByteTimeDomainData(arr);
    cx.lineWidth=2;cx.strokeStyle=recording?"#FF4B4B":"#FF5C37";cx.shadowBlur=recording?15:8;cx.shadowColor=cx.strokeStyle;
    cx.beginPath();const sl=w/arr.length;
    for(let i=0;i<arr.length;i++){const v=arr[i]/128;const x=i*sl,y=v*h/2;if(i===0)cx.moveTo(x,y);else cx.lineTo(x,y)}
    cx.stroke();cx.shadowBlur=0;
    cx.strokeStyle="rgba(255,255,255,0.05)";cx.lineWidth=1;cx.beginPath();cx.moveTo(0,h/2);cx.lineTo(w,h/2);cx.stroke();
    recRAF=requestAnimationFrame(drawWave);
  }
  function meterLoop(){
    if(!recAnalyser)return;
    const arr=new Uint8Array(recAnalyser.fftSize);recAnalyser.getByteTimeDomainData(arr);
    let peak=0;for(let i=0;i<arr.length;i++){const v=Math.abs(arr[i]-128)/128;if(v>peak)peak=v}
    const pct=Math.min(100,peak*140);
    $("#lvlMic").style.width=pct+"%";$("#lvlMicV").textContent=peak>0.01?Math.round(20*Math.log10(Math.max(peak,0.001)))+"dB":"-∞";
    $("#lvlBeat").style.width=20+Math.random()*30+"%";
    $("#lvlMaster").style.width=Math.min(100,pct*0.6+20+Math.random()*10)+"%";
    if(recording){const t=ctx.currentTime-recStartTime;const m=Math.floor(t/60),s=Math.floor(t%60),ds=Math.floor((t%1)*10);
      $("#timer").textContent=String(m).padStart(2,"0")+":"+String(s).padStart(2,"0")+"."+ds;requestAnimationFrame(meterLoop)}
  }

  function addTrack(type,label){
    const tl=$("#tracks");
    const ph=tl.querySelector("div[style*='color:var(--dim2)']");if(ph)ph.remove();
    const row=document.createElement("div");
    row.className="track-row "+(type==="rec"?"rec-tr":type==="beat"?"beat-tr":"");
    row.innerHTML=`<div class="tr-name">${label}<small>${type.toUpperCase()}${type==="rec"?" · LIVE":""}</small></div>
      <div class="tr-wave"></div>
      <div class="tr-ctrl"><button title="mute">M</button><button title="delete">×</button></div>`;
    tl.appendChild(row);
    row.querySelector("button[title='delete']").addEventListener("click",()=>row.remove());
  }
  $("#playbackBtn").addEventListener("click",()=>{if(!recAudio){toast("Nothing recorded yet");return}
    const s=ctx.createBufferSource();s.buffer=recAudio;s.connect(masterGain);s.start();toast("Playing back")});
}

/* unlock audio */
function unlockAudio(){ensureCtx();if(ctx.state==="suspended")ctx.resume()}
document.addEventListener("pointerdown",unlockAudio,{once:true});
document.addEventListener("keydown",unlockAudio,{once:true});
