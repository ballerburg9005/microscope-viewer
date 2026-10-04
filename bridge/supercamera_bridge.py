#!/usr/bin/env python3
"""Line-oriented bridge between Electron and Geek Szitman supercamera devices.

This bridge implements the packet framing directly instead of relying on the
older supercamera 0.1.0 JPEG scraper. The 0329:2022 variant can return bytes
from the beginning of the next logical packet in a USB read; respecting the
protocol length and frame-id fields avoids mixing those bytes into the current
JPEG.
"""

from __future__ import annotations

import argparse
import base64
import json
import sys
import time
from dataclasses import dataclass
from typing import Any

try:
    import usb.core as usb_core
    import usb.util as usb_util
except ImportError:  # lets protocol unit tests run before bootstrap
    usb_core = None
    usb_util = None

KNOWN_DEVICES = (
    (0x0329, 0x2022),
    (0x2CE3, 0x3828),
)

EP_OUT = 0x01
EP_IN = 0x81
EP_IAP_OUT = 0x02
EP_IAP_IN = 0x82

MAGIC_INIT = bytes((0xFF, 0x55, 0xFF, 0x55, 0xEE, 0x10))
CONNECT_CMD = bytes((0xBB, 0xAA, 0x05, 0x00, 0x00))

PACKET_SIZE = 0x400
USB_HEADER_SIZE = 5
CAMERA_HEADER_SIZE = 7
PAYLOAD_OFFSET = USB_HEADER_SIZE + CAMERA_HEADER_SIZE
VALID_CIDS = (7, 11)
JPEG_SOI = b"\xff\xd8"
JPEG_EOI = b"\xff\xd9"


@dataclass(frozen=True)
class Packet:
    cid: int
    fid: int
    camera: int
    flags: int
    gsensor: int
    chunk: bytes


class FrameAssembler:
    """Assemble JPEG chunks until the device changes frame id."""

    def __init__(self) -> None:
        self._fid: int | None = None
        self._buffer = bytearray()

    def feed(self, packet: Packet) -> bytes | None:
        completed: bytes | None = None

        if self._fid is not None and packet.fid != self._fid:
            candidate = bytes(self._buffer)
            if is_valid_jpeg(candidate):
                completed = candidate
            self._buffer.clear()

        if self._fid is None or packet.fid != self._fid:
            self._fid = packet.fid

        self._buffer.extend(packet.chunk)
        return completed


def emit(payload: dict[str, Any]) -> None:
    print(json.dumps(payload, separators=(",", ":")), flush=True)


def safe_attr(device: Any, name: str) -> Any:
    try:
        return getattr(device, name)
    except Exception:
        return None


def require_pyusb() -> None:
    if usb_core is None or usb_util is None:
        raise RuntimeError("PyUSB is not installed. Run npm run bootstrap first.")


def find_devices() -> list[Any]:
    found: list[Any] = []
    for vendor_id, product_id in KNOWN_DEVICES:
        require_pyusb()
        devices = usb_core.find(
            find_all=True,
            idVendor=vendor_id,
            idProduct=product_id,
        )
        if devices:
            found.extend(list(devices))
    return found


def camera_to_dict(device: Any) -> dict[str, Any]:
    return {
        "usb_id": f"{device.idVendor:04x}:{device.idProduct:04x}",
        "vendor_id": device.idVendor,
        "product_id": device.idProduct,
        "manufacturer": safe_attr(device, "manufacturer"),
        "product": safe_attr(device, "product"),
        "serial": safe_attr(device, "serial_number"),
        "bus": safe_attr(device, "bus"),
        "address": safe_attr(device, "address"),
    }


def parse_packet(data: bytes) -> Packet | None:
    """Parse one logical com.useeplus.protocol packet.

    Bytes beyond the declared packet length are intentionally ignored. On the
    0329:2022 variant they can be the beginning of the next packet, which the
    camera retransmits on the next USB read.
    """
    if len(data) < PAYLOAD_OFFSET:
        return None
    if data[0] != 0xAA or data[1] != 0xBB or data[2] not in VALID_CIDS:
        return None

    declared_length = data[3] | (data[4] << 8)
    packet_end = USB_HEADER_SIZE + declared_length
    if declared_length < CAMERA_HEADER_SIZE or packet_end > len(data):
        return None

    return Packet(
        cid=data[2],
        fid=data[5],
        camera=data[6],
        flags=data[7],
        gsensor=int.from_bytes(data[8:12], "little", signed=True),
        chunk=bytes(data[PAYLOAD_OFFSET:packet_end]),
    )


def is_valid_jpeg(data: bytes) -> bool:
    return len(data) >= 4 and data.startswith(JPEG_SOI) and data.endswith(JPEG_EOI)


def jpeg_dimensions(data: bytes) -> tuple[int, int] | None:
    """Read JPEG dimensions directly from a SOF marker without decoding pixels."""
    if not data.startswith(JPEG_SOI):
        return None

    sof_markers = {
        0xC0, 0xC1, 0xC2, 0xC3,
        0xC5, 0xC6, 0xC7,
        0xC9, 0xCA, 0xCB,
        0xCD, 0xCE, 0xCF,
    }

    index = 2
    while index + 4 <= len(data):
        if data[index] != 0xFF:
            index += 1
            continue

        while index < len(data) and data[index] == 0xFF:
            index += 1
        if index >= len(data):
            break

        marker = data[index]
        index += 1

        if marker in (0xD8, 0xD9):
            continue
        if marker == 0xDA:  # start of scan; metadata is over
            break
        if index + 2 > len(data):
            break

        segment_length = int.from_bytes(data[index:index + 2], "big")
        if segment_length < 2 or index + segment_length > len(data):
            break

        if marker in sof_markers and segment_length >= 7:
            height = int.from_bytes(data[index + 3:index + 5], "big")
            width = int.from_bytes(data[index + 5:index + 7], "big")
            if width > 0 and height > 0:
                return width, height

        index += segment_length

    return None


