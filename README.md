<p align="center">
  <img src="assets/cover.png" alt="Microscope Viewer" width="100%" />
</p>

# Microscope Viewer

Desktop viewer for non-UVC USB microscopes using the Geek Szitman `supercamera` protocol. It was built for the microscope detected as:

```text
0329:2022 Geek szitman supercamera
```

## Features

- Direct USB capture for non-UVC `supercamera` devices.
- Electron UI with device refresh, start/stop controls, live image display, FPS/frame counters, and bridge logs.
- JPEG snapshot saving.
- udev setup script for user-level USB access.
- Source-only repository with repeatable Node and Python setup.

## Intent

This app exists to make the microscope usable from the desktop without relying on `/dev/video0`. The device is visible on the USB bus, but it does not expose itself as a standard UVC/V4L2 webcam, so Electron's normal `getUserMedia()` path cannot see it.

The app uses Electron for the UI and a small Python bridge for direct USB capture through the `supercamera` driver. The bridge emits JPEG frames to the Electron main process, and the renderer displays them as a live feed.

## Constraints That Drove The Design

- The microscope reports `Vendor Specific Class`, not USB Video Class.
- Linux currently attaches no kernel driver to `0329:2022`, so no `/dev/video*` node appears.
- Browser webcam APIs only enumerate standard camera devices, so they are insufficient for this hardware.
- Direct USB access usually needs a udev permission rule, otherwise the bridge may need root.
- The available reverse-engineered driver reports this camera stream as JPEG frames at `640 x 480`, regardless of the marketing `1600x` label.

## Requirements

- Linux desktop with USB access.
- Node.js and npm.
- Python 3.12 or newer.
- A supported microscope connected over USB:
  - `0329:2022`
  - `2ce3:3828`

## Setup

Install dependencies:

```bash
npm run bootstrap
```

Install the USB permission rule:

```bash
npm run setup:udev
```

Then unplug and reconnect the microscope. If capture still fails with a permission error, log out and back in so the `plugdev` group change is applied.

## Run

```bash
npm start
```

Click `Refresh` if the camera was plugged in after launch, then click `Start`.

Useful checks:

```bash
npm run check:camera
npm test
```

For a direct bridge stream test:

```bash
timeout 10s .venv/bin/python bridge/supercamera_bridge.py stream
```

## Notes

The app also documents failures in the right-side bridge log. If the device appears in `npm run check:camera` but streaming fails, the most likely causes are USB permissions, a busy/stale USB interface, or a protocol variant not handled by the Python driver.

## Documentation

- [Architecture](docs/architecture.md)
- [Troubleshooting](docs/troubleshooting.md)
- [Contributing](CONTRIBUTING.md)
