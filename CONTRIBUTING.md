# Contributing

This is a small desktop utility for a specific non-UVC USB microscope family. Keep changes focused on making the capture path more reliable or making failures easier to diagnose.

## Development Setup

```bash
npm run bootstrap
npm run setup:udev
npm test
npm run check:camera
npm start
```

After installing the udev rule, unplug and reconnect the microscope.

## Validation

Before opening a change, run:

```bash
npm test
```

If you have the hardware connected, also run:

```bash
npm run check:camera
timeout 10s .venv/bin/python bridge/supercamera_bridge.py stream
```

The stream command should print a `ready` event followed by JPEG frame events.

## Scope

Do not commit local virtual environments, `node_modules`, generated snapshots, or Electron build artifacts. The repository should remain source-only.
