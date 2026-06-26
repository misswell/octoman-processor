const { ipcRenderer } = require('electron');
const path = require('path');
const fs = require('fs');

// State
let files = [];
let results = [];
let isCompressing = false;
let outputDir = null;

// DOM Elements
const dropzone = document.getElementById('dropzone');
const settingsPanel = document.getElementById('settingsPanel');
const progressPanel = document.getElementById('progressPanel');
const resultsPanel = document.getElementById('resultsPanel');
const resultsList = document.getElementById('resultsList');
const fileCount = document.getElementById('fileCount');
const qualitySlider = document.getElementById('qualitySlider');
const qualityValue = document.getElementById('qualityValue');
const progressFill = document.getElementById('progressFill');
const progressText = document.getElementById('progressText');
const statOriginal = document.getElementById('statOriginal');
const statCompressed = document.getElementById('statCompressed');
const totalSavings = document.getElementById('totalSavings');
const totalRate = document.getElementById('totalRate');
const resultCount = document.getElementById('resultCount');
const resultTotalSavings = document.getElementById('resultTotalSavings');
const outputDirDisplay = document.getElementById('outputDirDisplay');
const outputDirRow = document.getElementById('outputDirRow');

// Quality slider
qualitySlider.addEventListener('input', () => {
  qualityValue.textContent = qualitySlider.value + '%';
});

// Output mode radio
document.querySelectorAll('input[name="outputMode"]').forEach(radio => {
  radio.addEventListener('change', () => {
    outputDirRow.style.display = radio.value === 'folder' ? 'flex' : 'none';
  });
});

// Drag and drop
dropzone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropzone.classList.add('dragover');
});

dropzone.addEventListener('dragleave', () => {
  dropzone.classList.remove('dragover');
});

dropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropzone.classList.remove('dragover');
  const droppedFiles = Array.from(e.dataTransfer.files);
  handleFiles(droppedFiles);
});

// File selection
async function selectFiles() {
  const filePaths = await ipcRenderer.invoke('select-files');
  if (filePaths && filePaths.length > 0) {
    handleFilePaths(filePaths);
  }
}

async function selectFolder() {
  const folderPaths = await ipcRenderer.invoke('select-folder');
  if (folderPaths && folderPaths.length > 0) {
    handleFilePaths(folderPaths);
  }
}

async function selectOutputDir() {
  const dirs = await ipcRenderer.invoke('select-output-dir');
  if (dirs && dirs.length > 0) {
    outputDir = dirs[0];
    outputDirDisplay.textContent = outputDir;
    outputDirDisplay.title = outputDir;
  }
}

function handleFiles(fileList) {
  const filePaths = [];
  for (const file of fileList) {
    filePaths.push(file.path || file.name);
  }
  handleFilePaths(filePaths);
}

function handleFilePaths(filePaths) {
  if (filePaths.length === 0) return;

  files = filePaths;
  results = [];
  isCompressing = false;
  outputDir = null;
  outputDirDisplay.textContent = '未选择';

  fileCount.textContent = `${files.length} 个文件`;
  settingsPanel.style.display = 'block';
  resultsPanel.style.display = 'none';
  progressPanel.style.display = 'none';

  settingsPanel.scrollIntoView({ behavior: 'smooth' });
}

// Compression
async function startCompression() {
  if (isCompressing || files.length === 0) return;
  isCompressing = true;
  results = [];

  const outputMode = document.querySelector('input[name="outputMode"]:checked').value;
  const options = {
    quality: parseInt(qualitySlider.value),
    smartMode: document.getElementById('smartMode').checked,
    convertToWebp: document.getElementById('convertToWebp').checked,
    outputMode,
    outputDir: outputMode === 'folder' ? outputDir : null,
  };

  if (outputMode === 'folder' && !outputDir) {
    showToast('请先选择输出目录');
    isCompressing = false;
    return;
  }

  // Show progress
  progressPanel.style.display = 'block';
  resultsPanel.style.display = 'none';
  progressFill.style.width = '0%';
  progressText.textContent = `0 / ${files.length}`;
  statOriginal.textContent = '0B';
  statCompressed.textContent = '0B';
  totalSavings.textContent = '0B';
  totalRate.textContent = '0%';

  // Listen for progress
  const progressHandler = (event, data) => {
    const { current, total, file, result } = data;
    const pct = Math.min((current / total) * 100, 100);
    progressFill.style.width = pct + '%';
    progressText.textContent = `${current} / ${total}`;

    if (result) {
      results.push(result);
      updateStats();
    }
  };

  ipcRenderer.on('compress-progress', progressHandler);

  try {
    const compressResults = await ipcRenderer.invoke('compress-files', files, options);
    results = compressResults;
    updateStats();
    showResults();
  } catch (err) {
    console.error('Compression error:', err);
    showToast('压缩出错: ' + err.message);
  } finally {
    ipcRenderer.removeListener('compress-progress', progressHandler);
    isCompressing = false;
    progressFill.style.width = '100%';
  }
}

