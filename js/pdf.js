/**
 * pdf.js — PDF Generation using jsPDF
 * A4 auto-fit, multi-page, size-optimized
 */

async function generatePDF() {
  if (!window.ScanApp.images.length) { toast('이미지를 먼저 추가해주세요', 'error'); return; }
  showPage('result');
  switchResultTab('pdf');
  showProgress('PDF 생성 중...', '');
  await new Promise(r => setTimeout(r, 100)); // allow UI to update

  try {
    if (typeof window.jspdf === 'undefined' && typeof jsPDF === 'undefined') {
      throw new Error('jsPDF 라이브러리가 로딩되지 않았습니다. 인터넷 연결을 확인해주세요.');
    }
    const { jsPDF } = window.jspdf || window;
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
    const A4_W = 210, A4_H = 297;
    const MARGIN = 8;

    for (let i = 0; i < window.ScanApp.images.length; i++) {
      updateProgress((i / window.ScanApp.images.length) * 90, `PDF 생성 중 (${i+1}/${window.ScanApp.images.length})`, '이미지 처리중');
      if (i > 0) pdf.addPage();

      const imgInfo = await getImageInfo(window.ScanApp.images[i].dataUrl);
      const { dataUrl, w, h } = imgInfo;

      // Fit image in A4 with margin
      const maxW = A4_W - MARGIN * 2;
      const maxH = A4_H - MARGIN * 2;
      let drawW = maxW, drawH = h * (maxW / w);
      if (drawH > maxH) { drawH = maxH; drawW = w * (maxH / h); }
      const x = (A4_W - drawW) / 2;
      const y = (A4_H - drawH) / 2;

      // Determine format
      const isJpeg = dataUrl.startsWith('data:image/jpeg') || dataUrl.startsWith('data:image/jpg');
      const format = isJpeg ? 'JPEG' : 'PNG';
      pdf.addImage(dataUrl, format, x, y, drawW, drawH, '', 'FAST');
    }

    updateProgress(95, 'PDF 완성 중...', '저장 준비');
    const pdfBlob = pdf.output('blob');
    window.pdfBlob = pdfBlob;
    updateProgress(100, '완료!', '');
    setTimeout(hideProgress, 500);

    // Preview first page
    renderPDFPreview(pdf, A4_W, A4_H, MARGIN);

    toast('PDF가 생성되었습니다!', 'success');
    saveRecentDoc('스캔문서_' + dateStamp(), 'pdf', window.ScanApp.images[0]?.dataUrl?.substring(0,100), window.ScanApp.images.length);
  } catch (err) {
    hideProgress();
    toast('PDF 오류: ' + err.message, 'error');
    console.error(err);
  }
}

function getImageInfo(dataUrl) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      // Compress: if > 1MB convert to JPEG at 0.85
      const canvas = document.createElement('canvas');
      const MAX = 2480; // ~A4 300dpi
      let w = img.naturalWidth, h = img.naturalHeight;
      if (w > MAX) { h = h * MAX / w; w = MAX; }
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      const compressed = canvas.toDataURL('image/jpeg', 0.85);
      resolve({ dataUrl: compressed, w, h });
    };
    img.src = dataUrl;
  });
}

function renderPDFPreview(pdf, A4_W, A4_H, MARGIN) {
  const canvas = document.getElementById('pdf-prev-canvas');
  if (!canvas) return;
  const scale = canvas.parentElement.clientWidth / (A4_W * 3.78);
  canvas.width  = A4_W * 3.78;
  canvas.height = A4_H * 3.78;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const img = new Image();
  img.onload = () => {
    const mw = (A4_W - MARGIN*2) * 3.78;
    const mh = (A4_H - MARGIN*2) * 3.78;
    let dw = mw, dh = img.naturalHeight * (mw / img.naturalWidth);
    if (dh > mh) { dh = mh; dw = img.naturalWidth * (mh / img.naturalHeight); }
    const dx = (canvas.width - dw) / 2;
    const dy = (canvas.height - dh) / 2;
    ctx.drawImage(img, dx, dy, dw, dh);
    canvas.style.width = '100%';
  };
  img.src = window.ScanApp.images[0]?.dataUrl || '';
}

function downloadPDF() {
  if (!window.pdfBlob) { toast('먼저 PDF를 생성해주세요', 'error'); return; }
  downloadBlob(window.pdfBlob, '스캔문서_' + dateStamp() + '.pdf');
  toast('PDF 다운로드 시작!', 'success');
}

function sharePDF() {
  if (!window.pdfBlob) { toast('먼저 PDF를 생성해주세요', 'error'); return; }
  if (navigator.share) {
    const file = new File([window.pdfBlob], '스캔문서_' + dateStamp() + '.pdf', { type: 'application/pdf' });
    navigator.share({ files: [file], title: '스캔 문서', text: 'Document Scanner App으로 스캔한 문서입니다.' })
      .catch(e => { if (e.name !== 'AbortError') toast('공유 실패: ' + e.message, 'error'); });
  } else {
    toast('이 브라우저는 파일 공유를 지원하지 않습니다', 'error');
    downloadPDF();
  }
}

window.generatePDF = generatePDF;
window.downloadPDF = downloadPDF;
window.sharePDF = sharePDF;
