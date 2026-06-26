const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { compressImage } = require('./compression/engine');

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

ipcMain.handle('compress-files', async (event, filePaths, options) => {
  const results = [];
  let processedCount = 0;
  const { outputMode, outputDir } = options;

  // Collect all image files (expand directories)
  const allFiles = [];
  const imageExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'];

  function collectFiles(list) {
    for (const fp of list) {
      const stat = fs.statSync(fp);
      if (stat.isDirectory()) {
        const entries = fs.readdirSync(fp, { withFileTypes: true });
        collectFiles(entries.map(e => path.join(fp, e.name)));
      } else if (stat.isFile()) {
        const ext = path.extname(fp).toLowerCase();
        if (imageExtensions.includes(ext)) allFiles.push(fp);
      }
    }
  }

  collectFiles(filePaths);
  const total = allFiles.length;

  for (const filePath of allFiles) {
    try {
      const result = await compressImage(filePath, options);
      results.push(result);

      // Write output based on mode
      if (result.success && result.buffer) {
        let outPath = null;

        if (outputMode === 'replace') {
          // Overwrite original
          outPath = filePath;
        } else if (outputMode === 'suffix') {
          const ext = path.extname(filePath);
          const base = path.basename(filePath, ext);
          const outExt = options.convertToWebp ? '.webp' : ext;
          outPath = path.join(path.dirname(filePath), `${base}_compressed${outExt}`);
        } else if (outputMode === 'folder' && outputDir) {
          const relPath = path.relative(
            filePaths.length === 1 && fs.statSync(filePaths[0]).isDirectory()
              ? filePaths[0]
              : path.dirname(filePath),
            filePath
          );
          const ext = path.extname(filePath);
          const outExt = options.convertToWebp ? '.webp' : ext;
          const relOut = relPath.replace(ext + '$', '') + outExt;
          outPath = path.join(outputDir, relOut);
          fs.mkdirSync(path.dirname(outPath), { recursive: true });
        }

        if (outPath) {
          fs.writeFileSync(outPath, result.buffer);
          result.outputPath = outPath;
        }
      }

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

ipcMain.handle('get-app-version', () => app.getVersion());
