import unittest
from collections import deque
from unittest.mock import patch

from multi3400 import Multi3400
from test_bac2400 import legacy_packet


CAPTURE = bytes.fromhex("fe 12 13 47 11 00 00 00 00 00 01 00 00 00 00 00 00 12 ba")
QUERY = bytes.fromhex("fe 0d 11 00 00 00 00 00 00 00 00 00 00 e2")
COIN_ON = bytes.fromhex("fe 0d 10 07 00 00 00 00 00 00 00 00 00 e4")


def status_frame(status1=0, status2=0, bills=(0,) * 6, bd1=0, version=0x12):
    packet = bytearray([0xFE, 18, 0x13, status1, status2, *bills, 0, 0, bd1, 0, 0, 0, version])
    checksum = 0
    for byte in packet:
        checksum ^= byte
    return bytes(packet + bytes([checksum]))


class FakeMulti3400:
    """Serial transport only; tests supply independent captured/generated RX evidence."""
    is_open = True

    def __init__(self):
        self.sent = []

    def write(self, packet):
        self.sent.append(bytes(packet))
        return len(packet)


class Multi3400Test(unittest.TestCase):
    def setUp(self):
        self.board = Multi3400("COM5")
        self.serial = FakeMulti3400()
        self.board.ser = self.serial
        self.sent = self.serial.sent

    def reply(self, packet=None):
        if packet is None:
            packet = status_frame()
        return self.board.process_incoming(packet)

    def acknowledge_and_query(self):
        self.assertEqual(self.reply(b"\x11"), [])
        self.board.advance_recovery()
        self.assertEqual(self.sent[-1], QUERY)

    def enable(self, amount=60000):
        self.assertTrue(self.board.set_payment_amount(amount))
        self.board.handle_acceptor_command(legacy_packet(0x53, 0x41, 0x0D))
        self.reply()
        self.assertEqual(self.sent[-1][3], 8)
        self.acknowledge_and_query()
        self.reply()
        self.assertEqual(self.sent[-1][3], 3)
        self.acknowledge_and_query()
        result = self.reply(status_frame(3))
        self.assertTrue(any(m.get("packet", [0, 0])[1] == 0x4F for m in result))

    def test_exact_demo_frame_length_and_serial_settings(self):
        self.assertEqual((self.board.baudrate, self.board.parity), (9600, "N"))
        self.assertEqual(self.board.frame(0x11), QUERY)
        self.assertEqual(self.board.frame(0x10, [7]), COIN_ON)
        self.assertEqual(len(QUERY), 14)
        self.assertEqual(len(CAPTURE), 19)
        self.assertEqual(self.board.bd1_value, 10000)
        for invalid in (True, 0, 2000, "10000"):
            with self.assertRaises(ValueError):
                Multi3400("COM5", invalid)

    def test_captured_status_parses_connection_flags_cash_and_version(self):
        self.board.handle_acceptor_command(legacy_packet(0x48, 0x69, 0x3F))
        self.assertEqual(self.reply(CAPTURE[:8]), [])
        result = self.reply(CAPTURE[8:])
        self.assertEqual((self.board.status1, self.board.status2), (0x47, 0x11))
        self.assertTrue(self.board.status1 & 1 and self.board.status1 & 2 and self.board.status1 & 4)
        self.assertTrue(self.board.status1 & 0x40 and self.board.status2 & 1 and self.board.status2 & 0x10)
        self.assertEqual(self.board.last_bill_counts, [0, 0, 0, 0, 0, 1])
        self.assertEqual(self.board.dispenser_statuses[2], 3)
        self.assertEqual(self.board.version, "0x12")
        self.assertEqual(self.board.bill_codes, deque())
        self.assertTrue(result[0]["versionVerified"])
        self.assertTrue(any(m.get("packet", [0, 0])[1] == 0x6D for m in result))

    def test_clear_enable_limit_and_stop_require_ack_and_new_off_status(self):
        self.enable()
        controls = [p for p in self.sent if p[2] == 0x10]
        self.assertEqual([p[3] for p in controls], [8, 3])
        self.assertTrue(all(p[7] == 60 for p in controls))
        self.board.handle_acceptor_command(legacy_packet(0x53, 0x43, 0x1C))
        self.reply(status_frame(3))
        self.assertEqual(self.sent[-1][3], 0)
        self.assertIsNotNone(self.board.pending_acceptor_control)
        self.acknowledge_and_query()
        result = self.reply(status_frame(1))  # BV2 OFF alone is not stopped.
        self.assertFalse(any(m.get("packet", [0, 0])[1] == 0x4F for m in result))
        self.board.advance_recovery()
        result = self.reply()
        self.assertTrue(any(m.get("packet", [0, 0])[1] == 0x4F for m in result))
        self.assertFalse(self.board.acceptor_enabled)

    def test_all_stacked_notes_are_credited_once_and_reenable_never_clears(self):
        self.enable()
        counts = (0, 0, 1, 1, 1, 1)
        self.board.query_acceptor()
        result = self.reply(status_frame(3, bills=counts))
        self.assertTrue(any(m.get("event") == 0x0B for m in result))
        codes = [self.board.handle_acceptor_command(legacy_packet(0x47, 0x42, 0x3F))[0]["packet"][3] for _ in range(5)]
        self.assertEqual(codes, [1, 5, 10, 50, 0])
        self.board.handle_acceptor_command(legacy_packet(0x53, 0x41, 0x0D))
        self.reply(status_frame(3, bills=counts))
        self.assertEqual(self.sent[-1][3], 3)
        self.acknowledge_and_query()
        self.reply(status_frame(3, bills=counts))
        self.assertFalse(self.board.bill_codes)
        self.assertEqual(sum(p[2] == 0x10 and bool(p[3] & 8) for p in self.sent), 1)

    def test_enable_verification_also_preserves_notes_received_immediately(self):
        self.board.handle_acceptor_command(legacy_packet(0x53, 0x41, 0x0D))
        self.reply()
        self.acknowledge_and_query()
        self.reply()
        self.acknowledge_and_query()
        result = self.reply(status_frame(3, bills=(0, 0, 0, 0, 1, 1)))
        self.assertEqual(list(self.board.bill_codes), [10, 50])
        self.assertTrue(any(m.get("packet", [0, 0])[1] == 0x4F for m in result))

    def test_stop_between_notes_preserves_the_payment_counter_on_reenable(self):
        self.enable()
        counts = (0, 0, 1, 0, 0, 0)
        self.board.query_acceptor()
        self.reply(status_frame(3, bills=counts))
        self.board.handle_acceptor_command(legacy_packet(0x53, 0x43, 0x1C))
        self.reply(status_frame(3, bills=counts))
        self.acknowledge_and_query()
        self.reply(status_frame(bills=counts))
        self.assertTrue(self.board.session_started)
        self.assertEqual(self.board.handle_acceptor_command(legacy_packet(0x47, 0x42, 0x3F))[0]["packet"][3], 1)
        self.board.handle_acceptor_command(legacy_packet(0x53, 0x41, 0x0D))
        self.reply(status_frame(bills=counts))
        self.assertEqual(self.sent[-1][3], 3)
        self.acknowledge_and_query()
        self.reply(status_frame(3, bills=counts))
        self.board.query_acceptor()
        self.reply(status_frame(3, bills=(0, 0, 1, 1, 0, 0)))
        self.assertEqual(list(self.board.bill_codes), [5])
        self.assertEqual(sum(p[2] == 0x10 and bool(p[3] & 8) for p in self.sent), 1)

    def test_error_during_enable_verification_cannot_advertise_ready(self):
        self.board.handle_acceptor_command(legacy_packet(0x53, 0x41, 0x0D))
        self.reply()
        self.acknowledge_and_query()
        self.reply()
        self.acknowledge_and_query()
        result = self.reply(status_frame(0x13))
        self.assertFalse(any(m.get("packet", [0, 0])[1] == 0x4F for m in result))
        self.assertEqual(next(m for m in result if m.get("reason"))["reason"], "acceptor_board_error")

    def test_reset_is_stop_only_and_preserves_unread_cash(self):
        self.enable()
        self.board.query_acceptor()
        self.reply(status_frame(3, bills=(0, 0, 0, 0, 1, 0)))
        self.board.handle_acceptor_command(legacy_packet(0x52, 0x53, 0x54))
        self.reply(status_frame(3, bills=(0, 0, 0, 0, 1, 0)))
        self.assertEqual(self.sent[-1][3], 0)
        self.acknowledge_and_query()
        self.reply(status_frame(bills=(0, 0, 0, 0, 1, 0)))
        self.assertEqual(list(self.board.bill_codes), [10])
        self.assertEqual(sum(p[2] == 0x10 and bool(p[3] & 8) for p in self.sent), 1)
        self.assertEqual(self.board.handle_acceptor_command(legacy_packet(0x53, 0x41, 6))[0]["reason"], "unsupported_command")

    def begin_payout(self, count=1, baseline=4):
        self.assertTrue(self.board.dispense(count))
        self.reply(status_frame(bd1=baseline))
        self.assertEqual(self.sent[-1][2:7], bytes([0x12, 0, 0, count, 0]))
        self.acknowledge_and_query()

    def test_bd1_exact_delta_and_idle_are_the_only_payout_success(self):
        self.begin_payout()
        result = self.reply(status_frame(8, bd1=5))
        self.assertFalse(any(m.get("data", [0, 0])[1] == 0x64 for m in result))
        self.board.advance_recovery()
        result = self.reply(status_frame(bd1=5))
        self.assertEqual(next(m["data"] for m in result if m["type"] == "dispenser_data")[1:4], [0x64, 1, 0x53])
        self.assertIsNone(self.board.pending_payout)
        self.assertFalse(self.board.payout_uncertain)
        self.assertEqual(sum(p[2] == 0x12 for p in self.sent), 1)

    def test_payout_short_error_empty_excess_reset_or_timeout_never_retries(self):
        for condition in ("short", "error", "empty", "excess", "reset", "timeout"):
            with self.subTest(condition=condition):
                self.setUp()
                self.begin_payout(2)
                frame = status_frame(status2=1 if condition == "error" else 0x10 if condition == "empty" else 0,
                                     bd1=5 if condition == "short" else 7 if condition == "excess" else 0 if condition == "reset" else 4)
                result = self.reply(frame)
                if self.board.pending_payout:
                    self.board.pending_payout["started"] -= 10
                    result.extend(self.board.expire_operations())
                self.assertFalse(any(m.get("data", [0, 0])[1] == 0x64 for m in result))
                self.assertTrue(self.board.payout_uncertain)
                self.assertFalse(self.board.dispense(2))
                self.assertFalse(self.board.recover("dispenser", "qa-reset")[0]["verified"])
                self.assertEqual(sum(p[2] == 0x12 for p in self.sent), 1)

    def test_payout_preflight_empty_and_timeout_have_no_payout_command(self):
        self.board.dispense(1)
        self.reply(status_frame(status2=0x10))
        self.assertTrue(self.board.payout_uncertain)
        self.assertEqual(sum(p[2] == 0x12 for p in self.sent), 0)
        self.setUp()
        self.board.dispense(1)
        self.board.pending_payout["started"] -= 10
        self.board.expire_operations()
        self.reply()
        self.assertTrue(self.board.payout_uncertain)
        self.assertEqual(sum(p[2] == 0x12 for p in self.sent), 0)

    def test_nak_checksum_length_wrong_query_and_ack_alone_never_confirm(self):
        for condition in ("nak", "checksum", "length", "wrong_query", "ack_only"):
            with self.subTest(condition=condition):
                self.setUp()
                self.board.handle_acceptor_command(legacy_packet(0x53, 0x43, 0x1C))
                self.reply(status_frame(3))
                if condition == "nak":
                    result = self.reply(b"\xEE")
                elif condition == "ack_only":
                    result = self.reply(b"\x11")
                else:
                    self.acknowledge_and_query()
                    frame = bytearray(status_frame())
                    if condition == "checksum": frame[-1] ^= 1
                    if condition == "length": frame[1] = 17
                    if condition == "wrong_query": frame[2] = 0x17; frame[-1] ^= 0x13 ^ 0x17
                    result = self.reply(frame)
                self.assertFalse(any(m.get("packet", [0, 0])[1] == 0x4F for m in result))
                if condition != "ack_only":
                    failure = next(m for m in result if m.get("reason"))
                    self.assertEqual(failure["source"], "board_ng" if condition == "nak" else "adapter")

    def test_recovery_query_stop_reset_verify_never_dispenses_and_preserves_counts(self):
        for target in ("acceptor", "dispenser"):
            with self.subTest(target=target):
                self.setUp()
                self.board.recover(target, "qa-recovery")
                self.reply(CAPTURE)
                self.assertEqual(self.sent[-1][2:5], bytes([0x10, 0, 0]))
                self.acknowledge_and_query()
                self.reply(status_frame(status2=0x11, bills=(0, 0, 0, 0, 0, 1)))
                self.assertEqual(self.sent[-1][2:5], bytes([0x10, 0, 2]))
                self.acknowledge_and_query()
                result = self.reply(status_frame(bills=(0, 0, 0, 0, 0, 1)))
                self.assertTrue(next(m for m in result if m["type"] == "cash_board_result")["verified"])
                self.assertEqual(self.board.last_bill_counts[-1], 1)
                self.assertTrue(all(p[2] != 0x12 and (p[2] != 0x10 or not p[3] & 0x1F) for p in self.sent))

    def test_recovery_failure_yield_busy_queued_cash_and_reconnect_do_not_pay(self):
        self.board.recover("dispenser", "qa")
        self.reply()
        self.acknowledge_and_query()
        result = self.reply(status_frame(status2=0x10))
        self.assertEqual(next(m for m in result if m.get("reason"))["reason"], "dispenser_empty")
        self.board.recover("acceptor", "yield")
        self.board.yield_recovery("yield")
        result = self.reply()
        self.assertEqual(next(m for m in result if m.get("reason"))["reason"], "recovery_yielded")
        self.board.recover("acceptor", "busy")
        result = self.reply(status_frame(status2=0x40))
        self.assertEqual(next(m for m in result if m.get("reason"))["reason"], "acceptor_processing")
        self.board.recover("acceptor", "cash")
        result = self.reply(status_frame(bills=(0, 0, 0, 0, 1, 0)))
        self.assertEqual(next(m for m in result if m.get("reason"))["reason"], "queued_bills")
        self.assertTrue(all(p[2] != 0x12 for p in self.sent))

    def test_status_query_is_serialized_and_polls_without_a_renderer(self):
        self.board.advance_recovery()
        self.board.query_dispenser()
        self.board.query_acceptor()
        self.assertEqual(self.sent, [QUERY])
        self.reply()
        self.board.advance_recovery()
        self.assertEqual(self.sent, [QUERY, QUERY])
        self.reply()
        with patch("multi3400.time.monotonic", return_value=self.board.last_query + 0.26):
            self.board.advance_recovery()
        self.assertEqual(self.sent, [QUERY] * 3)

    def test_partial_write_late_status_and_counter_decrease_fail_closed(self):
        self.board.dispense(1)
        self.serial.write = lambda p: self.sent.append(bytes(p)) or 2
        self.reply()
        self.assertTrue(self.board.payout_uncertain)
        self.reply(status_frame(bd1=1))
        self.assertIsNone(self.board.pending_payout)
        self.setUp()
        self.board.query_acceptor()
        self.reply(status_frame(bills=(0, 0, 0, 0, 2, 0)))
        self.board.query_acceptor()
        self.reply(status_frame(bills=(0, 0, 0, 0, 1, 1)))
        self.assertTrue(self.board.counter_uncertain)
        self.assertEqual(list(self.board.bill_codes), [50])

    def test_payout_nak_or_corrupt_frame_latches_uncertainty(self):
        for packet in (b"\xEE", status_frame(bd1=5)[:-1] + b"\x00", b"\xFE\x11"):
            with self.subTest(packet=packet):
                self.setUp()
                self.begin_payout()
                result = self.reply(packet)
                self.assertTrue(self.board.payout_uncertain)
                self.assertFalse(any(m.get("data", [0, 0])[1] == 0x64 for m in result))
                self.assertFalse(self.board.dispense(1))
                self.assertEqual(sum(p[2] == 0x12 for p in self.sent), 1)

    def test_timeout_yield_and_stale_ack_do_not_enable_or_claim_recovery(self):
        self.board.recover("dispenser", "no-response")
        self.board.pending_recovery["started"] -= 7
        result = self.board.expire_operations()
        self.assertEqual(result[0]["reason"], "recovery_timeout")
        self.assertFalse(result[0]["verified"])
        self.setUp()
        self.board.handle_acceptor_command(legacy_packet(0x53, 0x43, 0x1C))
        self.reply(status_frame(3))
        self.board.wire_pending["started"] -= 1
        result = self.board.expire_operations()
        self.assertEqual(result[0]["reason"], "response_timeout")
        self.assertEqual(self.reply(b"\x11"), [])
        self.board.advance_recovery()
        self.assertEqual(sum(p[2] == 0x10 for p in self.sent), 1)
        self.setUp()
        self.board.handle_acceptor_command(legacy_packet(0x53, 0x43, 0x1C))
        self.board.pending_acceptor_control["started"] -= 3
        result = self.board.expire_operations()
        self.assertEqual(result[0]["reason"], "control_timeout")

    def test_payment_limit_and_invalid_input_never_wrap(self):
        self.assertTrue(self.board.set_payment_amount(60001))
        self.assertEqual(self.board.max_input, 61)
        self.assertTrue(self.board.set_payment_amount(255000))
        self.assertEqual(self.board.max_input, 255)
        self.assertTrue(self.board.set_payment_amount(256000))
        self.assertEqual(self.board.max_input, 0)
        for value in (True, 0, -1, "60000", 1.5):
            self.assertFalse(self.board.set_payment_amount(value))


if __name__ == "__main__":
    unittest.main()
