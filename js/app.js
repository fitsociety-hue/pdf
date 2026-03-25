/**
 * app.js — Global App State & Router
 * Document Scanner App (GitHub Pages Edition)
 */

// ─── Global State ──────────────────────────────────────────
window.ScanApp = {
  images: [],          // Array of { id, dataUrl, name }
  currentIdx: 0,       // currently editing image index
  ocrText: '',         // last OCR result
  settings: {
    geminiApiKey: '',
    useGemini: false,
    lang: 'kor+eng',
  },
};

// ─── DOM Ready ─────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  loadSettings();
  renderRecentDocs();
  initNavigation();
  initModals();
});

// ─── Navigation ────────────────────────────────────────────
function initNavigation() {
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
      const target = item.dataset.page;
      if (target) showPage(target);
      document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
      item.classList.add('active');
    });
  });
}

function showPage(pageId) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const page = document.getElementById('page-' + pageId);
  if (page) {
    page.classList.add('active');
    page.scrollTop = 0;
  }
}

// ─── Modal / Bottom Sheet ───────────────────────────────────
function initModals() {
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', e => {
      if (e.target === overlay) closeAllModals();
    });
  });
}
function openModal(id) {
  document.getElementById(id)?.classList.add('active');
}
function closeAllModals() {
  document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('active'));
}
window.openModal = openModal;
window.closeAllModals = closeAllModals;

// ─── Progress Overlay ───────────────────────────────────────
function showProgress(label = '처리 중...', sub = '') {
  const ov = document.getElementById('progress-overlay');
  if (!ov) return;
  ov.querySelector('.progress-label').textContent = label;
  ov.querySelector('.progress-sub').textContent = sub;
  ov.querySelector('.progress-bar').style.width = '0%';
  ov.classList.add('active');
}
function updateProgress(pct, label, sub) {
  const ov = document.getElementById('progress-overlay');
  if (!ov) return;
  if (label) ov.querySelector('.progress-label').textContent = label;
  if (sub !== undefined) ov.querySelector('.progress-sub').textContent = sub;
  ov.querySelector('.progress-bar').style.width = pct + '%';
}
function hideProgress() {
  document.getElementById('progress-overlay')?.classList.remove('active');
}
window.showProgress = showProgress;
window.updateProgress = updateProgress;
window.hideProgress = hideProgress;

// ─── Toast ──────────────────────────────────────────────────
function toast(message, type = 'info', duration = 3000) {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => el.remove(), duration);
}
window.toast = toast;

// ─── Settings Persistence ───────────────────────────────────
function loadSettings() {
  const saved = JSON.parse(localStorage.getItem('scanapp_settings') || '{}');
  Object.assign(window.ScanApp.settings, saved);
  const apiInput = document.getElementById('gemini-api-key');
  if (apiInput) apiInput.value = window.ScanApp.settings.geminiApiKey || '';
  const toggle = document.getElementById('use-gemini');
  if (toggle) toggle.checked = window.ScanApp.settings.useGemini || false;
}
function saveSettings() {
  const apiInput = document.getElementById('gemini-api-key');
  const toggle = document.getElementById('use-gemini');
  if (apiInput) window.ScanApp.settings.geminiApiKey = apiInput.value.trim();
  if (toggle) window.ScanApp.settings.useGemini = toggle.checked;
  localStorage.setItem('scanapp_settings', JSON.stringify(window.ScanApp.settings));
  toast('설정이 저장되었습니다', 'success');
}
window.saveSettings = saveSettings;

