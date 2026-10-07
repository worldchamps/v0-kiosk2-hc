"""Byte-level K750 fake. No COM device or customer card is accessed."""
from collections import deque
import unittest
from unittest.mock import patch

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
        self.uid_response = bytes.fromhex("01020304")
        self.blocks[0] = self.uid_response + b"\x04" + bytes(11)
        self.uid_write_behavior = "accept"
        for i in range(3, 64, 4):
            self.blocks[i] = bytes.fromhex("ffffffffffffff078069ffffffffffff")
        self.take_card = True
        self.present_queries = 0
        self.mismatch_count = 0
        self.wrote = set()
        self.denied_sector = None
        self.authenticated_sector = None
        self.write_delay = 0
        self.controls = []
        self.denied_block = None
    @property
    def in_waiting(self):
        return min(len(self.input), 1)  # fragment every ACK/frame into individual bytes
    def read(self, size):
        return bytes(self.input.popleft() for _ in range(min(size, len(self.input))))
    def close(self):
        self.is_open = False
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
                if self.bits == 1 and self.take_card:
                    self.present_queries += 1
                    if self.present_queries > 1:
                        self.bits = 0
                reply = b"SF" + f"{self.bits:04X}".encode()
            elif command in self.device.MOVES.values():
                self.authenticated_sector = None
                self.bits = 0 if command in (b"CP", b"DB", b"RS") else 2 if command in (b"FC7", b"FC8") else 1
                if command == b"FC4":
                    self.present_queries = 0
                return len(data)
            elif command == b";0":
                self.authenticated_sector = None
                reply = b"P;0"
            elif command == b";1":
                reply = b"P;1" + self.uid_response
            elif command[:2] == b";2":
                # Vendor K720_S50LoadSecKey sends SectorAddr unchanged (00..0F).
                self.authenticated_sector = None
                if command[2] >= 16 or command[2] == self.denied_sector:
                    reply = b"N;2\x43"
                else:
                    self.authenticated_sector = command[2]
                    reply = b"P;2"
            elif command[:2] == b";3" and (command[2] == self.denied_block or
                                          command[2] // 4 != self.authenticated_sector):
                reply = b"N;3\x45"
            elif command[:2] == b";4" and command[2] // 4 != self.authenticated_sector:
                reply = b"N;4\x46"
            elif command[:3] == b";4\x00" and self.uid_write_behavior == "reject":
                reply = b"N;4\x46"
            elif command[:2] == b";3":
                value = self.blocks[command[2]]
                if command[2] % 4 == 3:
                    value = b"\x00" * 6 + value[6:]
                if self.mismatch_count and command[2] in self.wrote:
                    self.mismatch_count -= 1
                    value = bytes([value[0] ^ 1]) + value[1:]
                reply = b"P;3" + value
            else:
                if command[:2] == b";4":
                    self.device.sleep(self.write_delay)
                    self.blocks[command[2]] = command[3:]
                    self.wrote.add(command[2])
                    if command[2] == 0:
                        if self.uid_write_behavior != "stale_uid":
                            self.uid_response = command[3:7] + self.uid_response[4:]
                        if self.uid_write_behavior == "corrupt_block":
                            self.blocks[0] = self.blocks[0][:15] + b"\x01"
                        self.authenticated_sector = None
                reply = b"P" + command[:2]
            frame = bytearray(self.device.frame(reply))
            if self.fault == "bcc":
                frame[-1] ^= 1
            self.input.extend(frame)
        elif data[0] == 4:
            self.controls.append(data)
            self.pending = None
        return len(data)


class CardDispenserContracts(unittest.TestCase):
    profile = {"sectors": [{"sector": 0, "keyA": "FFFFFFFFFFFF", "keyB": "FFFFFFFFFFFF"}]}
    def device(self, address=b"00"):
        clock = FakeClock()
        device = CardDispenser("QA-FAKE", address=address, clock=clock, sleep=clock.sleep)
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

    def test_device_number_08_is_used_for_command_and_control_frames(self):
        device = self.device(b"08")
        self.assertEqual(device.frame(b"AP"), bytes.fromhex("02303800024150031a"))
        with patch.object(device.ser, "write", wraps=device.ser.write) as write:
            status = device.status()
            self.assertTrue(status["success"])
            self.assertEqual(status["address"], "08")
            self.assertEqual([call.args[0] for call in write.call_args_list],
                             [bytes.fromhex("02303800024150031a"), b"\x0508"])

    def test_expired_recovery_does_not_unlock_or_issue_a_command(self):
        device = self.device()
        device.desynchronized = True
        with self.assertRaisesRegex(CardError, "timeout"):
            device._recover_channel(device.clock() + 1)
        self.assertTrue(device.desynchronized)
        self.assertEqual(device.ser.commands, [])

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
            device._authenticate(0, "ffffffffffff", "A", 5)
            device._write_block(1, "a1" * 16, 5)
            self.assertEqual(device._read_block(1, 5), "a1" * 16)
            device.start()
        self.assertIsNone(device.thread)

    def test_corrupt_frame_blocks_card_commands_until_explicit_status_recovery(self):
        device = self.device()
        device.ser.fault = "bcc"
        self.assertFalse(device.status()["success"])
        device.ser.fault = None
        with self.assertRaisesRegex(CardError, "protocol_unsynchronized"):
            device._read_block(1, 10)
        device.ser.input.extend(device.frame(b"SF0002"))  # stale reply must be discarded
        result = device.status()
        self.assertTrue(result["success"])
        self.assertEqual(result["sensors"], 0)
        self.assertEqual(device.ser.controls, [b"\x0400"])
        self.assertEqual(device.ser.commands, [b"AP", b"AP"])

    def test_status_retries_report_real_timeout_phase_without_moving_cards(self):
        device = self.device()
        device.ser.fault = "silent"
        for _ in range(2):
            result = device.status()
            self.assertEqual(result["reason"], "timeout")
            self.assertEqual(result["errorStage"], "ack")
            self.assertEqual(result["receivedBytes"], 0)
            self.assertEqual(result["address"], "00")
        self.assertEqual(device.ser.commands, [b"AP", b"AP"])

    def test_manual_status_reopens_unavailable_port_when_it_becomes_free(self):
        device = self.device()
        device.ser.close()
        with patch("serial_manager.serial.Serial", side_effect=PermissionError("busy")):
            result = device.status()
        self.assertFalse(result["success"])
        self.assertEqual(result["errorStage"], "port")
        replacement = FakeK750(device)
        with patch("serial_manager.serial.Serial", return_value=replacement):
            self.assertTrue(device.status()["success"])
        self.assertEqual(replacement.commands, [b"AP"])

    def record(self, device):
        blocks = {str(i): device.ser.blocks[i].hex() for i in range(4)}
        blocks["0"] = "ffffffff00" + blocks["0"][10:]
        return {"profile": self.profile, "uid": "ffffffff", "blocks": blocks}

    def test_register_is_read_only_and_returns_original_before_saving(self):
        device = self.device()
        progress = []
        result = device.register(self.profile, progress.append)
        self.assertTrue(result["success"])
        self.assertEqual(result["uid"], "01020304")
        self.assertEqual(result["blocks"]["3"][:12], "ffffffffffff")
        self.assertIn({"state": "presented"}, progress)
        self.assertFalse(any(cmd[:2] == b";4" for cmd in device.ser.commands))
        self.assertNotIn(b"DB", device.ser.commands)

    def test_registration_refuses_failed_sector_and_returns_original(self):
        device = self.device()
        device.ser.denied_sector = 0
        result = device.register(self.profile)
        self.assertFalse(result["success"])
        self.assertTrue(result["settled"])
        self.assertEqual(result["failedSectors"], [0])
        self.assertIn(b"FC4", device.ser.commands)
        self.assertNotIn("blocks", result)

    def test_all_sixteen_sectors_register_and_issue_with_vendor_sector_addressing(self):
        device = self.device(b"08")
        profile = {"sectors": [{**self.profile["sectors"][0], "sector": i} for i in range(16)]}
        source_blocks = {str(i): value.hex() for i, value in device.ser.blocks.items()}
        registered = device.register(profile)
        self.assertTrue(registered["success"], registered)
        self.assertEqual(registered["blocks"], source_blocks)
        self.assertEqual(device.ser.wrote, set())
        auth_commands = [cmd for cmd in device.ser.commands if cmd[:2] == b";2"]
        self.assertEqual([cmd[2] for cmd in auth_commands], list(range(16)))
        self.assertEqual(auth_commands[1], bytes.fromhex("3b320130ffffffffffff"))
        device.ser.commands.clear()
        device.ser.uid_response = bytes.fromhex("aabbccdd")
        device.ser.blocks[0] = device.ser.uid_response + bytes(12)
        for block in range(1, 64):
            if block % 4 != 3:
                device.ser.blocks[block] = bytes(16)
        issued = device.issue({"profile": profile, "uid": registered["uid"], "blocks": registered["blocks"]})
        self.assertTrue(issued["success"], issued)
        self.assertEqual(device.ser.wrote, set(range(64)))
        self.assertEqual([cmd[2] for cmd in device.ser.commands if cmd[:2] == b";2"], list(range(16)) + [0, 0])
        self.assertEqual(device.ser.uid_response.hex(), registered["uid"])
        self.assertTrue(issued["uidChanged"] and issued["uidMatchesSource"])
        self.assertEqual([cmd[2] for cmd in device.ser.commands if cmd[:2] == b";4"], list(range(1, 64)) + [0])
        self.assertEqual(device.ser.blocks[0].hex(), source_blocks["0"])
        self.assertEqual({str(i): value.hex() for i, value in device.ser.blocks.items()}, source_blocks)

    def test_nonzero_authentication_failure_reports_sector_without_a_block_number(self):
        device = self.device()
        device.ser.denied_sector = 1
        profile = {"sectors": [{**self.profile["sectors"][0], "sector": i} for i in range(2)]}
        result = device.register(profile)
        self.assertEqual(result["reason"], "authentication_failed")
        self.assertEqual(result["failedSectors"], [1])
        self.assertNotIn("failedBlock", result)
        self.assertNotIn("blocks", result)
        self.assertEqual(device.ser.wrote, set())
        self.assertTrue(result["settled"])
        self.assertIn(b"FC4", device.ser.commands)

    def test_five_byte_vendor_id_registers_and_issues_using_the_first_four_bytes(self):
        device = self.device(b"08")
        # Do not guess whether the undocumented fifth byte is BCC/status/etc.
        # The vendor demo displays the first four; block 0 independently agrees.
        device.ser.uid_response = bytes.fromhex("01020304ab")
        result = device.register(self.profile)
        self.assertTrue(result["success"])
        self.assertEqual(result["uid"], "01020304")
        self.assertEqual(device.ser.wrote, set())
        self.assertTrue(device.issue(self.record(device))["success"])
        self.assertIn(0, device.ser.wrote)
        self.assertEqual(device.ser.uid_response.hex(), "ffffffffab")
        self.assertEqual(device.ser.blocks[0][:4], bytes.fromhex("ffffffff"))

    def test_uid_mismatch_returns_original_without_registering_or_writing_it(self):
        device = self.device()
        device.ser.uid_response = bytes.fromhex("05060708ab")
        result = device.register(self.profile)
        self.assertFalse(result["success"])
        self.assertEqual(result["reason"], "uid_mismatch")
        self.assertTrue(result["settled"])
        self.assertIn(b"FC4", device.ser.commands)
        self.assertNotIn("uid", result)
        self.assertNotIn("blocks", result)
        self.assertEqual(device.ser.wrote, set())

    def test_other_uid_lengths_are_not_silently_truncated(self):
        device = self.device()
        device.ser.uid_response = bytes.fromhex("01020304050607")
        self.assertEqual(device._select_card(5), "01020304050607")
        for size in (0, 3, 6, 8, 10):
            device = self.device()
            device.ser.uid_response = bytes(range(size))
            result = device.register(self.profile)
            self.assertEqual(result["reason"], "invalid_uid_response")
            self.assertEqual(result["responseBytes"], size)
            self.assertNotIn("uid", result)

    def test_registration_preserves_read_failure_details_after_returning_original(self):
        device = self.device()
        device.ser.denied_block = 1
        progress = []
        result = device.register(self.profile, progress.append)
        self.assertFalse(result["success"])
        self.assertTrue(result["settled"])
        self.assertEqual(result["reason"], "card_command_failed")
        self.assertEqual(result["failedCommand"], "3B33")
        self.assertEqual(result["deviceCode"], 0x45)
        self.assertEqual(result["failedBlock"], 1)
        self.assertIn({"state": "presented"}, progress)
        self.assertIn(b"FC4", device.ser.commands)
        self.assertEqual(device.ser.wrote, set())
        self.assertNotIn("uid", result)
        self.assertNotIn("blocks", result)

    def test_registration_reports_short_block_length_without_exposing_its_contents(self):
        device = self.device()
        device.ser.blocks[1] = b"sensitive"
        result = device.register(self.profile)
        self.assertEqual(result["reason"], "invalid_block")
        self.assertEqual(result["responseBytes"], 9)
        self.assertEqual(result["failedBlock"], 1)
        self.assertTrue(result["settled"])
        self.assertNotIn("sensitive", str(result))
        self.assertNotIn(b"sensitive".hex(), str(result))

    def test_issue_verifies_data_and_rf_uid_before_presenting_one_cuid_card(self):
        device = self.device()
        result = device.issue(self.record(device))
        self.assertTrue(result["success"])
        self.assertTrue(result["uidChanged"])
        self.assertTrue(result["uidMatchesSource"])
        self.assertEqual(device.ser.commands.count(b"FC7"), 1)
        identity_write = next(i for i, cmd in enumerate(device.ser.commands) if cmd[:3] == b";4\x00")
        self.assertEqual(device.ser.commands[identity_write + 1:identity_write + 3], [b";0", b";1"])
        self.assertLess(identity_write, device.ser.commands.index(b"FC4"))
        self.assertNotIn("uid", result)
        self.assertNotIn("blocks", result)

    def test_identity_failure_captures_one_card_without_presenting_or_retrying(self):
        for behavior, reason in [("reject", "uid_write_failed"), ("stale_uid", "uid_verify_failed"),
                                 ("corrupt_block", "uid_verify_failed")]:
            with self.subTest(behavior=behavior):
                device = self.device()
                device.ser.uid_write_behavior = behavior
                result = device.issue(self.record(device))
                self.assertFalse(result["success"])
                self.assertEqual(result["reason"], reason)
                self.assertTrue(result["settled"])
                self.assertEqual(device.ser.commands.count(b"FC7"), 1)
                self.assertEqual(device.ser.commands.count(b"CP"), 1)
                self.assertNotIn(b"FC4", device.ser.commands)
                self.assertNotIn("uid", result)
                self.assertNotIn("blocks", result)
                if behavior == "reject":
                    self.assertEqual(result["failedBlock"], 0)
                    self.assertEqual(result["deviceCode"], 0x46)

    def test_invalid_source_identity_is_rejected_before_any_card_moves(self):
        for fault in ("missing_uid", "long_uid", "different_uid", "bad_bcc", "missing_sector_zero"):
            with self.subTest(fault=fault):
                device = self.device()
                record = self.record(device)
                if fault == "missing_uid":
                    del record["uid"]
                elif fault == "long_uid":
                    record["uid"] = "ff" * 7
                elif fault == "different_uid":
                    record["uid"] = "01020304"
                elif fault == "bad_bcc":
                    record["blocks"]["0"] = "ffffffff01" + record["blocks"]["0"][10:]
                else:
                    record["profile"] = {"sectors": [{**self.profile["sectors"][0], "sector": 1}]}
                    record["blocks"] = {str(i): device.ser.blocks[i].hex() for i in range(4, 8)}
                result = device.issue(record)
                self.assertFalse(result["success"])
                self.assertIn(result["reason"], ("uid_copy_unsupported", "invalid_source_identity"))
                self.assertEqual(device.ser.commands, [])

    def test_seven_byte_stock_uid_is_captured_without_writing_any_block(self):
        device = self.device()
        device.ser.uid_response = bytes.fromhex("01020304050607")
        result = device.issue(self.record(device))
        self.assertEqual(result["reason"], "stock_uid_unsupported")
        self.assertTrue(result["settled"])
        self.assertEqual(device.ser.wrote, set())
        self.assertIn(b"CP", device.ser.commands)
        self.assertNotIn(b"FC4", device.ser.commands)

    def test_verify_failure_captures_bad_card_and_retries_only_once(self):
        for count, success, captures in [(1, True, 1), (2, False, 2)]:
            device = self.device()
            device.ser.mismatch_count = count
            result = device.issue(self.record(device))
            self.assertEqual(result["success"], success)
            self.assertEqual(device.ser.commands.count(b"FC7"), 2)
            self.assertEqual(device.ser.commands.count(b"CP"), captures)

    def test_empty_jam_and_bad_permissions_do_not_issue(self):
        for bits, reason in [(8, "empty"), (0x20, "jam")]:
            device = self.device()
            device.ser.bits = bits
            self.assertEqual(device.issue(self.record(device))["reason"], reason)
            self.assertNotIn(b"FC7", device.ser.commands)
        device = self.device()
        with self.assertRaises(CardError):
            device._write_block(3, "00" * 16, 5)
        self.assertEqual(device.ser.commands, [])

    def test_unclaimed_card_captured_after_sixty_seconds(self):
        device = self.device()
        device.ser.take_card = False
        result = device.issue(self.record(device))
        self.assertEqual(result["reason"], "not_taken")
        self.assertTrue(result["settled"])
        self.assertGreaterEqual(device.clock(), 60)
        self.assertIn(b"CP", device.ser.commands)

    def test_return_goes_to_stock_without_pms_or_writes(self):
        device = self.device()
        self.assertTrue(device.accept_return()["success"])
        self.assertIn(b"DB", device.ser.commands)
        self.assertFalse(any(cmd[:2] == b";4" for cmd in device.ser.commands))

    def test_whole_issue_time_budget_is_bounded(self):
        device = self.device()
        device.ser.fault = "silent"
        self.assertFalse(device.issue(self.record(device))["success"])
        self.assertLessEqual(device.clock(), 30.1)
        device = self.device()
        device.ser.write_delay = 0.4
        record = {"profile": {"sectors": [{**self.profile["sectors"][0], "sector": i} for i in range(16)]},
                  "uid": "01020304",
                  "blocks": {str(i): value.hex() for i, value in device.ser.blocks.items()}}
        result = device.issue(record)
        self.assertFalse(result["success"])
        self.assertEqual(result["reason"], "timeout")
        self.assertTrue(result["settled"])
        self.assertLessEqual(device.clock(), 30.1)
        self.assertEqual(device.ser.commands.count(b"FC7"), 1)
        self.assertIn(b"CP", device.ser.commands)
