
const fileInput = document.getElementById('fileInput');
const origCanvas = document.getElementById('origCanvas');
const outCanvas = document.getElementById('outCanvas');
const processBtn = document.getElementById('processBtn');
const exportBtn = document.getElementById('exportBtn');
const resetBtn  = document.getElementById('resetBtn');

const thresh = document.getElementById('thresh');
const threshVal = document.getElementById('threshVal');
const stroke = document.getElementById('stroke');
const strokeNum = document.getElementById('strokeNum');
const strokeVal = document.getElementById('strokeVal');
const color = document.getElementById('color');
const colorHex = document.getElementById('colorHex');

// ---------- Tunables ----------
const INTERNAL_SCALE = 4;             // hi-res multiplier (quality)
const MAX_DISPLAY_DIM = 2000;         // clamp long edge to reduce memory/time

// ---------- State ----------
let origImg = null;
let workW = 0, workH = 0;             // hi-res dims
const workCanvas = document.createElement('canvas');

// Preview alpha cache (downscaled alpha as canvas)
let alphaLoCanvas = document.createElement('canvas'); // only alpha
let previewReady = false;

// Modal
const loadingModal = document.getElementById('loadingModal');
const showLoading = ()=> loadingModal.classList.remove('hidden');
const hideLoading = ()=> loadingModal.classList.add('hidden');

// ---------- Helpers ----------
function drawImageToCanvas(img, canvas, maxDim=MAX_DISPLAY_DIM){
  const ratio = Math.min(maxDim / img.width, maxDim / img.height, 1);
  const w = Math.round(img.width * ratio);
  const h = Math.round(img.height * ratio);
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0,0,w,h);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, w, h);
  return {w, h};
}
function prepareWorkCanvas(displayW, displayH){
  workW = displayW * INTERNAL_SCALE;
  workH = displayH * INTERNAL_SCALE;
  workCanvas.width = workW;
  workCanvas.height = workH;
  const wctx = workCanvas.getContext('2d');
  wctx.imageSmoothingEnabled = true;
  wctx.imageSmoothingQuality = 'high';
  wctx.drawImage(origCanvas, 0, 0, workW, workH);
}
function debounce(fn, ms=80){ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), ms); }; }

