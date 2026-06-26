const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

// ─── Image type detection ───────────────────────────────────────
function detectImageType(filePath) {
  const buffer = fs.readFileSync(filePath).subarray(0, 12);
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) return 'png';
  if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) return 'jpg';
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) return 'gif';
  if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46) return 'webp';
  if (buffer[0] === 0x42 && buffer[1] === 0x4D) return 'bmp';
  return 'unknown';
}

function getFileSize(filePath) {
  return fs.statSync(filePath).size;
}

function formatBytes(bytes) {
  if (bytes < 1024) return bytes.toFixed(1) + 'B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + 'KB';
  return (bytes / (1024 * 1024)).toFixed(1) + 'MB';
}

// ─── Tool discovery ─────────────────────────────────────────────
function findTool(name, extraPaths) {
  const searchPaths = [
    ...(extraPaths || []),
    '/opt/homebrew/opt/mozjpeg/bin',
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin',
    '/opt/local/bin',
  ];
  for (const dir of searchPaths) {
    const fullPath = path.join(dir, name);
    if (fs.existsSync(fullPath)) return fullPath;
  }
  try {
    const result = execSync(`which ${name} 2>/dev/null`).toString().trim();
    if (result) return result;
  } catch (e) {}
  return name;
}

const PNGQUANT   = findTool('pngquant');
const MOZJPEG    = fs.existsSync('/opt/homebrew/opt/mozjpeg/bin/cjpeg') ? '/opt/homebrew/opt/mozjpeg/bin/cjpeg' : findTool('cjpeg');
const GIFSICLE   = findTool('gifsicle');
const CWEBP      = findTool('cwebp');

// ─── Smart analysis ─────────────────────────────────────────────
function analyzeImage(filePath, type) {
  const size = getFileSize(filePath);
  let quality = 75;

  if (size > 5 * 1024 * 1024)       quality = 60;
  else if (size > 2 * 1024 * 1024)  quality = 65;
  else if (size > 1024 * 1024)      quality = 70;
  else if (size > 500 * 1024)       quality = 75;
  else                              quality = 80;

  return { quality, size };
}

// ─── Helpers ────────────────────────────────────────────────────
function fallbackResult(filePath, originalSize, type, algorithm) {
  return {
    success: false,
    file: filePath,
    originalSize,
    compressedSize: originalSize,
    savings: 0,
    originalSizeFormatted: formatBytes(originalSize),
    compressedSizeFormatted: formatBytes(originalSize),
    buffer: fs.readFileSync(filePath),
    type,
    algorithm,
    error: 'Compression failed, using original',
  };
}

function cleanup(tmpDir) {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {}
}

function makeResult(filePath, originalSize, compressedSize, buffer, type, algorithm) {
  const savings = ((originalSize - compressedSize) / originalSize * 100);
  return {
    success: true,
    file: filePath,
    originalSize,
    compressedSize,
    savings: parseFloat(savings.toFixed(1)),
    originalSizeFormatted: formatBytes(originalSize),
    compressedSizeFormatted: formatBytes(compressedSize),
    buffer,
    type,
    algorithm,
  };
}

// ─── Individual compressors ─────────────────────────────────────
async function compressPNG(filePath, options = {}) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'octoman-'));
  const tmpFile = path.join(tmpDir, 'compressed.png');
  const originalSize = getFileSize(filePath);
  const analysis = analyzeImage(filePath, 'png');
  const quality = options.quality || analysis.quality;

  try {
    const qLow = Math.max(quality - 10, 10);
    const qHigh = Math.min(quality + 10, 100);
    const cmd = `"${PNGQUANT}" --quality=${qLow}-${qHigh} --speed=3 --strip --output="${tmpFile}" -- "${filePath}" 2>/dev/null`;
    execSync(cmd, { timeout: 30000 });

    if (fs.existsSync(tmpFile) && getFileSize(tmpFile) > 0) {
      const compressedSize = getFileSize(tmpFile);
      const buffer = fs.readFileSync(tmpFile);
      cleanup(tmpDir);
      return makeResult(filePath, originalSize, compressedSize, buffer, 'png', 'pngquant');
    }
  } catch (e) { /* fall through */ }
  cleanup(tmpDir);
  return fallbackResult(filePath, originalSize, 'png', 'pngquant');
}

async function compressJPG(filePath, options = {}) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'octoman-'));
  const tmpFile = path.join(tmpDir, 'compressed.jpg');
  const originalSize = getFileSize(filePath);
  const analysis = analyzeImage(filePath, 'jpg');
  const quality = options.quality || analysis.quality;

  try {
    const cmd = `"${MOZJPEG}" -quality ${quality} -optimize -progressive -outfile "${tmpFile}" "${filePath}" 2>/dev/null`;
    execSync(cmd, { timeout: 30000 });

    if (fs.existsSync(tmpFile) && getFileSize(tmpFile) > 0) {
      const compressedSize = getFileSize(tmpFile);
      const buffer = fs.readFileSync(tmpFile);
      cleanup(tmpDir);
      return makeResult(filePath, originalSize, compressedSize, buffer, 'jpg', 'mozjpeg');
    }
  } catch (e) { /* fall through */ }
  cleanup(tmpDir);
  return fallbackResult(filePath, originalSize, 'jpg', 'mozjpeg');
}

