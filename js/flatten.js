/**
 * flatten.js — Document Dewarping / Perspective Flattening
 *
 * Features:
 *  - Auto-detect 4 document corners (brightness edge analysis)
 *  - 4-point draggable corner UI on canvas overlay
 *  - Homography (perspective) transform → flat document
 *  - Adaptive white-balance + background removal post-process
 *  - Integrates with editor.js: replaces current canvas image
 */

// ─── State ────────────────────────────────────────────────────
let flattenMode   = false;
let flatCorners   = [];          // [{x,y} × 4] in canvas display coords
let dragIdx       = -1;          // which corner is being dragged
let flatOverlay   = null;        // the overlay canvas element
let flatOriginal  = null;        // original ImageData before flatten
let flatSourceImg = null;        // original full-res Image for transform

// ─── Entry Point ─────────────────────────────────────────────
function enterFlattenMode() {
  const canvas = document.getElementById('editor-canvas');
  if (!canvas || canvas.width === 0) { toast('먼저 이미지를 불러오세요', 'error'); return; }

  flattenMode   = true;
  flatSourceImg = null;

  // Save current canvas as source
  const tmpCanvas = document.createElement('canvas');
  tmpCanvas.width  = canvas.width;
  tmpCanvas.height = canvas.height;
  tmpCanvas.getContext('2d').drawImage(canvas, 0, 0);
  flatOriginal = tmpCanvas;

  // Auto-detect document corners
  flatCorners = autoDetectCorners(canvas);

  // Build the overlay for draggable corners
  buildFlattenOverlay(canvas);
  updateFlattenOverlay();

  // Show flatten toolbar
  document.getElementById('flatten-toolbar').style.display = 'flex';
  document.getElementById('editor-tools').style.display    = 'none';
  document.getElementById('editor-sliders').style.display  = 'none';
  const act = document.getElementById('editor-sliders-actions');
  if (act) act.style.display = 'none';
  toast('네 꼭짓점을 문서 모서리에 맞게 조정하세요', 'info');
}

function exitFlattenMode(apply) {
  if (apply) applyFlattenTransform();
  flattenMode = false;
  removeFlattenOverlay();
  document.getElementById('flatten-toolbar').style.display = 'none';
  document.getElementById('editor-tools').style.display    = '';
  document.getElementById('editor-sliders').style.display  = '';
  const act = document.getElementById('editor-sliders-actions');
  if (act) act.style.display = '';
}

// ─── Auto Corner Detection ────────────────────────────────────
function autoDetectCorners(canvas) {
  const W = canvas.width, H = canvas.height;
  const ctx = canvas.getContext('2d');
  const data = ctx.getImageData(0, 0, W, H).data;

  // Scan from each edge inward until we hit a bright pixel (avg > 160)
  const isBright = (x, y) => {
    const i = (y * W + x) * 4;
    return (data[i] + data[i+1] + data[i+2]) / 3 > 155;
  };

  // Find top-left: scan from TL diagonally
  let tl = { x: Math.round(W*0.05), y: Math.round(H*0.05) };
  let tr = { x: Math.round(W*0.95), y: Math.round(H*0.05) };
  let br = { x: Math.round(W*0.95), y: Math.round(H*0.95) };
  let bl = { x: Math.round(W*0.05), y: Math.round(H*0.95) };

  // Scan top edge → TL
  outer: for (let y = 0; y < H/2; y++) {
    for (let x = 0; x < W/2; x++) {
      if (isBright(x, y)) { tl = { x, y }; break outer; }
    }
  }
  // Scan top edge → TR
  outer2: for (let y = 0; y < H/2; y++) {
    for (let x = W-1; x >= W/2; x--) {
      if (isBright(x, y)) { tr = { x, y }; break outer2; }
    }
  }
  // Bottom-left
  outer3: for (let y = H-1; y >= H/2; y--) {
    for (let x = 0; x < W/2; x++) {
      if (isBright(x, y)) { bl = { x, y }; break outer3; }
    }
  }
  // Bottom-right
  outer4: for (let y = H-1; y >= H/2; y--) {
    for (let x = W-1; x >= W/2; x--) {
      if (isBright(x, y)) { br = { x, y }; break outer4; }
    }
  }

  return [tl, tr, br, bl]; // TL, TR, BR, BL order
}

