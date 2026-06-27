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
const resultsPanel = document.getElementById('resultsPanel');
const resultsList = document.getElementById('resultsList');
const fileCount = document.getElementById('fileCount');
const qualitySlider = document.getElementById('qualitySlider');
const qualityValue = document.getElementById('qualityValue');
const statOriginal = document.getElementById('statOriginal');
const statCompressed = document.getElementById('statCompressed');
const totalSavings = document.getElementById('totalSavings');
const totalRate = document.getElementById('totalRate');
const resultCount = document.getElementById('resultCount');
const resultTotalSavings = document.getElementById('resultTotalSavings');
const outputDirDisplay = document.getElementById('outputDirDisplay');
const comparePanel = document.getElementById('comparePanel');
const compareOriginalImg = document.getElementById('compareOriginalImg');
const compareCompressedImg = document.getElementById('compareCompressedImg');
const compareHandle = document.getElementById('compareHandle');
const compareFilename = document.getElementById('compareFilename');
const compareOriginalSize = document.getElementById('compareOriginalSize');
const compareCompressedSize = document.getElementById('compareCompressedSize');
const compareSavings = document.getElementById('compareSavings');
const compareAlgorithm = document.getElementById('compareAlgorithm');
let currentCompareResult = null;
let currentCompareZoom = 1;
const outputDirRow = document.getElementById('outputDirRow');