// ─── Image Management ───────────────────────────────────────
function addImage(dataUrl, name) {
  const id = Date.now() + Math.random();
  window.ScanApp.images.push({ id, dataUrl, name: name || `이미지 ${window.ScanApp.images.length + 1}` });
  refreshImageStrip();
}
function removeImage(id) {
  window.ScanApp.images = window.ScanApp.images.filter(img => img.id !== id);
  if (window.ScanApp.currentIdx >= window.ScanApp.images.length) {
    window.ScanApp.currentIdx = Math.max(0, window.ScanApp.images.length - 1);
  }
  refreshImageStrip();
  if (window.ScanApp.images.length > 0) {
    loadImageToEditor(window.ScanApp.currentIdx);
  } else {
    showPage('home');
  }
}
function refreshImageStrip() {
  const strip = document.getElementById('images-strip');
  if (!strip) return;
  strip.innerHTML = '';
  window.ScanApp.images.forEach((img, i) => {
    const thumb = document.createElement('div');
    thumb.className = 'strip-thumb' + (i === window.ScanApp.currentIdx ? ' active' : '');
    thumb.innerHTML = `
      <img src="${img.dataUrl}" alt="이미지 ${i+1}">
      <span class="thumb-num">${i+1}</span>
      <button class="thumb-del" onclick="removeImage(${img.id})">✕</button>`;
    thumb.addEventListener('click', (e) => {
      if (!e.target.classList.contains('thumb-del')) {
        window.ScanApp.currentIdx = i;
        loadImageToEditor(i);
        refreshImageStrip();
      }
    });
    strip.appendChild(thumb);
  });
  // Add button
  const addBtn = document.createElement('div');
  addBtn.className = 'add-thumb';
  addBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg><span>추가</span>`;
  addBtn.onclick = () => document.getElementById('file-input')?.click();
  strip.appendChild(addBtn);
  // Update image count badge
  const badge = document.getElementById('img-count-badge');
  if (badge) badge.textContent = window.ScanApp.images.length + '장';
}

window.addImage = addImage;
window.removeImage = removeImage;
window.refreshImageStrip = refreshImageStrip;

// ─── Home Actions ───────────────────────────────────────────
function startCamera() {
  if (typeof initCamera === 'function') initCamera();
  else toast('카메라 기능 로딩 중...', 'info');
}
function openUpload() {
  document.getElementById('file-input')?.click();
}
window.startCamera = startCamera;
window.openUpload = openUpload;

// ─── File Input Handler ─────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const fileInput = document.getElementById('file-input');
  if (fileInput) {
    fileInput.addEventListener('change', async (e) => {
      const files = [...e.target.files];
      if (!files.length) return;
      showProgress('이미지 불러오는 중...', '');
      for (let i = 0; i < files.length; i++) {
        updateProgress((i / files.length) * 100, '이미지 불러오는 중...', `${i+1}/${files.length}`);
        const dataUrl = await readFileAsDataURL(files[i]);
        addImage(dataUrl, files[i].name);
      }
      hideProgress();
      showPage('editor');
      if (window.ScanApp.images.length > 0) {
        loadImageToEditor(window.ScanApp.currentIdx);
      }
      fileInput.value = '';
    });
  }
});

function readFileAsDataURL(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = e => resolve(e.target.result);
    reader.readAsDataURL(file);
  });
}
window.readFileAsDataURL = readFileAsDataURL;

// ─── Recent Documents ───────────────────────────────────────
function renderRecentDocs() {
  const docs = JSON.parse(localStorage.getItem('scanapp_recent') || '[]');
  const container = document.getElementById('recent-docs');
  if (!container) return;
  if (!docs.length) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📂</div>
        <p>최근 문서가 없습니다.<br>카메라로 촬영하거나 이미지를 업로드하세요.</p>
      </div>`;
    return;
  }
  container.innerHTML = docs.slice(0, 10).map(doc => `
    <div class="doc-item card" onclick="openRecentDoc('${doc.id}')">
      <div class="doc-thumb">${doc.thumb ? `<img src="${doc.thumb}">` : getDocIcon(doc.type)}</div>
      <div class="doc-info">
        <div class="doc-name">${doc.name}</div>
        <div class="doc-meta">${formatDate(doc.date)} · ${doc.pages || 1}페이지</div>
        <span class="doc-badge ${doc.type}">${doc.type?.toUpperCase()}</span>
      </div>
    </div>`).join('');
}
function getDocIcon(type) {
  const icons = { pdf:'📄', word:'📝', html:'🌐', md:'#️⃣', ocr:'🔍' };
  return icons[type] || '📄';
}
function formatDate(dateStr) {
  const d = new Date(dateStr);
  const now = new Date();
  const diff = now - d;
  if (diff < 60000) return '방금 전';
  if (diff < 3600000) return Math.floor(diff/60000) + '분 전';
  if (diff < 86400000) return Math.floor(diff/3600000) + '시간 전';
  return d.toLocaleDateString('ko-KR');
}
function saveRecentDoc(name, type, thumb, pages) {
  const docs = JSON.parse(localStorage.getItem('scanapp_recent') || '[]');
  const doc = { id: Date.now().toString(), name, type, thumb, pages, date: new Date().toISOString() };
  docs.unshift(doc);
  localStorage.setItem('scanapp_recent', JSON.stringify(docs.slice(0, 20)));
  renderRecentDocs();
}
window.saveRecentDoc = saveRecentDoc;
window.renderRecentDocs = renderRecentDocs;

// ─── Show Function Menu ──────────────────────────────────────
function showFunctionMenu() {
  if (!window.ScanApp.images.length) { toast('먼저 이미지를 추가해주세요', 'error'); return; }
  openModal('modal-functions');
}
window.showFunctionMenu = showFunctionMenu;
