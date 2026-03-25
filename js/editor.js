/**
 * editor.js — Canvas-based Image Editor
 * Supports: rotate, brightness, contrast, grayscale, crop
 */

let editorImg = new Image();
let editorState = {
  rotation: 0,
  brightness: 100,
  contrast: 100,
  grayscale: 0,
  cropMode: false,
  crop: null,
};
let cropStart = null, cropBox = { x:0, y:0, w:0, h:0 };

// ─── Load image into canvas ─────────────────────────────────
function loadImageToEditor(idx) {
  const canvas = document.getElementById('editor-canvas');
  if (!canvas) return;
  const img = window.ScanApp.images[idx];
  if (!img) return;
  window.ScanApp.currentIdx = idx;
  editorState = { rotation:0, brightness:100, contrast:100, grayscale:0, cropMode:false, crop:null };
  updateSliders();
  editorImg = new Image();
  editorImg.onload = () => renderCanvas();
  editorImg.src = img.dataUrl;
}

function renderCanvas() {
  const canvas = document.getElementById('editor-canvas');
  if (!canvas || !editorImg.src) return;
  const ctx = canvas.getContext('2d');
  const rot = editorState.rotation;
  const swapped = rot === 90 || rot === 270;
  const w = swapped ? editorImg.naturalHeight : editorImg.naturalWidth;
  const h = swapped ? editorImg.naturalWidth  : editorImg.naturalHeight;

  // Fit inside 100% width / 60vh
  const wrapW = canvas.parentElement.clientWidth - 40;
  const wrapH = window.innerHeight * 0.55;
  const scale = Math.min(wrapW / w, wrapH / h, 1);

  canvas.width  = w * scale;
  canvas.height = h * scale;
  ctx.save();
  ctx.translate(canvas.width/2, canvas.height/2);
  ctx.rotate((rot * Math.PI) / 180);
  ctx.filter = [
    `brightness(${editorState.brightness}%)`,
    `contrast(${editorState.contrast}%)`,
    `grayscale(${editorState.grayscale}%)`,
  ].join(' ');
  const dw = swapped ? editorImg.naturalHeight * scale : editorImg.naturalWidth  * scale;
  const dh = swapped ? editorImg.naturalWidth  * scale : editorImg.naturalHeight * scale;
  ctx.drawImage(editorImg, -dw/2, -dh/2, dw, dh);
  ctx.restore();
}

// ─── Tool Buttons ───────────────────────────────────────────
function rotateLeft() {
  editorState.rotation = ((editorState.rotation - 90) + 360) % 360;
  renderCanvas(); applyToCurrentImage();
}
function rotateRight() {
  editorState.rotation = (editorState.rotation + 90) % 360;
  renderCanvas(); applyToCurrentImage();
}
function resetEdits() {
  editorState = { rotation:0, brightness:100, contrast:100, grayscale:0, cropMode:false, crop:null };
  updateSliders(); renderCanvas();
}

function setToolActive(el) {
  document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
  if (el) el.classList.add('active');
}

function toggleCropMode(btn) {
  editorState.cropMode = !editorState.cropMode;
  const overlay = document.getElementById('crop-overlay');
  if (overlay) overlay.classList.toggle('active', editorState.cropMode);
  if (btn) btn.classList.toggle('active', editorState.cropMode);
  if (!editorState.cropMode) setCropBoxVisual(null);
}

function applyCrop() {
  if (!editorState.cropMode || !cropBox.w || !cropBox.h) { toast('크롭 영역을 선택해주세요', 'error'); return; }
  const canvas = document.getElementById('editor-canvas');
  const box = document.querySelector('.crop-box');
  if (!canvas || !box) return;
  const cx = canvas.getBoundingClientRect();
  const rx = box.offsetLeft / canvas.width;
  const ry = box.offsetTop  / canvas.height;
  const rw = cropBox.w      / canvas.width;
  const rh = cropBox.h      / canvas.height;
  const iw = editorImg.naturalWidth, ih = editorImg.naturalHeight;
  const tmp = document.createElement('canvas');
  tmp.width  = rw * iw; tmp.height = rh * ih;
  tmp.getContext('2d').drawImage(editorImg, rx*iw, ry*ih, rw*iw, rh*ih, 0, 0, tmp.width, tmp.height);
  const dataUrl = tmp.toDataURL('image/jpeg', 0.95);
  window.ScanApp.images[window.ScanApp.currentIdx].dataUrl = dataUrl;
  editorImg.src = dataUrl;
  editorImg.onload = () => renderCanvas();
  toggleCropMode(null);
  toast('크롭 완료!', 'success');
}

