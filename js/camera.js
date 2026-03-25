/**
 * camera.js — Samsung-style Document Scanner Camera
 * Features: doc edge detection overlay, auto-capture, flash (torch),
 *           countdown timer, page counter badge, thumbnail strip
 */

// ─── State ──────────────────────────────────────────────────
let cameraStream = null;
let camSettings  = { flash: false, timer: 0, autoCapture: false };
let docDetectInterval = null;
let autoCountdown     = null;
let autoCountdownSec  = 0;
let detectionCanvas   = null;   // offscreen canvas for frame analysis
let isDocDetected     = false;
let capturedCount     = 0;
let cvReady           = false;
let detectedQuad      = null; // { tl, tr, br, bl }

// ─── OpenCV Init ─────────────────────────────────────────────
function onOpenCvReady() {
  cvReady = true;
  console.log('OpenCV.js is ready');
  toast('실시간 문서 감지 준비 완료', 'info');
}

// ─── Init Camera ─────────────────────────────────────────────
function initCamera() {
  // Fallback for browsers without getUserMedia
  if (!navigator.mediaDevices?.getUserMedia) {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'image/*'; inp.capture = 'camera';
    inp.onchange = async (e) => {
      const file = e.target.files[0]; if (!file) return;
      addImage(await readFileAsDataURL(file), file.name);
      showPage('editor'); loadImageToEditor(window.ScanApp.currentIdx);
    };
    inp.click(); return;
  }

  const overlay = document.getElementById('camera-overlay');
  const video   = document.getElementById('camera-video');
  if (!overlay || !video) return;

  capturedCount = window.ScanApp.images.length;
  updateCamBadge();

  navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
    audio: false
  }).then(stream => {
    cameraStream = stream;
    video.srcObject = stream;
    video.play();
    overlay.classList.add('active');
    updateFlashBtn();
    // Offscreen detection canvas
    detectionCanvas = document.createElement('canvas');
    // Start document edge detection loop
    video.addEventListener('loadedmetadata', () => {
      detectionCanvas.width  = video.videoWidth  || 640;
      detectionCanvas.height = video.videoHeight || 480;
      startDocDetection(video);
    });
  }).catch(err => {
    console.error(err);
    toast('카메라 접근 실패: ' + err.message, 'error');
  });
}

// ─── Document Edge Detection Loop ───────────────────────────
function startDocDetection(video) {
  stopDocDetection();
  docDetectInterval = setInterval(() => detectDocument(video), 200);
}
function stopDocDetection() {
  if (docDetectInterval) { clearInterval(docDetectInterval); docDetectInterval = null; }
}

