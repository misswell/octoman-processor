const { execSync, exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const util = require('util');

// ─── Backend availability detection ─────────────────────────────
let sharp = null;
let squoosh = null;
let squooshPool = null;

function loadSharp() {
  if (sharp === null) {
    try { sharp = require('sharp'); } catch (e) { sharp = false; }
  }
  return sharp;
}

function loadSquoosh() {
  if (squoosh === null) {
    try {
      squoosh = require('@squoosh/lib');
      squooshPool = new squoosh.ImagePool(2);
    } catch (e) { squoosh = false; console.error('Squoosh load error:', e.message); }
  }
  return squoosh;
}

function closeSquooshPool() {
  try { if (squooshPool) { squooshPool.close(); squooshPool = null; } } catch (e) {}
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
const GIFSICLE   = findTool('gifsicle');
const CWEBP      = findTool('cwebp');
const OXIPNG     = findTool('oxipng');
const CJXL       = findTool('cjxl');
const AVIFENC    = findTool('avifenc');

// ─── Image type detection ───────────────────────────────────────
function detectImageType(filePath) {
  const buffer = fs.readFileSync(filePath).subarray(0, 12);
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) return 'png';
  if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) return 'jpg';
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) return 'gif';
  if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46) return 'webp';
  if (buffer[0] === 0x42 && buffer[1] === 0x4D) return 'bmp';
  if (buffer[0] === 0x00 && buffer[1] === 0x00 && buffer[2] === 0x00 && buffer[3] === 0x18) return 'jp2';
  if (buffer[4] === 0x66 && buffer[5] === 0x74 && buffer[6] === 0x79 && buffer[7] === 0x70) return 'heif';
  if (buffer[4] === 0x66 && buffer[5] === 0x74 && buffer[6] === 0x79 && buffer[7] === 0x70 && buffer[8] === 0x61 && buffer[9] === 0x76 && buffer[10] === 0x69 && buffer[11] === 0x66) return 'avif';
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

// ─── CLI-based compressors (legacy) ─────────────────────────────
async function compressPNG(filePath, options = {}) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'octor-'));
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
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'octor-'));
  const tmpFile = path.join(tmpDir, 'compressed.jpg');
  const originalSize = getFileSize(filePath);
  const analysis = analyzeImage(filePath, 'jpg');
  const quality = options.quality || analysis.quality;

  // Try sharp first (has built-in mozjpeg)
  const sh = loadSharp();
  if (sh) {
    try {
      const buf = await sh(filePath)
        .jpeg({ quality, mozjpeg: true, progressive: true, optimizeCoding: true })
        .toBuffer();
      const compressedSize = buf.length;
      if (compressedSize > 0) {
        cleanup(tmpDir);
        return makeResult(filePath, originalSize, compressedSize, buf, 'jpg', 'sharp-mozjpeg');
      }
    } catch (e) {}
  }

  // Fallback to CLI mozjpeg
  try {
    const mozjpegPath = findTool('cjpeg');
    const cmd = `"${mozjpegPath}" -quality ${quality} -optimize -progressive -outfile "${tmpFile}" "${filePath}" 2>/dev/null`;
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
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'octor-'));
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
  const originalSize = getFileSize(filePath);
  const analysis = analyzeImage(filePath, 'webp');
  const quality = options.quality || analysis.quality;

  // Try sharp first
  const sh = loadSharp();
  if (sh) {
    try {
      const buf = await sh(filePath)
        .webp({ quality, effort: 6 })
        .toBuffer();
      const compressedSize = buf.length;
      if (compressedSize > 0) {
        return makeResult(filePath, originalSize, compressedSize, buf, 'webp', 'sharp-webp');
      }
    } catch (e) {}
  }

  // Fallback to CLI cwebp
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'octor-'));
  const tmpFile = path.join(tmpDir, 'compressed.webp');
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

