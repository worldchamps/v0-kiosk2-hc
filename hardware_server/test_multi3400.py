"""Response injection only: no port, device, network or customer data."""
import logging
import unittest
from unittest.mock import Mock, patch

from multi3400 import Multi3400
from test_bac2400 import legacy_packet


def status_frame(status1=0, status2=0, inputs=None, payouts=None, version=0x12, code=0x13):
    frame = bytearray([0xFE, 18, code, status1, status2,
                       *(inputs or [0] * 6), *(payouts or [0] * 4), 0, 0, version])
    checksum = 0
    for value in frame:
        checksum ^= value
    return bytes(frame + bytes([checksum]))


class Multi3400Test(unittest.TestCase):
    def setUp(self):
        previous_logging = logging.root.manager.disable
        logging.disable(logging.NOTSET)
        self.addCleanup(logging.disable, previous_logging)
        self.now = 10.0
        self.clock = patch("multi3400.time.monotonic", side_effect=lambda: self.now)
        self.clock.start()
        self.addCleanup(self.clock.stop)
        self.serial = patch("serial_manager.serial.Serial", side_effect=AssertionError("Real COM is forbidden"))
        self.serial.start()
        self.addCleanup(self.serial.stop)
        self.board = Multi3400("QA-NO-PORT")
        self.sent = []
        self.board.send = lambda data: self.sent.append(bytes(data)) or True

    def accept(self, a, b, c):
        return self.board.handle_acceptor_command(legacy_packet(a, b, c))

    def dispense(self, a, b=0, c=0):
        return self.board.handle_dispenser_command(legacy_packet(a, b, c))

    def receive(self, **fields):
        return self.board.process_incoming(status_frame(**fields))

    def ack(self, value=0x11):
        return self.board.process_incoming(bytes([value]))

    def legacy(self, messages, device="acceptor"):
        field = "packet" if device == "acceptor" else "data"
        return [m[field][1:4] for m in messages if field in m]

    def enable(self):
        self.accept(0x53, 0x41, 0x0D)
        self.receive()
        self.ack()
        self.receive()
        self.ack()
        result = self.receive(status1=3)
        self.assertEqual(self.legacy(result), [[0x4F, 0x4B, 0]])

    def start_payout(self, count=8):
        self.dispense(0x44, count, 0x53)
        self.receive()
        self.ack()
        self.receive()
        self.assertEqual(self.sent[-1][2:7], bytes([0x12, 0, 0, count, 0]))
        result = self.ack()
        self.assertEqual(self.legacy(result, "dispenser"), [[0x64, count, 0x61]])

    def progress(self, count, status1=0, status2=0):
        self.now += 0.25
        self.board.poll()
        self.assertEqual(self.sent[-1][2], 0x11)
        return self.receive(status1=status1, status2=status2, payouts=[0, 0, count, 0])

    def assert_single_payout(self):
        self.assertEqual(sum(frame[2] == 0x12 for frame in self.sent), 1)

    def test_serial_and_command_frames_match_vendor_bytes(self):
        self.assertEqual((self.board.baudrate, self.board.parity), (9600, "N"))
        self.assertEqual(self.board._command(0x11), bytes.fromhex("FE 0D 11 00 00 00 00 00 00 00 00 00 00 E2"))
        for command in [self.board._command(0x10, ctrl1=8), self.board._command(0x10, ctrl1=0x10),
                        self.board._command(0x12, bd1=8)]:
            self.assertEqual(len(command), 14)
            self.assertEqual(command[7:13], bytes(6))
            checksum = 0
            for value in command:
                checksum ^= value
            self.assertEqual(checksum, 0)

    def test_field_capture_ignores_uninstalled_hopper_and_bd2_and_accepts_version_12(self):
        capture = bytes.fromhex("FE 12 13 47 11 00 00 00 00 00 01 00 00 00 00 00 00 12 BA")
        result = self.board.process_incoming(capture)
        self.assertEqual(self.board.input_counts, [0, 0, 0, 0, 0, 1])
        self.assertEqual((self.board.status1, self.board.status2), (0x47, 0x11))
        self.assertEqual(self.board._acceptor_state(), 1)
        info = next(m for m in result if m["type"] == "cash_board_info")
        self.assertEqual(info, {"type": "cash_board_info", "version": "0x12", "versionVerified": True,
                               "responseFields": {"0x13": capture[3:18].hex().upper()}, "protocol": "multi3400-fe"})
        self.assertFalse(self.board.bill_codes)
        self.assertFalse(self.board.counter_uncertain)
        for version in (0, 0x13, 0xFF):
            self.assertTrue(self.receive(version=version, inputs=[0, 0, 0, 0, 0, 1])[0]["versionVerified"])
        self.receive(status1=0x40, status2=0x22, inputs=[0, 0, 0, 0, 0, 1])
        self.assertTrue(self.board._payout_safe())

    def test_fragmented_receive_resynchronizes_and_stray_ack_cannot_finish_query(self):
        self.accept(0x48, 0x69, 0x3F)
        self.assertEqual(self.board.process_incoming(b"garbage\x11\xEE"), [])
        frame = status_frame()
        self.assertEqual(self.board.process_incoming(frame[:1]), [])
        self.assertEqual(self.board.process_incoming(frame[1:9]), [])
        self.assertEqual(self.legacy(self.board.process_incoming(frame[9:])), [[0x6D, 0x65, 0]])
        self.assertEqual(len(self.sent), 1)

    def test_wrong_response_code_is_logged_and_does_not_satisfy_status_wait(self):
        self.accept(0x48, 0x69, 0x3F)
        with self.assertLogs("MULTI3400", "WARNING"):
            self.assertEqual(self.receive(code=0x16), [])
        self.assertIsNotNone(self.board.waiting)
        self.assertEqual(self.legacy(self.receive()), [[0x6D, 0x65, 0]])

    def test_status_during_ack_wait_updates_counts_without_advancing_command(self):
        self.accept(0x53, 0x41, 0x0E)
        self.receive()
        self.assertEqual(len(self.sent), 1)
        self.assertEqual(self.board.waiting["reply"], "ack")
        self.ack()
        self.assertEqual(len(self.sent), 2)

    def test_bad_length_and_xor_fail_after_discard_and_quiet_period(self):
        for corrupt in ("length", "xor"):
            with self.subTest(corrupt=corrupt):
                self.board = Multi3400("QA-NO-PORT")
                self.board.send = lambda data: self.sent.append(bytes(data)) or True
                fake = Mock(is_open=True)
                self.board.ser = fake
                self.accept(0x53, 0x41, 0x0D)
                frame = bytearray(status_frame())
                frame[1 if corrupt == "length" else -1] ^= 1
                self.board.process_incoming(frame)
                fake.reset_input_buffer.assert_called_once()
                before = len(self.sent)
                self.receive()
                self.now += 0.49
                self.assertEqual(self.board.poll(), [])
                self.now += 0.02
                self.assertEqual(self.legacy(self.board.poll()), [[0x4E, 0x47, 0]])
                self.assertEqual(len(self.sent), before)
                self.assertIsNone(self.board.operation)

    def test_ack_nak_and_one_second_response_timeout(self):
        self.accept(0x53, 0x41, 0x0E)
        self.assertEqual(self.legacy(self.ack(0xEE)), [[0x4E, 0x47, 0]])
        self.accept(0x53, 0x41, 0x0E)
        self.now += 1.0
        self.assertEqual(self.board.poll(), [])
        self.assertIsNotNone(self.board.waiting)
        self.now += 0.01
        self.assertEqual(self.board.poll(), [])
        self.assertTrue(self.board.failure_pending)
        self.ack()  # A late ACK in quarantine must never issue a status query.
        self.now += 0.5
        self.assertEqual(self.legacy(self.board.expire_operations()), [[0x4E, 0x47, 0]])
        self.assertEqual(len(self.sent), 2)

    def test_connect_and_reconnect_stop_before_any_other_board_command(self):
        for _ in range(2):
            fake = Mock(is_open=True)
            with patch("serial_manager.serial.Serial", return_value=fake) as constructor:
                self.assertTrue(self.board.connect())
            self.assertEqual(constructor.call_args.kwargs["parity"], "N")
            self.assertEqual(self.sent[-1], self.board._command(0x10))
            self.assertEqual(self.board.waiting["reply"], "ack")
            self.ack()
            self.assertEqual(self.sent[-1], self.board._command(0x11))
            with self.assertLogs("MULTI3400", "CRITICAL"):
                self.receive(status1=7)
            self.assertIsNone(self.board.operation)

    def test_failed_connection_sends_nothing(self):
        self.assertFalse(self.board.connect())
        self.assertEqual(self.sent, [])

    def test_enable_clears_then_verifies_both_validators_with_coin_disabled(self):
        self.enable()
        self.assertEqual(self.sent, [self.board._command(0x11), self.board._command(0x10, ctrl1=8),
                                    self.board._command(0x11), self.board._command(0x10, ctrl1=3), self.board._command(0x11)])
        before = len(self.sent)
        self.accept(0x53, 0x43, 0x3C)
        self.assertEqual(self.legacy(self.receive(status1=3)), [[0x4F, 0x4B, 0]])
        self.assertEqual(self.sent[before:], [self.board._command(0x11)])

    def test_enable_busy_or_validator_error_sends_no_control(self):
        for status1, status2 in [(0x10, 0), (0x20, 0), (0, 0x40), (0, 0x80), (8, 0)]:
            self.accept(0x53, 0x41, 0x0D)
            self.assertEqual(self.legacy(self.receive(status1=status1, status2=status2)), [[0x4E, 0x47, 0]])
        self.assertTrue(all(frame[2] == 0x11 for frame in self.sent))

    def test_enable_queue_counter_uncertain_payout_uncertain_or_other_work_refuses(self):
        for field, value in [("bill_codes", [0x0A]), ("counter_uncertain", True), ("payout_uncertain", True)]:
            old = getattr(self.board, field)
            setattr(self.board, field, value)
            self.assertEqual(self.legacy(self.accept(0x53, 0x41, 0x0D)), [[0x4E, 0x47, 0]])
            setattr(self.board, field, old)
        self.accept(0x48, 0x69, 0x3F)
        self.assertEqual(self.legacy(self.accept(0x53, 0x41, 0x0D)), [[0x4E, 0x47, 0]])
        self.assertEqual(len(self.sent), 1)

    def test_enable_clear_and_final_enabled_state_must_match(self):
        for failure in ("not-cleared", "coin-on"):
            self.board = Multi3400("QA-NO-PORT")
            self.board.send = lambda data: self.sent.append(bytes(data)) or True
            self.accept(0x53, 0x41, 0x0D)
            self.receive(inputs=[0, 0, 0, 0, 1, 0])
            self.ack()
            if failure == "not-cleared":
                result = self.receive(inputs=[0, 0, 0, 0, 1, 0])
            else:
                self.receive()
                self.ack()
                result = self.receive(status1=7)
            self.assertEqual(self.legacy(result), [[0x4E, 0x47, 0]])

    def test_stop_success_and_failure_finish_without_enabling(self):
        for status1, status2, ok in [(0, 0, True), (3, 0, False), (0, 0x40, False), (0, 0x80, False)]:
            self.accept(0x53, 0x43, 0x1C)
            self.ack()
            self.assertEqual(self.legacy(self.receive(status1=status1, status2=status2)),
                             [[0x4F, 0x4B, 0]] if ok else [[0x4E, 0x47, 0]])
        self.assertTrue(all(frame[2] != 0x10 or frame[3] == 0 for frame in self.sent))

    def test_all_received_bills_are_queued_and_reported_once(self):
        self.receive()
        result = self.receive(inputs=[0, 0, 1, 1, 1, 1])
        self.assertIn({"type": "acceptor_event", "event": 0x0B}, result)
        self.assertEqual(list(self.board.bill_codes), [1, 5, 10, 50])
        self.assertFalse(any(m["type"] == "acceptor_event" for m in self.receive(inputs=[0, 0, 1, 1, 1, 1])))
        self.accept(0x47, 0x41, 0x3F)
        self.assertEqual(self.legacy(self.receive(inputs=[0, 0, 1, 1, 1, 1])), [[0x67, 0x61, 0x0B]])
        for code in [1, 5, 10, 50, 0]:
            self.assertEqual(self.legacy(self.accept(0x47, 0x42, 0x3F)), [[0x67, 0x62, code]])

    def test_coin_or_uncommanded_decrease_marks_counter_uncertain(self):
        for before, after in [([0] * 6, [1, 0, 0, 0, 0, 0]), ([0] * 6, [0, 1, 0, 0, 0, 0]),
                              ([0, 0, 0, 0, 1, 0], [0] * 6)]:
            self.board.last_input_counts = before
            with self.assertLogs("MULTI3400", "CRITICAL"):
                self.receive(inputs=after)
            self.assertTrue(self.board.counter_uncertain)
            self.assertEqual(self.board._acceptor_state(), 0x0C)
        self.assertEqual(self.sent, [])

    def test_acceptor_status_queue_error_busy_and_idle_priority(self):
        for status1, status2, expected in [(0x10, 0, 0x0C), (0, 0xC0, 4), (0, 0, 1)]:
            self.accept(0x47, 0x41, 0x3F)
            self.assertEqual(self.legacy(self.receive(status1=status1, status2=status2)), [[0x67, 0x61, expected]])

    def test_reset_with_queue_only_stops_and_never_clears_received_cash(self):
        self.board.bill_codes.extend([0x01, 0x32])
        self.accept(0x52, 0x53, 0x54)
        self.ack()
        self.assertEqual(self.legacy(self.receive()), [[0x4E, 0x47, 0]])
        self.assertEqual(self.sent, [self.board._command(0x10), self.board._command(0x11)])
        self.assertEqual(list(self.board.bill_codes), [1, 50])

    def test_reset_without_queue_stops_then_clears_and_verifies(self):
        self.accept(0x52, 0x53, 0x54)
        self.ack()
        self.receive(inputs=[0, 0, 0, 0, 2, 0])
        self.assertEqual(self.sent[-1], self.board._command(0x10, ctrl1=8))
        self.ack()
        self.assertEqual(self.legacy(self.receive()), [[0x4F, 0x4B, 0]])
        self.assertFalse(self.board.counter_uncertain)

    def test_unknown_acceptor_refuses_unknown_dispenser_is_silent(self):
        self.assertEqual(self.legacy(self.accept(0x53, 0x41, 6)), [[0x4E, 0x47, 0]])
        self.assertEqual(self.dispense(0xFF), [])
        self.assertEqual(self.sent, [])

    def test_dispenser_handshake_and_initialization_query_only_without_bd1_reset(self):
        self.dispense(0x48, 0x49, 0x3F)
        self.assertEqual(self.legacy(self.receive(), "dispenser"), [[0x6D, 0x65, 0x21]])
        for status1, status2, ok in [(0, 0, True), (0x40, 0x22, True), (0, 0x10, False), (0, 1, False), (8, 0, False)]:
            self.dispense(0x49)
            self.assertEqual(self.legacy(self.receive(status1=status1, status2=status2), "dispenser"),
                             [[0x69, 0, 0x61]] if ok else [[0x6E, 0x73, 0x21]])
        self.assertTrue(all(frame[2] == 0x11 for frame in self.sent))

    def test_eight_note_payout_zeroes_counts_once_then_acknowledges_and_verifies(self):
        self.start_payout()
        self.assertEqual(self.sent, [self.board._command(0x11), self.board._command(0x10, ctrl1=0x10),
                                    self.board._command(0x11), self.board._command(0x12, bd1=8)])
        self.assertEqual(self.legacy(self.dispense(0x53), "dispenser"), [[0x73, 0x6F, 0x6E]])
        self.progress(3, status1=8)
        self.assertEqual(self.legacy(self.progress(8), "dispenser"), [[0x73, 8, 0x6F]])
        self.assertFalse(self.board.payout_uncertain)
        self.dispense(0x53)
        self.assertEqual(self.legacy(self.receive(payouts=[0, 0, 8, 0]), "dispenser"), [[0x73, 8, 0x6F]])
        self.assert_single_payout()

    def test_poll_only_queries_active_payout_at_quarter_second_intervals(self):
        self.assertEqual(self.board.poll(), [])
        self.assertEqual(self.sent, [])
        self.start_payout()
        before = len(self.sent)
        self.now += 0.24
        self.board.poll()
        self.assertEqual(len(self.sent), before)
        self.now += 0.01
        self.board.poll()
        self.board.poll()
        self.assertEqual(len(self.sent), before + 1)
        self.receive(payouts=[0, 0, 8, 0])
        before = len(self.sent)
        self.now += 1
        self.board.poll()
        self.assertEqual(len(self.sent), before)

    def test_payout_bd1_error_after_three_notes_is_partial_and_never_reissued(self):
        self.start_payout()
        self.assertEqual(self.legacy(self.progress(3, status2=1), "dispenser"), [])  # jam: count unknown, no status reply
        self.assertTrue(self.board.payout_uncertain)
        self.assertEqual(self.legacy(self.dispense(0x44, 8, 0x53), "dispenser"), [[0x6E, 0x73, 0x21]])
        self.assertEqual(self.legacy(self.accept(0x53, 0x41, 0x0D)), [[0x4E, 0x47, 0]])
        self.board.poll()
        self.assert_single_payout()

    def test_payout_nak_refuses_without_claiming_notes_or_automatic_retry(self):
        self.dispense(0x44, 8, 0x53)
        self.receive()
        self.ack()
        self.receive()
        self.assertEqual(self.legacy(self.ack(0xEE), "dispenser"), [[0x6E, 0x73, 0x21]])
        self.assertIsNone(self.board.operation)
        self.assertFalse(self.board.payout_uncertain)
        self.assert_single_payout()

    def test_payout_stalled_at_three_notes_times_out_partial_without_retry(self):
        self.start_payout()
        self.progress(3)
        self.now = 27.01  # Eight notes: total 8*1.5+5 seconds.
        self.assertEqual(self.legacy(self.board.poll(), "dispenser"), [])  # timeout: count unknown, no status reply
        self.assertTrue(self.board.payout_uncertain)
        self.dispense(0x44, 8, 0x53)
        self.board.recover("dispenser", "no-retry")
        self.assert_single_payout()

    def test_payout_ack_timeout_or_partial_write_is_uncertain_and_never_reissued(self):
        for partial_write in (False, True):
            self.board = Multi3400("QA-NO-PORT")
            self.sent = []
            self.board.send = lambda data: self.sent.append(bytes(data)) or not (partial_write and data[2] == 0x12)
            self.dispense(0x44, 8, 0x53)
            self.receive()
            self.ack()
            self.receive()
            if not partial_write:
                self.now += 1.01
                self.board.poll()
            self.now += 0.51
            self.assertEqual(self.legacy(self.board.poll(), "dispenser"), [])
            self.assertTrue(self.board.payout_uncertain)
            self.dispense(0x44, 8, 0x53)
            self.assert_single_payout()

    def test_payout_counts_above_request_or_decreasing_are_uncertain(self):
        self.start_payout()
        self.assertEqual(self.legacy(self.progress(9), "dispenser"), [])
        self.assertTrue(self.board.payout_uncertain)
        self.assert_single_payout()

    def test_payout_counter_decrease_after_progress_is_uncertain(self):
        self.start_payout()
        self.progress(3, status1=8)
        self.assertEqual(self.legacy(self.progress(2), "dispenser"), [])
        self.assertTrue(self.board.payout_uncertain)
        self.assert_single_payout()

    def test_empty_after_exact_delivery_is_complete_empty_before_delivery_is_not(self):
        self.start_payout()
        self.assertEqual(self.legacy(self.progress(8, status2=0x10), "dispenser"), [[0x73, 8, 0x6F]])
        self.assertFalse(self.board.payout_uncertain)

    def test_empty_before_requested_count_reports_exact_partial_and_is_not_retried(self):
        self.start_payout()
        self.assertEqual(self.legacy(self.progress(3, status2=0x10), "dispenser"), [[0x73, 3, 0x6E]])
        self.assertFalse(self.board.payout_uncertain)  # The board counted exactly 3 notes before running out.
        self.assertEqual(self.legacy(self.dispense(0x53, 0, 0), "dispenser"), [])
        self.assertEqual(self.legacy(self.receive(status2=0x10), "dispenser"), [[0x73, 3, 0x6E]])
        # A refill needs a new payment; BD1 empty refuses another payout before any 0x12 frame.
        self.assertEqual(self.legacy(self.dispense(0x44, 8, 0x53), "dispenser"), [[0x6E, 0x73, 0x21]])
        self.assert_single_payout()

    def test_uncertain_payout_gets_no_status_reply_so_the_renderer_records_it_unconfirmed(self):
        self.start_payout()
        self.progress(9)
        self.assertTrue(self.board.payout_uncertain)
        self.assertEqual(self.legacy(self.dispense(0x53, 0, 0), "dispenser"), [])
        self.assertEqual(self.legacy(self.receive(), "dispenser"), [])

    def test_payout_bounds_and_unread_bills_are_refused_without_io(self):
        for count in (0, 61, 255):
            self.assertEqual(self.legacy(self.dispense(0x44, count, 0x53), "dispenser"), [[0x6E, 0x73, 0x21]])
        self.board.bill_codes.append(5)
        self.assertEqual(self.legacy(self.dispense(0x44, 8, 0x53), "dispenser"), [[0x6E, 0x73, 0x21]])
        self.assertEqual(self.sent, [])

    def test_serial_reader_reconnect_path_uses_connection_time_stop(self):
        fake = Mock(is_open=True, in_waiting=0)
        self.board.running = True
        with patch("serial_manager.serial.Serial", return_value=fake), \
                patch("serial_manager.time.sleep", side_effect=lambda _: setattr(self.board, "running", False)):
            self.board._run()
        self.assertEqual(self.sent, [self.board._command(0x10)])

    def test_reconnect_never_releases_uncertain_payout(self):
        self.start_payout()
        with patch("serial_manager.serial.Serial", return_value=Mock(is_open=True)):
            self.board.connect()
        self.assertTrue(self.board.payout_uncertain)
        self.ack()
        self.receive()
        self.assertTrue(self.board.payout_uncertain)
        self.dispense(0x44, 8, 0x53)
        self.assert_single_payout()

    def test_invalid_value_and_unsafe_payout_preconditions_never_send_payout(self):
        for value in (None, 0, True, "5000", 2000):
            self.board.bd1_value = value
            self.assertEqual(self.legacy(self.dispense(0x44, 8, 0x53), "dispenser"), [[0x6E, 0x73, 0x21]])
        self.assertEqual(self.sent, [])
        self.board.bd1_value = 5000
        for status1, status2 in [(3, 0), (4, 0), (8, 0), (0, 0x40), (0, 0x80), (0, 1), (0, 0x10)]:
            self.board.status1 = self.board.status2 = 0
            self.dispense(0x44, 8, 0x53)
            self.assertEqual(self.legacy(self.receive(status1=status1, status2=status2), "dispenser"), [[0x6E, 0x73, 0x21]])
        self.assertTrue(all(frame[2] == 0x11 for frame in self.sent))

    def test_payout_count_zero_requires_verified_clear_and_does_not_retry(self):
        self.dispense(0x44, 8, 0x53)
        self.receive(payouts=[0, 0, 2, 0])
        self.ack()
        self.assertEqual(self.legacy(self.receive(payouts=[0, 0, 2, 0]), "dispenser"), [[0x6E, 0x73, 0x21]])
        self.assertFalse(any(frame[2] == 0x12 for frame in self.sent))

    def test_acceptor_recovery_logs_received_money_then_clears_verifies_and_releases_counter(self):
        self.board.counter_uncertain = True
        self.board.bill_codes.extend([1, 5, 10, 50])
        with self.assertLogs("MULTI3400", "CRITICAL") as logs:
            self.board.recover("acceptor", "qa-recover")
        self.assertIn("66000", logs.output[0])
        self.assertEqual(self.sent, [self.board._command(0x10, ctrl1=8)])
        self.assertFalse(self.board.bill_codes)
        self.ack()
        result = self.receive()
        self.assertTrue(next(m for m in result if m["type"] == "cash_board_result")["verified"])
        self.assertFalse(self.board.counter_uncertain)

    def test_acceptor_recovery_wrong_status_or_counts_fail(self):
        for status1, inputs in [(3, [0] * 6), (0x10, [0] * 6), (0, [0, 0, 1, 0, 0, 0])]:
            self.board.recover("acceptor", "qa-fail")
            self.ack()
            result = self.receive(status1=status1, inputs=inputs)
            self.assertFalse(next(m for m in result if m["type"] == "cash_board_result")["success"])

    def test_dispenser_recovery_queries_only_and_never_resets_or_pays(self):
        for status1, status2, ok in [(0, 0, True), (0x40, 0x22, True), (8, 0, False), (0, 1, False), (0, 0x10, False)]:
            self.board.recover("dispenser", "qa-status")
            result = self.receive(status1=status1, status2=status2)
            self.assertEqual(next(m for m in result if m["type"] == "cash_board_result")["verified"], ok)
        self.assertTrue(all(frame[2] == 0x11 for frame in self.sent))

    def test_recovery_timeout_busy_and_payout_uncertainty_fail(self):
        self.board.recover("dispenser", "qa-timeout")
        result = self.board.recover("acceptor", "qa-busy")
        self.assertFalse(result[0]["success"])
        self.now += 1.01
        self.board.poll()
        self.now += 0.51
        self.assertFalse(self.board.poll()[0]["success"])
        self.board.payout_uncertain = True
        self.assertFalse(self.board.recover("acceptor", "qa-uncertain")[0]["success"])
        self.assertEqual(len(self.sent), 1)

    def test_duplicate_payout_and_enable_cannot_replace_inflight_command(self):
        self.start_payout()
        self.assertEqual(self.legacy(self.dispense(0x44, 1, 0x53), "dispenser"), [[0x6E, 0x73, 0x21]])
        self.assertEqual(self.legacy(self.accept(0x53, 0x41, 0x0D)), [[0x4E, 0x47, 0]])
        self.assert_single_payout()


if __name__ == "__main__":
    unittest.main()
