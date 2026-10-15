import unittest
from unittest.mock import patch

from bac2400 import Bac2400


def multi_frame(*tlvs):
    body = bytearray()
    for command, payload in tlvs:
        body.extend([len(payload) + 1, command, *payload])
    packet = bytearray([0x33, len(body), *body])
    checksum = 0
    for value in packet[1:]:
        checksum ^= value
    packet.append(checksum)
    return bytes(packet)


def legacy_packet(a, b, c):
    return bytes([0x24, a, b, c, (a + b + c) & 255])


class Bac2400Test(unittest.TestCase):
    def setUp(self):
        self.board = Bac2400("COM5")
        self.sent = []
        self.board.send = lambda packet: self.sent.append(packet) or True

    def enable(self):
        self.assertEqual(self.board.handle_acceptor_command(legacy_packet(0x53, 0x41, 0x0D)), [])
        messages = self.board.process_incoming(multi_frame((0x18, [0] * 4), (0x1B, [1, 0, 0x13])))
        self.assertTrue(any(m.get("packet", [0, 0])[1] == 0x4F for m in messages))

    def test_serial_settings(self):
        self.assertEqual((self.board.baudrate, self.board.parity), (9600, "E"))

    def test_real_dispenser_status_packet(self):
        packet = bytes.fromhex("33 0F 05 15 00 00 00 00 05 16 00 00 03 00 02 17 00 1A")
        self.board.pending_dispenser_status = True
        messages = self.board.process_incoming(packet[:7])
        messages.extend(self.board.process_incoming(packet[7:]))

        self.assertEqual(self.board.dispenser_statuses, [0, 0, 3, 0])
        status = next(message["data"] for message in messages if message.get("type") == "dispenser_data")
        self.assertEqual(status[1:4], [0x73, 0x74, 0x65])

    def test_bill_translation_and_bv1_control(self):
        self.enable()
        self.assertEqual(self.sent[:2], [bytes.fromhex("5B A4 03 10 03 00 10"), bytes.fromhex("59 A6")])

        self.board.pending_acceptor_status = True
        messages = self.board.process_incoming(
            multi_frame((0x18, [0, 0, 1, 0]), (0x1B, [0x09, 0, 0x13]))
        )
        self.assertTrue(any(message.get("event") == 0x0B for message in messages))
        status = next(message["packet"] for message in messages if message.get("type") == "acceptor_raw")
        self.assertEqual(status[1:4], [0x67, 0x61, 0x0B])
        bill = self.board.handle_acceptor_command(legacy_packet(0x47, 0x42, 0x3F))[0]["packet"]
        self.assertEqual(bill[1:4], [0x67, 0x62, 0x0A])

    def test_bv1_accepts_10000_and_50000_won(self):
        self.enable()
        messages = self.board.process_incoming(
            multi_frame((0x18, [0, 0, 1, 1]), (0x1B, [0x09, 0, 0x13]))
        )

        self.assertTrue(any(message.get("event") == 0x0B for message in messages))
        self.assertEqual(list(self.board.bill_codes), [0x0A, 0x32])

    def test_bv1_counts_10000_with_standby_and_firmware_specific_flags(self):
        for flags in (0x09, 0x11, 0x81, 0x89):
            with self.subTest(flags=flags):
                self.setUp()
                self.enable()
                self.board.pending_acceptor_status = True
                messages = self.board.process_incoming(
                    multi_frame((0x18, [0, 0, 1, 0]), (0x1B, [flags, 0, 0x15]))
                )
                self.assertTrue(self.board.acceptor_enabled)
                self.assertEqual(self.board.acceptor_status, 0x0B)
                self.assertEqual(list(self.board.bill_codes), [0x0A])
                self.assertIn(self.board._legacy_message("acceptor", 0x67, 0x61, 0x0B), messages)
                self.board.process_incoming(multi_frame((0x18, [0, 0, 1, 0])))
                self.assertEqual(list(self.board.bill_codes), [0x0A])

    def test_bv1_counts_without_validator_in_single_tlv_response(self):
        self.board.process_incoming(bytes.fromhex("22 05 18 00 00 00 00 1D"))
        messages = self.board.process_incoming(bytes.fromhex("22 05 18 00 00 01 00 1C"))
        self.assertIn({"type": "acceptor_event", "event": 0x0B}, messages)
        self.assertEqual(self.board.acceptor_status, 0x0B)
        self.assertEqual(list(self.board.bill_codes), [0x0A])

    def test_bv1_ignores_counters_without_exactly_four_bytes(self):
        self.enable()
        for counts in ([], [0, 0, 1], [0, 0, 1, 0, 0]):
            with self.subTest(counts=counts):
                self.board.process_incoming(multi_frame((0x18, counts), (0x1B, [9, 0, 0x15])))
                self.assertEqual(self.board.last_bill_counts, [0] * 4)
                self.assertEqual(list(self.board.bill_codes), [])

    def test_bv1_only_enable_and_error_bits_affect_idle_status(self):
        for flags in (0x00, 0x02, 0x08, 0x10, 0x20, 0x40, 0x80, 0xBB, 0xFB):
            with self.subTest(flags=flags):
                self.board.process_incoming(multi_frame((0x1B, [flags, 0, 0x15])))
                self.assertEqual(self.board.acceptor_enabled, bool(flags & 0x01))
                self.assertEqual(self.board.acceptor_status, 0x01)

    def test_enable_clear_is_confirmed_with_standby_and_high_flags(self):
        for flags in (0x09, 0x11, 0x81, 0x89):
            with self.subTest(flags=flags):
                self.setUp()
                self.board.last_bill_counts = [1, 1, 1, 1]
                self.board.unsupported_bill_detected = True
                self.board.handle_acceptor_command(legacy_packet(0x53, 0x41, 0x0D))
                messages = self.board.process_incoming(multi_frame((0x18, [0] * 4), (0x1B, [flags, 0, 0x15])))
                self.assertIn(self.board._legacy_message("acceptor", 0x4F, 0x4B, 0), messages)
                self.assertIsNone(self.board.pending_acceptor_control)
                self.assertEqual(self.board.last_bill_counts, [0] * 4)
                self.assertFalse(self.board.unsupported_bill_detected)
                self.assertEqual(self.board.acceptor_status, 0x01)
                self.assertEqual(list(self.board.bill_codes), [])

    def test_enable_clear_waits_for_zero_counts_and_matching_enable_bit(self):
        self.board.last_bill_counts = [0, 0, 1, 0]
        self.board.handle_acceptor_command(legacy_packet(0x53, 0x41, 0x0D))
        for tlvs in (
            ((0x1B, [0x09, 0, 0x15]),),
            ((0x18, [0, 0, 1, 0]), (0x1B, [0x09, 0, 0x15])),
            ((0x18, [0] * 4), (0x1B, [0x88, 0, 0x15])),
        ):
            messages = self.board.process_incoming(multi_frame(*tlvs))
            self.assertNotIn(self.board._legacy_message("acceptor", 0x4F, 0x4B, 0), messages)
            self.assertIsNotNone(self.board.pending_acceptor_control)
        messages = self.board.process_incoming(multi_frame((0x18, [0] * 4), (0x1B, [0x89, 0, 0x15])))
        self.assertIn(self.board._legacy_message("acceptor", 0x4F, 0x4B, 0), messages)

    def test_bv1_error_rejects_control_but_reports_received_50000_before_the_error(self):
        self.enable()
        self.board.handle_acceptor_command(legacy_packet(0x53, 0x43, 0x1C))
        self.board.pending_acceptor_status = True
        messages = self.board.process_incoming(multi_frame((0x18, [0, 0, 0, 1]), (0x1B, [0x84, 0, 0x15])))
        self.assertEqual(self.board.acceptor_status, 0x0B)
        self.assertEqual(list(self.board.bill_codes), [0x32])
        self.assertIn(self.board._legacy_message("acceptor", 0x67, 0x61, 0x0B), messages)
        self.assertIn(self.board._legacy_message("acceptor", 0x4E, 0x47, 0), messages)
        self.assertNotIn(self.board._legacy_message("acceptor", 0x4F, 0x4B, 0), messages)
        self.assertIsNone(self.board.pending_acceptor_control)
        bill = self.board.handle_acceptor_command(legacy_packet(0x47, 0x42, 0x3F))[0]["packet"]
        self.assertEqual(bill[1:4], [0x67, 0x62, 0x32])
        self.board.process_incoming(multi_frame((0x18, [0, 0, 0, 1]), (0x1B, [0x84, 0, 0x15])))
        self.assertEqual(self.board.acceptor_status, 0x0C)
    def test_bv1_error_rejects_enable_even_with_confirmed_clear(self):
        self.board.handle_acceptor_command(legacy_packet(0x53, 0x41, 0x0D))
        messages = self.board.process_incoming(multi_frame((0x18, [0] * 4), (0x1B, [0x0D, 0, 0x15])))
        self.assertEqual(self.board.acceptor_status, 0x0C)
        self.assertIn(self.board._legacy_message("acceptor", 0x4E, 0x47, 0), messages)
        self.assertNotIn(self.board._legacy_message("acceptor", 0x4F, 0x4B, 0), messages)
        self.assertIsNone(self.board.pending_acceptor_control)

    def test_bv1_malformed_validator_rejects_control_without_discarding_valid_counts(self):
        for validator in ([], [1], [1, 0], [1, 0, 0x15, 0]):
            with self.subTest(validator=validator):
                self.setUp()
                self.enable()
                self.board.handle_acceptor_command(legacy_packet(0x53, 0x43, 0x1C))
                messages = self.board.process_incoming(multi_frame((0x18, [0, 0, 1, 0]), (0x1B, validator)))
                self.assertEqual(list(self.board.bill_codes), [0x0A])
                self.assertEqual(self.board.acceptor_status, 0x0C)
                self.assertIn(self.board._legacy_message("acceptor", 0x4E, 0x47, 0), messages)

    def test_bv1_stops_on_unsupported_or_decreased_counters_without_validator(self):
        for previous, current in (
            ([0] * 4, [1, 0, 0, 0]),
            ([0] * 4, [0, 1, 0, 0]),
            ([0, 0, 1, 0], [0] * 4),
        ):
            with self.subTest(previous=previous, current=current):
                self.setUp()
                self.enable()
                self.board.last_bill_counts = previous
                messages = self.board.process_incoming(multi_frame((0x18, current)))
                self.assertIn({"type": "acceptor_event", "event": 0x0C}, messages)
                self.assertFalse(self.board.acceptor_enabled)
                self.assertEqual(self.board.acceptor_status, 0x0C)
                self.assertTrue(self.board.unsupported_bill_detected)
                self.assertEqual(list(self.board.bill_codes), [])
                self.assertEqual(self.sent[-1], bytes.fromhex("5B A4 03 10 00 00 13"))

    def test_bv1_rejects_1000_and_5000_won_in_software(self):
        self.enable()
        messages = self.board.process_incoming(
            multi_frame((0x18, [1, 1, 0, 0]), (0x1B, [0x09, 0, 0x13]))
        )

        self.assertTrue(any(message.get("event") == 0x0C for message in messages))
        self.assertFalse(self.board.acceptor_enabled)
        self.assertEqual(self.board.acceptor_status, 0x0C)
        self.assertEqual(list(self.board.bill_codes), [])
        self.assertEqual(self.sent[-1], bytes.fromhex("5B A4 03 10 00 00 13"))

    def test_bd1_payout_command_and_completion(self):
        self.assertTrue(self.board.dispense(2))
        self.assertEqual(self.sent[-1], bytes.fromhex("71 8E"))

        self.assertEqual(
            self.board.process_incoming(
                multi_frame((0x15, [0, 0, 0, 0]), (0x16, [0, 0, 0, 0]), (0x17, [0]))
            ),
            [],
        )
        self.assertEqual(self.sent[-1], bytes.fromhex("73 8C 05 00 00 00 02 00 07"))

        messages = self.board.process_incoming(
            multi_frame((0x15, [0, 0, 2, 0]), (0x16, [0, 0, 0, 0]), (0x17, [0]))
        )
        payout = next(message["data"] for message in messages if message.get("type") == "dispenser_data")
        self.assertEqual(payout[1:4], [0x64, 2, 0x53])

    def test_v15_five_byte_bd1_payout_completes_one_bill(self):
        self.assertTrue(self.board.dispense(1))
        statuses = [1, 2, 0, 4, 0x20]
        self.assertEqual(self.board.process_incoming(
            multi_frame((0x15, [7, 8, 0, 9, 10]), (0x16, statuses), (0x17, [0]))
        ), [])
        self.assertEqual(self.sent[-1], bytes.fromhex("73 8C 05 00 00 00 01 00 04"))
        self.assertEqual(self.board.pending_payout["phase"], "dispensing")
        self.assertEqual(self.board.process_incoming(
            multi_frame((0x15, [7, 8, 0, 9, 10]), (0x16, statuses), (0x17, [1]))
        ), [])
        self.assertTrue(self.board.dispenser_running)
        messages = self.board.process_incoming(
            multi_frame((0x15, [7, 8, 1, 9, 10]), (0x16, statuses), (0x17, [0]))
        )
        self.assertEqual(messages, [self.board._legacy_message("dispenser", 0x64, 1, 0x53)])
        self.assertIsNone(self.board.pending_payout)
        self.assertFalse(self.board.payout_uncertain)

    def test_bd1_error_bits_and_error_code_nibbles_block_payout_and_report_error(self):
        for length in (4, 5):
            for status in (0x01, 0x02, 0x04, 0x10, 0x20, 0x40, 0x80):
                with self.subTest(length=length, status=status):
                    self.setUp()
                    self.board.dispense(1)
                    self.board.pending_dispenser_status = True
                    statuses = [0] * length
                    statuses[2] = status
                    messages = self.board.process_incoming(
                        multi_frame((0x15, [0] * length), (0x16, statuses), (0x17, [0]))
                    )
                    self.assertEqual(self.board.dispenser_statuses[2], status)
                    self.assertEqual(messages, [self.board._legacy_message("dispenser", 0x73, 0x74, 0x65)])
                    self.assertIsNone(self.board.pending_payout)
                    self.assertFalse(self.board.payout_uncertain)
                    self.assertEqual(self.sent, [bytes.fromhex("71 8E")])

    def test_bd1_error_code_during_payout_keeps_uncertainty_and_blocks_retry(self):
        self.board.dispense(1)
        self.board.process_incoming(multi_frame((0x15, [0] * 5), (0x16, [0] * 5), (0x17, [0])))
        messages = self.board.process_incoming(
            multi_frame((0x15, [0, 0, 1, 0, 0]), (0x16, [0, 0, 0x20, 0, 0]), (0x17, [0]))
        )
        self.assertEqual(messages, [])
        self.assertIsNone(self.board.pending_payout)
        self.assertTrue(self.board.payout_uncertain)
        self.assertFalse(self.board.dispense(1))
        self.assertEqual(len(self.sent), 2)

    def test_bd1_ignores_payout_and_status_lengths_other_than_four_or_five(self):
        for command in (0x15, 0x16):
            for length in (0, 3, 6):
                with self.subTest(command=command, length=length):
                    self.setUp()
                    self.board.dispense(1)
                    tlvs = {0x15: [0] * 4, 0x16: [0] * 4, 0x17: [0]}
                    tlvs[command] = [0] * length
                    self.assertEqual(self.board.process_incoming(multi_frame(*tlvs.items())), [])
                    self.assertEqual(self.board.pending_payout["phase"], "checking")
                    self.assertEqual(self.sent, [bytes.fromhex("71 8E")])

    def test_control_needs_a_fresh_matching_response_not_a_serial_write(self):
        self.assertEqual(self.board.handle_acceptor_command(legacy_packet(0x53, 0x43, 0x1C)), [])
        self.assertEqual(self.sent, [bytes.fromhex("5B A4 03 10 00 00 13"), bytes.fromhex("59 A6")])
        self.assertFalse(self.board.process_incoming(multi_frame((0x1B, [1, 0, 0x12])))[-1].get("success", False))
        messages = self.board.process_incoming(multi_frame((0x1B, [0, 0, 0x12])))
        self.assertTrue(any(m.get("packet", [0, 0])[1] == 0x4F for m in messages))

    def test_high_validator_flags_allow_connection_without_guessing_a_firmware_version(self):
        self.board.pending_acceptor_connection = True
        messages = self.board.process_incoming(multi_frame((0x1B, [0x11, 0, 0x12]), (0x18, [0] * 4)))
        info = next(m for m in messages if m["type"] == "cash_board_info")
        self.assertEqual(info["responseFields"], {"0x1B": "110012"})
        self.assertIsNone(info["version"])
        self.assertFalse(info["versionVerified"])
        self.assertIn(self.board._legacy_message("acceptor", 0x6D, 0x65, 0), messages)
        self.assertEqual(self.board.acceptor_status, 0x01)

    def test_unattended_recovery_is_status_stop_or_reset_status_with_no_money_commands(self):
        for target in ("acceptor", "dispenser"):
            with self.subTest(target=target):
                board, sent = Bac2400("NO-REAL-COM"), []
                board.send = lambda p: sent.append(p) or True
                self.assertEqual(board.recover(target, "qa-request"), [])
                if target == "acceptor":
                    before = multi_frame((0x18, [0] * 4), (0x1B, [1, 0, 0x12]))
                    after = multi_frame((0x18, [0] * 4), (0x1B, [0, 0, 0x12]))
                    expected = [bytes.fromhex(h) for h in ("59 A6", "5B A4 03 10 00 00 13", "59 A6")]
                else:
                    before = after = multi_frame((0x15, [0] * 4), (0x16, [0] * 4), (0x17, [0]))
                    expected = [bytes.fromhex(h) for h in ("71 8E", "73 8C 05 01 00 00 01 00 05", "71 8E")]
                board.process_incoming(before)
                result = board.process_incoming(after)
                self.assertEqual(sent, expected)
                self.assertEqual(next(m for m in result if m["type"] == "cash_board_result"),
                                 {"type": "cash_board_result", "requestId": "qa-request", "target": target,
                                  "success": True, "verified": True})
                self.assertIsNone(board.pending_payout)

    def test_acceptor_recovery_ignores_firmware_flags_and_verifies_only_disable_bit(self):
        for flags in (0x02, 0x08, 0x10, 0x20, 0x40, 0x80, 0xBA):
            with self.subTest(flags=flags):
                self.setUp()
                self.board.recover("acceptor", "qa-flags")
                self.board.process_incoming(multi_frame((0x18, [0] * 4), (0x1B, [flags | 1, 0, 0x15])))
                self.assertEqual(self.board.pending_recovery["phase"], "verifying")
                result = self.board.process_incoming(multi_frame((0x18, [0] * 4), (0x1B, [flags, 0, 0x15])))
                self.assertTrue(next(m for m in result if m["type"] == "cash_board_result")["verified"])
                self.assertEqual(self.sent, [bytes.fromhex(h) for h in ("59 A6", "5B A4 03 10 00 00 13", "59 A6")])

    def test_acceptor_recovery_rejects_still_enabled_or_bv1_error_during_verification(self):
        for flags in (0x09, 0x0C):
            with self.subTest(flags=flags):
                self.setUp()
                self.board.recover("acceptor", "qa-not-stopped")
                self.board.process_incoming(multi_frame((0x18, [0] * 4), (0x1B, [0x89, 0, 0x15])))
                result = self.board.process_incoming(multi_frame((0x18, [0] * 4), (0x1B, [flags, 0, 0x15])))
                self.assertFalse(next(m for m in result if m["type"] == "cash_board_result")["verified"])
                self.assertIsNone(self.board.pending_recovery)

    def test_recovery_refuses_bv1_error_malformed_partial_and_dispenser_busy_responses(self):
        for target, response in [
            ("acceptor", multi_frame((0x18, [0] * 4), (0x1B, [0x04, 0, 0x12]))),
            ("acceptor", multi_frame((0x18, [0] * 4), (0x1B, [0x11, 0]))),
            ("acceptor", multi_frame((0x1B, [0x09, 0, 0x12]))),
            ("dispenser", multi_frame((0x16, [0] * 4))),
            ("dispenser", multi_frame((0x15, [0] * 4), (0x16, [0, 0, 8, 0]), (0x17, [0]))),
            ("dispenser", multi_frame((0x15, [0] * 4), (0x16, [0] * 4), (0x17, [1]))),
        ]:
            with self.subTest(target=target, response=response.hex()):
                board, sent = Bac2400("NO-REAL-COM"), []
                board.send = lambda p: sent.append(p) or True
                board.recover(target, "qa-fault")
                result = board.process_incoming(response)
                self.assertEqual(len(sent), 1, "No mutation when the preflight is unknown or busy")
                self.assertFalse(next(m for m in result if m["type"] == "cash_board_result")["success"])
        self.board.payout_uncertain = True
        self.assertFalse(self.board.recover("dispenser", "uncertain")[0]["success"])
        self.assertEqual(self.sent, [])

    def test_acceptor_recovery_refuses_unread_money_and_unsupported_denominations(self):
        for counts in ([0, 0, 1, 0], [1, 0, 0, 0]):
            with self.subTest(counts=counts):
                self.setUp()
                self.enable()
                self.board.process_incoming(multi_frame((0x18, counts), (0x1B, [0x89, 0, 0x15])))
                self.board.recover("acceptor", "qa-cash")
                sent_count = len(self.sent)
                messages = self.board.process_incoming(multi_frame((0x18, counts), (0x1B, [0x89, 0, 0x15])))
                self.assertFalse(next(m for m in messages if m["type"] == "cash_board_result")["success"])
                self.assertEqual(len(self.sent), sent_count)

    def test_timeout_expires_recovery_and_no_late_reply_can_reset_or_pay(self):
        with patch("bac2400.time.monotonic", return_value=1):
            self.board.recover("dispenser", "expired")
        with patch("bac2400.time.monotonic", return_value=8):
            result = self.board.process_incoming(multi_frame((0x15, [0] * 4), (0x16, [0] * 4), (0x17, [0])))
        self.assertFalse(result[0]["success"])
        self.assertEqual(self.sent, [bytes.fromhex("71 8E")])

    def test_delayed_preflight_never_issues_money_after_the_renderer_waiter_expires(self):
        with patch("bac2400.time.monotonic", return_value=1):
            self.board.dispense(1)
        with patch("bac2400.time.monotonic", return_value=11):
            self.board.process_incoming(multi_frame((0x15, [0] * 4), (0x16, [0] * 4), (0x17, [0])))
        self.assertEqual(self.sent, [bytes.fromhex("71 8E")])
        self.assertIsNone(self.board.pending_payout)
        self.assertFalse(self.board.payout_uncertain)

    def test_payout_cumulative_partial_or_malformed_reply_stays_pending_until_timeout(self):
        self.board.dispense(2)
        ready = multi_frame((0x15, [0, 0, 1, 0]), (0x16, [0] * 4), (0x17, [0]))
        self.board.process_incoming(ready)
        for response in [
            multi_frame((0x15, [0, 0, 2, 0]), (0x17, [0])),
            multi_frame((0x15, [0, 0, 2, 0]), (0x16, [0] * 4), (0x17, [0])),
            multi_frame((0x15, [0, 0, 2, 0, 0]), (0x16, [0] * 4), (0x17, [0])),
            multi_frame((0x15, [0, 0, 2, 0]), (0x16, [0] * 4), (0x17, [0x80])),
            multi_frame((0x15, [0] * 4), (0x15, [0, 0, 2, 0])),
        ]:
            self.assertFalse(any(m["type"] == "dispenser_data" for m in self.board.process_incoming(response)))
        self.assertIsNotNone(self.board.pending_payout)
        with patch("bac2400.time.monotonic", return_value=self.board.pending_payout["started"] + 13):
            self.assertFalse(self.board.payout_in_progress)
        self.assertTrue(self.board.payout_uncertain)
        self.assertFalse(self.board.dispense(2))

    def test_fe_frame_fragmentation_cannot_hide_tlvs_and_trigger_a_payout(self):
        self.board.dispense(1)
        embedded = multi_frame((0x15, [0] * 4), (0x16, [0] * 4), (0x17, [0]))
        fe = bytes([0xFE, len(embedded) + 1]) + embedded
        self.assertEqual(self.board.process_incoming(fe[:1]), [])
        result = self.board.process_incoming(fe[1:])
        self.assertEqual(result[0]["protocol"], "unsupported-fe")
        self.assertEqual(self.sent, [bytes.fromhex("71 8E")])

    def test_reset_cannot_clear_unread_cash_and_unknown_return_is_not_ok(self):
        self.enable()
        self.board.process_incoming(multi_frame((0x18, [0, 0, 1, 0]), (0x1B, [9, 0, 0x12])))
        count = len(self.sent)
        for packet in [legacy_packet(0x52, 0x53, 0x54), legacy_packet(0x53, 0x41, 0x06)]:
            result = self.board.handle_acceptor_command(packet)
            self.assertEqual(result[0]["packet"][1:3], [0x4E, 0x47])
        self.assertEqual(len(self.sent), count)
        self.assertEqual(list(self.board.bill_codes), [0x0A])

    def test_uncertain_payout_cannot_advertise_ready_or_reopen_acceptance(self):
        self.board.payout_uncertain = True
        self.board.handle_dispenser_command(legacy_packet(0x53, 0x74, 0x3F))
        result = self.board.process_incoming(multi_frame((0x15, [0] * 4), (0x16, [0] * 4), (0x17, [0])))
        self.assertEqual(result[0]["data"][1:4], [0x73, 0x74, 0x65])
        before = len(self.sent)
        result = self.board.handle_acceptor_command(legacy_packet(0x53, 0x41, 0x0D))
        self.assertEqual(result[0]["packet"][1:3], [0x4E, 0x47])
        self.assertEqual(len(self.sent), before)

    def test_legacy_init_failure_never_matches_an_ok_and_success_preserves_command_case(self):
        for command, reply in [(0x49, 0x69), (0x69, 0x49)]:
            board = Bac2400("NO-COM")
            board.send = lambda _: True
            board.payout_uncertain = True
            result = board.handle_dispenser_command(legacy_packet(command, 0, 0))
            self.assertEqual(result[0]["data"][1:4], [0x73, 0x74, 0x65])
            board.payout_uncertain = False
            self.assertEqual(board.handle_dispenser_command(legacy_packet(command, 0, 0)), [])
            ready = multi_frame((0x15, [0] * 4), (0x16, [0] * 4), (0x17, [0]))
            board.process_incoming(ready)
            result = board.process_incoming(ready)
            self.assertEqual(result[0]["data"][1:4], [reply, 0, 0])


if __name__ == "__main__":
    unittest.main()
