"""ONEPLUS MULTI3400 HW v1.1: FE frames, never the BAC-2400 TLV protocol.

Only the legacy bridge interface and its guards are inherited from Bac2400.
V1_1 and V1_5 demos both write 14 bytes (length=13, XOR at index 13).
"""
import logging
import time

import serial

from bac2400 import Bac2400, locked


logger = logging.getLogger("MULTI3400")


class Multi3400(Bac2400):
    BILL_AMOUNTS = (100, 500, 1000, 5000, 10000, 50000)
    ACCEPTED_BILLS = {2: 0x01, 3: 0x05, 4: 0x0A, 5: 0x32}
    POLL_INTERVAL = 0.25

    def __init__(self, port, bd1_value=10000):
        super().__init__(port)
        self.name, self.parity = "MULTI3400", serial.PARITY_NONE
        if type(bd1_value) is not int or bd1_value not in (1000, 5000, 10000, 50000):
            raise ValueError("Invalid MULTI3400_BD1_VALUE")
        self.bd1_value = bd1_value
        self.status1 = self.status2 = None
        self.version = None
        self.last_query = 0
        self.wire_pending = None
        self.query_needed = False
        self.session_started = False
        self.max_input = 0
        self.counter_uncertain = False
        self.deferred_messages = []
        self.quiet_until = 0

    @staticmethod
    def frame(command, data=()):
        packet = bytearray([0xFE, 13, command, *data])
        if len(packet) > 13:
            raise ValueError("MULTI3400 command payload too long")
        packet.extend([0] * (13 - len(packet)))
        checksum = 0
        for value in packet:
            checksum ^= value
        return bytes(packet + bytes([checksum]))

    @staticmethod
    def _failure_reason(target, reason, source="adapter"):
        logger.warning("Cash adapter outcome: source=%s target=%s reason=%s", source, target, reason)

    @locked
    def set_payment_amount(self, amount):
        if type(amount) is not int or amount <= 0 or self.pending_acceptor_control:
            return False
        # One byte in thousands; never wrap a larger price into a smaller limit.
        self.max_input = (amount + 999) // 1000 if amount <= 255000 else 0
        if not self.max_input:
            self._failure_reason("acceptor", "input_limit_unavailable")
        return True

    def _write(self, command, data=()):
        if self.wire_pending or time.monotonic() < self.quiet_until:
            return False
        self.wire_pending = {"kind": "status" if command == 0x11 else "ack", "started": time.monotonic()}
        if self.send(self.frame(command, data)):
            return True
        self.wire_pending = None
        return False

    @locked
    def control_acceptor(self, enabled, clear=False):
        data = [0] * 10
        data[0] = (3 if enabled else 0) | (8 if clear else 0)  # Coin stays OFF.
        data[4] = self.max_input
        return self._write(0x10, data)

    @locked
    def query_acceptor(self):
        self.query_needed = True
        if self.wire_pending or time.monotonic() < self.quiet_until:
            return True
        self.last_query = time.monotonic()
        self.query_needed = False
        return self._write(0x11)

    query_dispenser = query_acceptor

    @locked
    def reset_dispenser(self):
        return self._write(0x10, [0, 2])  # Stop all inputs, BD1 reset; no clear/payout.

    @locked
    def handle_acceptor_command(self, packet):
        if not self.valid_legacy_packet(packet):
            return []
        a, b, value = packet[1:4]
        if (a, b) == (0x47, 0x42):
            code = self.bill_codes.popleft() if self.bill_codes else 0
            return [self._legacy_message("acceptor", 0x67, 0x62, code)]
        if self.pending_recovery:
            return [self._acceptor_ng("pending_recovery")]
        if (a, b) in ((0x48, 0x69), (0x47, 0x41)):
            if a == 0x48:
                self.pending_acceptor_connection = True
            else:
                self.pending_acceptor_status = True
            self.query_acceptor()
            return []
        if self.pending_acceptor_control:
            return [self._acceptor_ng("pending_acceptor_control")]
        enabled, end_session = None, False
        if (a, b, value) == (0x53, 0x41, 0x0D) or (a, b, value) == (0x53, 0x43, 0x3C):
            enabled = True
        elif (a, b, value) in ((0x53, 0x41, 0x0E), (0x53, 0x43, 0x1C), (0x52, 0x53, 0x54)):
            enabled, end_session = False, (a, b, value) == (0x52, 0x53, 0x54)
        if enabled is None:
            return [self._acceptor_ng("unsupported_command")]
        if enabled and (self.pending_payout or self.payout_uncertain or self.counter_uncertain or self.bill_codes):
            reason = "payout_uncertain" if self.payout_uncertain else "pending_payout" if self.pending_payout else \
                "counter_discontinuity" if self.counter_uncertain else "queued_bills"
            return [self._acceptor_ng(reason)]
        self.pending_acceptor_control = {"enabled": enabled, "end_session": end_session,
                                         "clear": enabled and not self.session_started,
                                         "phase": "checking", "started": time.monotonic()}
        if not self.query_acceptor():
            self.pending_acceptor_control = None
            return [self._acceptor_ng("send_failed")]
        return []

    def _fail_payout(self, reason, source="adapter"):
        self._failure_reason("dispenser", reason, source)
        self.payout_uncertain = True
        self.pending_payout = None
        return self._legacy_message("dispenser", 0x73, 0x74, 0x65)

    @property
    @locked
    def payout_in_progress(self):
        if self.pending_payout and time.monotonic() - self.pending_payout["started"] > 9:
            self.deferred_messages.append(self._fail_payout("payout_timeout"))
        return bool(self.pending_payout)

    def _fail_operations(self, reason, source="adapter"):
        messages = []
        if self.pending_acceptor_control:
            messages.append(self._acceptor_ng(reason, source))
            self.pending_acceptor_control = None
        if self.pending_recovery:
            messages.append(self._recovery_result(self.pending_recovery, False, reason, source))
            self.pending_recovery = None
        if self.pending_payout:
            messages.append(self._fail_payout(reason, source))
        if not messages:
            self._failure_reason("acceptor", reason, source)
        return messages

    @locked
    def expire_operations(self):
        self.payout_in_progress
        messages, self.deferred_messages = self.deferred_messages, []
        if self.pending_acceptor_control and time.monotonic() - self.pending_acceptor_control["started"] > 2.5:
            messages.append(self._acceptor_ng("control_timeout"))
            self.pending_acceptor_control = None
        if self.pending_recovery and time.monotonic() - self.pending_recovery["started"] > 6:
            messages.append(self._recovery_result(self.pending_recovery, False, "recovery_timeout"))
            self.pending_recovery = None
        if self.wire_pending and time.monotonic() - self.wire_pending["started"] > 0.75:
            self.wire_pending = None
            self.packet_buffer.clear()
            # No transaction IDs on the wire: drain late ACKs before another control.
            self.quiet_until = time.monotonic() + 0.75
            messages.extend(self._fail_operations("response_timeout"))
        return messages

    @locked
    def advance_recovery(self):
        operation = self.pending_recovery
        if operation and operation.get("yield") and not self.wire_pending:
            self.pending_recovery = None
            return [self._recovery_result(operation, False, "recovery_yielded")]
        if not self.wire_pending and time.monotonic() >= self.quiet_until and \
                (self.query_needed or time.monotonic() - self.last_query >= self.POLL_INTERVAL):
            if not self.query_acceptor():
                return self._fail_operations("send_failed")
        return []

    @locked
    def process_incoming(self, data):
        messages = self.expire_operations()
        self.packet_buffer.extend(data)
        while self.packet_buffer:
            marker = self.packet_buffer[0]
            if marker in (0x11, 0xEE):
                del self.packet_buffer[0]
                if not self.wire_pending or self.wire_pending["kind"] != "ack":
                    if marker == 0xEE:
                        messages.extend(self._fail_operations("board_nak", "board_ng"))
                    continue
                self.wire_pending = None
                if marker == 0xEE:
                    messages.extend(self._fail_operations("board_nak", "board_ng"))
                else:
                    self.query_needed = True  # ACK alone never confirms control or payout.
                continue
            if marker != 0xFE:
                del self.packet_buffer[0]
                continue
            if len(self.packet_buffer) < 2:
                break
            if self.packet_buffer[1] != 18:
                self.packet_buffer.clear()
                messages.extend(self._fail_operations("invalid_length"))
                break
            if len(self.packet_buffer) < 19:
                break
            frame = bytes(self.packet_buffer[:19])
            del self.packet_buffer[:19]
            checksum = 0
            for value in frame:
                checksum ^= value
            if checksum:
                messages.extend(self._fail_operations("invalid_checksum"))
                continue
            if frame[2] != 0x13:
                # 0x16/17/18 have big-endian counters, never byte-sized input/payout counts.
                messages.extend(self._fail_operations("unexpected_response"))
                continue
            fresh = bool(self.wire_pending and self.wire_pending["kind"] == "status")
            if fresh:
                self.wire_pending = None
            messages.extend(self._status(frame, fresh))
        return messages

    def _status(self, frame, fresh):
        messages = []
        self.response_confirmed = True
        self.status1, self.status2 = frame[3:5]
        self.version = f"0x{frame[17]:02X}"
        self.response_fields = {"0x13": frame[3:18].hex().upper()}
        messages.append({"type": "cash_board_info", "version": self.version, "versionVerified": True,
                         "responseFields": self.response_fields, "protocol": "multi3400-fe"})
        self.acceptor_enabled = bool(self.status1 & 3)
        self.dispenser_running = bool(self.status1 & 8)
        counts = list(frame[5:11])
        self.last_payout_counts = list(frame[11:15])
        self.dispenser_statuses[self.BD1] = (1 if self.status2 & 1 else 0) | (2 if self.status2 & 0x10 else 0)
        control = self.pending_acceptor_control
        clearing = fresh and control and control["phase"] == "clear_verify"
        if clearing and not any(counts):
            self.last_bill_counts = counts
        elif self.last_bill_counts is None:
            self.last_bill_counts = counts  # Existing board cash is never a new sale.
        elif not clearing:
            deltas = [current - previous for current, previous in zip(counts, self.last_bill_counts)]
            self.last_bill_counts = counts
            if any(delta < 0 for delta in deltas):
                self.counter_uncertain = True
                self._failure_reason("acceptor", "counter_discontinuity")
            # Credit every known stacked note even if another counter/status is faulty.
            for index, code in self.ACCEPTED_BILLS.items():
                self.bill_codes.extend([code] * max(0, deltas[index]))
            if any(deltas[index] > 0 for index in (0, 1)):
                self.counter_uncertain = True
                self._failure_reason("acceptor", "unexpected_coin")
            if self.bill_codes:
                messages.append({"type": "acceptor_event", "event": 0x0B})
        acceptor_error = bool(self.status1 & 0x30) or self.counter_uncertain
        acceptor_busy = bool(self.status2 & 0xC0)
        self.acceptor_status = 0x0B if self.bill_codes else 0x0C if acceptor_error else 0x04 if acceptor_busy else 0x01

        if fresh and control:
            phase = control["phase"]
            if control["enabled"] and ((acceptor_error and not self.bill_codes) or
                                       phase == "checking" and (acceptor_busy or self.bill_codes)):
                reason = "queued_bills" if self.bill_codes else "acceptor_board_error" if acceptor_error else "acceptor_processing"
                messages.append(self._acceptor_ng(reason, "board_status"))
                self.pending_acceptor_control = None
            elif phase == "checking":
                control["phase"] = "clear_verify" if control["clear"] else "verify"
                if not self.control_acceptor(False if control["clear"] else control["enabled"], control["clear"]):
                    messages.append(self._acceptor_ng("send_failed"))
                    self.pending_acceptor_control = None
            elif phase == "clear_verify":
                if not any(counts) and not self.status1 & 7 and not acceptor_busy:
                    control["phase"] = "verify"
                    if not self.control_acceptor(True):
                        messages.append(self._acceptor_ng("send_failed"))
                        self.pending_acceptor_control = None
                else:
                    messages.append(self._acceptor_ng("verification_failed", "board_status"))
                    self.pending_acceptor_control = None
            elif phase == "verify":
                expected = 3 if control["enabled"] else 0
                if self.status1 & 7 == expected and (not acceptor_busy or control["enabled"] and self.bill_codes):
                    if control["enabled"]:
                        self.session_started = True
                    elif control["end_session"]:
                        self.session_started = False
                    messages.append(self._legacy_message("acceptor", 0x4F, 0x4B, 0))
                    self.pending_acceptor_control = None
                else:
                    self.query_needed = True

        operation = self.pending_recovery
        if fresh and operation:
            phase = operation["phase"]
            target = operation["target"]
            if operation.get("yield"):
                messages.append(self._recovery_result(operation, False, "recovery_yielded"))
                self.pending_recovery = None
            elif self.dispenser_running or acceptor_busy or self.bill_codes or self.counter_uncertain:
                reason = "dispenser_running" if self.dispenser_running else "queued_bills" if self.bill_codes else \
                    "counter_discontinuity" if self.counter_uncertain else "acceptor_processing"
                messages.append(self._recovery_result(operation, False, reason, "board_status"))
                self.pending_recovery = None
            elif phase == "checking" and self.status1 & 7:
                operation["phase"] = "stopping"
                if not self.control_acceptor(False):
                    messages.extend(self._fail_operations("send_failed"))
            elif phase in ("checking", "stopping") and not self.status1 & 7:
                operation["phase"] = "verifying"
                if not self.reset_dispenser():
                    messages.extend(self._fail_operations("send_failed"))
            elif phase == "verifying":
                success = not self.status1 & 7 and not (acceptor_error if target == "acceptor" else self.dispenser_statuses[self.BD1])
                reason = None if success else "acceptor_board_error" if target == "acceptor" else \
                    "dispenser_empty" if self.status2 & 0x10 else "dispenser_board_error"
                messages.append(self._recovery_result(operation, success, reason, "board_status"))
                self.pending_recovery = None
            else:
                self.query_needed = True

        payout = self.pending_payout
        if fresh and payout:
            if self.dispenser_statuses[self.BD1]:
                messages.append(self._fail_payout("dispenser_empty" if self.status2 & 0x10 else "dispenser_board_error", "board_status"))
            elif payout["phase"] == "checking":
                if self.dispenser_running or self.status1 & 7 or acceptor_busy or self.bill_codes:
                    messages.append(self._fail_payout("dispenser_not_idle", "board_status"))
                else:
                    payout["previous_count"] = self.last_payout_counts[self.BD1]
                    payout["phase"] = "dispensing"
                    if not self._write(0x12, [0, 0, payout["count"]]):
                        messages.append(self._fail_payout("send_failed"))
            elif payout["phase"] == "dispensing":
                delta = self.last_payout_counts[self.BD1] - payout["previous_count"]
                if delta < 0 or delta > payout["count"]:
                    messages.append(self._fail_payout("payout_count_mismatch", "board_status"))
                elif delta == payout["count"] and not self.dispenser_running:
                    messages.append(self._legacy_message("dispenser", 0x64, payout["count"], 0x53))
                    self.pending_payout = None
                else:
                    self.query_needed = True  # Partial counts need more evidence until timeout.

        if fresh:
            if self.pending_acceptor_connection:
                messages.append(self._legacy_message("acceptor", 0x6D, 0x65, 0))
                self.pending_acceptor_connection = False
            if self.pending_acceptor_status:
                messages.append(self._legacy_message("acceptor", 0x67, 0x61, self.acceptor_status))
                self.pending_acceptor_status = False
            if self.pending_dispenser_connection:
                messages.append(self._legacy_message("dispenser", 0x6D, 0x65, 0))
                self.pending_dispenser_connection = False
            if self.pending_dispenser_status:
                state = 0x65 if self.dispenser_statuses[self.BD1] or self.payout_uncertain else \
                    0x6F if self.dispenser_running or self.pending_payout else 0x62
                messages.append(self._legacy_message("dispenser", 0x73, 0x74, state))
                self.pending_dispenser_status = False
        return messages