// ─── Sliders ────────────────────────────────────────────────
function updateSliders() {
  setSlider('brightness-val', 'brightness-slider', editorState.brightness);
  setSlider('contrast-val',   'contrast-slider',   editorState.contrast);
  setSlider('grayscale-val',  'grayscale-slider',  editorState.grayscale);
}
function setSlider(valId, sliderId, value) {
  const v = document.getElementById(valId);
  const s = document.getElementById(sliderId);
  if (v) v.textContent = value;
  if (s) s.value = value;
}

function onSliderChange(type, val) {
  editorState[type] = parseInt(val);
  document.getElementById(type + '-val').textContent = val;
  renderCanvas();
}
window.onSliderChange = onSliderChange;

// ─── Apply edits: bake canvas back into image array ─────────
function applyToCurrentImage() {
  const canvas = document.getElementById('editor-canvas');
  if (!canvas) return;
  const dataUrl = canvas.toDataURL('image/jpeg', 0.95);
  if (window.ScanApp.images[window.ScanApp.currentIdx]) {
    window.ScanApp.images[window.ScanApp.currentIdx].dataUrl = dataUrl;
  }
  refreshImageStrip();
}
function applyEdits() {
  applyToCurrentImage();
  toast('편집이 적용되었습니다', 'success');
}

// ─── Crop Touch/Mouse Handling ────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const canvas  = document.getElementById('editor-canvas');
  const overlay = document.getElementById('crop-overlay');
  if (!canvas || !overlay) return;

  function getPos(e) {
    const rect = canvas.getBoundingClientRect();
    const src  = e.touches ? e.touches[0] : e;
    return { x: src.clientX - rect.left, y: src.clientY - rect.top };
  }
  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

  overlay.addEventListener('mousedown',  startCrop);
  overlay.addEventListener('touchstart', startCrop, { passive: false });

  function startCrop(e) {
    if (!editorState.cropMode) return;
    e.preventDefault();
    const pos = getPos(e);
    const rect = canvas.getBoundingClientRect();
    cropStart = {
      x: clamp(pos.x, 0, rect.width),
      y: clamp(pos.y, 0, rect.height)
    };
  }
  function moveCrop(e) {
    if (!cropStart || !editorState.cropMode) return;
    e.preventDefault();
    const pos = getPos(e);
    const rect = canvas.getBoundingClientRect();
    const x = clamp(Math.min(pos.x, cropStart.x), 0, rect.width);
    const y = clamp(Math.min(pos.y, cropStart.y), 0, rect.height);
    const w = clamp(Math.abs(pos.x - cropStart.x), 0, rect.width  - x);
    const h = clamp(Math.abs(pos.y - cropStart.y), 0, rect.height - y);
    cropBox = { x, y, w, h };
    setCropBoxVisual({ x, y, w, h });
  }
  function endCrop() { cropStart = null; }

  overlay.addEventListener('mousemove',  moveCrop);
  overlay.addEventListener('touchmove',  moveCrop, { passive: false });
  overlay.addEventListener('mouseup',    endCrop);
  overlay.addEventListener('touchend',   endCrop);
});

function setCropBoxVisual(box) {
  let el = document.querySelector('.crop-box');
  const overlay = document.getElementById('crop-overlay');
  if (!overlay) return;
  if (!box) { if (el) el.remove(); return; }
  if (!el) {
    el = document.createElement('div');
    el.className = 'crop-box';
    overlay.appendChild(el);
  }
  el.style.left   = box.x + 'px';
  el.style.top    = box.y + 'px';
  el.style.width  = box.w + 'px';
  el.style.height = box.h + 'px';
}

// ─── Image Preprocessing for OCR ────────────────────────────
function preprocessForOCR(dataUrl) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      // Upscale to at least 2000px wide for OCR
      const scale = Math.max(1, 2000 / img.naturalWidth);
      canvas.width  = img.naturalWidth  * scale;
      canvas.height = img.naturalHeight * scale;
      const ctx = canvas.getContext('2d');
      ctx.filter = 'grayscale(100%) contrast(150%) brightness(110%)';
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      // Simple binarization
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const d = imageData.data;
      for (let i = 0; i < d.length; i += 4) {
        const gray = 0.299*d[i] + 0.587*d[i+1] + 0.114*d[i+2];
        const val  = gray > 128 ? 255 : 0;
        d[i] = d[i+1] = d[i+2] = val;
      }
      ctx.putImageData(imageData, 0, 0);
      resolve(canvas.toDataURL('image/png'));
    };
    img.src = dataUrl;
  });
}
window.preprocessForOCR = preprocessForOCR;

// ─── Export ──────────────────────────────────────────────────
window.loadImageToEditor = loadImageToEditor;
window.rotateLeft  = rotateLeft;
window.rotateRight = rotateRight;
window.resetEdits  = resetEdits;
window.toggleCropMode = toggleCropMode;
window.applyCrop   = applyCrop;
window.applyEdits  = applyEdits;
window.setToolActive = setToolActive;
