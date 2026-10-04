#!/usr/bin/env python3
import unittest

from supercamera_bridge import FrameAssembler, Packet, jpeg_dimensions, parse_packet


def fake_jpeg(width=640, height=480):
    # SOI + minimal SOF0 segment + EOI. Enough for metadata/parser tests.
    return bytes([
        0xFF, 0xD8,
        0xFF, 0xC0, 0x00, 0x11, 0x08,
        (height >> 8) & 0xFF, height & 0xFF,
        (width >> 8) & 0xFF, width & 0xFF,
        0x03,
        0x01, 0x11, 0x00,
        0x02, 0x11, 0x00,
        0x03, 0x11, 0x00,
        0xFF, 0xD9,
    ])


class ProtocolTests(unittest.TestCase):
    def test_parse_packet_uses_declared_length_and_ignores_extra_bytes(self):
        chunk = b"jpeg-chunk"
        declared = 7 + len(chunk)
        packet = bytes([
            0xAA, 0xBB, 0x07,
            declared & 0xFF, declared >> 8,
            0x22, 0x00, 0x02,
            0x01, 0x00, 0x00, 0x00,
        ]) + chunk + b"NEXT_PACKET_PREFIX"
        parsed = parse_packet(packet)
        self.assertIsNotNone(parsed)
        self.assertEqual(parsed.fid, 0x22)
        self.assertEqual(parsed.flags, 0x02)
        self.assertEqual(parsed.chunk, chunk)

    def test_frame_assembler_finishes_on_frame_id_change(self):
        jpeg = fake_jpeg()
        split = len(jpeg) // 2
        assembler = FrameAssembler()
        self.assertIsNone(assembler.feed(Packet(7, 1, 0, 0, 0, jpeg[:split])))
        self.assertIsNone(assembler.feed(Packet(11, 1, 0, 0, 0, jpeg[split:])))
        completed = assembler.feed(Packet(7, 2, 0, 0, 0, b"next"))
        self.assertEqual(completed, jpeg)

    def test_jpeg_dimensions_from_sof(self):
        self.assertEqual(jpeg_dimensions(fake_jpeg(1280, 720)), (1280, 720))


if __name__ == "__main__":
    unittest.main()