class Camera:
    def __init__(self, serial: str = "", timeout: float = 5.0) -> None:
        self.serial_filter = serial
        self.timeout = timeout
        self.device: Any | None = None
        self.frames_read = 0
        self.assembler = FrameAssembler()
        self._claimed_interfaces: list[int] = []
        self._open()

    def _find_device(self) -> Any:
        devices = find_devices()
        if not devices:
            ids = ", ".join(f"{vid:04x}:{pid:04x}" for vid, pid in KNOWN_DEVICES)
            raise RuntimeError(f"No supercamera devices found. Known USB IDs: {ids}")

        if self.serial_filter:
            for device in devices:
                if safe_attr(device, "serial_number") == self.serial_filter:
                    return device
            raise RuntimeError(f"No camera with serial {self.serial_filter!r} found.")

        return devices[0]

    def _open(self) -> None:
        device = self._find_device()
        self.device = device

        for interface in (0, 1):
            try:
                if device.is_kernel_driver_active(interface):
                    device.detach_kernel_driver(interface)
            except (NotImplementedError, usb_core.USBError):
                pass

        device.set_configuration()

        for interface in (0, 1):
            usb_util.claim_interface(device, interface)
            self._claimed_interfaces.append(interface)

        # Drain pending iAP heartbeat traffic before enabling the video altsetting.
        for _ in range(30):
            try:
                device.read(EP_IAP_IN, 512, timeout=100)
            except usb_core.USBError:
                break

        device.set_interface_altsetting(interface=1, alternate_setting=1)
        device.clear_halt(EP_OUT)
        device.write(EP_IAP_OUT, MAGIC_INIT, timeout=1000)
        device.write(EP_OUT, CONNECT_CMD, timeout=1000)
        time.sleep(0.3)

        self.assembler = FrameAssembler()

        # Initial data after connect is often a partial frame. Drop the first
        # complete frame so the UI starts on a clean frame boundary.
        self.read_jpeg()

    def read_jpeg(self) -> bytes | None:
        if self.device is None:
            raise RuntimeError("Camera is not open.")

        deadline = time.monotonic() + self.timeout
        while time.monotonic() < deadline:
            try:
                raw = bytes(self.device.read(EP_IN, PACKET_SIZE, timeout=1000))
            except usb_core.USBError as exc:
                if getattr(exc, "errno", None) in (110,):
                    continue
                if exc.__class__.__name__ == "USBTimeoutError":
                    continue
                raise

            packet = parse_packet(raw)
            if packet is None:
                continue

            jpeg = self.assembler.feed(packet)
            if jpeg is not None:
                self.frames_read += 1
                return jpeg

        return None

    @property
    def serial_number(self) -> str | None:
        return safe_attr(self.device, "serial_number") if self.device else None

    @property
    def bus(self) -> int | None:
        return safe_attr(self.device, "bus") if self.device else None

    @property
    def address(self) -> int | None:
        return safe_attr(self.device, "address") if self.device else None

    def release(self) -> None:
        if self.device is None:
            return

        try:
            self.device.set_interface_altsetting(interface=1, alternate_setting=0)
        except usb_core.USBError:
            pass

        for interface in reversed(self._claimed_interfaces):
            try:
                usb_util.release_interface(self.device, interface)
            except usb_core.USBError:
                pass
        self._claimed_interfaces.clear()

        try:
            usb_util.dispose_resources(self.device)
        except Exception:
            pass
        self.device = None

    def __enter__(self) -> "Camera":
        return self

    def __exit__(self, *_args: Any) -> None:
        self.release()


def list_command(_args: argparse.Namespace) -> int:
    try:
        devices = [camera_to_dict(device) for device in find_devices()]
        emit({"ok": True, "devices": devices})
        return 0
    except Exception as exc:
        emit({"ok": False, "error": str(exc)})
        return 1


def stream_command(args: argparse.Namespace) -> int:
    try:
        with Camera(serial=args.serial or "", timeout=args.timeout) as camera:
            emit(
                {
                    "type": "ready",
                    "serial": camera.serial_number,
                    "bus": camera.bus,
                    "address": camera.address,
                    "message": "Camera stream opened with packet-aware capture.",
                }
            )

            missed = 0
            last_report = time.monotonic()
            while True:
                jpeg = camera.read_jpeg()
                if not jpeg:
                    missed += 1
                    now = time.monotonic()
                    if now - last_report >= 2:
                        emit(
                            {
                                "type": "log",
                                "level": "warn",
                                "message": f"Waiting for frames; missed {missed} reads.",
                            }
                        )
                        last_report = now
                    continue

                dimensions = jpeg_dimensions(jpeg) or (640, 480)
                width, height = dimensions
                emit(
                    {
                        "type": "frame",
                        "frames": camera.frames_read,
                        "width": width,
                        "height": height,
                        "jpeg_bytes": len(jpeg),
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
