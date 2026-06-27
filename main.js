const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { compressImage, compressSmart, compressToFormat, compressWithSharp, detectImageType, formatBytes } = require('./compression/engine');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 720,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#f8f6f8',
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// ─── IPC Handlers ───────────────────────────────────────────────

ipcMain.handle('select-files', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] }],
  });
  return result.filePaths;
});

ipcMain.handle('select-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
  });
  return result.filePaths;
});

ipcMain.handle('select-output-dir', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'createDirectory'],
  });
  return result.filePaths;
});

// ─── Collect files helper ───────────────────────────────────────
function collectImageFiles(filePaths) {
  const allFiles = [];
  const imageExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.avif', '.jxl'];

  function walk(list) {
    for (const fp of list) {
      const stat = fs.statSync(fp);
      if (stat.isDirectory()) {
        const entries = fs.readdirSync(fp, { withFileTypes: true });
        walk(entries.map(e => path.join(fp, e.name)));
      } else if (stat.isFile()) {
        const ext = path.extname(fp).toLowerCase();
        if (imageExtensions.includes(ext)) allFiles.push(fp);
      }
    }
  }

  walk(filePaths);
  return allFiles;
}

function getBackupDir() {
  return path.join(os.tmpdir(), 'octor-compressor-backups');
}

function writeOutputFile(result, filePath, filePaths, options) {
  if (!result.success || !result.buffer) return null;

  const { outputMode, outputDir } = options;
  let outPath = null;
  const outExt = result.type ? '.' + result.type : path.extname(filePath);

  if (outputMode === 'replace') {
    // Save backup before overwriting
    const backupDir = getBackupDir();
    const backupPath = path.join(backupDir, Buffer.from(filePath).toString('base64url'));
    fs.mkdirSync(backupDir, { recursive: true });
    if (!fs.existsSync(backupPath)) {
      fs.copyFileSync(filePath, backupPath);
    }
    outPath = filePath;
    result._backupPath = backupPath;
  } else if (outputMode === 'suffix') {
    const base = path.basename(filePath, path.extname(filePath));
    outPath = path.join(path.dirname(filePath), base + '_compressed' + outExt);
  } else if (outputMode === 'folder' && outputDir) {
    const relPath = path.relative(
      filePaths.length === 1 && fs.statSync(filePaths[0]).isDirectory()
        ? filePaths[0]
        : path.dirname(filePath),
      filePath
    );
    const relOut = relPath.replace(path.extname(relPath), '') + outExt;
    outPath = path.join(outputDir, relOut);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
  }
  result._outputMode = outputMode;

  if (outPath) {
    fs.writeFileSync(outPath, result.buffer);
    result.outputPath = outPath;
  }
  return outPath;
}

// ─── Legacy compress handler ────────────────────────────────────
ipcMain.handle('compress-files', async (event, filePaths, options) => {
  const results = [];
  const allFiles = collectImageFiles(filePaths);
  const total = allFiles.length;
  let processedCount = 0;

  for (const filePath of allFiles) {
    try {
      const result = await compressImage(filePath, options);
      results.push(result);
      writeOutputFile(result, filePath, filePaths, options);

      processedCount++;
      if (mainWindow) {
        mainWindow.webContents.send('compress-progress', {
          current: processedCount, total, file: filePath, result,
        });
      }
    } catch (err) {
      results.push({
        file: filePath, success: false, error: err.message,
        originalSize: 0, compressedSize: 0, savings: 0,
      });
      processedCount++;
    }
  }

  return results;
});

// ─── Smart / format-conversion compress handler ─────────────────
ipcMain.handle('compress-smart', async (event, filePaths, options) => {
  const results = [];
  const allFiles = collectImageFiles(filePaths);
  const total = allFiles.length;
  let processedCount = 0;

  for (const filePath of allFiles) {
    try {
      let result;
      const targetFormat = options.outputFormat;
      const useSmart = options.smartMode;

      if (targetFormat && targetFormat !== 'original') {
        result = await compressToFormat(filePath, targetFormat, options);
      } else if (useSmart) {
        result = await compressSmart(filePath, options);
      } else {
        result = await compressImage(filePath, options);
      }

      results.push(result);
      writeOutputFile(result, filePath, filePaths, options);

      processedCount++;
      if (mainWindow) {
        mainWindow.webContents.send('compress-progress', {
          current: processedCount, total, file: filePath, result,
        });
      }
    } catch (err) {
      results.push({
        file: filePath, success: false, error: err.message,
        originalSize: 0, compressedSize: 0, savings: 0,
      });
      processedCount++;
    }
  }

  return results;
});

// ─── Utility handlers ───────────────────────────────────────────
ipcMain.handle('save-file', async (event, sourcePath, compressedBuffer) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: path.basename(sourcePath),
    filters: [{ name: 'Images', extensions: [path.extname(sourcePath).replace('.', '')] }],
  });
  if (!result.canceled && result.filePath) {
    fs.writeFileSync(result.filePath, compressedBuffer);
    return result.filePath;
  }
  return null;
});

ipcMain.handle('open-in-finder', async (event, filePath) => {
  shell.showItemInFolder(filePath);
});

// ─── Read image as data URL for comparison ──────────────────────
ipcMain.handle('read-image-dataurl', async (event, filePath) => {
  try {
    const buffer = fs.readFileSync(filePath);
    const ext = path.extname(filePath).toLowerCase().replace('.', '');
    const mimeMap = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', avif: 'image/avif', jxl: 'image/jxl' };
    const mime = mimeMap[ext] || 'image/png';
    return 'data:' + mime + ';base64,' + buffer.toString('base64');
  } catch (e) {
    return null;
  }
});

ipcMain.handle('get-app-version', () => app.getVersion());

// ─── Restore original file ─────────────────────────────────────
ipcMain.handle('restore-original', async (event, filePath, backupPath, outputMode) => {
  try {
    if (outputMode === 'replace' && backupPath && fs.existsSync(backupPath)) {
      fs.copyFileSync(backupPath, filePath);
      fs.unlinkSync(backupPath);
      return { success: true, filePath };
    } else if (outputMode === 'suffix') {
      const ext = path.extname(filePath);
      const base = path.basename(filePath, ext);
      const dir = path.dirname(filePath);
      const compressedPath = path.join(dir, base + '_compressed' + ext);
      if (fs.existsSync(compressedPath)) {
        fs.unlinkSync(compressedPath);
      }
      return { success: true, filePath };
    } else if (outputMode === 'folder') {
      if (backupPath && fs.existsSync(backupPath)) {
        fs.unlinkSync(backupPath);
      }
      return { success: true, filePath };
    }
    return { success: false, error: '无法恢复' };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ─── Compress single file with new quality ─────────────────────
ipcMain.handle('compress-single', async (event, filePath, options) => {
  return await compressImage(filePath, options);
});