function updateStats() {
  let totalOriginal = 0;
  let totalCompressed = 0;
  let successCount = 0;

  for (const r of results) {
    if (r.success) {
      totalOriginal += r.originalSize || 0;
      totalCompressed += r.compressedSize || 0;
      successCount++;
    }
  }

  const savings = totalOriginal - totalCompressed;
  const rate = totalOriginal > 0 ? ((savings / totalOriginal) * 100) : 0;

  statOriginal.textContent = formatBytes(totalOriginal);
  statCompressed.textContent = formatBytes(totalCompressed);
  totalSavings.textContent = formatBytes(savings);
  totalRate.textContent = rate.toFixed(1) + '%';
}

function showResults() {
  resultsPanel.style.display = 'block';

  let totalOriginal = 0;
  let totalCompressed = 0;
  let successCount = 0;

  for (const r of results) {
    if (r.success) {
      totalOriginal += r.originalSize || 0;
      totalCompressed += r.compressedSize || 0;
      successCount++;
    }
  }

  resultCount.textContent = successCount;
  resultTotalSavings.textContent = formatBytes(totalOriginal - totalCompressed);

  resultsList.innerHTML = '';

  for (const r of results) {
    const item = document.createElement('div');
    item.className = `result-item ${r.success ? 'success' : 'fail'}`;

    const ext = (r.type || path.extname(r.file).replace('.', '').toLowerCase() || '?');
    const filename = path.basename(r.file);

    const savingsClass = r.savings < 0 ? 'negative' : '';
    const savingsText = r.savings >= 0 ? '-' + r.savings.toFixed(1) + '%' : '+' + Math.abs(r.savings).toFixed(1) + '%';

    item.innerHTML = `
      <div class="result-icon ${ext}">${ext}</div>
      <div class="result-info">
        <div class="result-filename" title="${filename}">${filename}</div>
        <div class="result-sizes">
          ${r.originalSizeFormatted || '?'} → ${r.compressedSizeFormatted || '?'}
          ${r.algorithm ? `<span style="color:var(--text-tertiary);font-size:10px"> · ${r.algorithm}</span>` : ''}
        </div>
      </div>
      <div class="result-savings ${savingsClass}">${savingsText}</div>
      <div class="result-actions">
        <button class="btn-icon" onclick="saveResult('${r.file.replace(/'/g, "\\'")}')" title="另存为">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><path d="M11 0H3a1 1 0 00-1 1v12a1 1 0 001 1h8a1 1 0 001-1V1a1 1 0 00-1-1zm-1 12H4V2h6v10z"/></svg>
        </button>
        <button class="btn-icon" onclick="openInFinder('${r.file.replace(/'/g, "\\'")}')" title="在访达中显示">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><path d="M1 2.5A1.5 1.5 0 012.5 1h3.172a1.5 1.5 0 011.06.44l.94.94H11.5A1.5 1.5 0 0113 3.88V11.5a1.5 1.5 0 01-1.5 1.5h-9A1.5 1.5 0 011 11.5V2.5z"/></svg>
        </button>
      </div>
    `;

    resultsList.appendChild(item);
  }

  resultsPanel.scrollIntoView({ behavior: 'smooth' });
}

async function saveResult(filePath) {
  const result = results.find(r => r.file === filePath);
  if (!result || !result.buffer) return;

  const savedPath = await ipcRenderer.invoke('save-file', filePath, result.buffer);
  if (savedPath) {
    showToast('已保存到: ' + path.basename(savedPath));
  }
}

function openInFinder(filePath) {
  ipcRenderer.invoke('open-in-finder', filePath);
}

async function exportAll() {
  let count = 0;
  for (const r of results) {
    if (r.success && r.buffer) {
      const dir = path.dirname(r.file);
      const ext = path.extname(r.file);
      const base = path.basename(r.file, ext);
      const outPath = path.join(dir, `${base}_compressed${ext}`);
      try {
        fs.writeFileSync(outPath, r.buffer);
        count++;
      } catch (e) {
        console.error('Export error:', e);
      }
    }
  }
  showToast(`已导出 ${count} 个文件到原目录（_compressed 后缀）`);
}

function clearResults() {
  results = [];
  files = [];
  resultsList.innerHTML = '';
  resultsPanel.style.display = 'none';
  progressPanel.style.display = 'none';
  settingsPanel.style.display = 'none';
}

function formatBytes(bytes) {
  if (bytes === 0) return '0B';
  if (bytes < 1024) return bytes.toFixed(1) + 'B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + 'KB';
  return (bytes / (1024 * 1024)).toFixed(1) + 'MB';
}

// Toast notification
function showToast(message) {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.3s';
    setTimeout(() => toast.remove(), 300);
  }, 2500);
}
