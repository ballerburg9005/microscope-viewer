# Architecture

## Problem

The target microscope identifies as `0329:2022 Geek szitman supercamera`. On Linux it enumerates over USB, but its interfaces are vendor-specific instead of UVC. That means:

- no kernel camera driver binds to it;
- no `/dev/video*` device is created;
- Chromium and Electron webcam APIs cannot enumerate it.

## Design

The app is split into four pieces:

- `src/main.js`: Electron main process. It owns the app window, launches the Python bridge, parses JSON-line events, and handles raw snapshot writes.
- `src/preload.js`: Safe IPC boundary exposed to the renderer under `window.microscope`.
- `src/renderer/*`: UI plus the preview-quality pipeline. The raw JPEG is decoded into a HiDPI canvas; Enhanced mode applies conservative source-resolution sharpening and high-quality resampling without modifying saved snapshots.
- `bridge/supercamera_bridge.py`: Direct PyUSB implementation of the `com.useeplus.protocol` capture path. It lists supported devices, performs the camera handshake, parses logical USB packets, assembles JPEGs by frame ID, and streams them as JSON lines.

## USB Frame Assembly

The video endpoint carries logical packets with a 5-byte USB header and a 7-byte camera header followed by a JPEG chunk. The bridge validates the `AA BB` magic, command/camera ID, declared packet length, and frame ID.

This matters on the `0329:2022` variant because a USB read can contain bytes beyond the declared logical packet length. Reverse-engineering notes indicate those bytes may be the beginning of the next packet and are retransmitted on the following read. The bridge therefore ignores bytes beyond the declared packet length instead of concatenating them into the current JPEG.

A frame is emitted only after the frame ID changes and the assembled buffer has JPEG SOI/EOI markers.

## Data Flow

```text
USB microscope
  -> PyUSB packet parser / frame-ID assembler
  -> raw JPEG as JSON line over stdout
  -> Electron main process
  -> IPC
  -> renderer HiDPI canvas
```

Snapshots are saved from the untouched raw JPEG. Preview enhancement is deliberately renderer-only.

The renderer keeps only the newest pending frame while JPEG decoding is busy, so an expensive preview frame is dropped rather than allowing display latency to grow.

## Resolution

The bridge reads width and height from each JPEG's SOF marker. Tested devices using this protocol produce `640 x 480` JPEG frames, but the UI no longer blindly assumes that value when valid JPEG metadata is available.

## Permissions

Direct USB access requires user-level permission to claim the device. `scripts/install-udev-rule.sh` installs a udev rule for:

- `0329:2022`
- `2ce3:3828`

The second ID is included because the same protocol appears under that alternate USB ID in related devices.

## Known Limitations

- Preview enhancement improves perceived desktop sharpness but cannot create optical detail that is absent from the source JPEG.
- The app is Linux-oriented because the current permission setup uses udev and PyUSB.
- The camera can be claimed by one process at a time. If a stream fails after a previous crash, unplug and reconnect the microscope.
- USB capture has been designed around the known `com.useeplus.protocol` packet format; unknown firmware variants may require additional handling.