// ─── Overlay Canvas for Draggable Corners ────────────────────
function buildFlattenOverlay(refCanvas) {
  removeFlattenOverlay();
  const wrap = refCanvas.parentElement;
  const oc = document.createElement('canvas');
  oc.id = 'flatten-overlay';
  oc.style.cssText = `
    position:absolute;inset:0;width:100%;height:100%;
    z-index:50;touch-action:none;cursor:crosshair;
  `;
  wrap.appendChild(oc);
  flatOverlay = oc;

  // Resize overlay to match display
  const ro = new ResizeObserver(() => {
    oc.width  = oc.offsetWidth;
    oc.height = oc.offsetHeight;
    updateFlattenOverlay();
  });
  ro.observe(oc);
  oc.width  = oc.offsetWidth  || refCanvas.clientWidth;
  oc.height = oc.offsetHeight || refCanvas.clientHeight;

  // Mouse/Touch events
  const getPos = (e) => {
    const r = oc.getBoundingClientRect();
    const cl = e.touches ? e.touches[0] : e;
    return { x: cl.clientX - r.left, y: cl.clientY - r.top };
  };
  const onDown = (e) => {
    e.preventDefault();
    const p = getPos(e);
    dragIdx = -1;
    let minD = 40; // px threshold
    const scaleX = oc.width  / flatOriginal.width;
    const scaleY = oc.height / flatOriginal.height;
    flatCorners.forEach((c, i) => {
      const d = Math.hypot(c.x * scaleX - p.x, c.y * scaleY - p.y);
      if (d < minD) { minD = d; dragIdx = i; }
    });
  };
  const onMove = (e) => {
    if (dragIdx < 0) return;
    e.preventDefault();
    const p = getPos(e);
    const scaleX = flatOriginal.width  / oc.width;
    const scaleY = flatOriginal.height / oc.height;
    flatCorners[dragIdx] = {
      x: Math.max(0, Math.min(flatOriginal.width,  p.x * scaleX)),
      y: Math.max(0, Math.min(flatOriginal.height, p.y * scaleY))
    };
    updateFlattenOverlay();
  };
  const onUp = () => { dragIdx = -1; };

  oc.addEventListener('mousedown', onDown);
  oc.addEventListener('mousemove', onMove);
  oc.addEventListener('mouseup',   onUp);
  oc.addEventListener('touchstart', onDown, { passive: false });
  oc.addEventListener('touchmove',  onMove, { passive: false });
  oc.addEventListener('touchend',   onUp);
}

function removeFlattenOverlay() {
  const existing = document.getElementById('flatten-overlay');
  if (existing) existing.remove();
  flatOverlay = null;
}

function updateFlattenOverlay() {
  if (!flatOverlay || !flatOriginal) return;
  const oc  = flatOverlay;
  const W   = oc.width, H = oc.height;
  const ctx = oc.getContext('2d');
  ctx.clearRect(0, 0, W, H);

  const scaleX = W / flatOriginal.width;
  const scaleY = H / flatOriginal.height;
  const pts = flatCorners.map(c => ({ x: c.x * scaleX, y: c.y * scaleY }));

  // Dim overlay outside the quad
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(0, 0, W, H);
  ctx.globalCompositeOperation = 'destination-out';
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  pts.forEach(p => ctx.lineTo(p.x, p.y));
  ctx.closePath();
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';

  // Quad border
  ctx.strokeStyle = '#2de0b8';
  ctx.lineWidth   = 2.5;
  ctx.shadowColor = '#2de0b8';
  ctx.shadowBlur  = 8;
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  pts.forEach(p => ctx.lineTo(p.x, p.y));
  ctx.closePath();
  ctx.stroke();
  ctx.shadowBlur = 0;

  // Corner handles
  const labels = ['TL','TR','BR','BL'];
  pts.forEach((p, i) => {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 18, 0, Math.PI*2);
    ctx.fillStyle = dragIdx === i ? '#2de0b8' : 'rgba(45,224,184,0.25)';
    ctx.fill();
    ctx.strokeStyle = '#2de0b8';
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // Cross-hair center
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(p.x-7, p.y); ctx.lineTo(p.x+7, p.y);
    ctx.moveTo(p.x, p.y-7); ctx.lineTo(p.x, p.y+7);
    ctx.stroke();

    // Label
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 10px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(labels[i], p.x, p.y + 30);
  });

  // Corner L-brackets for aesthetic
  const cLen = 24;
  pts.forEach((p, i) => {
    const dx = i===1||i===2 ? -1 : 1;
    const dy = i===2||i===3 ? -1 : 1;
    ctx.strokeStyle = '#2de0b8'; ctx.lineWidth = 3; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(p.x + dx*cLen, p.y); ctx.lineTo(p.x, p.y); ctx.lineTo(p.x, p.y + dy*cLen);
    ctx.stroke();
  });
}

