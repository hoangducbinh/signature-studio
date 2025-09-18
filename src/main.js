// ---------- DOM Ready & Controls ----------
document.addEventListener('DOMContentLoaded', initializeElements);
if (document.readyState !== 'loading') initializeElements();

function initializeElements() {
  const thresh = document.getElementById('thresh');
  const threshNum = document.getElementById('threshNum');
  
  if (!thresh || !threshNum) {
    console.error('Critical elements not found');
    return;
  }
  
  setupThresholdControls(thresh, threshNum);
  setupDragDrop();
  showUploadPrompt(); // Initialize with upload prompt
}

function setupThresholdControls(thresh, threshNum) {
  const debouncedThresh = debounce(async () => {
    if (!window.origImg) return;
    window.prepareWorkCanvas(window.origCanvas.width, window.origCanvas.height);
    await window.processAll();
  }, 150);

  const updateThreshold = () => {
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
const stroke = document.getElementById('stroke');
const strokeNum = document.getElementById('strokeNum');
const color = document.getElementById('color');
const colorHex = document.getElementById('colorHex');
const loadingModal = document.getElementById('loadingModal');

const INTERNAL_SCALE = 4;
// Bỏ MAX_DISPLAY_DIM - hiển thị ảnh gốc 100%

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
    canvasTitle.textContent = 'Kết quả';
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
function drawImageToCanvas(img, canvas) {
  // Hiển thị ảnh với kích thước gốc 100% - không scale gì cả
  const w = img.width;
  const h = img.height;
  
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
// Sử dụng file worker riêng biệt để tránh CSP issues trên GitHub Pages
let worker;
try {
  worker = new Worker('./src/worker.js');
} catch (error) {
  console.error('Worker creation failed:', error);
  // Fallback for CSP issues
  try {
    worker = new Worker('./worker.js');
  } catch (error2) {
    console.error('Worker fallback failed:', error2);
    alert('Không thể khởi tạo Web Worker. Vui lòng thử refresh trang.');
  }
}

// Add error handling for worker
if (worker) {
  worker.addEventListener('error', (error) => {
    console.error('Worker error:', error);
    hideLoading();
    alert('Có lỗi xảy ra khi xử lý ảnh. Vui lòng thử lại.');
  });
}

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
  if (!worker) {
    throw new Error('Worker not available');
  }
  
  const wctx = workCanvas.getContext('2d', { willReadFrequently: true });
  const imgData = wctx.getImageData(0, 0, workW, workH);
  const pvW = Math.round(workW / INTERNAL_SCALE);
  const pvH = Math.round(workH / INTERNAL_SCALE);
  const customThreshold = thresh?.value ? parseInt(thresh.value) : undefined;

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Worker timeout'));
    }, 30000); // 30 second timeout
    
    const onMsg = (e) => {
      if (e.data?.type === 'baseDone') {
        worker.removeEventListener('message', onMsg);
        clearTimeout(timeout);
        resolve(e.data);
      } else if (e.data?.type === 'error') {
        worker.removeEventListener('message', onMsg);
        clearTimeout(timeout);
        reject(new Error(e.data.message));
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
  if (!worker) {
    throw new Error('Worker not available');
  }
  
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Worker timeout'));
    }, 15000); // 15 second timeout
    
    const onMsg = (e) => {
      if (e.data?.type === 'previewMask') {
        worker.removeEventListener('message', onMsg);
        clearTimeout(timeout);
        const mask = new Uint8ClampedArray(e.data.mask);
        rebuildPreviewCanvasFromMask(mask, e.data.w, e.data.h);
        resolve();
      } else if (e.data?.type === 'error') {
        worker.removeEventListener('message', onMsg);
        clearTimeout(timeout);
        reject(new Error(e.data.message));
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
  if (!worker) {
    throw new Error('Worker not available');
  }
  
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Worker timeout'));
    }, 30000); // 30 second timeout
    
    const onMsg = (e) => {
      if (e.data?.type === 'exportMaskDone') {
        worker.removeEventListener('message', onMsg);
        clearTimeout(timeout);
        resolve({ mask: new Uint8ClampedArray(e.data.mask), w: e.data.w, h: e.data.h });
      } else if (e.data?.type === 'error') {
        worker.removeEventListener('message', onMsg);
        clearTimeout(timeout);
        reject(new Error(e.data.message));
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
  stroke.value = 0; 
  strokeNum.value = 0; 
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
  strokeNum.value = stroke.value;
  debouncedStroke();
});

stroke.addEventListener('change', () => {
  strokeNum.value = stroke.value;
  debouncedStroke();
});

strokeNum.addEventListener('input', () => {
  const val = parseFloat(strokeNum.value);
  if (!isNaN(val) && val >= -5 && val <= 5) {
    stroke.value = val;
    debouncedStroke();
  }
});

strokeNum.addEventListener('change', () => {
  const val = parseFloat(strokeNum.value);
  if (!isNaN(val) && val >= -5 && val <= 5) {
    stroke.value = val;
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
