/**
 * converter.js — Document Format Conversion
 * Word (.docx), HTML, Markdown
 */

// ─── Shared Utilities ────────────────────────────────────────
function getOCRText() {
  const ta = document.getElementById('ocr-textarea');
  const text = (ta?.value || window.ScanApp.ocrText || '').trim();
  if (!text) throw new Error('OCR 텍스트가 없습니다. 먼저 OCR을 실행해주세요.');
  return text;
}

function dateStamp() {
  return new Date().toISOString().slice(0,10).replace(/-/g,'');
}
window.dateStamp = dateStamp;

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
}
window.downloadBlob = downloadBlob;

// ─── Text → HTML structure ───────────────────────────────────
function textToHTMLStructure(text) {
  const lines = text.split('\n');
  let html = '';
  let inTable = false;
  for (const line of lines) {
    const t = line.trim();
    if (!t) { if (inTable) { html += '</table>'; inTable = false; } html += '<br>'; continue; }
    // Separator
    if (t === '---') { html += '<hr>'; continue; }
    // Detect table rows (simple: contains multiple | )
    if ((t.match(/\|/g) || []).length >= 2) {
      if (!inTable) { html += '<table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;width:100%">'; inTable = true; }
      const cells = t.split('|').map(c => c.trim()).filter(Boolean);
      html += '<tr>' + cells.map(c => `<td>${escapeHTML(c)}</td>`).join('') + '</tr>';
      continue;
    }
    if (inTable) { html += '</table>'; inTable = false; }
    html += `<p>${escapeHTML(t)}</p>`;
  }
  if (inTable) html += '</table>';
  return html;
}

function escapeHTML(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ─── Convert to HTML ─────────────────────────────────────────
async function convertToHTML() {
  showProgress('HTML 변환 중...', '');
  try {
    const text = getOCRText();
    const body = textToHTMLStructure(text);
    const html = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>스캔 문서 — ${dateStamp()}</title>
<style>
  body { font-family: 'Noto Sans KR', 'Malgun Gothic', sans-serif; max-width: 800px; margin: 0 auto; padding: 40px 20px; line-height: 1.8; color: #222; }
  p { margin: 0 0 8px; }
  table { border-collapse: collapse; width: 100%; margin: 16px 0; }
  td, th { border: 1px solid #ccc; padding: 8px 12px; }
  hr { border: none; border-top: 1px solid #ddd; margin: 20px 0; }
</style>
</head>
<body>
<h1>스캔 문서</h1>
<p style="color:#888;font-size:0.85em">생성일: ${new Date().toLocaleDateString('ko-KR')} | Document Scanner App</p>
<hr>
${body}
</body>
</html>`;
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    hideProgress();
    showResultPanel('html', html);
    downloadBlob(blob, '문서_' + dateStamp() + '.html');
    toast('HTML 변환 완료!', 'success');
    saveRecentDoc('HTML_' + dateStamp(), 'html', null, 1);
  } catch (err) { hideProgress(); toast(err.message, 'error'); }
}

// ─── Convert to Markdown ─────────────────────────────────────
async function convertToMarkdown() {
  showProgress('Markdown 변환 중...', '');
  try {
    const text = getOCRText();
    const lines = text.split('\n');
    let md = `# 스캔 문서\n\n*생성일: ${new Date().toLocaleDateString('ko-KR')} | Document Scanner App*\n\n---\n\n`;
    for (const line of lines) {
      const t = line.trim();
      if (!t) { md += '\n'; continue; }
      if (t === '---') { md += '---\n'; continue; }
      // Simple table detection
      if ((t.match(/\|/g) || []).length >= 2) {
        md += t + '\n'; continue;
      }
      md += t + '\n';
    }
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    hideProgress();
    showResultPanel('md', md);
    downloadBlob(blob, '문서_' + dateStamp() + '.md');
    toast('Markdown 변환 완료!', 'success');
    saveRecentDoc('MD_' + dateStamp(), 'md', null, 1);
  } catch (err) { hideProgress(); toast(err.message, 'error'); }
}

// ─── Convert to Word (.docx) ─────────────────────────────────
async function convertToWord() {
  showProgress('Word 문서 생성 중...', '');
  try {
    const text = getOCRText();
    if (typeof docx === 'undefined') throw new Error('docx.js가 로딩되지 않았습니다. 인터넷을 확인해주세요.');

    const paragraphs = text.split('\n').map(line => {
      const t = line.trim();
      if (!t) return new docx.Paragraph({ children: [] });
      return new docx.Paragraph({
        children: [new docx.TextRun({ text: t, size: 24, font: 'Malgun Gothic' })],
        spacing: { after: 120 },
      });
    });

    // Add title
    const titlePara = new docx.Paragraph({
      children: [new docx.TextRun({ text: '스캔 문서', bold: true, size: 36, font: 'Malgun Gothic' })],
      spacing: { after: 200 },
      heading: docx.HeadingLevel.HEADING_1,
    });
    const datePara = new docx.Paragraph({
      children: [new docx.TextRun({ text: `생성일: ${new Date().toLocaleDateString('ko-KR')} | Document Scanner App`, size: 18, color: '888888', font: 'Malgun Gothic' })],
      spacing: { after: 400 },
    });

    const doc = new docx.Document({
      sections: [{
        properties: {
          page: {
            margin: { top: 1000, bottom: 1000, left: 1200, right: 1200 },
          },
        },
        children: [titlePara, datePara, ...paragraphs],
      }],
    });

    updateProgress(80, 'Word 파일 생성 중...', '');
    const blob = await docx.Packer.toBlob(doc);
    hideProgress();
    downloadBlob(blob, '문서_' + dateStamp() + '.docx');
    toast('Word 변환 완료!', 'success');
    showResultPanel('word', text);
    saveRecentDoc('WORD_' + dateStamp(), 'word', null, 1);
  } catch (err) { hideProgress(); toast('Word 오류: ' + err.message, 'error'); console.error(err); }
}

// ─── Show Result Panel ───────────────────────────────────────
function showResultPanel(type, content) {
  showPage('result');
  const tab = type === 'md' ? 'md' : type === 'html' ? 'html' : 'convert';
  switchResultTab(tab);
  const pre = document.getElementById('convert-preview');
  if (pre) {
    pre.textContent = content.length > 3000 ? content.substring(0, 3000) + '\n\n... (미리보기 제한)' : content;
  }
}

// ─── Result Tab Switcher ─────────────────────────────────────
function switchResultTab(tab) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.result-pane').forEach(p => p.classList.toggle('active', p.dataset.pane === tab));
}
window.switchResultTab = switchResultTab;

window.convertToHTML     = convertToHTML;
window.convertToMarkdown = convertToMarkdown;
window.convertToWord     = convertToWord;
