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

    def test_control_needs_a_fresh_matching_response_not_a_serial_write(self):
        self.assertEqual(self.board.handle_acceptor_command(legacy_packet(0x53, 0x43, 0x1C)), [])
        self.assertEqual(self.sent, [bytes.fromhex("5B A4 03 10 00 00 13"), bytes.fromhex("59 A6")])
        self.assertFalse(self.board.process_incoming(multi_frame((0x1B, [1, 0, 0x12])))[-1].get("success", False))
        messages = self.board.process_incoming(multi_frame((0x1B, [0, 0, 0x12])))
        self.assertTrue(any(m.get("packet", [0, 0])[1] == 0x4F for m in messages))

    def test_version_like_response_bytes_are_logged_without_guessing_a_firmware(self):
        self.board.pending_acceptor_connection = True
        messages = self.board.process_incoming(multi_frame((0x1B, [0x11, 0, 0x12]), (0x18, [0] * 4)))
        info = next(m for m in messages if m["type"] == "cash_board_info")
        self.assertEqual(info["responseFields"], {"0x1B": "110012"})
        self.assertIsNone(info["version"])
        self.assertFalse(info["versionVerified"])
        self.assertFalse(any(m["type"] == "acceptor_raw" for m in messages))
        self.assertEqual(self.board.acceptor_status, 0x0C)

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
                board.advance_recovery()
                result = board.process_incoming(after)
                self.assertEqual(sent, expected)
                self.assertEqual(next(m for m in result if m["type"] == "cash_board_result"),
                                 {"type": "cash_board_result", "requestId": "qa-request", "target": target,
                                  "success": True, "verified": True, "source": "board_status", "reason": None})
                self.assertIsNone(board.pending_payout)

    def test_recovery_yields_after_only_the_outstanding_query_and_never_resets_or_moves_money(self):
        for target, reply in [
            ("acceptor", multi_frame((0x18, [0]*4), (0x1B, [0, 0, 0x12]))),
            ("dispenser", multi_frame((0x15, [0]*4), (0x16, [0]*4), (0x17, [0]))),
        ]:
            board, sent = Bac2400("NO-REAL-COM"), []
            board.send = lambda p: sent.append(p) or True
            board.recover(target, "payment-start")
            self.assertEqual(board.yield_recovery("other-request"), [])
            self.assertNotIn("yield", board.pending_recovery)
            board.yield_recovery("payment-start")
            self.assertIsNotNone(board.pending_recovery, "Do not release before the outstanding response")
            result = next(m for m in board.process_incoming(reply) if m["type"] == "cash_board_result")
            self.assertEqual((result["success"], result["source"], result["reason"]), (False, "adapter", "recovery_yielded"))
            self.assertEqual(len(sent), 1)
            self.assertIsNone(board.pending_recovery)
            self.assertIsNone(board.pending_payout)

    def test_recovery_reasons_distinguish_adapter_rejections_from_board_status(self):
        self.board.payout_uncertain = True
        blocked = self.board.recover("dispenser", "uncertain")[0]
        self.assertEqual((blocked["source"], blocked["reason"]), ("adapter", "payout_uncertain"))
        self.assertTrue(self.board.payout_uncertain, "Uncertain payouts must never be auto-cleared")
        board = Bac2400("NO-REAL-COM")
        board.send = lambda p: True
        board.recover("dispenser", "hardware-error")
        reply = multi_frame((0x15, [0]*4), (0x16, [0, 0, 3, 0]), (0x17, [0]))
        failed = next(m for m in board.process_incoming(reply) if m["type"] == "cash_board_result")
        self.assertEqual((failed["source"], failed["reason"]), ("board_status", "dispenser_board_error"))
        self.board.payout_uncertain = False
        self.board.bill_codes.append(0x0A)
        failed = self.board.handle_acceptor_command(legacy_packet(0x52, 0x53, 0x54))[0]
        self.assertEqual((failed["source"], failed["reason"]), ("adapter", "queued_bills"))
        self.assertEqual(list(self.board.bill_codes), [0x0A])

    def test_yield_between_reset_and_verification_stops_before_the_next_serial_command(self):
        self.board.recover("dispenser", "yield-after-reset")
        ready = multi_frame((0x15, [0]*4), (0x16, [0]*4), (0x17, [0]))
        self.board.process_incoming(ready)
        self.assertEqual(len(self.sent), 2, "Only the query and single reset have been sent")
        self.board.yield_recovery("yield-after-reset")
        self.assertEqual(self.board.advance_recovery(), [])
        self.assertEqual(len(self.sent), 2, "Verification query yields to payment")
        result = next(m for m in self.board.process_incoming(ready) if m["type"] == "cash_board_result")
        self.assertEqual(result["reason"], "recovery_yielded")

    def test_recovery_refuses_processing_unknown_partial_and_money_evidence(self):
        for target, response in [
            ("acceptor", multi_frame((0x18, [0] * 4), (0x1B, [8, 0, 0x12]))),
            ("acceptor", multi_frame((0x18, [0] * 4), (0x1B, [0x11, 0, 0x12]))),
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

    def test_payout_cumulative_partial_unknown_or_malformed_reply_is_not_success(self):
        self.board.dispense(2)
        ready = multi_frame((0x15, [0, 0, 1, 0]), (0x16, [0] * 4), (0x17, [0]))
        self.board.process_incoming(ready)
        for response in [
            multi_frame((0x15, [0, 0, 2, 0]), (0x17, [0])),
            multi_frame((0x15, [0, 0, 2, 0]), (0x16, [0] * 4), (0x17, [0])),
            multi_frame((0x15, [0, 0, 2, 0, 0]), (0x16, [0] * 4), (0x17, [0])),
            multi_frame((0x15, [0, 0, 2, 0]), (0x16, [0, 0, 0x80, 0]), (0x17, [0])),
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
