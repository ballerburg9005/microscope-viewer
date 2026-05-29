const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('node:path');
const { spawn } = require('node:child_process');
const fs = require('node:fs');

let mainWindow;
let bridgeProcess = null;

const appRoot = path.join(__dirname, '..');
const pythonPath = path.join(appRoot, '.venv', 'bin', 'python');
const bridgePath = path.join(appRoot, 'bridge', 'supercamera_bridge.py');

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 900,
    minHeight: 620,
    backgroundColor: '#0d1217',
    title: 'Microscope Viewer',
    icon: path.join(appRoot, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

function sendBridgeEvent(payload) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('bridge:event', payload);
}

function parseBridgeLines(stream, onMessage) {
  let buffer = '';
  stream.setEncoding('utf8');
  stream.on('data', (chunk) => {
    buffer += chunk;
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        onMessage(JSON.parse(line));
      } catch {
        sendBridgeEvent({ type: 'log', level: 'warn', message: line });
      }
    }
  });
}

function stopBridge() {
  if (!bridgeProcess) return;
  const proc = bridgeProcess;
  bridgeProcess = null;
  proc.kill('SIGTERM');
}

function startBridge(serial) {
  stopBridge();

  const args = [bridgePath, 'stream'];
  if (serial) args.push('--serial', serial);

  bridgeProcess = spawn(pythonPath, args, {
    cwd: appRoot,
    env: { ...process.env, PYTHONUNBUFFERED: '1' },
  });

  parseBridgeLines(bridgeProcess.stdout, sendBridgeEvent);

  bridgeProcess.stderr.setEncoding('utf8');
  bridgeProcess.stderr.on('data', (chunk) => {
    sendBridgeEvent({ type: 'log', level: 'error', message: chunk.trim() });
  });

  bridgeProcess.on('exit', (code, signal) => {
    bridgeProcess = null;
    sendBridgeEvent({
      type: 'stopped',
      code,
      signal,
      message: code === 0 ? 'Camera stream stopped.' : `Camera bridge exited (${signal || code}).`,
    });
  });
}

function runBridgeList() {
  return new Promise((resolve) => {
    const proc = spawn(pythonPath, [bridgePath, 'list'], {
      cwd: appRoot,
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
    });
    let stdout = '';
    let stderr = '';
    proc.stdout.setEncoding('utf8');
    proc.stderr.setEncoding('utf8');
    proc.stdout.on('data', (chunk) => { stdout += chunk; });
    proc.stderr.on('data', (chunk) => { stderr += chunk; });
    proc.on('exit', (code) => {
      if (code !== 0) {
        resolve({ ok: false, error: stderr.trim() || `Camera probe exited with ${code}` });
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch {
        resolve({ ok: false, error: stdout.trim() || 'Camera probe returned invalid JSON.' });
      }
    });
  });
}

ipcMain.handle('camera:list', runBridgeList);

ipcMain.handle('camera:start', (_event, options = {}) => {
  startBridge(options.serial || '');
  return { ok: true };
});

ipcMain.handle('camera:stop', () => {
  stopBridge();
  return { ok: true };
});

ipcMain.handle('snapshot:save', async (_event, dataUrl) => {
  const match = /^data:image\/jpeg;base64,(.+)$/.exec(dataUrl || '');
  if (!match) return { ok: false, error: 'No JPEG frame is available to save.' };

  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'Save microscope snapshot',
    defaultPath: `microscope-${new Date().toISOString().replace(/[:.]/g, '-')}.jpg`,
    filters: [{ name: 'JPEG image', extensions: ['jpg', 'jpeg'] }],
  });

  if (canceled || !filePath) return { ok: false, canceled: true };
  fs.writeFileSync(filePath, Buffer.from(match[1], 'base64'));
  return { ok: true, filePath };
});

app.whenReady().then(createWindow);

app.on('before-quit', stopBridge);

app.on('window-all-closed', () => {
  stopBridge();
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
