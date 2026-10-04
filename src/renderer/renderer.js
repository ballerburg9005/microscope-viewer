const deviceSelect = document.getElementById('deviceSelect');
const refreshButton = document.getElementById('refreshButton');
const startButton = document.getElementById('startButton');
const stopButton = document.getElementById('stopButton');
const snapshotButton = document.getElementById('snapshotButton');
const clearLogButton = document.getElementById('clearLogButton');
const qualitySelect = document.getElementById('qualitySelect');
const statusEl = document.getElementById('status');
const frameEl = document.getElementById('frame');
const stageEl = document.getElementById('stage');
const emptyState = document.getElementById('emptyState');
const resolutionEl = document.getElementById('resolution');
const framesEl = document.getElementById('frames');
const fpsEl = document.getElementById('fps');
const serialEl = document.getElementById('serial');
const logEl = document.getElementById('log');

const frameContext = frameEl.getContext('2d', { alpha: true });
const sourceCanvas = document.createElement('canvas');
const sourceContext = sourceCanvas.getContext('2d', { willReadFrequently: true });

let lastFrameDataUrl = '';
let frameCount = 0;
let fpsWindowStart = performance.now();
let fpsWindowFrames = 0;
let pendingFrame = null;
let rendering = false;
let currentImage = null;

function setStatus(text, state = '') {
  statusEl.textContent = text;
  statusEl.className = `status ${state}`.trim();
  stageEl.classList.toggle('is-live', state === 'live');
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

function clampByte(value) {
  if (value < 0) return 0;
  if (value > 255) return 255;
  return value;
}

function sharpenImageData(imageData, amount = 0.12) {
  const { width, height, data } = imageData;
  if (width < 3 || height < 3 || amount <= 0) return;

  const source = new Uint8ClampedArray(data);
  const stride = width * 4;
  const centerGain = 1 + (4 * amount);

  for (let y = 1; y < height - 1; y += 1) {
    let index = (y * width + 1) * 4;
    for (let x = 1; x < width - 1; x += 1, index += 4) {
      for (let channel = 0; channel < 3; channel += 1) {
        const value =
          (source[index + channel] * centerGain) -
          (amount * (
            source[index - 4 + channel] +
            source[index + 4 + channel] +
            source[index - stride + channel] +
            source[index + stride + channel]
          ));
        data[index + channel] = clampByte(value);
      }
    }
  }
}

function ensureOutputCanvasSize() {
  const rect = stageEl.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.round(rect.width * dpr));
  const height = Math.max(1, Math.round(rect.height * dpr));

  if (frameEl.width !== width || frameEl.height !== height) {
    frameEl.width = width;
    frameEl.height = height;
  }
}

function drawDecodedFrame(image) {
  ensureOutputCanvasSize();

  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  if (!sourceWidth || !sourceHeight) return;

  let renderSource = image;
  if (qualitySelect.value === 'enhanced') {
    if (sourceCanvas.width !== sourceWidth || sourceCanvas.height !== sourceHeight) {
      sourceCanvas.width = sourceWidth;
      sourceCanvas.height = sourceHeight;
    }

    sourceContext.setTransform(1, 0, 0, 1, 0, 0);
    sourceContext.clearRect(0, 0, sourceWidth, sourceHeight);
    sourceContext.drawImage(image, 0, 0, sourceWidth, sourceHeight);

    const pixels = sourceContext.getImageData(0, 0, sourceWidth, sourceHeight);
    sharpenImageData(pixels, 0.12);
    sourceContext.putImageData(pixels, 0, 0);
    renderSource = sourceCanvas;
  }

  const canvasWidth = frameEl.width;
  const canvasHeight = frameEl.height;
  const scale = Math.min(canvasWidth / sourceWidth, canvasHeight / sourceHeight);
  const drawWidth = Math.max(1, Math.round(sourceWidth * scale));
  const drawHeight = Math.max(1, Math.round(sourceHeight * scale));
  const offsetX = Math.round((canvasWidth - drawWidth) / 2);
  const offsetY = Math.round((canvasHeight - drawHeight) / 2);

  frameContext.setTransform(1, 0, 0, 1, 0, 0);
  frameContext.clearRect(0, 0, canvasWidth, canvasHeight);
  frameContext.imageSmoothingEnabled = true;
  frameContext.imageSmoothingQuality = 'high';
  frameContext.filter = qualitySelect.value === 'enhanced'
    ? 'contrast(1.035) saturate(1.025)'
    : 'none';
  frameContext.drawImage(
    renderSource,
    0,
    0,
    sourceWidth,
    sourceHeight,
    offsetX,
    offsetY,
    drawWidth,
    drawHeight,
  );
  frameContext.filter = 'none';
}

async function decodeFrame(dataUrl) {
  const image = new Image();
  image.src = dataUrl;
  await image.decode();
  return image;
}

async function drainRenderQueue() {
  if (rendering) return;
  rendering = true;

  try {
    while (pendingFrame) {
      const job = pendingFrame;
      pendingFrame = null;

      try {
        const image = await decodeFrame(job.dataUrl);
        // If a newer frame arrived while this JPEG was decoding, drop the stale
        // display frame. This keeps latency low without losing the raw snapshot.
        if (pendingFrame) continue;
        currentImage = image;
        drawDecodedFrame(image);
      } catch (error) {
        log(`Preview decode failed: ${error.message || error}`, 'warn');
      }
    }
  } finally {
    rendering = false;
  }
}

function queuePreview(dataUrl) {
  pendingFrame = { dataUrl };
  void drainRenderQueue();
}

function handleFrame(payload) {
  lastFrameDataUrl = `data:image/jpeg;base64,${payload.jpeg}`;
  frameEl.style.display = 'block';
  emptyState.style.display = 'none';
  queuePreview(lastFrameDataUrl);

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

qualitySelect.addEventListener('change', () => {
  if (currentImage) drawDecodedFrame(currentImage);
  log(`Preview quality: ${qualitySelect.value}.`);
});

startButton.addEventListener('click', async () => {
  const selected = deviceSelect.selectedOptions[0];
  const serial = selected?.dataset.serial || '';
  frameCount = 0;
  fpsWindowStart = performance.now();
  fpsWindowFrames = 0;
  resolutionEl.textContent = 'Detecting';
  setStreaming(true);
  setStatus('Starting');
  log('Starting packet-aware direct USB capture bridge.');
  await window.microscope.start({ serial });
});

stopButton.addEventListener('click', async () => {
  await window.microscope.stop();
  setStreaming(false);
  setStatus('Stopped');
});

snapshotButton.addEventListener('click', async () => {
  const result = await window.microscope.saveSnapshot(lastFrameDataUrl);
  if (result.ok) log(`Saved raw camera JPEG to ${result.filePath}`);
  else if (!result.canceled) log(result.error || 'Snapshot save failed.', 'error');
});

clearLogButton.addEventListener('click', () => {
  logEl.textContent = '';
});

new ResizeObserver(() => {
  if (currentImage) drawDecodedFrame(currentImage);
}).observe(stageEl);

setStreaming(false);
refreshDevices();