// ─── Sharp-based compressors (modern) ──────────────────────────
async function compressWithSharp(filePath, options = {}) {
  const sh = loadSharp();
  if (!sh) return null;

  const type = detectImageType(filePath);
  const originalSize = getFileSize(filePath);
  const analysis = analyzeImage(filePath, type);
  const quality = options.quality || analysis.quality;
  const effort = options.effort || 6;

  try {
    let pipeline = sh(filePath);
    let outType = options.outputFormat || type;
    let algorithm = 'sharp';

    switch (outType) {
      case 'jpg':
      case 'jpeg':
        pipeline = pipeline.jpeg({
          quality,
          mozjpeg: true,
          progressive: true,
          optimizeCoding: true,
          trellisQuant: true,
          overshootDeringing: true,
        });
        algorithm += '-mozjpeg';
        break;
      case 'png':
        pipeline = pipeline.png({
          quality,
          compressionLevel: 9,
          palette: quality < 80,
          colors: Math.max(Math.floor(quality / 100 * 256), 32),
        });
        algorithm += '-png';
        break;
      case 'webp':
        pipeline = pipeline.webp({ quality, effort });
        algorithm += '-webp';
        break;
      case 'avif':
        pipeline = pipeline.heif({
          quality,
          effort,
          compression: 'av1',
        });
        algorithm += '-avif';
        break;
      case 'jxl':
        try {
          pipeline = pipeline.jxl({ quality, effort });
          algorithm += '-jxl';
        } catch(e) {
          return null;
        }
        break;
      default:
        return null;
    }

    const buf = await pipeline.toBuffer();
    const compressedSize = buf.length;
    if (compressedSize > 0 && compressedSize < originalSize) {
      return makeResult(filePath, originalSize, compressedSize, buf, outType, algorithm);
    }
  } catch (e) {
    // Sharp failed, fall through
  }
  return null;
}


// ─── Squoosh-based compressors (WASM) ──────────────────────────
async function compressWithSquoosh(filePath, options = {}) {
  const sq = loadSquoosh();
  if (!sq) return null;

  const type = detectImageType(filePath);
  const originalSize = getFileSize(filePath);
  const analysis = analyzeImage(filePath, type);
  const quality = options.quality || analysis.quality;
  const outType = options.outputFormat || type;

  try {
    const image = squooshPool.ingestImage(filePath);

    // Build encoder options
    let encoderName, encoderOpts;

    switch (outType) {
      case 'jpg':
      case 'jpeg':
        encoderName = 'mozjpeg';
        encoderOpts = {
          quality,
          baseline: false,
          arithmetic: false,
          progressive: true,
          optimize_coding: true,
          smoothing: 0,
          color_space: 3,
          quant_table: 3,
          trellis_multipass: false,
          trellis_opt_zero: false,
          trellis_opt_table: false,
          trellis_loops: 1,
          auto_subsample: true,
          chroma_subsample: 2,
          separate_chroma_quality: false,
          chroma_quality: quality,
        };
        break;
      case 'webp':
        encoderName = 'webp';
        encoderOpts = { quality };
        break;
      case 'avif':
        encoderName = 'avif';
        encoderOpts = { quality, speed: 6 };
        break;
      case 'jxl':
        encoderName = 'jxl';
        encoderOpts = { quality, effort: Math.min(7, options.effort || 5) };
        break;
      case 'png':
        encoderName = 'oxipng';
        encoderOpts = { level: Math.max(2, Math.min(6, Math.floor((100 - quality) / 15))) };
        break;
      default:
        return null;
    }

    await image.encode({ [encoderName]: encoderOpts });
    const result = await image.encodedWith[encoderName];

    if (result && result.binary && result.binary.length > 0) {
      const compressedSize = result.binary.length;
      const buf = Buffer.from(result.binary);
      if (compressedSize < originalSize) {
        return makeResult(filePath, originalSize, compressedSize, buf, outType, 'squoosh-' + encoderName);
      }
    }
  } catch (e) {
    // Squoosh failed, fall through
  }
  return null;
}