// Quality slider
qualitySlider.addEventListener('input', () => {
  qualityValue.textContent = qualitySlider.value + '%';
  const pct = qualitySlider.value;
  qualitySlider.style.background = 'linear-gradient(90deg, var(--primary) ' + pct + '%, #e2e8f0 ' + pct + '%)';
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

  // Append new files, deduplicate
  var existing = new Set(files);
  for (var i = 0; i < filePaths.length; i++) {
    if (!existing.has(filePaths[i])) {
      files.push(filePaths[i]);
      existing.add(filePaths[i]);
    }
  }

  // Show queue panel (and settings if not yet shown)
  var queuePanel = document.getElementById('queuePanel');
  if (queuePanel) queuePanel.style.display = 'block';
  settingsPanel.style.display = 'block';
  resultsPanel.style.display = 'none';
  updateQueueSummary();
  renderFileQueue();
  queuePanel.scrollIntoView({ behavior: 'smooth' });
}

// Global state for compression
var fileRows = {};      // filePath -> row element
var cancelledFiles = new Set();
var totalDone = 0;
var totalFiles = 0;

function updateQueueSummary() {
  var summary = document.getElementById('queueSummary');
  if (!summary) return;
  if (isCompressing) {
    summary.textContent = totalDone + ' / ' + totalFiles + ' 已完成';
  } else {
    summary.textContent = files.length + ' 个文件';
  }
}

function renderFileQueue() {
  var list = document.getElementById('fileQueueList');
  if (!list) return;
  list.innerHTML = '';
  fileRows = {};
  for (var i = 0; i < files.length; i++) {
    var row = createQueueRow(files[i]);
    fileRows[files[i]] = row;
    list.appendChild(row);
  }
}

function createQueueRow(filePath) {
  var row = document.createElement('div');
  row.className = 'file-queue-item waiting';
  row.dataset.file = filePath;
  var name = filePath.split('/').pop() || filePath;
  var origSize = '';
  try { origSize = formatBytes(fs.statSync(filePath).size); } catch (e) {}
  row.innerHTML =
    '<span class="queue-item-icon">○</span>' +
    '<span class="queue-item-name">' + name + '</span>' +
    '<span class="queue-item-size">' + origSize + '</span>' +
    '<span class="queue-item-status">等待中</span>' +
    '<button class="queue-item-remove" title="移除">×</button>' +
    '<div class="progress-file-bar"></div>';
  var rmBtn = row.querySelector('.queue-item-remove');
  rmBtn.addEventListener('click', function(e) {
    e.stopPropagation();
    if (row.classList.contains('waiting')) {
      // If compressing, notify main process to skip
      if (isCompressing) {
        cancelledFiles.add(filePath);
        ipcRenderer.invoke('cancel-file', filePath);
      }
      // Remove from files array
      var idx = files.indexOf(filePath);
      if (idx >= 0) files.splice(idx, 1);
      // Update UI
      row.classList.remove('waiting');
      row.classList.add('cancelled');
      row.querySelector('.queue-item-icon').textContent = '—';
      row.querySelector('.queue-item-status').textContent = '已移除';
      row.querySelector('.queue-item-remove').style.display = 'none';
      if (!isCompressing) {
        updateQueueSummary();
      } else {
        totalFiles--;
        updateQueueSummary();
      }
    }
  });
  return row;
}

// Clear all files with confirmation
function clearAllFiles() {
  if (files.length === 0) return;
  if (!confirm('确定要清空全部 ' + files.length + ' 个文件吗？')) return;
  files = [];
  results = [];
  fileRows = {};
  cancelledFiles.clear();
  totalDone = 0;
  totalFiles = 0;
  isCompressing = false;
  var queuePanel = document.getElementById('queuePanel');
  if (queuePanel) queuePanel.style.display = 'none';
  settingsPanel.style.display = 'none';
  resultsPanel.style.display = 'none';
  var list = document.getElementById('fileQueueList');
  if (list) list.innerHTML = '';
  var stats = document.getElementById('queueStats');
  if (stats) stats.style.display = 'none';
}

// Compression
async function startCompression() {
  if (isCompressing || files.length === 0) return;
  isCompressing = true;
  results = [];

  const outputMode = document.querySelector('input[name="outputMode"]:checked').value;
  const outputFormat = document.getElementById('outputFormat').value;
  const backend = document.getElementById('compressionBackend').value;
  const effort = parseInt(document.getElementById('compressionEffort').value);
  const smartMode = document.getElementById('smartMode').checked;
  const convertToWebp = document.getElementById('convertToWebp').checked;

  let effectiveFormat = outputFormat;
  if (convertToWebp && outputFormat === 'original') {
    effectiveFormat = 'webp';
  }

  const options = {
    quality: parseInt(qualitySlider.value),
    smartMode,
    outputFormat: effectiveFormat,
    backend,
    effort,
    convertToWebp,
    outputMode,
    outputDir: outputMode === 'folder' ? outputDir : null,
  };

  if (outputMode === 'folder' && !outputDir) {
    showToast('请先选择输出目录');
    isCompressing = false;
    return;
  }

  const useSmartIpc = smartMode || effectiveFormat !== 'original';

  // Show stats, reset counters
  var queueStats = document.getElementById('queueStats');
  if (queueStats) queueStats.style.display = 'flex';
  statOriginal.textContent = '0B';
  statCompressed.textContent = '0B';
  totalSavings.textContent = '0B';
  totalRate.textContent = '0%';

  // Update all existing rows to "waiting" state (in case of re-compress)
  cancelledFiles.clear();
  totalDone = 0;
  totalFiles = files.length;
  updateQueueSummary();

  // Disable start button during compression
  var startBtn = document.getElementById('startCompressBtn');
  if (startBtn) startBtn.disabled = true;

  // Re-render queue to reset any done/failed states
  renderFileQueue();

  // Progress handler - updates existing rows in place
  const progressHandler = (event, data) => {
    var file = data.file, result = data.result, status = data.status;
    var row = fileRows[file];
    if (!row) return;

    if (status === 'starting') {
      row.classList.remove('waiting');
      row.classList.add('compressing');
      row.querySelector('.queue-item-icon').innerHTML = '<span class="progress-file-spinner"></span>';
      row.querySelector('.queue-item-status').textContent = '压缩中…';
      var rmBtn = row.querySelector('.queue-item-remove');
      if (rmBtn) rmBtn.style.display = 'none';
    }

    if (result) {
      row.classList.remove('compressing');
      row.classList.add(result.success ? 'done' : 'failed');
      row.querySelector('.queue-item-icon').innerHTML = result.success ? '✓' : '✗';
      var sizeEl = row.querySelector('.queue-item-size');
      if (result.success && sizeEl) {
        sizeEl.textContent = formatBytes(result.originalSize) + ' → ' + formatBytes(result.compressedSize);
      }
      var savingsText = result.success
        ? (result.savings >= 0 ? '-' : '+') + Math.abs(result.savings).toFixed(1) + '%'
        : '失败';
      row.querySelector('.queue-item-status').textContent = savingsText;
      results.push(result);
      updateStats();
      totalDone++;
      updateQueueSummary();
    }

    if (status === 'cancelled' && row) {
      row.classList.add('cancelled');
      row.querySelector('.queue-item-icon').textContent = '—';
      row.querySelector('.queue-item-status').textContent = '已跳过';
    }
  };

  ipcRenderer.on('compress-progress', progressHandler);

  try {
    await ipcRenderer.invoke(useSmartIpc ? 'compress-smart' : 'compress-files', files, options);
    updateStats();
    showResults();
  } catch (err) {
    console.error('Compression error:', err);
    showToast('压缩出错: ' + err.message);
  } finally {
    ipcRenderer.removeListener('compress-progress', progressHandler);
    isCompressing = false;
    if (startBtn) startBtn.disabled = false;
    updateQueueSummary();
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
    const outExt = r.type || ext;

    item.innerHTML = `
      <div class="result-icon ${outExt}">${outExt}</div>
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
        <button class="btn-icon" onclick="openCompareByFile('${r.file.replace(/'/g, "\\'")}')" title="对比查看">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><path d="M2 2h4v4H2V2zm0 6h4v4H2V8zm6-6h4v4H8V2zm0 6h4v4H8V8z"/></svg>
        </button>
        <button class="btn-icon" onclick="restoreOriginal('${r.file.replace(/'/g, "\\'")}', '${r._backupPath || ""}', '${r._outputMode || "suffix"}')" title="恢复原图">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><path d="M7 1a6 6 0 100 12A6 6 0 007 1zm0 10V7H4l3-4 3 4H7v4z"/></svg>
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

async function restoreOriginal(filePath, backupPath, outputMode) {
  const result = await ipcRenderer.invoke('restore-original', filePath, backupPath, outputMode);
  if (result.success) {
    showToast('已恢复原图: ' + path.basename(filePath));
    results = results.filter(r => r.file !== filePath);
    showResults();
  } else {
    showToast('恢复失败: ' + (result.error || '未知错误'));
  }
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
  fileRows = {};
  cancelledFiles.clear();
  totalDone = 0;
  totalFiles = 0;
  resultsList.innerHTML = '';
  resultsPanel.style.display = 'none';
  var queuePanel = document.getElementById('queuePanel');
  if (queuePanel) queuePanel.style.display = 'none';
  var queueStats = document.getElementById('queueStats');
  if (queueStats) queueStats.style.display = 'none';
  settingsPanel.style.display = 'none';
  var list = document.getElementById('fileQueueList');
  if (list) list.innerHTML = '';
}

function formatBytes(bytes) {
  if (bytes === 0) return '0B';
  if (bytes < 1024) return bytes.toFixed(1) + 'B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + 'KB';
  return (bytes / (1024 * 1024)).toFixed(1) + 'MB';
}


// ─── Comparison ─────────────────────────────────────────────────
// ─── Recompress with new quality ────────────────────────────────
async function recompressWithQuality(quality) {
  if (!currentCompareResult) return;
  const result = currentCompareResult;
  const recompressBtn = document.getElementById("recompressBtn");
  if (recompressBtn) recompressBtn.disabled = true;

  try {
    const options = {
      quality: parseInt(quality),
      backend: "auto",
      effort: 6,
    };
    const newResult = await ipcRenderer.invoke("compress-single", result.file, options);
    if (newResult && newResult.success && newResult.buffer) {
      // Update the compressed image in the comparison
      if (compareCompressedImg.src) {
        URL.revokeObjectURL(compareCompressedImg.src);
      }
      const compressedBlob = new Blob([newResult.buffer], { type: "image/" + (newResult.type || "png") });
      compareCompressedImg.src = URL.createObjectURL(compressedBlob);

      // Update info
      compareCompressedSize.textContent = newResult.compressedSizeFormatted || "?";
      compareSavings.textContent = (newResult.savings >= 0 ? "-" : "+") + Math.abs(newResult.savings).toFixed(1) + "%";
      compareAlgorithm.textContent = newResult.algorithm || "?";

      // Update the result in results array
      const idx = results.findIndex(r => r.file === result.file);
      if (idx >= 0) {
        results[idx] = { ...results[idx], ...newResult };
      }
      currentCompareResult = { ...result, ...newResult };

      showToast("重新压缩完成 (质量: " + quality + "%)");
    } else {
      showToast("重新压缩失败");
    }
  } catch (err) {
    showToast("重新压缩出错: " + err.message);
  } finally {
    if (recompressBtn) recompressBtn.disabled = false;
  }
}

async function openCompare(result) {
  currentCompareResult = result;

  // Load original image as data URL
  const originalDataUrl = await ipcRenderer.invoke('read-image-dataurl', result.file);
  if (!originalDataUrl) {
    showToast('无法加载原图');
    return;
  }

  // Set images
  const compressedBlob = new Blob([result.buffer], { type: 'image/' + (result.type || 'png') });
  compareCompressedImg.src = URL.createObjectURL(compressedBlob);
  compareOriginalImg.src = originalDataUrl;

  // Set container aspect-ratio to match image, eliminating object-fit
  // letterboxing so clip-path maps directly to image pixels (no offset).
  var outer = document.getElementById('compareSliderOuter');
  var setRatio = function() {
    var w = compareOriginalImg.naturalWidth || compareCompressedImg.naturalWidth;
    var h = compareOriginalImg.naturalHeight || compareCompressedImg.naturalHeight;
    if (w && h) {
      outer.style.aspectRatio = w + ' / ' + h;
    }
  };
  if (compareOriginalImg.naturalWidth) setRatio();
  else compareOriginalImg.onload = setRatio;

  // Reset zoom and slider
  setCompareZoom(1);
  updateCompareSlider(50);

  // Set info
  compareFilename.textContent = result.file.split('/').pop() || result.file.split('\\').pop();
  compareOriginalSize.textContent = result.originalSizeFormatted || '?';
  compareCompressedSize.textContent = result.compressedSizeFormatted || '?';
  compareSavings.textContent = (result.savings >= 0 ? '-' : '+') + Math.abs(result.savings).toFixed(1) + '%';
  compareAlgorithm.textContent = result.algorithm || '?';

  // Show modal with backdrop
  document.getElementById('modalBackdrop').style.display = 'block';
  comparePanel.style.display = 'flex';
  document.body.style.overflow = 'hidden';
}

// ── Compare slider: clip-path + handle position ──────────────────
// The clip line position is stored as a percentage [0-100] of the
// VISIBLE container width (not the full image). When zoomed in,
// updateCompareSlider translates this to an absolute image-space
// percentage for the clip-path.
function updateCompareSlider(value) {
  var sliderBar = document.getElementById('compareRange');
  if (sliderBar) sliderBar.value = Math.round(value);

  var outer = document.getElementById('compareSliderOuter');
  var container = document.getElementById('compareSliderContainer');
  var zoom = currentCompareZoom || 1;
  var cw = outer.clientWidth;
  var sl = container.scrollLeft;

  // The clip line in screen pixels (from left edge of viewport)
  var clipLinePx = sl + (value / 100) * cw;
  // Total image width in pixels
  var imgWidth = cw * zoom;
  // Convert to percentage of image width for clip-path
  var clipLinePct = (clipLinePx / imgWidth) * 100;
  var clipRight = Math.max(0, Math.min(100, 100 - clipLinePct));

  compareOriginalImg.style.clipPath = 'inset(0 ' + clipRight + '% 0 0)';
  // Move handle to the screen position (percentage of visible width)
  compareHandle.style.left = value + '%';
}

// ── Zoom: zoom toward the compare axis position ──────────────────
// Before changing zoom, record which image point sits under the
// compare axis. After zoom, scroll so that the same image point
// remains under the axis. Vertically, zoom toward viewport center.
function setCompareZoom(level) {
  level = Math.max(0.1, Math.min(8, level));
  var outer = document.getElementById('compareSliderOuter');
  var container = document.getElementById('compareSliderContainer');
  var oldZoom = currentCompareZoom || 1;
  var cw = outer.clientWidth;
  var ch = outer.clientHeight;

  // Current slider value (0-100, percentage of visible width)
  var sliderBar = document.getElementById('compareRange');
  var sliderVal = sliderBar ? parseFloat(sliderBar.value) : 50;

  // Image point under the compare axis (normalized 0-1 of full image)
  var axisImgX = (container.scrollLeft + (sliderVal / 100) * cw) / (cw * oldZoom);
  // Vertical center point (normalized 0-1 of full image)
  var centerY = (container.scrollTop + ch / 2) / (ch * oldZoom);

  // Apply new zoom
  currentCompareZoom = level;
  container.style.setProperty('--zoom', level);
  outer.style.setProperty('--zoom', level);

  // Scroll so the same image points stay under the axis / center
  var newImgW = cw * level;
  var newImgH = ch * level;
  container.scrollLeft = axisImgX * newImgW - (sliderVal / 100) * cw;
  container.scrollTop = centerY * newImgH - ch / 2;

  // Update zoom slider and label
  var zoomSlider = document.getElementById('zoomSlider');
  if (zoomSlider) zoomSlider.value = level;
  var zoomValue = document.getElementById('zoomValue');
  if (zoomValue) zoomValue.textContent = Math.round(level * 100) + '%';

  // Refresh clip-path for new scroll position
  updateCompareSlider(sliderVal);
}

// Step zoom for +/- buttons
function stepZoom(delta) {
  setCompareZoom(currentCompareZoom + delta);
}

// ── Fullscreen toggle ────────────────────────────────────────────
function toggleFullscreen() {
  comparePanel.classList.toggle('fullscreen');
}

// ── Close compare ────────────────────────────────────────────────
function closeCompare() {
  comparePanel.style.display = 'none';
  comparePanel.classList.remove('fullscreen');
  document.getElementById('modalBackdrop').style.display = 'none';
  document.body.style.overflow = '';
  if (compareCompressedImg.src) {
    URL.revokeObjectURL(compareCompressedImg.src);
  }
  currentCompareResult = null;
  setCompareZoom(1);
}

// ── Recompress quality slider ────────────────────────────────────
var recompressQualitySlider = document.getElementById('recompressQuality');
var recompressQualityValue = document.getElementById('recompressQualityValue');
if (recompressQualitySlider) {
  recompressQualitySlider.addEventListener('input', function() {
    recompressQualityValue.textContent = recompressQualitySlider.value + '%';
  });
}

// ── Compare interaction: hover-follow + drag + wheel zoom ────────
(function setupCompareDrag() {
  var outer = document.getElementById('compareSliderOuter');
  var container = document.getElementById('compareSliderContainer');
  var sliderBar = document.getElementById('compareRange');
  if (!outer || !container) return;

  var isPointerDown = false;

  function getPercent(clientX) {
    var rect = outer.getBoundingClientRect();
    var x = clientX - rect.left;
    return Math.max(0, Math.min(100, (x / rect.width) * 100));
  }

  // Mouse-hover follow: move clip line to cursor position.
  outer.addEventListener('mousemove', function(e) {
    var pct = getPercent(e.clientX);
    updateCompareSlider(pct);
  });

  // Touch / drag support
  function onPointerDown(e) {
    isPointerDown = true;
    e.preventDefault();
    var clientX = e.touches ? e.touches[0].clientX : e.clientX;
    updateCompareSlider(getPercent(clientX));
  }

  function onPointerMove(e) {
    if (!isPointerDown) return;
    e.preventDefault();
    var clientX = e.touches ? e.touches[0].clientX : e.clientX;
    updateCompareSlider(getPercent(clientX));
  }

  function onPointerUp() { isPointerDown = false; }

  outer.addEventListener('mousedown', onPointerDown);
  outer.addEventListener('touchstart', onPointerDown, { passive: false });
  document.addEventListener('mousemove', onPointerMove);
  document.addEventListener('mouseup', onPointerUp);
  document.addEventListener('touchmove', onPointerMove, { passive: false });
  document.addEventListener('touchend', onPointerUp);

  // Slider bar direct control
  if (sliderBar) {
    sliderBar.addEventListener('input', function() {
      updateCompareSlider(this.value);
    });
  }

  // Wheel zoom: zoom toward mouse position
  outer.addEventListener('wheel', function(e) {
    if (!e.ctrlKey && !e.metaKey) return; // require Ctrl/Cmd for zoom
    e.preventDefault();
    var oldZoom = currentCompareZoom || 1;
    var delta = e.deltaY < 0 ? 0.25 : -0.25;
    var newZoom = Math.max(0.1, Math.min(8, oldZoom + delta));

    // Zoom toward mouse X position
    var rect = outer.getBoundingClientRect();
    var mouseX = e.clientX - rect.left;
    var mousePct = (mouseX / rect.width) * 100;

    var cw = outer.clientWidth;
    var ch = outer.clientHeight;
    var mouseImgX = (container.scrollLeft + mouseX) / (cw * oldZoom);
    var mouseImgY = (container.scrollTop + (e.clientY - rect.top)) / (ch * oldZoom);

    currentCompareZoom = newZoom;
    container.style.setProperty('--zoom', newZoom);
    container.scrollLeft = mouseImgX * (cw * newZoom) - mouseX;
    container.scrollTop = mouseImgY * (ch * newZoom) - (e.clientY - rect.top);

    var zoomSlider = document.getElementById('zoomSlider');
    if (zoomSlider) zoomSlider.value = newZoom;
    var zoomValue = document.getElementById('zoomValue');
    if (zoomValue) zoomValue.textContent = Math.round(newZoom * 100) + '%';

    // Keep clip line at the same image point
    var sliderVal = sliderBar ? parseFloat(sliderBar.value) : 50;
    updateCompareSlider(sliderVal);
  }, { passive: false });

  // Update clip-path when scrolling
  container.addEventListener('scroll', function() {
    if (sliderBar) updateCompareSlider(sliderBar.value);
  });

  // Zoom slider control
  var zoomSliderEl = document.getElementById('zoomSlider');
  if (zoomSliderEl) {
    zoomSliderEl.addEventListener('input', function() {
      setCompareZoom(parseFloat(this.value));
    });
  }
})();

// Keyboard shortcut: Escape to close
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && comparePanel.style.display !== 'none') {
    closeCompare();
  }
});

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

// Restore from compare modal
async function restoreFromCompare() {
  if (!currentCompareResult) return;
  const r = currentCompareResult;
  await restoreOriginal(r.file, r._backupPath || '', r._outputMode || 'suffix');
  closeCompare();
}

// Toggle window controls / about
function toggleWindowControls() {
  showToast('Octor Compressor v' + (window.appVersion || '1.1.0'));
}

// Helper to find result by file path and open compare
function openCompareByFile(filePath) {
  const result = results.find(r => r.file === filePath);
  if (result) openCompare(result);
}

// Init quality slider gradient
(function() {
  const qs = document.getElementById('qualitySlider');
  if (qs) {
    const pct = qs.value;
    qs.style.background = 'linear-gradient(90deg, var(--primary) ' + pct + '%, #e2e8f0 ' + pct + '%)';
  }
})();
