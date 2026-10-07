"""Byte-level K750 fake. No COM device or customer card is accessed."""
from collections import deque
import unittest

from card_dispenser import CardDispenser, CardError, card_enabled


class FakeClock:
    def __init__(self):
        self.value = 0
    def __call__(self):
        return self.value
    def sleep(self, seconds):
        self.value += seconds


class FakeK750:
    is_open = True
    def __init__(self, device):
        self.device, self.input, self.commands = device, deque(), []
        self.pending = None
        self.bits = 0
        self.fault = None
        self.blocks = {i: bytes([i]) * 16 for i in range(64)}
    @property
    def in_waiting(self):
        return min(len(self.input), 1)  # fragment every ACK/frame into individual bytes
    def read(self, size):
        return bytes(self.input.popleft() for _ in range(min(size, len(self.input))))
    def write(self, data):
        if data[0] == 2:
            if self.pending is not None:
                raise AssertionError("Command overlap before ENQ")
            self.pending = data[5:-2]
            self.commands.append(self.pending)
            if self.fault == "silent":
                return len(data)
            self.input.extend(bytes([21 if self.fault == "nak" else 6]) + self.device.address)
        elif data[0] == 5:
            command, self.pending = self.pending, None
            if command == b"AP":
                reply = b"SF" + f"{self.bits:04X}".encode()
            elif command in self.device.MOVES.values():
                self.bits = 0 if command in (b"CP", b"DB", b"RS") else 2 if command in (b"FC7", b"FC8") else 1
                return len(data)
            elif command[:2] == b";3":
                reply = b"P;3" + self.blocks[command[2]]
            else:
                if command[:2] == b";4":
                    self.blocks[command[2]] = command[3:]
                reply = b"P" + command[:2]
            frame = bytearray(self.device.frame(reply))
            if self.fault == "bcc":
                frame[-1] ^= 1
            self.input.extend(frame)
        elif data[0] == 4:
            self.pending = None
        return len(data)


class CardDispenserContracts(unittest.TestCase):
    def device(self):
        clock = FakeClock()
        device = CardDispenser("QA-FAKE", clock=clock, sleep=clock.sleep)
        device.ser = FakeK750(device)
        return device

    def test_gate_requires_explicit_supported_pc_and_flag(self):
        for prop, building, allowed in [("property1", "", True), ("property3", "A", True),
                                       ("property3", "B", False), ("property3", "", False),
                                       ("property2", "", False), ("property4", "", False)]:
            env = {"KIOSK_PROPERTY_ID": prop, "KIOSK_BUILDING": building}
            self.assertFalse(card_enabled(env))
            env["CARD_DISPENSER_ENABLED"] = "true"
            self.assertEqual(card_enabled(env), allowed)

    def test_manual_status_vector_and_fragmentation(self):
        device = self.device()
        self.assertEqual(device.frame(b"AP"), bytes.fromhex("023030000241500312"))
        device.ser.bits = 0x8018
        status = device.status()
        self.assertTrue(status["success"])
        self.assertTrue(status["empty"] and status["low"] and status["captureFull"])
        self.assertEqual(status["reason"], "capture_full")

    def test_movement_is_ack_enq_then_status_without_p_reply(self):
        device = self.device()
        device.ser.bits = 2
        self.assertTrue(device.capture()["settled"])
        self.assertEqual(device.ser.commands, [b"AP", b"CP", b"AP"])
        self.assertGreaterEqual(device.clock(), .2)

    def test_nak_checksum_silent_failure_and_single_operation_lock(self):
        for fault, reason in [("nak", "nak"), ("bcc", "checksum"), ("silent", "timeout")]:
            device = self.device()
            device.ser.fault = fault
            self.assertEqual(device.status()["reason"], reason)
            self.assertLess(device.clock(), 3.1)
        device = self.device()
        device.lock.acquire()
        self.assertEqual(device.status()["reason"], "busy")
        self.assertEqual(device.ser.commands, [])

    def test_block_zero_rejected_without_io(self):
        device = self.device()
        with self.assertRaises(CardError):
            device._write_block(0, "00" * 16, 5)
        self.assertEqual(device.ser.commands, [])

    def test_invalid_profile_and_block_rejected_without_io(self):
        device = self.device()
        for sector, key, kind in [(16, "ff" * 6, "A"), (0, "secret", "A"), (0, "ff" * 6, "C")]:
            with self.assertRaises(CardError):
                device._authenticate(sector, key, kind, 5)
        for block in [-1, 64, True]:
            with self.assertRaises(CardError):
                device._read_block(block, 5)
        self.assertEqual(device.ser.commands, [])

    def test_reset_rejects_card_in_transport(self):
        device = self.device()
        device.ser.bits = 2
        self.assertEqual(device.reset()["reason"], "card_present")
        self.assertNotIn(b"RS", device.ser.commands)

    def test_card_bytes_do_not_use_raw_serial_log_or_reader_thread(self):
        device = self.device()
        with self.assertNoLogs("SerialManager"):
            device._write_block(1, "a1" * 16, 5)
            self.assertEqual(device._read_block(1, 5), "a1" * 16)
            device.start()
        self.assertIsNone(device.thread)

    def test_corrupt_frame_cannot_satisfy_next_request(self):
        device = self.device()
        device.ser.fault = "bcc"
        self.assertFalse(device.status()["success"])
        device.ser.fault = None
        self.assertEqual(device.status()["reason"], "protocol_unsynchronized")
        self.assertEqual(len(device.ser.commands), 1)
