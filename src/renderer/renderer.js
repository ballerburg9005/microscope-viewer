const deviceSelect = document.getElementById('deviceSelect');
const refreshButton = document.getElementById('refreshButton');
const startButton = document.getElementById('startButton');
const stopButton = document.getElementById('stopButton');
const snapshotButton = document.getElementById('snapshotButton');
const clearLogButton = document.getElementById('clearLogButton');
const statusEl = document.getElementById('status');
const frameEl = document.getElementById('frame');
const emptyState = document.getElementById('emptyState');
const resolutionEl = document.getElementById('resolution');
const framesEl = document.getElementById('frames');
const fpsEl = document.getElementById('fps');
const serialEl = document.getElementById('serial');
const logEl = document.getElementById('log');

let lastFrameDataUrl = '';
let frameCount = 0;
let fpsWindowStart = performance.now();
let fpsWindowFrames = 0;

function setStatus(text, state = '') {
  statusEl.textContent = text;
  statusEl.className = `status ${state}`.trim();
}

function log(message, level = 'info') {
  const stamp = new Date().toLocaleTimeString();
  logEl.textContent += `[${stamp}] ${level}: ${message}\n`;
  logEl.scrollTop = logEl.scrollHeight;
}

function setStreaming(streaming) {
  startButton.disabled = streaming;
  stopButton.disabled = !streaming;
  snapshotButton.disabled = !lastFrameDataUrl;
}

function renderDevices(result) {
  deviceSelect.innerHTML = '';
  if (!result.ok || !result.devices || result.devices.length === 0) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = 'No supercamera devices found';
    deviceSelect.append(option);
    serialEl.textContent = '-';
    setStatus(result.ok ? 'No device' : 'Error', result.ok ? '' : 'error');
    if (!result.ok && result.error) log(result.error, 'error');
    return;
  }

  for (const device of result.devices) {
    const option = document.createElement('option');
    option.value = device.serial || '';
    option.textContent = `${device.product || 'supercamera'} ${device.usb_id} bus ${device.bus} addr ${device.address}`;
    option.dataset.serial = device.serial || '';
    deviceSelect.append(option);
  }

  serialEl.textContent = result.devices[0].serial || '-';
  setStatus('Ready');
  log(`Found ${result.devices.length} supported device(s).`);
}

async function refreshDevices() {
  setStatus('Scanning');
  const result = await window.microscope.list();
  renderDevices(result);
}

function handleFrame(payload) {
  lastFrameDataUrl = `data:image/jpeg;base64,${payload.jpeg}`;
  frameEl.src = lastFrameDataUrl;
  frameEl.style.display = 'block';
  emptyState.style.display = 'none';

  frameCount = payload.frames || frameCount + 1;
  framesEl.textContent = String(frameCount);
  if (payload.width && payload.height) {
    resolutionEl.textContent = `${payload.width} x ${payload.height}`;
  }

  fpsWindowFrames += 1;
  const now = performance.now();
  const elapsed = (now - fpsWindowStart) / 1000;
  if (elapsed >= 1) {
    fpsEl.textContent = (fpsWindowFrames / elapsed).toFixed(1);
    fpsWindowStart = now;
    fpsWindowFrames = 0;
  }
  snapshotButton.disabled = false;
}

window.microscope.onBridgeEvent((payload) => {
  if (payload.type === 'frame') {
    handleFrame(payload);
    setStatus('Live', 'live');
    return;
  }

  if (payload.type === 'ready') {
    setStatus('Live', 'live');
    serialEl.textContent = payload.serial || serialEl.textContent;
    log(payload.message || 'Camera stream opened.');
    return;
  }

  if (payload.type === 'stopped') {
    setStreaming(false);
    setStatus(payload.code === 0 ? 'Stopped' : 'Error', payload.code === 0 ? '' : 'error');
    log(payload.message || 'Bridge stopped.', payload.code === 0 ? 'info' : 'error');
    return;
  }

  if (payload.type === 'log' || payload.type === 'error') {
    log(payload.message || String(payload), payload.level || payload.type);
  }
});

refreshButton.addEventListener('click', refreshDevices);

deviceSelect.addEventListener('change', () => {
  const selected = deviceSelect.selectedOptions[0];
  serialEl.textContent = selected?.dataset.serial || '-';
});

startButton.addEventListener('click', async () => {
  const selected = deviceSelect.selectedOptions[0];
  const serial = selected?.dataset.serial || '';
  frameCount = 0;
  fpsWindowStart = performance.now();
  fpsWindowFrames = 0;
  setStreaming(true);
  setStatus('Starting');
  log('Starting direct USB capture bridge.');
  await window.microscope.start({ serial });
});

stopButton.addEventListener('click', async () => {
  await window.microscope.stop();
  setStreaming(false);
  setStatus('Stopped');
});

snapshotButton.addEventListener('click', async () => {
  const result = await window.microscope.saveSnapshot(lastFrameDataUrl);
  if (result.ok) log(`Saved snapshot to ${result.filePath}`);
  else if (!result.canceled) log(result.error || 'Snapshot save failed.', 'error');
});

clearLogButton.addEventListener('click', () => {
  logEl.textContent = '';
});

setStreaming(false);
refreshDevices();