// ─── AVIF via CLI ───────────────────────────────────────────────
async function compressToAVIF(filePath, options = {}) {
  const originalSize = getFileSize(filePath);
  const analysis = analyzeImage(filePath, 'avif');
  const quality = options.quality || analysis.quality;
  const candidates = [];

  // Try Squoosh (best AVIF encoder)
  if (loadSquoosh()) {
    const sqResult = await compressWithSquoosh(filePath, { ...options, outputFormat: 'avif', quality });
    if (sqResult && sqResult.success) candidates.push(sqResult);
  }

  // Try CLI avifenc
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'octor-'));
  const tmpFile = path.join(tmpDir, 'compressed.avif');
  try {
    const cmd = `"${AVIFENC}" --speed 6 --jobs 4 --min 0 --max ${quality} -o "${tmpFile}" "${filePath}" 2>/dev/null`;
    execSync(cmd, { timeout: 60000 });

    if (fs.existsSync(tmpFile) && getFileSize(tmpFile) > 0) {
      const compressedSize = getFileSize(tmpFile);
      const buffer = fs.readFileSync(tmpFile);
      candidates.push(makeResult(filePath, originalSize, compressedSize, buffer, 'avif', 'avifenc'));
    }
  } catch (e) { /* fall through */ }
  cleanup(tmpDir);

  // Try sharp as fallback
  const sharpResult = await compressWithSharp(filePath, { ...options, outputFormat: 'avif' });
  if (sharpResult && sharpResult.success) candidates.push(sharpResult);

  // Pick best
  if (candidates.length > 0) {
    candidates.sort((a, b) => b.savings - a.savings);
    return candidates[0];
  }

  return fallbackResult(filePath, originalSize, 'avif', 'avifenc');
}

// ─── JPEG XL via CLI ────────────────────────────────────────────
async function compressToJXL(filePath, options = {}) {
  const originalSize = getFileSize(filePath);
  const analysis = analyzeImage(filePath, 'jxl');
  const quality = options.quality || analysis.quality;
  const candidates = [];

  // Try CLI cjxl first (best JXL encoder)
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'octor-'));
  const tmpFile = path.join(tmpDir, 'compressed.jxl');
  try {
    const distance = Math.max(0.1, Math.min(15, (100 - quality) / 7));
    const cmd = `"${CJXL}" --lossless_jpeg=0 --distance ${distance.toFixed(2)} --effort 7 "${filePath}" "${tmpFile}" 2>/dev/null`;
    execSync(cmd, { timeout: 60000 });

    if (fs.existsSync(tmpFile) && getFileSize(tmpFile) > 0) {
      const compressedSize = getFileSize(tmpFile);
      const buffer = fs.readFileSync(tmpFile);
      candidates.push(makeResult(filePath, originalSize, compressedSize, buffer, 'jxl', 'cjxl'));
    }
  } catch (e) { /* fall through */ }
  cleanup(tmpDir);

  // Try Squoosh as alternative
  if (loadSquoosh()) {
    const sqResult = await compressWithSquoosh(filePath, { ...options, outputFormat: 'jxl', quality });
    if (sqResult && sqResult.success) candidates.push(sqResult);
  }

  // Try sharp as fallback
  const sharpResult = await compressWithSharp(filePath, { ...options, outputFormat: 'jxl' });
  if (sharpResult && sharpResult.success) candidates.push(sharpResult);

  // Pick best
  if (candidates.length > 0) {
    candidates.sort((a, b) => b.savings - a.savings);
    return candidates[0];
  }

  return fallbackResult(filePath, originalSize, 'jxl', 'cjxl');
}

// ─── OxiPNG (Rust-based PNG optimizer) ──────────────────────────
async function compressWithOxiPNG(filePath, options = {}) {
  const originalSize = getFileSize(filePath);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'octor-'));
  const tmpFile = path.join(tmpDir, 'compressed.png');

  try {
    const level = Math.min(6, Math.max(1, Math.floor((options.quality || 75) / 20)));
    const cmd = `"${OXIPNG}" -o ${level} --strip safe --out "${tmpFile}" "${filePath}" 2>/dev/null`;
    execSync(cmd, { timeout: 60000 });

    if (fs.existsSync(tmpFile) && getFileSize(tmpFile) > 0) {
      const compressedSize = getFileSize(tmpFile);
      const buffer = fs.readFileSync(tmpFile);
      cleanup(tmpDir);
      return makeResult(filePath, originalSize, compressedSize, buffer, 'png', 'oxipng');
    }
  } catch (e) { /* fall through */ }
  cleanup(tmpDir);
  return null;
}