// ─── Apply Perspective Transform ─────────────────────────────
function applyFlattenTransform() {
  const src = flatOriginal;
  if (!src) return;
  const pts = flatCorners; // [{x,y}] TL,TR,BR,BL in source pixels

  showProgress('플랫 보정 적용 중...', 0);

  // Compute output size (A4 ratio or actual quad dimensions)
  const wTop = Math.hypot(pts[1].x-pts[0].x, pts[1].y-pts[0].y);
  const wBot = Math.hypot(pts[2].x-pts[3].x, pts[2].y-pts[3].y);
  const hL   = Math.hypot(pts[3].x-pts[0].x, pts[3].y-pts[0].y);
  const hR   = Math.hypot(pts[2].x-pts[1].x, pts[2].y-pts[1].y);
  const outW  = Math.round(Math.max(wTop, wBot));
  const outH  = Math.round(Math.max(hL,  hR));

  const dstPts = [
    {x:0,    y:0},
    {x:outW, y:0},
    {x:outW, y:outH},
    {x:0,    y:outH}
  ];

  updateProgress(20);

  // Compute homography: H maps src→dst
  const H    = computeHomography(pts, dstPts);
  const Hinv = invertMatrix3x3(H);

  updateProgress(35);

  // Source pixel data
  const srcCtx = src.getContext('2d');
  const srcImg = srcCtx.getImageData(0, 0, src.width, src.height);

  // Output canvas
  const outCanvas = document.createElement('canvas');
  outCanvas.width  = outW;
  outCanvas.height = outH;
  const outCtx = outCanvas.getContext('2d');
  const outImg = outCtx.createImageData(outW, outH);

  updateProgress(45);

  // Inverse warp: for each dst pixel, find src pixel
  const srcW = src.width;
  const srcH = src.height;
  const sd = srcImg.data;
  const od = outImg.data;

  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      // Apply inverse homography
      const w   = Hinv[6]*x + Hinv[7]*y + Hinv[8];
      const sx  = (Hinv[0]*x + Hinv[1]*y + Hinv[2]) / w;
      const sy  = (Hinv[3]*x + Hinv[4]*y + Hinv[5]) / w;

      // Bilinear interpolation
      const x0 = Math.floor(sx), y0 = Math.floor(sy);
      const x1 = x0 + 1,        y1 = y0 + 1;
      const fx  = sx - x0,      fy  = sy - y0;

      const clamp = (v, max) => Math.max(0, Math.min(max-1, v));
      const idx = (cx, cy) => (clamp(cy, srcH) * srcW + clamp(cx, srcW)) * 4;

      if (sx < 0 || sy < 0 || sx >= srcW || sy >= srcH) {
        const i = (y * outW + x) * 4;
        od[i]=255; od[i+1]=255; od[i+2]=255; od[i+3]=255;
        continue;
      }

      const i00=idx(x0,y0), i10=idx(x1,y0), i01=idx(x0,y1), i11=idx(x1,y1);
      const oi = (y * outW + x) * 4;
      for (let c = 0; c < 3; c++) {
        od[oi+c] = Math.round(
          sd[i00+c]*(1-fx)*(1-fy) +
          sd[i10+c]*fx*(1-fy) +
          sd[i01+c]*(1-fx)*fy +
          sd[i11+c]*fx*fy
        );
      }
      od[oi+3] = 255;
    }
    if (y % 50 === 0) updateProgress(45 + Math.round(y/outH * 40));
  }

  updateProgress(85);
  outCtx.putImageData(outImg, 0, 0);

  // Post-process: white balance + contrast enhancement
  updateProgress(90);
  const finalCanvas = adaptiveWhiteBalance(outCanvas);

  // Push to editor
  updateProgress(95);
  const edCanvas = document.getElementById('editor-canvas');
  edCanvas.width  = finalCanvas.width;
  edCanvas.height = finalCanvas.height;
  edCanvas.getContext('2d').drawImage(finalCanvas, 0, 0);

  // Save to image array
  const idx2 = window.ScanApp.currentIdx;
  if (idx2 >= 0 && window.ScanApp.images[idx2]) {
    window.ScanApp.images[idx2].dataUrl = finalCanvas.toDataURL('image/jpeg', 0.92);
    window.ScanApp.images[idx2].edited  = true;
    refreshImageStrip?.();
  }

  hideProgress();
  toast('✅ 플랫 보정 완료! 이제 편집 및 PDF 변환이 가능합니다', 'success');
}

