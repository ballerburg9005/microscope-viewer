# Architecture

## Problem

The target microscope identifies as `0329:2022 Geek szitman supercamera`. On Linux it enumerates over USB, but its interfaces are vendor-specific instead of UVC. That means:

- no kernel camera driver binds to it;
- no `/dev/video*` device is created;
- Chromium and Electron webcam APIs cannot enumerate it.

## Design

The app is split into three pieces:

- `src/main.js`: Electron main process. It owns the app window, launches the Python bridge, parses JSON-line events, and handles snapshot writes.
- `src/preload.js`: Safe IPC boundary exposed to the renderer under `window.microscope`.
- `src/renderer/*`: UI for device discovery, start/stop, live image display, frame stats, logs, and snapshots.
- `bridge/supercamera_bridge.py`: Direct USB bridge using the `supercamera` Python package. It lists supported devices and streams JPEG frames as JSON lines.

## Data Flow

```text
USB microscope -> supercamera Python driver -> JSON lines over stdout -> Electron main -> IPC -> renderer image element
```

Frames are base64-encoded JPEGs. This is simple and reliable for a desktop utility, though it is not the most efficient possible transport. If frame rate becomes a problem, the bridge can be replaced with a local socket or shared file ring without changing the UI contract much.

## Permissions

Direct USB access requires user-level permission to claim the device. `scripts/install-udev-rule.sh` installs a udev rule for:

- `0329:2022`
- `2ce3:3828`

The second ID is included because the same protocol appears under that alternate USB ID in related devices.

## Known Limitations

- The reverse-engineered driver reports `640 x 480` frames.
- The app is Linux-oriented because the current permission setup and hardware inspection path use udev and PyUSB on Linux.
- The camera can be claimed by one process at a time. If a stream fails after a previous crash, unplug and reconnect the microscope.
