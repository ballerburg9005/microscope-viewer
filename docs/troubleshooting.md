# Troubleshooting

## Device Is Not Listed

Check USB enumeration:

```bash
lsusb | grep -i -E '0329:2022|2ce3:3828|supercamera|szitman'
```

If the device does not appear, try another cable, port, or a powered USB hub.

## Permission Denied

Install the udev rule:

```bash
npm run setup:udev
```

Then unplug and reconnect the microscope. If it still fails, log out and back in so group membership changes are applied.

## No `/dev/video0`

That is expected for this microscope. It is not a UVC camera. The app talks to it directly over USB through the Python bridge.

## Stream Starts But Shows No Useful Image

The bridge has access to the hardware if it prints a `ready` event and `frame` events:

```bash
timeout 10s .venv/bin/python bridge/supercamera_bridge.py stream
```

If frames arrive but the image is not useful, check microscope focus, lighting, and whether the sensor cap is still covered.

## Electron Sandbox Error

Some Linux installs require the Electron sandbox helper to be owned by root:

```bash
sudo chown root:root node_modules/electron/dist/chrome-sandbox
sudo chmod 4755 node_modules/electron/dist/chrome-sandbox
```
