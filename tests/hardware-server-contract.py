"""Local-only adapter contracts. No real serial port, SDK, device configuration, or customer data."""
import asyncio
import importlib.util
import json
import logging
import os
import runpy
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import Mock, mock_open, patch

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
from multi3400 import Multi3400
from printer import BixolonPrinter
from test_bac2400 import Bac2400Test, multi_frame
from test_multi3400 import Multi3400Test, status_frame
from test_card_dispenser import CardDispenserContracts

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
    def test_moved_beach_b_hardware_loads_from_local_env_and_uses_8N1_without_oneplus(self):
        isolated = importlib.util.module_from_spec(spec)
        local_env = "KIOSK_PROPERTY_ID=property3\nKIOSK_BUILDING=A\nKIOSK_HARDWARE=beach-b\nCARD_DISPENSER_ENABLED=true\n"
        with patch("builtins.open", mock_open(read_data=local_env)), patch.dict("os.environ", {}, clear=True):
            spec.loader.exec_module(isolated)
        self.assertEqual(isolated.HARDWARE_PROFILE, "beach-b")
        self.assertTrue(isolated.USE_MULTI3400)
        self.assertTrue(isolated.USE_WOOSIM)
        self.assertFalse(isolated.USE_BAC2400)
        self.assertIsInstance(isolated.multi3400, Multi3400)
        self.assertEqual(isolated.multi3400.bd1_value, 5000)
        self.assertEqual(isolated.multi3400.parity, serial.PARITY_NONE)
        with patch.object(serial, "Serial", return_value=Mock(is_open=True)) as fake_serial:
            isolated.multi3400.connect()
            self.assertEqual(fake_serial.call_args.kwargs["parity"], "N")
            # pyserial defaults are one stop bit and eight data bits.
            self.assertEqual(fake_serial.call_args.kwargs.get("stopbits", 1), 1)
            self.assertEqual(fake_serial.call_args.kwargs.get("bytesize", 8), 8)
        for device in (isolated.bac2400, isolated.acceptor, isolated.dispenser, isolated.printer, isolated.card_dispenser):
            self.assertIsNone(device)
        serial.Serial.assert_not_called()

    async def test_invalid_hardware_and_foreign_camp_disable_all_devices_and_reject_commands(self):
        for profile in ("unknown", "ONEPLUS", " beach-b ", "camp"):
            isolated = importlib.util.module_from_spec(spec)
            env = {"KIOSK_PROPERTY_ID": "property3", "KIOSK_BUILDING": "A", "KIOSK_HARDWARE": profile,
                   "CARD_DISPENSER_ENABLED": "true", "CARD_BRIDGE_TOKEN": "a" * 64}
            with patch("builtins.open", side_effect=FileNotFoundError), patch.dict("os.environ", env, clear=True):
                spec.loader.exec_module(isolated)
                self.assertIsNone(isolated.HARDWARE_PROFILE)
                for device in (isolated.multi3400, isolated.bac2400, isolated.acceptor, isolated.dispenser, isolated.printer, isolated.card_dispenser):
                    self.assertIsNone(device)
                client = FakeClient([json.dumps({"type": "acceptor_enable"}), json.dumps({"type": "raw_dispenser", "data": [36, 68, 8, 83, 159]}),
                                     json.dumps({"type": "printer_status"}), json.dumps({"type": "ping"})])
                await isolated.handle_client(client)
                self.assertEqual(client.sent[:2], [{"type": "error", "reason": "invalid_hardware_profile"}] * 2)
                self.assertEqual(client.sent[2], {"type": "printer_status", "ready": False})
                self.assertEqual(client.sent[3], {"type": "pong"})
        serial.Serial.assert_not_called()

    def test_cash_board_scope_and_local_port_priority_without_opening_any_com(self):
        cases = [
            ({"KIOSK_PROPERTY_ID": "property3", "KIOSK_BUILDING": "B"}, True, "COM5"),
            ({"KIOSK_PROPERTY_ID": "property4"}, True, "COM5"),
            ({"KIOSK_PROPERTY_ID": "property3", "KIOSK_BUILDING": "B", "BAC2400_PORT": "COM9", "BOARD3400_PORT": "COM8"}, True, "COM9"),
            ({"KIOSK_PROPERTY_ID": "property4", "BOARD3400_PORT": "COM8"}, True, "COM8"),
            ({"KIOSK_PROPERTY_ID": "property3", "KIOSK_BUILDING": "A"}, False, None),
            ({"KIOSK_PROPERTY_ID": "property3"}, False, None),
            ({"KIOSK_PROPERTY_ID": "property1", "KIOSK_BUILDING": "C"}, False, None),
            ({"KIOSK_PROPERTY_ID": "property1", "KIOSK_BUILDING": "D"}, False, None),
            ({"KIOSK_PROPERTY_ID": "property2", "KIOSK_BUILDING": "B"}, False, None),
        ]
        for env, integrated, port in cases:
            with self.subTest(env=env):
                isolated = importlib.util.module_from_spec(spec)
                with patch("builtins.open", side_effect=FileNotFoundError), patch.dict("os.environ", env, clear=True):
                    spec.loader.exec_module(isolated)
                is_b = env.get("KIOSK_PROPERTY_ID") == "property3" and env.get("KIOSK_BUILDING") == "B"
                self.assertEqual(isolated.USE_MULTI3400, is_b)
                self.assertEqual(isolated.USE_BAC2400, env.get("KIOSK_PROPERTY_ID") == "property4")
                board = isolated.multi3400 or isolated.bac2400
                self.assertEqual(board.port if board else None, port)
                if integrated:
                    self.assertIsInstance(board, Multi3400 if is_b else Bac2400)
                self.assertEqual(isolated.acceptor is None, integrated)
                self.assertEqual(isolated.dispenser is None, integrated)
        serial.Serial.assert_not_called()

    def test_B_payout_value_loads_from_local_env_and_invalid_values_refuse_without_io(self):
        for configured, expected in [(None, 5000), ("1000", 1000), ("5000", 5000), ("10000", 10000),
                                     ("50000", 50000), ("bad", None), ("2000", 2000), ("", None)]:
            local_env = "KIOSK_PROPERTY_ID=property3\nKIOSK_BUILDING=B\n"
            if configured is not None:
                local_env += "MULTI3400_BD1_VALUE=" + configured + "\n"
            isolated = importlib.util.module_from_spec(spec)
            with patch("builtins.open", mock_open(read_data=local_env)), patch.dict("os.environ", {}, clear=True):
                spec.loader.exec_module(isolated)
            self.assertEqual(isolated.multi3400.bd1_value, expected)
            isolated.multi3400.send = Mock(return_value=True)
            if expected not in Multi3400.PAYOUT_VALUES:
                result = isolated.handle_bac2400_message({"type": "dispense", "count": 8})
                self.assertEqual(result[0]["data"][1:4], [0x6E, 0x73, 0x21])
                isolated.multi3400.send.assert_not_called()
        serial.Serial.assert_not_called()

    async def test_B_raw_and_generic_dispenser_commands_use_FE_and_oneplus_responses(self):
        for message in ({"type": "raw_dispenser", "data": list(server.legacy_packet(0x44, 8, 0x53))},
                        {"type": "dispense", "count": 8}):
            isolated = importlib.util.module_from_spec(spec)
            with patch("builtins.open", side_effect=FileNotFoundError), patch.dict("os.environ",
                    {"KIOSK_PROPERTY_ID": "property3", "KIOSK_BUILDING": "B"}, clear=True):
                spec.loader.exec_module(isolated)
            board, sent = isolated.multi3400, []
            board.send = lambda p: sent.append(bytes(p)) or True
            await isolated.handle_client(FakeClient([json.dumps(message)]))
            board.process_incoming(status_frame())
            board.process_incoming(b"\x11")
            board.process_incoming(status_frame())
            result = board.process_incoming(b"\x11")
            self.assertEqual(sent, [Multi3400._command(0x11), Multi3400._command(0x10, ctrl1=0x10),
                                    Multi3400._command(0x11), Multi3400._command(0x12, bd1=8)])
            self.assertEqual(result[0]["data"], list(server.legacy_packet(0x64, 8, 0x61)))
        serial.Serial.assert_not_called()

    def test_source_self_test_loads_architecture_matching_bixolon_sdk_without_a_port(self):
        # Run the changed source under the selected Python, including the real 32/64-bit DLL load.
        with patch.object(sys, "argv", ["main.py", "--self-test"]):
            with self.assertRaises(SystemExit) as result:
                runpy.run_path(str(root / "hardware_server/main.py"), run_name="__main__")
        self.assertEqual(result.exception.code, 0)
        serial.Serial.assert_not_called()

    async def test_B_and_Camp_route_recovery_through_the_real_adapter_with_zero_payout_or_return(self):
        for env in [{"KIOSK_PROPERTY_ID": "property3", "KIOSK_BUILDING": "B"}, {"KIOSK_PROPERTY_ID": "property4"}]:
            isolated = importlib.util.module_from_spec(spec)
            with patch("builtins.open", side_effect=FileNotFoundError), patch.dict("os.environ", env, clear=True):
                spec.loader.exec_module(isolated)
            sent = []
            if isolated.multi3400:
                board = isolated.multi3400
                board.send = lambda p: sent.append(bytes(p)) or True
                for target in ("acceptor", "dispenser"):
                    client = FakeClient([json.dumps({"type": "cash_board_recover", "requestId": "qa-" + target, "target": target})])
                    await isolated.handle_client(client)
                    if target == "acceptor":
                        board.process_incoming(b"\x11")
                    result = board.process_incoming(status_frame())
                    self.assertTrue(next(m for m in result if m["type"] == "cash_board_result")["verified"])
                self.assertEqual(sent, [Multi3400._command(0x10, ctrl1=8), Multi3400._command(0x11), Multi3400._command(0x11)])
                self.assertIsNone(board.operation)
                continue
            isolated.bac2400.send = lambda p: sent.append(bytes(p)) or True
            for target in ("acceptor", "dispenser"):
                client = FakeClient([json.dumps({"type": "cash_board_recover", "requestId": "qa-" + target, "target": target})])
                await isolated.handle_client(client)
                if target == "acceptor":
                    before = multi_frame((0x18, [0] * 4), (0x1B, [1, 0, 0x12]))
                    after = multi_frame((0x18, [0] * 4), (0x1B, [0, 0, 0x12]))
                else:
                    before = after = multi_frame((0x15, [0] * 4), (0x16, [0] * 4), (0x17, [0]))
                isolated.bac2400.process_incoming(before)
                result = isolated.bac2400.process_incoming(after)
                self.assertTrue(next(m for m in result if m["type"] == "cash_board_result")["verified"])
            self.assertEqual(sent, [bytes.fromhex(h) for h in (
                "59 A6", "5B A4 03 10 00 00 13", "59 A6", "71 8E", "73 8C 05 01 00 00 01 00 05", "71 8E")])
            self.assertIsNone(isolated.bac2400.pending_payout)
        serial.Serial.assert_not_called()

    def test_card_startup_gates_and_invalid_configuration_leave_other_hardware_available(self):
        base = {"CARD_BRIDGE_TOKEN": "a" * 64, "CARD_DISPENSER_PORT": "COM9", "CARD_DISPENSER_ENABLED": "true"}
        for overrides, allowed in [({"KIOSK_PROPERTY_ID": "property1"}, True),
                                   ({"KIOSK_PROPERTY_ID": "property3", "KIOSK_BUILDING": "A"}, True),
                                   ({"KIOSK_PROPERTY_ID": "property3", "KIOSK_BUILDING": "B"}, False),
                                   ({"KIOSK_PROPERTY_ID": "property4"}, False),
                                   ({"KIOSK_PROPERTY_ID": "property2"}, False),
                                   ({"KIOSK_PROPERTY_ID": "property1", "CARD_DISPENSER_ENABLED": "false"}, False),
                                   ({"KIOSK_PROPERTY_ID": "property1", "CARD_DISPENSER_PORT": "COM2"}, False),
                                   ({"KIOSK_PROPERTY_ID": "property1", "CARD_DISPENSER_ADDRESS": "잘못됨"}, False),
                                   ({"KIOSK_PROPERTY_ID": "property1", "CARD_DISPENSER_ADDRESS": "99"}, False)]:
            isolated = importlib.util.module_from_spec(spec)
            with patch("builtins.open", side_effect=FileNotFoundError), patch.dict("os.environ", {**base, **overrides}, clear=True):
                spec.loader.exec_module(isolated)
            self.assertEqual(isolated.card_dispenser is not None, allowed)
        serial.Serial.assert_not_called()

    async def test_card_messages_require_private_token_and_never_broadcast_source_card(self):
        client, other = FakeClient(), FakeClient()
        device = Mock()
        device.register.return_value = {"success": True, "uid": "01020304", "blocks": {"1": "ab" * 16}, "settled": True}
        server.connected_clients.add(other)
        try:
            with patch.object(server, "card_dispenser", device), patch.object(server, "CARD_BRIDGE_TOKEN", "a" * 64), \
                 patch.dict("os.environ", {"KIOSK_PROPERTY_ID": "property1", "CARD_DISPENSER_ENABLED": "true"}):
                await server.handle_card_command(client, {"type": "card_register", "requestId": "test-1", "token": "bad"})
                await server.handle_card_command(client, {"type": "card_register", "requestId": "test-1", "token": "가" * 64})
                device.register.assert_not_called()
                await server.handle_card_command(client, {"type": "card_register", "requestId": "test-2", "token": "a" * 64, "profile": {}})
                device.register.assert_called_once()
                self.assertEqual(client.sent[0]["requestId"], "test-2")
                self.assertEqual(other.sent, [])
        finally:
            server.connected_clients.clear()

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

    async def test_printer_status_reconnects_without_printing_or_cutting(self):
        client = FakeClient(['{"type":"printer_status"}'])
        printer = Mock(is_connected=False)
        def connect():
            printer.is_connected = True
        printer.connect.side_effect = connect
        with patch.object(server, 'printer', printer):
            await server.handle_client(client)
        self.assertEqual(client.sent, [{"type": "printer_status", "ready": True}])
        printer.connect.assert_called_once()
        printer.print_text.assert_not_called()
        printer.cut_paper.assert_not_called()

    async def test_C_D_bixolon_status_reuses_the_print_sdk_connection_without_closing_or_reinitializing(self):
        for building in ('C', 'D'):
            with self.subTest(building=building):
                isolated = importlib.util.module_from_spec(spec)
                with patch('builtins.open', side_effect=FileNotFoundError), patch.dict('os.environ',
                        {'KIOSK_PROPERTY_ID': 'property1', 'KIOSK_BUILDING': building}, clear=True):
                    spec.loader.exec_module(isolated)
                printer = isolated.printer
                sdk = Mock()
                sdk.PrinterOpen.return_value = sdk.InitializePrinter.return_value = 0
                sdk.PrintTextW.return_value = sdk.CutPaper.return_value = 0
                printer.sdk = sdk
                client = FakeClient(['{"type":"printer_status"}', '{"type":"printer_status"}'])
                await isolated.handle_client(client)
                self.assertEqual(client.sent, [{'type': 'printer_status', 'ready': True}] * 2)
                sdk.PrinterOpen.assert_called_once()
                sdk.InitializePrinter.assert_called_once()
                sdk.PrinterClose.assert_not_called()
                sdk.PrintTextW.assert_not_called()
                sdk.CutPaper.assert_not_called()
                # The same SDK/COM owner remains available to the existing receipt path.
                self.assertTrue(printer.print_text('QA synthetic receipt'))
                self.assertTrue(printer.cut_paper())
                sdk.PrinterOpen.assert_called_once()
                sdk.InitializePrinter.assert_called_once()
                sdk.PrinterClose.assert_not_called()

    async def test_server_shutdown_requires_the_per_launch_secret(self):
        secret = 'a' * 64
        stop = asyncio.Event()
        client = FakeClient([json.dumps({"type": "shutdown", "token": "b" * 64}),
                             json.dumps({"type": "shutdown", "token": secret})])
        with patch.object(server, 'CARD_BRIDGE_TOKEN', secret), patch.object(server, 'shutdown_event', stop):
            await server.handle_client(client)
        self.assertTrue(stop.is_set())
        self.assertEqual(client.sent, [{"type": "shutdown_ack"}])

    async def test_one_closed_client_does_not_block_other_device_recipients(self):
        good, bad = FakeClient(), FakeClient(broken=True)
        server.connected_clients.update([good, bad])
        try:
            await server.broadcast({"type": "acceptor_event", "event": 11})
            self.assertEqual(len(good.sent), 1)
        finally:
            server.connected_clients.clear()

    @unittest.skipIf(os.environ.get("KIOSK_QA_NO_NETWORK") == "1", "Network forbidden for this QA run")
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
        self.assertEqual(board.process_incoming(old), [], 'Running alone cannot prove a per-cycle counter')
        self.assertEqual(board.process_incoming(multi_frame((0x15, [0] * 4), (0x16, [0] * 4), (0x17, [1]))), [])
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
