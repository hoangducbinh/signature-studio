// ---------- DOM Ready & Controls ----------
document.addEventListener('DOMContentLoaded', initializeElements);
if (document.readyState !== 'loading') initializeElements();

function initializeElements() {
  const thresh = document.getElementById('thresh');
  const threshNum = document.getElementById('threshNum');
  const threshVal = document.getElementById('threshVal');
  
  if (!thresh || !threshNum || !threshVal) {
    console.error('Critical elements not found');
    return;
  }
  
  setupThresholdControls(thresh, threshNum, threshVal);
  setupDragDrop();
  showUploadPrompt(); // Initialize with upload prompt
}

function setupThresholdControls(thresh, threshNum, threshVal) {
  const debouncedThresh = debounce(async () => {
    if (!window.origImg) return;
    window.prepareWorkCanvas(window.origCanvas.width, window.origCanvas.height);
    await window.processAll();
  }, 150);

  const updateThreshold = () => {
    threshVal.textContent = thresh.value;
    threshNum.value = thresh.value;
    debouncedThresh();
  };

  thresh.addEventListener('input', updateThreshold);
  thresh.addEventListener('change', updateThreshold);

  threshNum.addEventListener('input', () => {
    const val = parseInt(threshNum.value);
    if (!isNaN(val) && val >= 0 && val <= 255) {
      thresh.value = val;
      updateThreshold();
    }
  });
  
  threshNum.addEventListener('change', () => {
    const val = parseInt(threshNum.value);
    if (!isNaN(val) && val >= 0 && val <= 255) {
      thresh.value = val;
      updateThreshold();
    } else {
      threshNum.value = thresh.value;
    }
  });
}

// ---------- Elements & Config ----------
const fileInput = document.getElementById('fileInput');
const mainCanvas = document.getElementById('mainCanvas');
const uploadPrompt = document.getElementById('uploadPrompt');
const canvasTitle = document.getElementById('canvasTitle');
const canvasControls = document.getElementById('canvasControls');
const showOriginalBtn = document.getElementById('showOriginal');
const showResultBtn = document.getElementById('showResult');
const exportBtn = document.getElementById('exportBtn');
const resetBtn = document.getElementById('resetBtn');
const thresh = document.getElementById('thresh');
const threshNum = document.getElementById('threshNum');
const threshVal = document.getElementById('threshVal');
const stroke = document.getElementById('stroke');
const strokeNum = document.getElementById('strokeNum');
const strokeVal = document.getElementById('strokeVal');
const color = document.getElementById('color');
const colorHex = document.getElementById('colorHex');
const loadingModal = document.getElementById('loadingModal');

const INTERNAL_SCALE = 4;
const MAX_DISPLAY_DIM = 2000;

// ---------- State ----------
let origImg = null;
let workW = 0, workH = 0;
const workCanvas = document.createElement('canvas');
const origCanvas = document.createElement('canvas');
const outCanvas = document.createElement('canvas');
let alphaLoCanvas = document.createElement('canvas');
let previewReady = false;
let currentView = 'result'; // 'original' or 'result'

// Expose globals
window.origImg = null;
window.origCanvas = origCanvas;
window.prepareWorkCanvas = prepareWorkCanvas;
window.processAll = processAll;

const showLoading = () => loadingModal.classList.remove('hidden');
const hideLoading = () => loadingModal.classList.add('hidden');

// ---------- View Management ----------
function showUploadPrompt() {
  uploadPrompt.classList.remove('hidden');
  mainCanvas.classList.add('hidden');
  canvasControls.classList.add('hidden');
  canvasTitle.textContent = 'Tải ảnh chữ ký';
}

function showCanvas() {
  uploadPrompt.classList.add('hidden');
  mainCanvas.classList.remove('hidden');
  canvasControls.classList.remove('hidden');
  updateCanvasView();
}

