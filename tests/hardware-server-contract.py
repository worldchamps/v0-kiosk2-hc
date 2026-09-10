"""Local-only adapter contracts. No real serial port, SDK, device configuration, or customer data."""
import asyncio
import importlib.util
import json
import logging
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import Mock, patch

sys.dont_write_bytecode = True
root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / "hardware_server"))
serial = types.ModuleType("serial")
serial.PARITY_NONE, serial.PARITY_EVEN = "N", "E"
serial.Serial = Mock(side_effect=AssertionError("Real COM access is forbidden in QA"))
sys.modules["serial"] = serial

from serial_manager import SerialDevice
from acceptor import OnePlusAcceptor
from bac2400 import Bac2400
from printer import BixolonPrinter
from test_bac2400 import Bac2400Test, multi_frame

spec = importlib.util.spec_from_file_location("qa_hardware_main", root / "hardware_server/main.py")
server = importlib.util.module_from_spec(spec)
with patch("builtins.open", side_effect=FileNotFoundError), patch.dict("os.environ", {}, clear=True):
    spec.loader.exec_module(server)

logging.disable(logging.CRITICAL)


class FakeClient:
    def __init__(self, messages=(), broken=False):
        self.messages, self.sent, self.broken = iter(messages), [], broken

    def __aiter__(self):
        return self

    async def __anext__(self):
        try:
            return next(self.messages)
        except StopIteration:
            raise StopAsyncIteration

    async def send(self, message):
        if self.broken:
            raise RuntimeError("synthetic closed client")
        self.sent.append(json.loads(message))


