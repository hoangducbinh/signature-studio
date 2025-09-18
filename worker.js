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