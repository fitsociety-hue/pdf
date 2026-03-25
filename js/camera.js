/**
 * camera.js — Camera Capture & File Upload
 */

let cameraStream = null;

function initCamera() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    // Fallback: trigger file input with camera
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/*'; input.capture = 'camera';
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const dataUrl = await readFileAsDataURL(file);
      addImage(dataUrl, file.name);
      showPage('editor');
      loadImageToEditor(window.ScanApp.currentIdx);
    };
    input.click();
    return;
  }

  // Open camera overlay
  const overlay = document.getElementById('camera-overlay');
  const video   = document.getElementById('camera-video');
  if (!overlay || !video) return;

  navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }
  }).then(stream => {
    cameraStream = stream;
    video.srcObject = stream;
    video.play();
    overlay.classList.add('active');
  }).catch(err => {
    console.error(err);
    toast('카메라 접근 실패: ' + err.message, 'error');
  });
}

function capturePhoto() {
  const video = document.getElementById('camera-video');
  if (!video) return;
  const canvas = document.createElement('canvas');
  canvas.width  = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext('2d').drawImage(video, 0, 0);
  const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
  const name = `사진_${new Date().toLocaleDateString('ko-KR').replace(/\./g,' ').trim()}.jpg`;
  addImage(dataUrl, name);
  // Flash effect
  const flash = document.getElementById('camera-flash');
  if (flash) { flash.style.opacity = '1'; setTimeout(() => flash.style.opacity = '0', 150); }
  toast(`${window.ScanApp.images.length}번째 사진이 추가되었습니다`, 'success');
}

function closeCamera() {
  const overlay = document.getElementById('camera-overlay');
  const video   = document.getElementById('camera-video');
  if (overlay) overlay.classList.remove('active');
  if (cameraStream) { cameraStream.getTracks().forEach(t => t.stop()); cameraStream = null; }
  if (video) video.srcObject = null;
  if (window.ScanApp.images.length > 0) {
    showPage('editor');
    loadImageToEditor(window.ScanApp.currentIdx);
  }
}

function switchCamera() {
  if (!cameraStream) return;
  const track = cameraStream.getVideoTracks()[0];
  const constraints = track.getConstraints();
  const newFacing = constraints.facingMode?.ideal === 'environment' ? 'user' : 'environment';
  closeCamera();
  setTimeout(() => {
    navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: newFacing }, width: { ideal: 1920 }, height: { ideal: 1080 } }
    }).then(stream => {
      cameraStream = stream;
      const video = document.getElementById('camera-video');
      if (video) { video.srcObject = stream; video.play(); }
      document.getElementById('camera-overlay')?.classList.add('active');
    });
  }, 200);
}

window.initCamera = initCamera;
window.capturePhoto = capturePhoto;
window.closeCamera = closeCamera;
window.switchCamera = switchCamera;