// ---------- Worker (SDF) ----------
const workerCode = `
let workW=0, workH=0;
let baseAlphaHi = null;    // Uint8ClampedArray alpha (hi-res)
let binHi = null;          // Uint8Array hi-res 1/0
let previewW=0, previewH=0;
let sdfPreview = null;     // Float32Array signed distance (preview)

function toGray(data){
  const len = data.length/4;
  const gray = new Uint8ClampedArray(len);
  for(let i=0, j=0; i<data.length; i+=4, j++){
    const r=data[i], g=data[i+1], b=data[i+2];
    gray[j] = (0.2126*r + 0.7152*g + 0.0722*b) | 0;
  }
  return gray;
}
function otsuThreshold(gray){
  const hist = new Uint32Array(256);
  for(let i=0;i<gray.length;i++) hist[gray[i]]++;
  const total = gray.length;
  let sum = 0; for(let t=0;t<256;t++) sum += t * hist[t];
  let sumB=0, wB=0, wF=0, varMax=0, threshold=127;
  for(let t=0;t<256;t++){
    wB += hist[t]; if(wB===0) continue;
    wF = total - wB; if(wF===0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const varBetween = wB*wF*(mB - mF)*(mB - mF);
    if(varBetween > varMax){ varMax = varBetween; threshold = t; }
  }
  return threshold;
}
function makeSoftMask(gray, threshold, feather = 24) {
  const len = gray.length;
  const alpha = new Uint8ClampedArray(len);
  const tLo = threshold - feather;
  const tHi = threshold + feather;
  for (let i = 0; i < len; i++) {
    const g = gray[i];
    let a = 0;
    if (g <= tLo) a = 255;
    else if (g >= tHi) a = 0;
    else {
      const t = (g - tLo) / (tHi - tLo);
      const smoothT = t * t * (3 - 2 * t);
      a = Math.round(255 * (1 - smoothT));
    }
    alpha[i] = a;
  }
  return alpha;
}
function blurAlphaBox(alpha, w, h, r){
  if(r<=0) return alpha;
  const out = new Uint8ClampedArray(alpha.length);
  const tmp = new Uint8ClampedArray(alpha.length);
  for (let y = 0; y < h; y++) {
    let acc = 0, count = 0;
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(w - 1, x + r);
      if (x === 0) {
        acc = 0; count = 0;
        for (let k = x0; k <= x1; k++) { acc += alpha[row + k]; count++; }
      } else {
        const prevOut = x - r - 1;
        const nextIn  = x + r;
        if (prevOut >= 0) { acc -= alpha[row + prevOut]; count--; }
        if (nextIn < w)  { acc += alpha[row + nextIn];  count++; }
      }
      tmp[row + x] = Math.round(acc / count);
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0, count = 0;
    for (let y = 0; y < h; y++) {
      const y0 = Math.max(0, y - r);
      const y1 = Math.min(h - 1, y + r);
      if (y === 0) {
        acc = 0; count = 0;
        for (let k = y0; k <= y1; k++) { acc += tmp[k * w + x]; count++; }
      } else {
        const prevOut = y - r - 1;
        const nextIn  = y + r;
        if (prevOut >= 0) { acc -= tmp[prevOut * w + x]; count--; }
        if (nextIn < h)  { acc += tmp[nextIn * w + x];  count++; }
      }
      out[y * w + x] = Math.round(acc / count);
    }
  }
  return out;
}
function binarizeFromAlpha(alpha){
  const out = new Uint8Array(alpha.length);
  for(let i=0;i<alpha.length;i++) out[i] = alpha[i]>0 ? 1 : 0;
  return out;
}
// ---- 1D EDT ----
function edt1d(f, n){
  const INF = 1e20;
  const v = new Int32Array(n);
  const z = new Float64Array(n+1);
  const d = new Float64Array(n);
  let k = 0;
  v[0] = 0;
  z[0] = -INF;
  z[1] =  INF;
  for(let q=1; q<n; q++){
    let s = ((f[q] + q*q) - (f[v[k]] + v[k]*v[k])) / (2*q - 2*v[k]);
    while(s <= z[k]){
      k--;
      s = ((f[q] + q*q) - (f[v[k]] + v[k]*v[k])) / (2*q - 2*v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k+1] = INF;
  }
  k = 0;
  for(let q=0; q<n; q++){
    while(z[k+1] < q) k++;
    const val = q - v[k];
    d[q] = (val*val) + f[v[k]];
  }
  return d;
}
function edt2d(binary, w, h){
  const INF = 1e12;
  const f = new Float64Array(w*h);
  for(let i=0;i<w*h;i++) f[i] = binary[i] ? 0 : INF;
  const g = new Float64Array(w*h);
  for(let x=0; x<w; x++){
    const col = new Float64Array(h);
    for(let y=0; y<h; y++) col[y] = f[y*w + x];
    const dcol = edt1d(col, h);
    for(let y=0; y<h; y++) g[y*w + x] = dcol[y];
  }
  const d = new Float64Array(w*h);
  for(let y=0; y<h; y++){
    const row = new Float64Array(w);
    for(let x=0; x<w; x++) row[x] = g[y*w + x];
    const drow = edt1d(row, w);
    for(let x=0; x<w; x++) d[y*w + x] = drow[x];
  }
  return d;
}
function downscaleBin(src, sw, sh, dw, dh){
  const dst = new Uint8Array(dw*dh);
  const xRatio = sw / dw, yRatio = sh / dh;
  for(let j=0; j<dh; j++){
    const sy = Math.min(sh-1, Math.floor(j * yRatio));
    for(let i=0; i<dw; i++){
      const sx = Math.min(sw-1, Math.floor(i * xRatio));
      dst[j*dw+i] = src[sy*sw+sx];
    }
  }
  return dst;
}

self.onmessage = (e)=>{
  const {type} = e.data;
  if(type === 'buildBase'){
    const {imgData, width, height, pvW, pvH} = e.data;
    workW = width; workH = height;
    previewW = pvW; previewH = pvH;

    const gray = toGray(imgData.data);
    const t = otsuThreshold(gray);
    let alpha = makeSoftMask(gray, t, 24);
    alpha = blurAlphaBox(alpha, workW, workH, 2);
    baseAlphaHi = alpha;
    const bin = binarizeFromAlpha(alpha);
    // SDF preview
    const binPv = downscaleBin(bin, workW, workH, previewW, previewH);
    const dInSq = edt2d(binPv, previewW, previewH);
    const invPv = new Uint8Array(binPv.length);
    for(let i=0;i<binPv.length;i++) invPv[i] = binPv[i] ? 0 : 1;
    const dOutSq = edt2d(invPv, previewW, previewH);
    sdfPreview = new Float32Array(binPv.length);
    for(let i=0;i<binPv.length;i++){
      const inD = Math.sqrt(dInSq[i]);
      const outD = Math.sqrt(dOutSq[i]);
      // Signed distance: positive inside, negative outside
      sdfPreview[i] = outD - inD;
    }
    // Keep hi-res binary for later export (avoid recomputing)
    binHi = bin;
    self.postMessage({type:'baseDone', threshold:t}, []);
  }
  else if(type === 'previewMorph'){
    const {strokePrevPx} = e.data;
    if(!sdfPreview){ self.postMessage({type:'error', message:'SDF not ready'}); return; }
    const w = previewW, h = previewH;
    const out = new Uint8ClampedArray(w*h);
    const thr = -strokePrevPx; // expand if positive
    for(let i=0;i<out.length;i++){
      out[i] = (sdfPreview[i] >= thr) ? 255 : 0;
    }
    // light 3x3 blur to soften edges
    const blurred = new Uint8ClampedArray(out.length);
    for(let y=0;y<h;y++){
      for(let x=0;x<w;x++){
        let acc=0,cnt=0;
        for(let dy=-1;dy<=1;dy++){
          const yy=y+dy; if(yy<0||yy>=h) continue;
          for(let dx=-1;dx<=1;dx++){
            const xx=x+dx; if(xx<0||xx>=w) continue;
            acc+=out[yy*w+xx]; cnt++;
          }
        }
        blurred[y*w+x] = Math.round(acc/cnt);
      }
    }
    self.postMessage({type:'previewMask', mask:blurred, w, h}, [blurred.buffer]);
  }
  else if(type === 'exportMask'){
    const {strokeHiPx} = e.data;
    if(!binHi){ self.postMessage({type:'error', message:'Hi-res base not ready'}); return; }
    const w = workW, h = workH;
    // Hi-res SDF (EDT both sides)
    const dInSq = edt2d(binHi, w, h);
    const invHi = new Uint8Array(binHi.length);
    for(let i=0;i<binHi.length;i++) invHi[i] = binHi[i] ? 0 : 1;
    const dOutSq = edt2d(invHi, w, h);

    const thr = -strokeHiPx;
    const hiMask = new Uint8ClampedArray(w*h);
    for(let i=0;i<hiMask.length;i++){
      const inD = Math.sqrt(dInSq[i]);
      const outD = Math.sqrt(dOutSq[i]);
      const sdf = outD - inD; // positive inside, negative outside
      hiMask[i] = (sdf >= thr) ? 255 : 0;
    }
    self.postMessage({type:'exportMaskDone', mask:hiMask, w, h}, [hiMask.buffer]);
  }
};
`;
const worker = new Worker(URL.createObjectURL(new Blob([workerCode], {type:'application/javascript'})));