function updateCanvasView() {
  if (currentView === 'original') {
    // Copy from origCanvas to mainCanvas
    mainCanvas.width = origCanvas.width;
    mainCanvas.height = origCanvas.height;
    const ctx = mainCanvas.getContext('2d');
    ctx.clearRect(0, 0, mainCanvas.width, mainCanvas.height);
    ctx.drawImage(origCanvas, 0, 0);
    canvasTitle.textContent = 'Ảnh gốc';
    showOriginalBtn.classList.add('active');
    showResultBtn.classList.remove('active');
  } else {
    // Copy from outCanvas to mainCanvas
    mainCanvas.width = outCanvas.width;
    mainCanvas.height = outCanvas.height;
    const ctx = mainCanvas.getContext('2d');
    ctx.clearRect(0, 0, mainCanvas.width, mainCanvas.height);
    ctx.drawImage(outCanvas, 0, 0);
    canvasTitle.textContent = 'Kết quả (xem trước)';
    showResultBtn.classList.add('active');
    showOriginalBtn.classList.remove('active');
  }
}

// ---------- Drag & Drop ----------
function setupDragDrop() {
  const canvasBody = document.querySelector('.canvas-body');
  
  ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
    canvasBody.addEventListener(eventName, preventDefaults, false);
  });

  function preventDefaults(e) {
    e.preventDefault();
    e.stopPropagation();
  }

  ['dragenter', 'dragover'].forEach(eventName => {
    canvasBody.addEventListener(eventName, () => {
      canvasBody.style.background = 'rgba(59, 130, 246, 0.1)';
    }, false);
  });

  ['dragleave', 'drop'].forEach(eventName => {
    canvasBody.addEventListener(eventName, () => {
      canvasBody.style.background = '';
    }, false);
  });

  canvasBody.addEventListener('drop', handleDrop, false);

  function handleDrop(e) {
    const dt = e.dataTransfer;
    const files = dt.files;
    if (files.length > 0) {
      handleFile(files[0]);
    }
  }
}

// ---------- Helpers ----------
function drawImageToCanvas(img, canvas, maxDim = MAX_DISPLAY_DIM) {
  const ratio = Math.min(maxDim / img.width, maxDim / img.height, 1);
  const w = Math.round(img.width * ratio);
  const h = Math.round(img.height * ratio);
  
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, w, h);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, w, h);
  
  return { w, h };
}

function prepareWorkCanvas(displayW, displayH) {
  workW = displayW * INTERNAL_SCALE;
  workH = displayH * INTERNAL_SCALE;
  workCanvas.width = workW;
  workCanvas.height = workH;
  
  const wctx = workCanvas.getContext('2d', { willReadFrequently: true });
  wctx.imageSmoothingEnabled = true;
  wctx.imageSmoothingQuality = 'high';
  wctx.drawImage(origCanvas, 0, 0, workW, workH);
}

function debounce(fn, ms = 80) {
  let timeout;
  return (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => fn(...args), ms);
  };
}