class HardwareContracts(unittest.IsolatedAsyncioTestCase):
    def test_imports_never_open_hardware(self):
        serial.Serial.assert_not_called()
        self.assertFalse(server.printer.is_connected)

    def test_serial_partial_write_is_not_success_and_write_is_bounded(self):
        device = SerialDevice("QA", "QA-FAKE")
        fake = Mock(is_open=True)
        with patch.object(serial, "Serial", return_value=fake) as constructor:
            self.assertTrue(device.connect())
        self.assertEqual(constructor.call_args.kwargs.get("write_timeout"), device.timeout)
        for written, expected in [(0, False), (2, False), (3, True)]:
            fake.write.return_value = written
            self.assertEqual(device.send(b"abc"), expected)
        fake.write.side_effect = OSError("fake failure")
        self.assertFalse(device.send(b"abc"))

    def test_acceptor_fragment_checksum_and_event_ack(self):
        device = OnePlusAcceptor("QA-FAKE")
        sent, received = [], []
        device.send = lambda data: sent.append(bytes(data)) or True
        packet = device._build_packet("E", "S", 0x0B)
        device.process_incoming(b"garbage" + packet[:2], received.append)
        self.assertEqual(received, [])
        device.process_incoming(packet[2:], received.append)
        self.assertEqual(received, [{"type": "acceptor_event", "event": 0x0B}])
        self.assertEqual(sent, [bytes(device._build_packet("e", "s", 0x0B))])
        bad = bytearray(packet); bad[-1] ^= 1
        device.process_incoming(bad, received.append)
        self.assertEqual(len(received), 1)

    def test_printer_sdk_partial_write_and_failure_never_report_success(self):
        printer = BixolonPrinter("QA-FAKE")
        printer.is_connected = True
        printer.sdk = Mock()
        printer.sdk.PrintTextW.return_value = 1
        printer.sdk.CutPaper.return_value = 1
        printer.sdk.WriteBuff.return_value = 0  # written count remains zero
        self.assertFalse(printer.print_text("QA synthetic receipt"))
        self.assertFalse(printer.cut_paper())
        self.assertFalse(printer.send_command(b"abc"))

    async def test_malformed_messages_do_not_kill_the_connection(self):
        client = FakeClient(["[]", '"text"', "null", "{broken", '{"type":"ping"}'])
        await server.handle_client(client)
        self.assertEqual(client.sent, [{"type": "pong"}])
        self.assertNotIn(client, server.connected_clients)

    async def test_one_closed_client_does_not_block_other_device_recipients(self):
        good, bad = FakeClient(), FakeClient(broken=True)
        server.connected_clients.update([good, bad])
        try:
            await server.broadcast({"type": "acceptor_event", "event": 11})
            self.assertEqual(len(good.sent), 1)
        finally:
            server.connected_clients.clear()

    async def test_main_binds_only_loopback_and_rejects_browser_origins(self):
        # Execute main's startup with all adapters and socket factory replaced; inspect the actual serve contract.
        captured = {}
        class Done(Exception):
            pass
        class Serve:
            async def __aenter__(self):
                raise Done()
            async def __aexit__(self, *_):
                pass
        def serve(*args, **kwargs):
            captured.update(args=args, kwargs=kwargs)
            return Serve()
        with patch.object(server, "dispenser", Mock()), patch.object(server, "acceptor", Mock()), \
             patch.object(server, "printer", Mock()), patch.object(server.websockets, "serve", serve):
            with self.assertRaises(Done):
                await server.main()
        self.assertEqual(captured["args"][1], "localhost")
        self.assertEqual(captured["kwargs"].get("origins"), [None])
        # Same factory/options, now on an ephemeral loopback socket with ping only, never device handlers.
        async def ping_only(ws):
            await ws.send("qa-ok")
        async with server.websockets.serve(ping_only, "127.0.0.1", 0, **captured["kwargs"]) as socket:
            uri = f"ws://127.0.0.1:{socket.sockets[0].getsockname()[1]}"
            async with server.websockets.connect(uri, proxy=None) as client:
                self.assertEqual(await client.recv(), "qa-ok")
            for origin in ["https://example.test", "http://localhost:3000", "null"]:
                with self.assertRaises(server.websockets.exceptions.InvalidStatus):
                    async with server.websockets.connect(uri, origin=origin, proxy=None):
                        self.fail("Browser Origin must be rejected")

    def test_bac_duplicate_payout_cannot_replace_inflight_amount(self):
        board = Bac2400("QA-FAKE")
        board.send = lambda _: True
        self.assertTrue(board.dispense(2))
        self.assertFalse(board.dispense(1))
        self.assertEqual(board.pending_payout["count"], 2)

    def test_bac_old_count_or_partial_status_is_not_new_payout_completion(self):
        board = Bac2400("QA-FAKE")
        board.send = lambda _: True
        board.last_payout_counts = [0, 0, 5, 0]
        self.assertTrue(board.dispense(2))
        board.process_incoming(multi_frame((0x16, [0, 0, 0, 0]), (0x17, [0])))
        messages = board.process_incoming(multi_frame((0x16, [0, 0, 0, 0]), (0x17, [0])))
        self.assertEqual(messages, [])
        self.assertIsNotNone(board.pending_payout)

    def test_bac_repeated_previous_count_needs_observed_progress(self):
        board = Bac2400("QA-FAKE")
        board.send = lambda _: True
        self.assertTrue(board.dispense(2))
        old = multi_frame((0x15, [0, 0, 2, 0]), (0x16, [0, 0, 0, 0]), (0x17, [0]))
        board.process_incoming(old)
        self.assertEqual(board.process_incoming(old), [])
        self.assertIsNotNone(board.pending_payout)
        self.assertEqual(board.process_incoming(multi_frame((0x17, [1]))), [])
        self.assertEqual(board.process_incoming(multi_frame((0x15, [0]), (0x17, [0]))), [])
        result = board.process_incoming(old)
        self.assertEqual(result[0]["data"][1:4], [0x64, 2, 0x53])
        self.assertIsNone(board.pending_payout)

    def test_bac_invalid_count_and_timeout_never_claim_completion(self):
        board = Bac2400("QA-FAKE")
        board.send = lambda _: True
        for count in [0, -1, 251, 1.5, True]:
            self.assertFalse(board.dispense(count))
        with patch("bac2400.time.monotonic", return_value=10):
            self.assertTrue(board.dispense(2))
        with patch("bac2400.time.monotonic", return_value=23):
            self.assertFalse(board.payout_in_progress)
        self.assertIsNone(board.pending_payout)


if __name__ == "__main__":
    unittest.main(verbosity=2)