// ---------- Rendering ----------
function renderColorWithAlphaCanvas(alphaCanvas){
  if(!previewReady || !alphaCanvas.width || !alphaCanvas.height) return;
  const ctx = outCanvas.getContext('2d');
  ctx.globalCompositeOperation = 'source-over';
  ctx.clearRect(0,0,outCanvas.width,outCanvas.height);
  ctx.fillStyle = color.value || '#000000';
  ctx.fillRect(0,0,outCanvas.width,outCanvas.height);
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(alphaCanvas, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
}
function rebuildPreviewCanvasFromMask(mask, w, h){
  previewReady = false;
  outCanvas.width = w; outCanvas.height = h;
  alphaLoCanvas.width = w; alphaLoCanvas.height = h;
  const actx = alphaLoCanvas.getContext('2d');
  const img = actx.createImageData(w, h);
  for(let i=0,j=0;i<img.data.length;i+=4,j++){
    img.data[i]=0; img.data[i+1]=0; img.data[i+2]=0; img.data[i+3]=mask[j];
  }
  actx.putImageData(img, 0, 0);
  previewReady = true;
  renderColorWithAlphaCanvas(alphaLoCanvas);
}

// ---------- Build & Morph ----------
async function buildBaseAsync(){
  const wctx = workCanvas.getContext('2d');
  const imgData = wctx.getImageData(0, 0, workW, workH);
  const pvW = Math.round(workW / INTERNAL_SCALE);
  const pvH = Math.round(workH / INTERNAL_SCALE);
  return new Promise((resolve)=>{
    const onMsg = (e)=>{
      if(e.data && e.data.type==='baseDone'){
        worker.removeEventListener('message', onMsg);
        resolve(e.data);
      }
    };
    worker.addEventListener('message', onMsg);
    worker.postMessage({type:'buildBase', imgData, width:workW, height:workH, pvW, pvH});
  });
}
async function previewMorphAsync(strokePrevPx){
  return new Promise((resolve)=>{
    const onMsg = (e)=>{
      const d = e.data;
      if(d && d.type==='previewMask'){
        worker.removeEventListener('message', onMsg);
        const mask = new Uint8ClampedArray(d.mask);
        rebuildPreviewCanvasFromMask(mask, d.w, d.h);
        resolve();
      }
    };
    worker.addEventListener('message', onMsg);
    worker.postMessage({type:'previewMorph', strokePrevPx});
  });
}

// ---------- Export ----------
async function exportHiResMaskAsync(strokeHiPx){
  return new Promise((resolve)=>{
    const onMsg = (e)=>{
      const d = e.data;
      if(d && d.type==='exportMaskDone'){
        worker.removeEventListener('message', onMsg);
        resolve({mask: new Uint8ClampedArray(d.mask), w: d.w, h: d.h});
      }
    };
    worker.addEventListener('message', onMsg);
    worker.postMessage({type:'exportMask', strokeHiPx});
  });
}
function findBoundingBox(alpha, w, h){
  let minX=w, minY=h, maxX=-1, maxY=-1;
  for(let y=0;y<h;y++){
    for(let x=0;x<w;x++){
      if(alpha[y*w+x] > 0){
        if(x<minX)minX=x; if(x>maxX)maxX=x; if(y<minY)minY=y; if(y>maxY)maxY=y;
      }
    }
  }
  if(maxX<minX || maxY<minY) return {x:0,y:0,w:0,h:0};
  return {x:minX, y:minY, w:maxX-minX+1, h:maxY-minY+1};
}
async function exportPng(){
  if(!origImg){ alert('Chưa có kết quả để xuất.'); return; }
  showLoading();
  try{
    const strokeHiPx = Math.round((parseFloat(stroke.value)||0) * INTERNAL_SCALE);
    const {mask, w, h} = await exportHiResMaskAsync(strokeHiPx);
    // bbox crop
    const bbox = findBoundingBox(mask, w, h);
    if(bbox.w===0 || bbox.h===0){ alert('Không phát hiện được nét ký.'); hideLoading(); return; }
    const hiAlpha = document.createElement('canvas');
    hiAlpha.width = bbox.w; hiAlpha.height = bbox.h;
    const hctx = hiAlpha.getContext('2d');
    const img = hctx.createImageData(bbox.w, bbox.h);
    for(let y=0;y<bbox.h;y++){
      for(let x=0;x<bbox.w;x++){
        const a = mask[(bbox.y+y)*w + (bbox.x+x)];
        const idx = (y*bbox.w + x)*4;
        img.data[idx]=0; img.data[idx+1]=0; img.data[idx+2]=0; img.data[idx+3]=a;
      }
    }
    hctx.putImageData(img, 0, 0);
    // downscale to preview scale for output
    const outW = Math.max(1, Math.round(bbox.w / INTERNAL_SCALE));
    const outH = Math.max(1, Math.round(bbox.h / INTERNAL_SCALE));
    const alphaOut = document.createElement('canvas');
    alphaOut.width = outW; alphaOut.height = outH;
    const actx = alphaOut.getContext('2d');
    actx.imageSmoothingEnabled = true;
    actx.imageSmoothingQuality = 'high';
    actx.drawImage(hiAlpha, 0, 0, outW, outH);
    // paint color + alpha
    const final = document.createElement('canvas');
    final.width = outW; final.height = outH;
    const fctx = final.getContext('2d');
    fctx.fillStyle = color.value || '#000000';
    fctx.fillRect(0,0,outW,outH);
    fctx.globalCompositeOperation = 'destination-in';
    fctx.drawImage(alphaOut, 0, 0);
    fctx.globalCompositeOperation = 'source-over';
    const url = final.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = url;
    a.download = 'signature.png';
    a.click();
  }catch(e){
    console.error(e);
    alert('Lỗi khi xuất PNG.');
  }finally{
    hideLoading();
  }
}

// ---------- Process flow ----------
async function processAll(){
  if(!origImg){ alert('Hãy tải ảnh chữ ký trước đã nhé!'); return; }
  previewReady = false;
  showLoading();
  try{
    await buildBaseAsync();
    const sPrev = parseFloat(stroke.value)||0;  // preview pixels
    await previewMorphAsync(sPrev);
  }catch(err){
    console.error(err);
    alert('Có lỗi khi xử lý ảnh.'); 
  }finally{
    hideLoading();
  }
}

// ---------- Event wiring ----------
fileInput.addEventListener('change', async (e) => {
  const file = e.target.files && e.target.files[0];
  if(!file) return;
  showLoading();
  try {
    const img = new Image();
    const loadImage = new Promise((resolve, reject) => {
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Không tải được ảnh'));
    });
    const reader = new FileReader();
    reader.onload = (ev) => { img.src = ev.target.result; };
    reader.readAsDataURL(file);
    await loadImage;
    const {w, h} = drawImageToCanvas(img, origCanvas);
    origImg = img;
    prepareWorkCanvas(w, h);
    await processAll();
  } catch (error) {
    alert('Không mở được ảnh. Hãy thử file .jpg/.png/.webp');
  } finally {
    hideLoading();
  }
});

// Sidebar nav
document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const target = btn.getAttribute('data-target');
    document.querySelectorAll('.panel').forEach(p => p.classList.add('hidden'));
    const panel = document.getElementById('panel-' + target);
    if(panel) panel.classList.remove('hidden');
  });
});