// Simple doc detection: analyze contours via OpenCV if available
function detectDocument(video) {
  if (!detectionCanvas || !video.videoWidth) return;
  const ctx = detectionCanvas.getContext('2d');
  const W = detectionCanvas.width, H = detectionCanvas.height;
  ctx.drawImage(video, 0, 0, W, H);

  let nowDetected = false;

  if (cvReady && typeof cv !== 'undefined') {
    try {
      let src = cv.imread(detectionCanvas);
      let gray = new cv.Mat();
      cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
      let blurred = new cv.Mat();
      cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0);
      let edges = new cv.Mat();
      cv.Canny(blurred, edges, 75, 200);

      let contours = new cv.MatVector();
      let hierarchy = new cv.Mat();
      cv.findContours(edges, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);

      let maxArea = 0;
      let maxContourIdx = -1;
      for (let i = 0; i < contours.size(); ++i) {
        let contour = contours.get(i);
        let area = cv.contourArea(contour);
        if (area > 5000) {
          let peri = cv.arcLength(contour, true);
          let approx = new cv.Mat();
          cv.approxPolyDP(contour, approx, 0.02 * peri, true);
          if (approx.rows === 4 && area > maxArea) {
            maxArea = area;
            maxContourIdx = i;
            // Extract corners
            let pts = [];
            for (let j = 0; j < 4; j++) {
              pts.push({ x: approx.data32S[j * 2], y: approx.data32S[j * 2 + 1] });
            }
            // Sort corners: top-left, top-right, bottom-right, bottom-left
            pts.sort((a, b) => a.y - b.y);
            let top = pts.slice(0, 2).sort((a, b) => a.x - b.x);
            let bottom = pts.slice(2, 4).sort((a, b) => b.x - a.x);
            detectedQuad = {
              tl: { x: top[0].x / W, y: top[0].y / H },
              tr: { x: top[1].x / W, y: top[1].y / H },
              br: { x: bottom[0].x / W, y: bottom[0].y / H },
              bl: { x: bottom[1].x / W, y: bottom[1].y / H }
            };
            nowDetected = true;
          }
          approx.delete();
        }
      }

      src.delete(); gray.delete(); blurred.delete(); edges.delete();
      contours.delete(); hierarchy.delete();
    } catch (e) {
      console.warn('OpenCV Detect Error:', e);
    }
  }

  // Fallback if not detected or CV not ready
  if (!nowDetected) {
    const centerData = ctx.getImageData(W*0.2, H*0.15, W*0.6, H*0.7);
    let bright = 0, total = centerData.data.length / 4;
    for (let i = 0; i < centerData.data.length; i += 4) {
      bright += (centerData.data[i] + centerData.data[i+1] + centerData.data[i+2]) / 3;
    }
    const avgBrightness = bright / total;
    nowDetected = avgBrightness > 150;
    if (nowDetected) {
      // Use standard rect if no CV quad
      detectedQuad = {
        tl: { x: 0.1, y: 0.15 }, tr: { x: 0.9, y: 0.15 },
        br: { x: 0.9, y: 0.85 }, bl: { x: 0.1, y: 0.85 }
      };
    } else {
      detectedQuad = null;
    }
  }

  if (nowDetected !== isDocDetected) {
    isDocDetected = nowDetected;
    updateOverlayFeedback(nowDetected);
  }

  // Auto-capture logic
  if (camSettings.autoCapture && isDocDetected && !autoCountdown) {
    startAutoCountdown();
  } else if (camSettings.autoCapture && !isDocDetected && autoCountdown) {
    cancelAutoCountdown();
  }

  // Draw detected quad overlay
  drawQuadOverlay(isDocDetected);
}

// ─── Draw Document Quad Overlay ──────────────────────────────
function drawQuadOverlay(detected) {
  const oc = document.getElementById('cam-overlay-canvas');
  if (!oc) return;
  const ctx = oc.getContext('2d');
  const video = document.getElementById('camera-video');
  if (!video) return;

  oc.width  = oc.offsetWidth  || video.clientWidth  || 375;
  oc.height = oc.offsetHeight || video.clientHeight || 600;
  ctx.clearRect(0, 0, oc.width, oc.height);
  if (!detected || !detectedQuad) return;

  const W = oc.width, H = oc.height;

  // Quad points
  const pts = [
    { x: detectedQuad.tl.x * W, y: detectedQuad.tl.y * H },
    { x: detectedQuad.tr.x * W, y: detectedQuad.tr.y * H },
    { x: detectedQuad.br.x * W, y: detectedQuad.br.y * H },
    { x: detectedQuad.bl.x * W, y: detectedQuad.bl.y * H },
  ];

  // Filled dim overlay outside the document (use clip to punch a hole)
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.beginPath();
  ctx.moveTo(0,0); ctx.lineTo(W,0); ctx.lineTo(W,H); ctx.lineTo(0,H); ctx.closePath();
  ctx.moveTo(pts[0].x, pts[0].y);
  ctx.lineTo(pts[1].x, pts[1].y);
  ctx.lineTo(pts[2].x, pts[2].y);
  ctx.lineTo(pts[3].x, pts[3].y);
  ctx.closePath();
  ctx.fill('evenodd');

  // Teal border
  ctx.strokeStyle = '#2de0b8';
  ctx.lineWidth   = 3;
  ctx.lineJoin    = 'round';
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  ctx.lineTo(pts[1].x, pts[1].y);
  ctx.lineTo(pts[2].x, pts[2].y);
  ctx.lineTo(pts[3].x, pts[3].y);
  ctx.closePath();
  ctx.stroke();

  // Corner handles
  const corner = 22;
  ctx.strokeStyle = '#2de0b8';
  ctx.lineWidth   = 5;
  ctx.lineCap     = 'round';
  pts.forEach((p, i) => {
    ctx.beginPath();
    // Simple bracket style
    if (i === 0) { // tl
      ctx.moveTo(p.x + corner, p.y); ctx.lineTo(p.x, p.y); ctx.lineTo(p.x, p.y + corner);
    } else if (i === 1) { // tr
      ctx.moveTo(p.x - corner, p.y); ctx.lineTo(p.x, p.y); ctx.lineTo(p.x, p.y + corner);
    } else if (i === 2) { // br
      ctx.moveTo(p.x - corner, p.y); ctx.lineTo(p.x, p.y); ctx.lineTo(p.x, p.y - corner);
    } else if (i === 3) { // bl
      ctx.moveTo(p.x + corner, p.y); ctx.lineTo(p.x, p.y); ctx.lineTo(p.x, p.y - corner);
    }
    ctx.stroke();
  });
}