// ─── Adaptive White Balance ───────────────────────────────────
function adaptiveWhiteBalance(canvas) {
  const W = canvas.width, H = canvas.height;
  const ctx = canvas.getContext('2d');
  const img = ctx.getImageData(0, 0, W, H);
  const d = img.data;

  // Find the 98th percentile of each channel (paper white estimation)
  const hist = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
  const total = W * H;
  for (let i = 0; i < d.length; i+=4) {
    hist[0][d[i]]++;  hist[1][d[i+1]]++; hist[2][d[i+2]]++;
  }
  const pct98 = (h) => {
    let cum = 0, target = total * 0.97;
    for (let v = 255; v >= 0; v--) { cum += h[v]; if (cum >= total - target) return v; }
    return 255;
  };
  const rMax = pct98(hist[0]), gMax = pct98(hist[1]), bMax = pct98(hist[2]);
  const pct2 = (h) => {
    let cum = 0, target = total * 0.02;
    for (let v = 0; v <= 255; v++) { cum += h[v]; if (cum >= target) return v; }
    return 0;
  };
  const rMin = pct2(hist[0]), gMin = pct2(hist[1]), bMin = pct2(hist[2]);

  // Stretch each channel
  const stretch = (v, lo, hi) => Math.max(0, Math.min(255, Math.round((v - lo) / (hi - lo) * 255)));
  for (let i = 0; i < d.length; i+=4) {
    d[i]   = stretch(d[i],   rMin, rMax);
    d[i+1] = stretch(d[i+1], gMin, gMax);
    d[i+2] = stretch(d[i+2], bMin, bMax);
  }

  // Slight contrast boost via curves
  const curve = new Uint8Array(256);
  for (let v = 0; v < 256; v++) {
    // S-curve: shadow darkening, highlight lightening
    const t = v / 255;
    curve[v] = Math.round(255 * (t < 0.5
      ? 2 * t * t
      : 1 - Math.pow(-2*t+2, 2)/2));
  }
  for (let i = 0; i < d.length; i+=4) {
    d[i]=curve[d[i]]; d[i+1]=curve[d[i+1]]; d[i+2]=curve[d[i+2]];
  }

  const outC = document.createElement('canvas');
  outC.width=W; outC.height=H;
  outC.getContext('2d').putImageData(img, 0, 0);
  return outC;
}

// ─── Homography Math ─────────────────────────────────────────
// Compute 3x3 homography from 4 point correspondences
function computeHomography(src, dst) {
  // Build 8x8 matrix A and 8-vector b
  const A = [];
  const b = [];
  for (let i = 0; i < 4; i++) {
    const sx=src[i].x, sy=src[i].y, dx=dst[i].x, dy=dst[i].y;
    A.push([sx, sy, 1, 0,  0,  0, -dx*sx, -dx*sy]);
    A.push([0,  0,  0, sx, sy, 1, -dy*sx, -dy*sy]);
    b.push(dx); b.push(dy);
  }
  const h = gaussianElim(A, b);
  return [
    h[0], h[1], h[2],
    h[3], h[4], h[5],
    h[6], h[7], 1
  ];
}

function gaussianElim(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let maxRow = col;
    for (let row = col+1; row < n; row++)
      if (Math.abs(M[row][col]) > Math.abs(M[maxRow][col])) maxRow = row;
    [M[col], M[maxRow]] = [M[maxRow], M[col]];
    const pivot = M[col][col];
    if (Math.abs(pivot) < 1e-10) continue;
    for (let row = col+1; row < n; row++) {
      const f = M[row][col] / pivot;
      for (let k = col; k <= n; k++) M[row][k] -= f * M[col][k];
    }
  }
  const x = new Array(n).fill(0);
  for (let i = n-1; i >= 0; i--) {
    x[i] = M[i][n] / M[i][i];
    for (let k = i-1; k >= 0; k--) M[k][n] -= M[k][i] * x[i];
  }
  return x;
}

function invertMatrix3x3(m) {
  const [a,b,c,d,e,f,g,h,k] = m;
  const det = a*(e*k-f*h) - b*(d*k-f*g) + c*(d*h-e*g);
  if (Math.abs(det) < 1e-10) return [...m];
  const inv = 1/det;
  return [
    (e*k-f*h)*inv, (c*h-b*k)*inv, (b*f-c*e)*inv,
    (f*g-d*k)*inv, (a*k-c*g)*inv, (c*d-a*f)*inv,
    (d*h-e*g)*inv, (b*g-a*h)*inv, (a*e-b*d)*inv
  ];
}

// ─── Progress helpers (reuse from app.js) ─────────────────────
function showProgress(msg, pct) {
  const ov = document.getElementById('progress-overlay');
  const lbl = document.getElementById('progress-label') || ov?.querySelector('.progress-label');
  const bar = document.getElementById('progress-bar') || ov?.querySelector('.progress-bar');
  if (ov) ov.classList.add('active');
  if (lbl) lbl.textContent = msg;
  if (bar) bar.style.width = pct + '%';
}
function updateProgress(pct) {
  const bar = document.querySelector('#progress-overlay .progress-bar');
  if (bar) bar.style.width = pct + '%';
}
function hideProgress() {
  const ov = document.getElementById('progress-overlay');
  if (ov) ov.classList.remove('active');
}

// ─── Exports ──────────────────────────────────────────────────
window.enterFlattenMode = enterFlattenMode;
window.exitFlattenMode  = exitFlattenMode;
