#!/usr/bin/env python3
"""Line-oriented bridge between Electron and the supercamera USB driver."""

from __future__ import annotations

import argparse
import base64
import json
import sys
import time
from typing import Any

from supercamera import Camera, list_devices, validate


def emit(payload: dict[str, Any]) -> None:
    print(json.dumps(payload, separators=(",", ":")), flush=True)


def camera_to_dict(device: Any) -> dict[str, Any]:
    return {
        "usb_id": f"{device.vendor_id:04x}:{device.product_id:04x}",
        "vendor_id": device.vendor_id,
        "product_id": device.product_id,
        "manufacturer": device.manufacturer,
        "product": device.product,
        "serial": device.serial_number,
        "bus": device.bus,
        "address": device.address,
    }


def list_command(_args: argparse.Namespace) -> int:
    try:
        devices = [camera_to_dict(device) for device in list_devices()]
        emit({"ok": True, "devices": devices})
        return 0
    except Exception as exc:
        emit({"ok": False, "error": str(exc)})
        return 1


def stream_command(args: argparse.Namespace) -> int:
    try:
        with Camera(serial=args.serial or None, timeout=args.timeout) as camera:
            width, height = camera.resolution
            emit(
                {
                    "type": "ready",
                    "serial": camera.serial_number,
                    "bus": camera.bus,
                    "address": camera.address,
                    "width": width,
                    "height": height,
                    "message": "Camera stream opened.",
                }
            )

            last_report = time.monotonic()
            dropped = 0
            while True:
                jpeg = camera.read_jpeg()
                if not jpeg:
                    dropped += 1
                    now = time.monotonic()
                    if now - last_report >= 2:
                        emit({"type": "log", "level": "warn", "message": f"Waiting for frames; missed {dropped} reads."})
                        last_report = now
                    continue

                if not validate.is_valid_jpeg(jpeg):
                    dropped += 1
                    continue

                emit(
                    {
                        "type": "frame",
                        "frames": camera.frames_read,
                        "width": width,
                        "height": height,
                        "jpeg": base64.b64encode(jpeg).decode("ascii"),
                    }
                )
    except KeyboardInterrupt:
        return 0
    except Exception as exc:
        emit({"type": "error", "level": "error", "message": str(exc)})
        print(str(exc), file=sys.stderr, flush=True)
        return 1


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Bridge for Geek Szitman supercamera devices.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    list_parser = subparsers.add_parser("list", help="List supported USB cameras.")
    list_parser.set_defaults(func=list_command)

    stream_parser = subparsers.add_parser("stream", help="Stream JPEG frames as JSON lines.")
    stream_parser.add_argument("--serial", default="", help="Open a specific camera serial number.")
    stream_parser.add_argument("--timeout", type=float, default=5.0, help="Seconds to wait for each frame.")
    stream_parser.set_defaults(func=stream_command)
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