async function compressGIF(filePath, options = {}) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'octoman-'));
  const tmpFile = path.join(tmpDir, 'compressed.gif');
  const originalSize = getFileSize(filePath);
  const analysis = analyzeImage(filePath, 'gif');
  const quality = options.quality || analysis.quality;

  try {
    const colors = Math.max(Math.floor(quality / 100 * 256), 32);
    const cmd = `"${GIFSICLE}" --optimize=3 --colors=${colors} --no-comments --output="${tmpFile}" "${filePath}" 2>/dev/null`;
    execSync(cmd, { timeout: 30000 });

    if (fs.existsSync(tmpFile) && getFileSize(tmpFile) > 0) {
      const compressedSize = getFileSize(tmpFile);
      const buffer = fs.readFileSync(tmpFile);
      cleanup(tmpDir);
      return makeResult(filePath, originalSize, compressedSize, buffer, 'gif', 'gifsicle');
    }
  } catch (e) { /* fall through */ }
  cleanup(tmpDir);
  return fallbackResult(filePath, originalSize, 'gif', 'gifsicle');
}

async function compressToWebP(filePath, options = {}) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'octoman-'));
  const tmpFile = path.join(tmpDir, 'compressed.webp');
  const originalSize = getFileSize(filePath);
  const analysis = analyzeImage(filePath, 'webp');
  const quality = options.quality || analysis.quality;

  try {
    const cmd = `"${CWEBP}" -q ${quality} -m 6 -pass 10 -mt -o "${tmpFile}" "${filePath}" 2>/dev/null`;
    execSync(cmd, { timeout: 30000 });

    if (fs.existsSync(tmpFile) && getFileSize(tmpFile) > 0) {
      const compressedSize = getFileSize(tmpFile);
      const buffer = fs.readFileSync(tmpFile);
      cleanup(tmpDir);
      return makeResult(filePath, originalSize, compressedSize, buffer, 'webp', 'cwebp');
    }
  } catch (e) { /* fall through */ }
  cleanup(tmpDir);
  return fallbackResult(filePath, originalSize, 'webp', 'cwebp');
}

/**
 * Convert any supported image to WebP
 */
async function convertToWebP(filePath, options = {}) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'octoman-'));
  const tmpFile = path.join(tmpDir, 'converted.webp');
  const originalSize = getFileSize(filePath);
  const analysis = analyzeImage(filePath, 'webp');
  const quality = options.quality || analysis.quality;

  try {
    const cmd = `"${CWEBP}" -q ${quality} -m 6 -pass 10 -mt -o "${tmpFile}" "${filePath}" 2>/dev/null`;
    execSync(cmd, { timeout: 30000 });

    if (fs.existsSync(tmpFile) && getFileSize(tmpFile) > 0) {
      const compressedSize = getFileSize(tmpFile);
      const buffer = fs.readFileSync(tmpFile);
      cleanup(tmpDir);
      return makeResult(filePath, originalSize, compressedSize, buffer, 'webp', 'cwebp');
    }
  } catch (e) { /* fall through */ }
  cleanup(tmpDir);
  return fallbackResult(filePath, originalSize, 'webp', 'cwebp');
}

// ─── Main API ───────────────────────────────────────────────────
async function compressImage(filePath, options = {}) {
  const type = detectImageType(filePath);

  // If convertToWebp is set, convert any format to WebP
  if (options.convertToWebp && type !== 'webp') {
    return await convertToWebP(filePath, options);
  }

  switch (type) {
    case 'png':  return await compressPNG(filePath, options);
    case 'jpg':  return await compressJPG(filePath, options);
    case 'gif':  return await compressGIF(filePath, options);
    case 'webp': return await compressToWebP(filePath, options);
    default:
      return {
        success: false,
        file: filePath,
        error: `Unsupported image type: ${type}`,
        originalSize: getFileSize(filePath),
        compressedSize: getFileSize(filePath),
        savings: 0,
        originalSizeFormatted: formatBytes(getFileSize(filePath)),
        compressedSizeFormatted: formatBytes(getFileSize(filePath)),
        buffer: fs.readFileSync(filePath),
        type,
      };
  }
}

async function compressFolder(folderPath, options = {}, progressCallback) {
  const allFiles = [];
  const imageExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'];

  function walkDir(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walkDir(fullPath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (imageExtensions.includes(ext)) {
          allFiles.push(fullPath);
        }
      }
    }
  }

  walkDir(folderPath);

  const results = [];
  for (const filePath of allFiles) {
    const result = await compressImage(filePath, options);
    results.push(result);
    if (progressCallback) progressCallback(filePath, result);
  }
  return results;
}

module.exports = { compressImage, compressFolder, detectImageType, formatBytes };