// ─── Overlay Feedback Text ───────────────────────────────────
function updateOverlayFeedback(detected) {
  const el = document.getElementById('cam-guide-text');
  if (!el) return;
  if (detected) {
    el.textContent = '문서가 감지되었습니다 ✓';
    el.style.background = 'rgba(45,224,184,0.85)';
    el.style.color = '#000';
  } else {
    el.textContent = '네 모서리가 모두 보이도록 스캔해주세요';
    el.style.background = 'rgba(0,0,0,0.75)';
    el.style.color = '#fff';
  }
}

// ─── Auto-capture Countdown ───────────────────────────────────
function startAutoCountdown() {
  autoCountdownSec = 2;
  updateAutoCountdownUI(autoCountdownSec);
  autoCountdown = setInterval(() => {
    autoCountdownSec--;
    updateAutoCountdownUI(autoCountdownSec);
    if (autoCountdownSec <= 0) {
      cancelAutoCountdown();
      if (isDocDetected) capturePhoto();
    }
  }, 1000);
}
function cancelAutoCountdown() {
  if (autoCountdown) { clearInterval(autoCountdown); autoCountdown = null; }
  updateAutoCountdownUI(0);
}
function updateAutoCountdownUI(n) {
  const el = document.getElementById('cam-auto-countdown');
  if (!el) return;
  el.textContent = n > 0 ? n : '';
  el.style.display = n > 0 ? 'flex' : 'none';
}

// ─── Capture Photo ───────────────────────────────────────────
function capturePhoto() {
  const video = document.getElementById('camera-video');
  if (!video || !video.videoWidth) { toast('카메라가 준비되지 않았습니다', 'error'); return; }

  // Flash effect
  const flash = document.getElementById('camera-flash');
  if (flash) { flash.style.opacity = '1'; setTimeout(() => flash.style.opacity = '0', 150); }

  // Handle timer
  const timerSec = camSettings.timer;
  if (timerSec > 0) {
    startTimerCapture(timerSec, () => doCapture(video));
  } else {
    doCapture(video);
  }
}

function doCapture(video) {
  const canvas = document.createElement('canvas');
  canvas.width  = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext('2d').drawImage(video, 0, 0);
  const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
  const name = `스캔_${new Date().toLocaleString('ko-KR').replace(/[\s:.]/g,'')}.jpg`;
  addImage(dataUrl, name);
  capturedCount = window.ScanApp.images.length;
  updateCamBadge();
  updateCamThumbnail(dataUrl);
  if (navigator.vibrate) navigator.vibrate(50);
  toast(`${capturedCount}장 촬영됨 — 플랫 보정 준비 중...`, 'success');

  // ✨ Auto-flatten: close camera and enter flatten mode on editor
  setTimeout(() => {
    closeCamera();
    // After editor loads, auto-enter flatten mode
    setTimeout(() => {
      if (typeof enterFlattenMode === 'function') enterFlattenMode();
    }, 350);
  }, 600);
}

// ─── Timer Capture ────────────────────────────────────────────
function startTimerCapture(seconds, callback) {
  const el = document.getElementById('cam-timer-countdown');
  if (el) { el.style.display = 'flex'; }
  let remaining = seconds;
  const iv = setInterval(() => {
    if (el) el.textContent = remaining;
    remaining--;
    if (remaining < 0) {
      clearInterval(iv);
      if (el) { el.style.display = 'none'; el.textContent = ''; }
      callback();
    }
  }, 1000);
}