// ─── Main compression dispatcher ────────────────────────────────
async function compressImage(filePath, options = {}) {
  const type = detectImageType(filePath);
  const backend = options.backend || 'auto';

  // Handle output format conversion
  const targetFormat = options.outputFormat || type;

  // If converting to a different format, use the target format's compressor
  if (targetFormat !== type && options.outputFormat) {
    return await compressToFormat(filePath, targetFormat, options);
  }

  // Backend selection
  if (backend === 'sharp' || (backend === 'auto' && loadSharp())) {
    const result = await compressWithSharp(filePath, options);
    if (result && result.success) return result;
  }

  // Fallback to CLI tools per format
  switch (type) {
    case 'png':
      // Try Squoosh oxipng first (lossless), then sharp, then CLI
      if (loadSquoosh()) {
        const sqResult = await compressWithSquoosh(filePath, { ...options, outputFormat: 'png' });
        if (sqResult && sqResult.success && sqResult.savings > 0) return sqResult;
      }
      // Try oxipng CLI for lossless
      if (options.lossless !== false) {
        const oxiResult = await compressWithOxiPNG(filePath, options);
        if (oxiResult && oxiResult.success && oxiResult.savings > 0) return oxiResult;
      }
      return await compressPNG(filePath, options);
    case 'jpg':
      return await compressJPG(filePath, options);
    case 'gif':
      return await compressGIF(filePath, options);
    case 'webp':
      // Try Squoosh first
      if (loadSquoosh()) {
        const sqResult = await compressWithSquoosh(filePath, { ...options, outputFormat: 'webp' });
        if (sqResult && sqResult.success) return sqResult;
      }
      return await compressToWebP(filePath, options);
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

async function compressToFormat(filePath, targetFormat, options = {}) {
  const originalSize = getFileSize(filePath);
  const type = detectImageType(filePath);

  switch (targetFormat) {
    case 'webp':
      return await compressToWebP(filePath, options);
    case 'avif':
      return await compressToAVIF(filePath, options);
    case 'jxl':
      return await compressToJXL(filePath, options);
    case 'jpg':
    case 'jpeg':
      return await compressJPG(filePath, options);
    case 'png':
      return await compressPNG(filePath, options);
    default:
      return {
        success: false,
        file: filePath,
        error: `Unsupported target format: ${targetFormat}`,
        originalSize,
        compressedSize: originalSize,
        savings: 0,
        originalSizeFormatted: formatBytes(originalSize),
        compressedSizeFormatted: formatBytes(originalSize),
        buffer: fs.readFileSync(filePath),
        type,
      };
  }
}

// ─── Smart mode: auto-select best algorithm ─────────────────────
async function compressSmart(filePath, options = {}) {
  const type = detectImageType(filePath);
  const originalSize = getFileSize(filePath);
  const quality = options.quality || analyzeImage(filePath, type).quality;

  // Try all available backends and pick the best result
  const candidates = [];

  // 1. Sharp (modern, multi-format)
  if (loadSharp()) {
    const r = await compressWithSharp(filePath, { ...options, quality });
    if (r && r.success) candidates.push(r);
  }

  // 2. CLI tools
  // Try Squoosh for all formats
  if (loadSquoosh()) {
    const sq = await compressWithSquoosh(filePath, { ...options, quality });
    if (sq && sq.success) candidates.push(sq);
  }

  switch (type) {
    case 'png':
      const oxi = await compressWithOxiPNG(filePath, { ...options, quality });
      if (oxi && oxi.success) candidates.push(oxi);
      const pq = await compressPNG(filePath, { ...options, quality });
      if (pq && pq.success) candidates.push(pq);
      break;
    case 'jpg':
      const jpg = await compressJPG(filePath, { ...options, quality });
      if (jpg && jpg.success) candidates.push(jpg);
      break;
    case 'gif':
      const gif = await compressGIF(filePath, { ...options, quality });
      if (gif && gif.success) candidates.push(gif);
      break;
    case 'webp':
      const webp = await compressToWebP(filePath, { ...options, quality });
      if (webp && webp.success) candidates.push(webp);
      break;
  }

  // Pick the best (highest compression ratio)
  if (candidates.length > 0) {
    candidates.sort((a, b) => b.savings - a.savings);
    return candidates[0];
  }

  // Fallback
  return compressImage(filePath, options);
}

// ─── Batch processing ───────────────────────────────────────────
async function compressFolder(folderPath, options = {}, progressCallback) {
  const allFiles = [];
  const imageExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.avif', '.jxl'];

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

module.exports = {
  compressImage,
  compressSmart,
  compressFolder,
  compressToFormat,
  compressToAVIF,
  compressToJXL,
  compressWithSharp,
  compressWithSquoosh,
  compressToWebP,
  detectImageType,
  formatBytes,
  getFileSize,
  closeSquooshPool,
};