processBtn && processBtn.addEventListener('click', async () => { 
  if(origImg){ 
    prepareWorkCanvas(origCanvas.width, origCanvas.height); 
    await processAll(); 
  } 
});
exportBtn.addEventListener('click', exportPng);
resetBtn.addEventListener('click', ()=>{
  thresh && (thresh.value = 128);
  threshVal && (threshVal.textContent = '128');
  stroke.value = 0; strokeNum.value = 0; strokeVal.textContent = '0';
  color.value = '#0000FF'; colorHex.value = '#0000FF';
  fileInput.value = '';
  const ctxO = origCanvas.getContext('2d');
  ctxO.clearRect(0,0,origCanvas.width, origCanvas.height);
  const ctxOut = outCanvas.getContext('2d');
  ctxOut.clearRect(0,0,outCanvas.width, outCanvas.height);
  origImg = null; workW=0; workH=0; previewReady=false;
  alphaLoCanvas = document.createElement('canvas');
});

// Controls
thresh && thresh.addEventListener('input', ()=>{ threshVal.textContent = thresh.value; });
thresh && thresh.addEventListener('change', ()=>{});

const debouncedStroke = debounce(async ()=>{
  if(!origImg) return;
  const sPrev = parseFloat(stroke.value)||0;
  await previewMorphAsync(sPrev);
}, 80);

