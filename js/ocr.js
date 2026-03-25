/**
 * ocr.js — OCR Engine (Tesseract.js + Gemini API)
 * Supports Korean + English
 */

// ─── Tesseract.js OCR ────────────────────────────────────────
async function runOCR() {
  if (!window.ScanApp.images.length) { toast('이미지를 먼저 추가해주세요', 'error'); return; }
  showPage('result');
  switchResultTab('ocr');

  // Try Gemini first if enabled and API key exists
  if (window.ScanApp.settings.useGemini && window.ScanApp.settings.geminiApiKey) {
    await runGeminiOCR();
    return;
  }
  await runTesseractOCR();
}

async function runTesseractOCR() {
  showProgress('OCR 준비 중...', 'Tesseract.js 로딩');
  updateProgress(5, 'OCR 준비 중...', '');

  try {
    if (typeof Tesseract === 'undefined') {
      toast('Tesseract.js 로딩 실패. 인터넷 연결을 확인해주세요.', 'error');
      hideProgress(); return;
    }

    let fullText = '';
    for (let i = 0; i < window.ScanApp.images.length; i++) {
      const pct = 10 + (i / window.ScanApp.images.length) * 80;
      updateProgress(pct, `OCR 처리 중... (${i+1}/${window.ScanApp.images.length})`, '이미지 전처리 중');
      const preprocessed = await preprocessForOCR(window.ScanApp.images[i].dataUrl);
      updateProgress(pct + 5, `OCR 인식 중... (${i+1}/${window.ScanApp.images.length})`, '텍스트 추출 중');
      const result = await Tesseract.recognize(preprocessed, 'kor+eng', {
        logger: m => {
          if (m.status === 'recognizing text') {
            updateProgress(pct + m.progress * 30, `OCR 인식 중... (${i+1}/${window.ScanApp.images.length})`, Math.round(m.progress*100) + '%');
          }
        },
        tessedit_pageseg_mode: Tesseract.PSM.SINGLE_BLOCK,
      });
      fullText += (i > 0 ? '\n\n---\n\n' : '') + result.data.text.trim();
    }
    updateProgress(100, '완료!', '');
    setTimeout(hideProgress, 500);
    setOCRResult(fullText);
    toast('OCR 완료!', 'success');
    saveRecentDoc('OCR_' + new Date().toLocaleDateString('ko-KR'), 'ocr', window.ScanApp.images[0]?.dataUrl?.substring(0,100), window.ScanApp.images.length);
  } catch (err) {
    hideProgress();
    toast('OCR 오류: ' + err.message, 'error');
    console.error(err);
  }
}

// ─── Gemini Vision API OCR ───────────────────────────────────
async function runGeminiOCR() {
  showProgress('Gemini AI OCR 실행 중...', 'Google AI 연결');
  updateProgress(10, 'Gemini API 호출 중...', '이미지 전송');

  try {
    let fullText = '';
    for (let i = 0; i < window.ScanApp.images.length; i++) {
      updateProgress(10 + (i / window.ScanApp.images.length) * 80, `Gemini OCR 중 (${i+1}/${window.ScanApp.images.length})`, '');
      const img = window.ScanApp.images[i];
      // dataUrl → base64
      const base64 = img.dataUrl.split(',')[1];
      const mimeType = img.dataUrl.split(';')[0].split(':')[1];
      const prompt = `이 이미지에서 모든 텍스트를 추출해주세요. 
      - 한글과 영어 모두 정확하게 인식해주세요.
      - 문단 구조와 줄바꿈을 원본과 동일하게 유지해주세요.
      - 표가 있으면 텍스트 형태로 최대한 구조를 유지해주세요.
      - 인식된 텍스트만 출력하세요. 설명은 포함하지 마세요.`;

      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${window.ScanApp.settings.geminiApiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [
            { text: prompt },
            { inline_data: { mime_type: mimeType, data: base64 } }
          ]}],
          generationConfig: { temperature: 0.1, maxOutputTokens: 8192 }
        })
      });
      if (!res.ok) throw new Error(`Gemini API 오류: ${res.status} ${res.statusText}`);
      const data = await res.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      fullText += (i > 0 ? '\n\n---\n\n' : '') + text.trim();
    }
    updateProgress(100, '완료!', '');
    setTimeout(hideProgress, 500);
    setOCRResult(fullText);
    toast('Gemini OCR 완료!', 'success');
  } catch (err) {
    hideProgress();
    console.error(err);
    toast('Gemini 오류: ' + err.message + ' — Tesseract로 재시도합니다.', 'error');
    await runTesseractOCR();
  }
}

// ─── Set OCR Result ──────────────────────────────────────────
function setOCRResult(text) {
  window.ScanApp.ocrText = text;
  const ta = document.getElementById('ocr-textarea');
  if (ta) ta.value = text;
  const wc = document.getElementById('word-count');
  if (wc) wc.textContent = text.length + '자 · ' + text.split(/\s+/).filter(Boolean).length + '단어';
}

function copyOCRText() {
  const ta = document.getElementById('ocr-textarea');
  if (!ta) return;
  window.ScanApp.ocrText = ta.value;
  navigator.clipboard.writeText(ta.value).then(() => toast('텍스트가 복사되었습니다', 'success'));
}

function downloadOCRText() {
  const ta = document.getElementById('ocr-textarea');
  if (!ta) return;
  const text = ta.value;
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  downloadBlob(blob, 'ocr_result_' + dateStamp() + '.txt');
}

window.runOCR = runOCR;
window.copyOCRText = copyOCRText;
window.downloadOCRText = downloadOCRText;
window.setOCRResult = setOCRResult;