// ─── Flash / Torch ────────────────────────────────────────────
async function toggleFlash() {
  if (!cameraStream) return;
  const track = cameraStream.getVideoTracks()[0];
  if (!track) return;
  const caps = track.getCapabilities?.() || {};
  if (caps.torch) {
    camSettings.flash = !camSettings.flash;
    await track.applyConstraints({ advanced: [{ torch: camSettings.flash }] });
  } else {
    toast('이 기기는 플래시를 지원하지 않습니다', 'info');
    return;
  }
  updateFlashBtn();
}
function updateFlashBtn() {
  const btn = document.getElementById('cam-flash-btn');
  if (!btn) return;
  btn.classList.toggle('active', camSettings.flash);
  btn.title = camSettings.flash ? '플래시 끄기' : '플래시 켜기';
}

// ─── Timer Toggle ──────────────────────────────────────────────
function cycleTimer() {
  const seq = [0, 3, 5, 10];
  const cur = seq.indexOf(camSettings.timer);
  camSettings.timer = seq[(cur + 1) % seq.length];
  const btn = document.getElementById('cam-timer-btn');
  if (btn) btn.querySelector('span').textContent = camSettings.timer ? camSettings.timer + 's' : 'OFF';
  btn?.classList.toggle('active', camSettings.timer > 0);
  toast(camSettings.timer ? `${camSettings.timer}초 타이머 설정` : '타이머 해제', 'info');
}

// ─── Auto Capture Toggle ──────────────────────────────────────
function toggleAutoCapture() {
  camSettings.autoCapture = !camSettings.autoCapture;
  const btn = document.getElementById('cam-auto-btn');
  if (btn) btn.classList.toggle('active', camSettings.autoCapture);
  toast(camSettings.autoCapture ? '자동 촬영 ON — 문서를 인식하면 자동으로 촬영됩니다' : '자동 촬영 OFF', 'info');
  if (!camSettings.autoCapture) cancelAutoCountdown();
}

// ─── Switch Camera ────────────────────────────────────────────
function switchCamera() {
  if (!cameraStream) return;
  const track = cameraStream.getVideoTracks()[0];
  const cur = track?.getConstraints?.()?.facingMode?.ideal || 'environment';
  const next = cur === 'environment' ? 'user' : 'environment';
  stopDocDetection();
  cameraStream.getTracks().forEach(t => t.stop());
  cameraStream = null;
  navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: next }, width: { ideal: 1920 }, height: { ideal: 1080 } },
    audio: false
  }).then(stream => {
    cameraStream = stream;
    const video = document.getElementById('camera-video');
    if (video) { video.srcObject = stream; video.play(); startDocDetection(video); }
  }).catch(e => toast('카메라 전환 실패: ' + e.message, 'error'));
}

// ─── Close Camera ─────────────────────────────────────────────
function closeCamera() {
  stopDocDetection();
  cancelAutoCountdown();
  const overlay = document.getElementById('camera-overlay');
  const video   = document.getElementById('camera-video');
  if (overlay) overlay.classList.remove('active');
  if (cameraStream) { cameraStream.getTracks().forEach(t => { try { t.applyConstraints({advanced:[{torch:false}]}); } catch{} t.stop(); }); cameraStream = null; }
  if (video) video.srcObject = null;
  // Clear detection canvas
  const oc = document.getElementById('cam-overlay-canvas');
  if (oc) oc.getContext('2d').clearRect(0, 0, oc.width, oc.height);

  if (window.ScanApp.images.length > 0) {
    showPage('editor');
    // Load the most recently added image
    loadImageToEditor(window.ScanApp.images.length - 1);
    refreshImageStrip();
  }
}

// ─── UI Helpers ───────────────────────────────────────────────
function updateCamBadge() {
  const el = document.getElementById('cam-badge');
  const count = capturedCount || window.ScanApp.images.length;
  if (!el) return;
  el.textContent = count;
  el.style.display = count > 0 ? 'flex' : 'none';
}
function updateCamThumbnail(dataUrl) {
  const el = document.getElementById('cam-thumbnail');
  if (!el) return;
  el.style.backgroundImage = `url(${dataUrl})`;
  el.style.backgroundSize  = 'cover';
  el.textContent = '';
}
function openLibrary() {
  closeCamera();
  document.getElementById('file-input')?.click();
}

window.initCamera        = initCamera;
window.capturePhoto      = capturePhoto;
window.closeCamera       = closeCamera;
window.switchCamera      = switchCamera;
window.toggleFlash       = toggleFlash;
window.cycleTimer        = cycleTimer;
window.toggleAutoCapture = toggleAutoCapture;
window.openLibrary       = openLibrary;