stroke.addEventListener('input', ()=>{
  strokeVal.textContent = stroke.value;
  strokeNum.value = stroke.value;
  debouncedStroke();
});
stroke.addEventListener('change', ()=>{
  strokeVal.textContent = stroke.value;
  strokeNum.value = stroke.value;
  debouncedStroke();
});
strokeNum.addEventListener('input', ()=>{
  const val = parseFloat(strokeNum.value);
  if(!isNaN(val) && val >= -5 && val <= 5){
    stroke.value = val;
    strokeVal.textContent = val.toString();
    debouncedStroke();
  }
});
strokeNum.addEventListener('change', ()=>{
  const val = parseFloat(strokeNum.value);
  if(!isNaN(val) && val >= -5 && val <= 5){
    stroke.value = val;
    strokeVal.textContent = val.toString();
    debouncedStroke();
  } else {
    strokeNum.value = stroke.value;
  }
});

function renderPreviewColorOnly(){
  if(previewReady && alphaLoCanvas.width && alphaLoCanvas.height){
    renderColorWithAlphaCanvas(alphaLoCanvas);
  }
}
color.addEventListener('change', ()=>{ colorHex.value = color.value; renderPreviewColorOnly(); });
colorHex.addEventListener('input', ()=>{
  const hex = colorHex.value.trim();
  if(/^#[0-9A-Fa-f]{6}$/.test(hex)){ color.value = hex; renderPreviewColorOnly(); }
});
colorHex.addEventListener('keydown', (e)=>{
  if(e.key === 'Enter'){
    const hex = colorHex.value.trim();
    if(/^#[0-9A-Fa-f]{6}$/.test(hex)){ color.value = hex; renderPreviewColorOnly(); }
    else { colorHex.value = color.value; }
  }
});