// ---------- Worker (SDF) ----------
const workerCode = `
// Version: 2.0 - Debug threshold
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

// Cải tiến: Phân tích histogram để tìm background và foreground
function analyzeHistogram(gray) {
  const hist = new Uint32Array(256);
  for(let i = 0; i < gray.length; i++) {
    hist[gray[i]]++;
  }
  
  // Tìm peak của background (vùng sáng)
  let maxCount = 0, backgroundPeak = 240;
  for(let i = 180; i < 256; i++) {
    if(hist[i] > maxCount) {
      maxCount = hist[i];
      backgroundPeak = i;
    }
  }
  
  // Tìm peak của foreground (vùng tối)
  let foregroundPeak = 50;
  let maxFgCount = 0;
  for(let i = 20; i < 120; i++) {
    if(hist[i] > maxFgCount) {
      maxFgCount = hist[i];
      foregroundPeak = i;
    }
  }
  
  // Tìm valley giữa 2 peak
  let valley = Math.round((backgroundPeak + foregroundPeak) / 2);
  let minCount = Math.max(maxCount, maxFgCount);
  const searchStart = Math.min(backgroundPeak, foregroundPeak + 30);
  const searchEnd = Math.max(foregroundPeak, backgroundPeak - 30);
  
  for(let i = searchStart; i >= searchEnd; i--) {
    if(hist[i] < minCount) {
      minCount = hist[i];
      valley = i;
    }
  }
  
  return { backgroundPeak, foregroundPeak, valley, histogram: hist };
}

function improvedThreshold(gray) {
  const analysis = analyzeHistogram(gray);
  let threshold = analysis.valley;
  
  // Tính tỷ lệ pixel tối
  const total = gray.length;
  let darkPixels = 0;
  for(let i = 0; i <= threshold; i++) {
    darkPixels += analysis.histogram[i];
  }
  const darkRatio = darkPixels / total;
  
  // Điều chỉnh threshold dựa trên tỷ lệ
  if (darkRatio > 0.25) {
    threshold = Math.min(threshold + 15, analysis.backgroundPeak - 20);
  } else if (darkRatio < 0.02) {
    threshold = Math.max(threshold - 15, analysis.foregroundPeak + 20);
  }
  
  return Math.max(40, Math.min(200, threshold));
}

function makeSoftMask(gray, threshold, feather = 8) {
  const len = gray.length;
  const alpha = new Uint8ClampedArray(len);
  const tLo = threshold - feather;
  const tHi = threshold + feather;
  
  for (let i = 0; i < len; i++) {
    const g = gray[i];
    let a = 0;
    
    if (g <= tLo) {
      a = 255; // Foreground
    } else if (g >= tHi) {
      a = 0;   // Background
    } else {
      // Smooth transition
      const t = (g - tLo) / (tHi - tLo);
      a = Math.round(255 * (1 - t * t * (3 - 2 * t)));
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
function binarizeFromAlpha(alpha, threshold = 128){
  const out = new Uint8Array(alpha.length);
  for(let i = 0; i < alpha.length; i++) {
    out[i] = alpha[i] > threshold ? 1 : 0;
  }
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
    const {imgData, width, height, pvW, pvH, customThreshold} = e.data;
    workW = width; workH = height;
    previewW = pvW; previewH = pvH;

    const gray = toGray(imgData.data);
    
    // Sử dụng threshold từ UI hoặc thuật toán tự động
    const t = customThreshold !== undefined ? customThreshold : improvedThreshold(gray);
    
    // Tạo alpha mask đơn giản
    const feather = Math.max(4, Math.min(12, Math.sqrt(workW * workH) / 200));
    let alpha = makeSoftMask(gray, t, feather);
    
    // Blur nhẹ
    const blurRadius = Math.max(1, Math.floor(Math.sqrt(workW * workH) / 1000));
    alpha = blurAlphaBox(alpha, workW, workH, blurRadius);
    
    baseAlphaHi = alpha;
    
    // Binary mask đơn giản - không lọc noise
    binHi = binarizeFromAlpha(alpha, 128);
    
    // SDF preview
    const binPv = downscaleBin(binHi, workW, workH, previewW, previewH);
    const dInSq = edt2d(binPv, previewW, previewH);
    const invPv = new Uint8Array(binPv.length);
    for(let i = 0; i < binPv.length; i++) {
      invPv[i] = binPv[i] ? 0 : 1;
    }
    const dOutSq = edt2d(invPv, previewW, previewH);
    sdfPreview = new Float32Array(binPv.length);
    for(let i = 0; i < binPv.length; i++){
      const inD = Math.sqrt(dInSq[i]);
      const outD = Math.sqrt(dOutSq[i]);
      sdfPreview[i] = outD - inD;
    }
    
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
function renderColorWithAlphaCanvas(alphaCanvas) {
  if (!previewReady || !alphaCanvas.width || !alphaCanvas.height) return;
  
  const ctx = outCanvas.getContext('2d');
  ctx.globalCompositeOperation = 'source-over';
  ctx.clearRect(0, 0, outCanvas.width, outCanvas.height);
  ctx.fillStyle = color.value || '#000000';
  ctx.fillRect(0, 0, outCanvas.width, outCanvas.height);
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(alphaCanvas, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  
  // Update main canvas if showing result
  if (currentView === 'result') {
    updateCanvasView();
  }
}

function rebuildPreviewCanvasFromMask(mask, w, h) {
  previewReady = false;
  outCanvas.width = w;
  outCanvas.height = h;
  alphaLoCanvas.width = w;
  alphaLoCanvas.height = h;

  const actx = alphaLoCanvas.getContext('2d', { willReadFrequently: true });
  const img = actx.createImageData(w, h);
  
  for (let i = 0, j = 0; i < img.data.length; i += 4, j++) {
    img.data[i] = img.data[i + 1] = img.data[i + 2] = 0;
    img.data[i + 3] = mask[j];
  }
  
  actx.putImageData(img, 0, 0);
  previewReady = true;
  renderColorWithAlphaCanvas(alphaLoCanvas);
}

// ---------- Build & Process ----------
async function buildBaseAsync() {
  const wctx = workCanvas.getContext('2d', { willReadFrequently: true });
  const imgData = wctx.getImageData(0, 0, workW, workH);
  const pvW = Math.round(workW / INTERNAL_SCALE);
  const pvH = Math.round(workH / INTERNAL_SCALE);
  const customThreshold = thresh?.value ? parseInt(thresh.value) : undefined;

  return new Promise((resolve) => {
    const onMsg = (e) => {
      if (e.data?.type === 'baseDone') {
        worker.removeEventListener('message', onMsg);
        resolve(e.data);
      }
    };
    
    worker.addEventListener('message', onMsg);
    worker.postMessage({
      type: 'buildBase',
      imgData,
      width: workW,
      height: workH,
      pvW,
      pvH,
      customThreshold
    });
  });
}

async function previewMorphAsync(strokePrevPx) {
  return new Promise((resolve) => {
    const onMsg = (e) => {
      if (e.data?.type === 'previewMask') {
        worker.removeEventListener('message', onMsg);
        const mask = new Uint8ClampedArray(e.data.mask);
        rebuildPreviewCanvasFromMask(mask, e.data.w, e.data.h);
        resolve();
      }
    };
    
    worker.addEventListener('message', onMsg);
    worker.postMessage({ type: 'previewMorph', strokePrevPx });
  });
}

async function processAll() {
  if (!origImg) {
    alert('Hãy tải ảnh chữ ký trước đã nhé!');
    return;
  }
  
  window.origImg = origImg;
  previewReady = false;
  showLoading();
  
  try {
    await buildBaseAsync();
    const sPrev = parseFloat(stroke.value) || 0;
    await previewMorphAsync(sPrev);
  } catch (err) {
    console.error(err);
    alert('Có lỗi khi xử lý ảnh.');
  } finally {
    hideLoading();
  }
}

// ---------- Export ----------
async function exportHiResMaskAsync(strokeHiPx) {
  return new Promise((resolve) => {
    const onMsg = (e) => {
      if (e.data?.type === 'exportMaskDone') {
        worker.removeEventListener('message', onMsg);
        resolve({ mask: new Uint8ClampedArray(e.data.mask), w: e.data.w, h: e.data.h });
      }
    };
    
    worker.addEventListener('message', onMsg);
    worker.postMessage({ type: 'exportMask', strokeHiPx });
  });
}

async function exportPng() {
  if (!origImg) {
    alert('Chưa có kết quả để xuất.');
    return;
  }
  
  showLoading();
  
  try {
    const strokeHiPx = Math.round((parseFloat(stroke.value) || 0) * INTERNAL_SCALE);
    const { mask, w, h } = await exportHiResMaskAsync(strokeHiPx);

    // Tạo alpha canvas hi-res
    const hiAlpha = document.createElement('canvas');
    hiAlpha.width = w;
    hiAlpha.height = h;
    const hctx = hiAlpha.getContext('2d', { willReadFrequently: true });
    const img = hctx.createImageData(w, h);

    for (let i = 0; i < mask.length; i++) {
      const idx = i * 4;
      img.data[idx] = img.data[idx + 1] = img.data[idx + 2] = 0;
      img.data[idx + 3] = mask[i];
    }
    hctx.putImageData(img, 0, 0);

    // Downscale về kích thước gốc
    const outW = origCanvas.width;
    const outH = origCanvas.height;
    const alphaOut = document.createElement('canvas');
    alphaOut.width = outW;
    alphaOut.height = outH;
    const actx = alphaOut.getContext('2d', { willReadFrequently: true });
    actx.imageSmoothingEnabled = true;
    actx.imageSmoothingQuality = 'high';
    actx.drawImage(hiAlpha, 0, 0, outW, outH);

    // Tạo ảnh cuối cùng
    const final = document.createElement('canvas');
    final.width = outW;
    final.height = outH;
    const fctx = final.getContext('2d', { willReadFrequently: true });
    fctx.clearRect(0, 0, outW, outH);
    fctx.fillStyle = color.value || '#000000';
    fctx.fillRect(0, 0, outW, outH);
    fctx.globalCompositeOperation = 'destination-in';
    fctx.drawImage(alphaOut, 0, 0);

    const url = final.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = url;
    a.download = 'signature.png';
    a.click();

  } catch (e) {
    console.error(e);
    alert('Lỗi khi xuất PNG.');
  } finally {
    hideLoading();
  }
}

// Download button alternative for main canvas
function downloadMainCanvas() {
  if (!origImg) {
    alert('Chưa có ảnh để tải');
    return;
  }
  
  const link = document.createElement('a');
  link.download = 'signature-processed.png';
  link.href = mainCanvas.toDataURL();
  link.click();
}

// ---------- Process flow ----------
async function processAll() {
  if (!origImg) {
    alert('Hãy tải ảnh chữ ký trước đã nhé!');
    return;
  }
  
  window.origImg = origImg;
  previewReady = false;
  showLoading();
  
  try {
    await buildBaseAsync();
    const sPrev = parseFloat(stroke.value) || 0;
    await previewMorphAsync(sPrev);
  } catch (err) {
    console.error(err);
    alert('Có lỗi khi xử lý ảnh.');
  } finally {
    hideLoading();
  }
}

// ---------- Event Handlers ----------
function handleFile(file) {
  if (!file) return;

  showLoading();

  loadImage(file).then(async (img) => {
    const { w, h } = drawImageToCanvas(img, origCanvas);
    
    origImg = img;
    window.origImg = origImg;
    prepareWorkCanvas(w, h);

    // Show canvas and switch to result view
    currentView = 'result';
    showCanvas();

    await processAll();
    showSettingsPanel();

  }).catch(error => {
    console.error('Error loading image:', error);
    alert('Không mở được ảnh. Hãy thử file .jpg/.png/.webp khác');
  }).finally(() => {
    hideLoading();
  });
}

fileInput.addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  handleFile(file);
});

async function loadImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();
    
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Không tải được ảnh'));
    reader.onload = (e) => { img.src = e.target.result; };
    reader.readAsDataURL(file);
  });
}

// Canvas view controls
showOriginalBtn.addEventListener('click', () => {
  currentView = 'original';
  updateCanvasView();
});

showResultBtn.addEventListener('click', () => {
  currentView = 'result';
  updateCanvasView();
});

function showSettingsPanel() {
  // Deactivate all nav buttons
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  
  // Activate settings button
  const settingsBtn = document.querySelector('[data-target="settings"]');
  if(settingsBtn) {
    settingsBtn.classList.add('active');
  }
  
  // Hide all panels
  document.querySelectorAll('.panel').forEach(p => p.classList.add('hidden'));
  
  // Show settings panel
  const settingsPanel = document.getElementById('panel-settings');
  if(settingsPanel) {
    settingsPanel.classList.remove('hidden');
  }
}

// Remove unused status functions
function updateCanvasStatus() {}
function clearCanvasStatus() {}

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

// ---------- Settings Panel Controls ----------
// Process button removed - auto processing on file load
exportBtn.addEventListener('click', exportPng);

resetBtn.addEventListener('click', () => {
  // Reset all controls
  thresh && (thresh.value = 128);
  threshNum && (threshNum.value = 128);
  threshVal && (threshVal.textContent = '128');
  stroke.value = 0; 
  strokeNum.value = 0; 
  strokeVal.textContent = '0';
  color.value = '#0000FF'; 
  colorHex.value = '#0000FF';
  fileInput.value = '';
  
  // Clear canvases
  const ctxO = origCanvas.getContext('2d');
  ctxO.clearRect(0, 0, origCanvas.width, origCanvas.height);
  const ctxOut = outCanvas.getContext('2d');
  ctxOut.clearRect(0, 0, outCanvas.width, outCanvas.height);
  const ctxMain = mainCanvas.getContext('2d');
  ctxMain.clearRect(0, 0, mainCanvas.width, mainCanvas.height);
  
  // Reset state
  origImg = null; 
  workW = 0; 
  workH = 0; 
  previewReady = false;
  currentView = 'result';
  alphaLoCanvas = document.createElement('canvas');
  window.origImg = null;
  
  // Show upload prompt
  showUploadPrompt();
  
  // Switch back to upload panel
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.querySelector('[data-target="upload"]').classList.add('active');
  document.querySelectorAll('.panel').forEach(p => p.classList.add('hidden'));
  document.getElementById('panel-upload').classList.remove('hidden');
});

// Thickness controls with debouncing
const debouncedStroke = debounce(async () => {
  if (!origImg) return;
  const sPrev = parseFloat(stroke.value) || 0;
  await previewMorphAsync(sPrev);
}, 80);

stroke.addEventListener('input', () => {
  strokeVal.textContent = stroke.value;
  strokeNum.value = stroke.value;
  debouncedStroke();
});

stroke.addEventListener('change', () => {
  strokeVal.textContent = stroke.value;
  strokeNum.value = stroke.value;
  debouncedStroke();
});

strokeNum.addEventListener('input', () => {
  const val = parseFloat(strokeNum.value);
  if (!isNaN(val) && val >= -5 && val <= 5) {
    stroke.value = val;
    strokeVal.textContent = val.toString();
    debouncedStroke();
  }
});

strokeNum.addEventListener('change', () => {
  const val = parseFloat(strokeNum.value);
  if (!isNaN(val) && val >= -5 && val <= 5) {
    stroke.value = val;
    strokeVal.textContent = val.toString();
    debouncedStroke();
  } else {
    strokeNum.value = stroke.value;
  }
});

// Color controls
function renderPreviewColorOnly() {
  if (previewReady && alphaLoCanvas.width && alphaLoCanvas.height) {
    renderColorWithAlphaCanvas(alphaLoCanvas);
  }
}

color.addEventListener('change', () => { 
  colorHex.value = color.value; 
  renderPreviewColorOnly(); 
});

colorHex.addEventListener('input', () => {
  const hex = colorHex.value.trim();
  if (/^#[0-9A-Fa-f]{6}$/.test(hex)) { 
    color.value = hex; 
    renderPreviewColorOnly(); 
  }
});

colorHex.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const hex = colorHex.value.trim();
    if (/^#[0-9A-Fa-f]{6}$/.test(hex)) { 
      color.value = hex; 
      renderPreviewColorOnly(); 
    } else { 
      colorHex.value = color.value; 
    }
  }
});
