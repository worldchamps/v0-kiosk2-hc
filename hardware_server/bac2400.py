import logging
import threading
import time
from collections import deque
from functools import wraps

import serial

from serial_manager import SerialDevice


logger = logging.getLogger("BAC2400")


def locked(method):
    @wraps(method)
    def call(self, *args, **kwargs):
        with self.lock:
            return method(self, *args, **kwargs)
    return call


class Bac2400(SerialDevice):
    """BV1/BD1 TLV adapter; MULTI3400 firmware compatibility needs field evidence."""

    BILL_AMOUNTS = (1000, 5000, 10000, 50000)
    ACCEPTED_BILLS = {2: 0x0A, 3: 0x32}
    BD1 = 2
    MARKERS = (0x11, 0x22, 0x33, 0x44, 0xEE, 0xFE)

    def __init__(self, port):
        super().__init__("BAC2400", port, 9600, parity=serial.PARITY_EVEN)
        self.lock = threading.RLock()
        self.packet_buffer = bytearray()
        self.bill_codes = deque()
        self.last_bill_counts = None
        self.last_payout_counts = [0] * 4
        self.dispenser_statuses = [0] * 4
        self.acceptor_enabled = False
        self.acceptor_status = 0x01
        self.unsupported_bill_detected = False
        self.dispenser_running = False
        self.pending_acceptor_connection = False
        self.pending_acceptor_status = False
        self.pending_dispenser_connection = False
        self.pending_dispenser_status = False
        self.pending_payout = None
        self.response_confirmed = False
        self.response_fields = {}
        self.pending_acceptor_control = None
        self.pending_recovery = None
        self.payout_uncertain = False

    @staticmethod
    def _command(prefix1, prefix2, payload):
        checksum = 0
        for value in payload:
            checksum ^= value
        return bytes([prefix1, prefix2, *payload, checksum])

    @staticmethod
    def _legacy_message(device, command1, command2, data):
        packet = [
            0x24,
            command1,
            command2,
            data,
            (command1 + command2 + data) & 0xFF,
        ]
        if device == "acceptor":
            return {"type": "acceptor_raw", "packet": packet}
        return {"type": "dispenser_data", "data": packet}

    @locked
    def control_acceptor(self, enabled, clear=False):
        flags = (0x01 if enabled else 0) | (0x02 if clear else 0)
        return self.send(self._command(0x5B, 0xA4, [0x03, 0x10, flags, 0]))

    @locked
    def query_acceptor(self):
        return self.send(bytes([0x59, 0xA6]))

    @locked
    def query_dispenser(self):
        return self.send(bytes([0x71, 0x8E]))

    @locked
    def reset_dispenser(self):
        return self.send(self._command(0x73, 0x8C, [0x05, 0x01, 0, 0, 1, 0]))

    @locked
    def dispense(self, count):
        if type(count) is not int or count < 1 or count > 250 or self.pending_payout or self.dispenser_running or \
                self.payout_uncertain or self.pending_recovery or self.pending_acceptor_control:
            reason = "payout_uncertain" if self.payout_uncertain else "pending_payout" if self.pending_payout else \
                "pending_recovery" if self.pending_recovery else "pending_acceptor_control" if self.pending_acceptor_control else \
                "dispenser_running" if self.dispenser_running else "invalid_payout_count"
            self._failure_reason("dispenser", reason)
            return False
        self.pending_payout = {
            "count": count,
            "started": time.monotonic(),
            "phase": "checking",
        }
        if self.query_dispenser():
            return True
        self.pending_payout = None
        return False

    @property
    @locked
    def payout_in_progress(self):
        if not self.pending_payout:
            return False
        # The renderer waits 10 seconds, including preflight. Never issue money after that waiter ends.
        if time.monotonic() - self.pending_payout["started"] > 9:
            logger.error("BD1 payout timed out")
            self._failure_reason("dispenser", "payout_timeout")
            self.payout_uncertain |= self.pending_payout["phase"] == "dispensing"
            self.pending_payout = None
            return False
        return True

    @staticmethod
    def valid_legacy_packet(packet):
        return len(packet) == 5 and packet[0] == 0x24 and packet[4] == sum(packet[1:4]) & 0xFF

    @locked
    def handle_acceptor_command(self, packet):
        if not self.valid_legacy_packet(packet):
            return []
        if self.pending_recovery:
            self._failure_reason("acceptor", "pending_recovery")
            return []
        command1, command2, data = packet[1:4]

        if (command1, command2) == (0x48, 0x69):
            self.pending_acceptor_connection = self.query_acceptor()
            return []
        if (command1, command2) == (0x47, 0x41):
            self.pending_acceptor_status = self.query_acceptor()
            return []
        if (command1, command2) == (0x47, 0x42):
            bill_code = self.bill_codes.popleft() if self.bill_codes else 0
            self.acceptor_status = 0x0B if self.bill_codes else 0x01
            return [self._legacy_message("acceptor", 0x67, 0x62, bill_code)]

        if self.pending_acceptor_control:
            self._failure_reason("acceptor", "pending_acceptor_control")
            return []
        enabled, clear = None, False
        if (command1, command2, data) == (0x53, 0x41, 0x0D):
            enabled, clear = True, not self.bill_codes
        elif (command1, command2, data) == (0x53, 0x41, 0x0E):
            enabled = False
        elif (command1, command2) == (0x53, 0x43):
            if data not in (0x1C, 0x3C):
                return [self._acceptor_ng("unsupported_config")]
            enabled, clear = data != 0x1C, data != 0x1C
        elif (command1, command2, data) == (0x52, 0x53, 0x54):
            enabled, clear = False, True
        # The board stacks automatically; a return/unknown SA is never a synthetic OK.
        if enabled is None:
            return [self._acceptor_ng("unsupported_command")]
        if enabled and (self.pending_payout or self.payout_uncertain):
            return [self._acceptor_ng("payout_uncertain" if self.payout_uncertain else "pending_payout")]
        if clear and self.bill_codes:
            return [self._acceptor_ng("queued_bills")]
        self.pending_acceptor_control = {"enabled": enabled, "clear": clear, "started": time.monotonic()}
        if not self.control_acceptor(enabled, clear) or not self.query_acceptor():
            self.pending_acceptor_control = None
            return [self._acceptor_ng("send_failed")]
        return []

    @locked
    def handle_dispenser_command(self, packet):
        if not self.valid_legacy_packet(packet):
            return []
        if self.pending_recovery:
            self._failure_reason("dispenser", "pending_recovery")
            return []
        command1, command2, data = packet[1:4]

        if command1 in (0x44, 0x64) and data == 0x53:
            self.dispense(command2)
            return []
        if (command1, command2) in ((0x48, 0x49), (0x68, 0x69)):
            self.pending_dispenser_connection = self.query_dispenser()
            return []
        if (command1, command2) in ((0x53, 0x74), (0x73, 0x74)):
            self.pending_dispenser_status = self.query_dispenser()
            return []
        if command1 in (0x49, 0x69) and command2 == 0 and data == 0:
            return self.recover("dispenser", "legacy-init", legacy=command1 ^ 0x20)
        self._failure_reason("dispenser", "unsupported_command")
        return []

    @locked
    def recover(self, target, request_id, legacy=False):
        self.payout_in_progress
        if target not in ("acceptor", "dispenser") or not isinstance(request_id, str) or not 1 <= len(request_id) <= 80:
            return []
        operation = {"target": target, "requestId": request_id, "legacy": legacy,
                     "phase": "checking", "started": time.monotonic()}
        if self.pending_recovery or self.pending_acceptor_control or self.pending_payout or self.payout_uncertain:
            reason = "payout_uncertain" if self.payout_uncertain else "pending_payout" if self.pending_payout else \
                "pending_acceptor_control" if self.pending_acceptor_control else "pending_recovery"
            return [self._recovery_result(operation, False, reason)]
        self.pending_recovery = operation
        if not (self.query_acceptor() if target == "acceptor" else self.query_dispenser()):
            self.pending_recovery = None
            return [self._recovery_result(operation, False, "send_failed")]
        return []

    @locked
    def yield_recovery(self, request_id):
        if self.pending_recovery and self.pending_recovery["requestId"] == request_id:
            self.pending_recovery["yield"] = True
        return []  # Wait for the outstanding command's response; never release the guard early.

    @locked
    def advance_recovery(self):
        operation = self.pending_recovery
        if not operation or not operation.get("queryNeeded") or operation.get("yield"):
            return []
        operation["queryNeeded"] = False
        if not (self.query_acceptor() if operation["target"] == "acceptor" else self.query_dispenser()):
            self.pending_recovery = None
            return [self._recovery_result(operation, False, "send_failed")]
        return []

    @staticmethod
    def _failure_reason(target, reason, source="adapter"):
        logger.warning("Cash adapter outcome: source=%s target=%s reason=%s", source, target, reason)

    def _acceptor_ng(self, reason, source="adapter"):
        self._failure_reason("acceptor", reason, source)
        return {**self._legacy_message("acceptor", 0x4E, 0x47, 0), "source": source, "reason": reason}

    def _recovery_result(self, operation, success, reason=None, source="adapter"):
        if not success:
            self._failure_reason(operation["target"], reason or "unverified", source)
        if operation["legacy"]:
            return self._legacy_message("dispenser", operation["legacy"], 0, 0) if success \
                else self._legacy_message("dispenser", 0x73, 0x74, 0x65)
        return {"type": "cash_board_result", "requestId": operation["requestId"],
                "target": operation["target"], "success": success, "verified": success,
                "source": source, "reason": reason}

    @locked
    def expire_operations(self):
        messages = []
        if self.pending_acceptor_control and time.monotonic() - self.pending_acceptor_control["started"] > 3:
            self.pending_acceptor_control = None
            messages.append(self._acceptor_ng("control_timeout"))
        if self.pending_recovery and time.monotonic() - self.pending_recovery["started"] > 6:
            messages.append(self._recovery_result(self.pending_recovery, False, "recovery_timeout"))
            self.pending_recovery = None
        return messages

    @locked
    def process_incoming(self, data):
        self.packet_buffer.extend(data)
        messages = []

        while self.packet_buffer:
            start = next(
                (index for index, value in enumerate(self.packet_buffer) if value in self.MARKERS),
                None,
            )
            if start is None:
                self.packet_buffer.clear()
                break
            if start:
                del self.packet_buffer[:start]

            marker = self.packet_buffer[0]
            if marker == 0xFE:
                if len(self.packet_buffer) < 2:
                    break
                frame_length = self.packet_buffer[1] + 1
                if not 3 <= frame_length <= 65:
                    self.packet_buffer.clear()
                elif len(self.packet_buffer) < frame_length:
                    break
                else:
                    del self.packet_buffer[:frame_length]
                logger.warning("Unsupported FE-framed 3400 response; not translated as TLV success")
                messages.append({"type": "cash_board_info", "version": None, "versionVerified": False,
                                 "responseFields": {}, "protocol": "unsupported-fe"})
                continue
            if marker in (0x11, 0x44, 0xEE):
                del self.packet_buffer[0]
                continue
            if len(self.packet_buffer) < 2:
                break

            length = self.packet_buffer[1]
            if length < 2 or length > 64:
                del self.packet_buffer[0]
                continue
            frame_length = length + 3
            if len(self.packet_buffer) < frame_length:
                break

            frame = bytes(self.packet_buffer[:frame_length])
            del self.packet_buffer[:frame_length]
            checksum = 0
            for value in frame[1:]:
                checksum ^= value
            if checksum:
                logger.warning("Ignoring BAC-2400 frame with invalid checksum: %s", frame.hex().upper())
                continue

            if not self.response_confirmed:
                logger.info("Cash board TLV response on %s (firmware version unverified)", self.port)
                self.response_confirmed = True

            body = frame[1:-1] if marker == 0x22 else frame[2:-1]
            tlvs = self._parse_tlvs(body)
            if tlvs is None:
                logger.warning("Ignoring malformed/duplicate cash board TLVs")
                continue
            fields = {f"0x{key:02X}": tlvs[key].hex().upper() for key in (0x14, 0x1B) if key in tlvs}
            if fields and fields != self.response_fields:
                self.response_fields = fields
                # No manufacturer version-query specification is available. Preserve bytes, do not guess a version.
                logger.info("Board response metadata (firmware not decoded): %s", fields)
                messages.append({"type": "cash_board_info", "version": None, "versionVerified": False,
                                 "responseFields": fields, "protocol": "bac2400-tlv"})
            messages.extend(self._translate_tlvs(tlvs))

        return messages

    @staticmethod
    def _parse_tlvs(body):
        tlvs = {}
        index = 0
        while index < len(body):
            count = body[index]
            end = index + count + 1
            if count < 1 or end > len(body) or body[index + 1] in tlvs:
                return None
            tlvs[body[index + 1]] = bytes(body[index + 2:end])
            index = end
        return tlvs

    def _translate_tlvs(self, tlvs):
        messages = self.expire_operations()
        self.payout_in_progress  # Expire before a late reply can send/complete a payout.
        validator = tlvs.get(0x1B)
        valid_validator = validator is not None and len(validator) == 3 and not validator[0] & ~0x0F
        counts = tlvs.get(0x18)
        valid_counts = counts is not None and len(counts) == 4
        control = self.pending_acceptor_control
        cleared = control and control["clear"] and valid_counts and not any(counts) and valid_validator
        if cleared:
            self.last_bill_counts = [0] * 4
            self.unsupported_bill_detected = False
        if valid_counts and valid_validator:
            current_counts = list(counts)
            if self.last_bill_counts is None:
                self.last_bill_counts = current_counts
            else:
                # A decrease without a confirmed clear is an unknown reset/wrap, never new money.
                decreased = any(current < previous for current, previous in zip(current_counts, self.last_bill_counts))
                deltas = [max(0, current - previous) for current, previous in zip(current_counts, self.last_bill_counts)]
                self.last_bill_counts = current_counts
                unsupported = [
                    self.BILL_AMOUNTS[index]
                    for index, delta in enumerate(deltas)
                    if index not in self.ACCEPTED_BILLS and delta
                ]
                if unsupported or decreased:
                    logger.critical("BV1 unsupported denomination/counter discontinuity: %s", unsupported)
                    self.unsupported_bill_detected = True
                    self.acceptor_status = 0x0C
                    self.control_acceptor(False)
                    messages.append({"type": "acceptor_event", "event": 0x0C})
                else:
                    for index, bill_code in self.ACCEPTED_BILLS.items():
                        self.bill_codes.extend([bill_code] * deltas[index])
                    if self.bill_codes:
                        self.acceptor_status = 0x0B
                        messages.append({"type": "acceptor_event", "event": 0x0B})

        if validator is not None:
            flags = validator[0] if validator else 0
            if not valid_validator or self.unsupported_bill_detected:
                self.acceptor_enabled = False
                self.acceptor_status = 0x0C
            else:
                self.acceptor_enabled = bool(flags & 0x01)
                if self.bill_codes:
                    self.acceptor_status = 0x0B
                elif flags & 0x04:
                    self.acceptor_status = 0x0C
                elif flags & 0x0A:
                    self.acceptor_status = 0x04  # Processing; never advertise legacy START_WAIT readiness.
                else:
                    self.acceptor_status = 0x01

        if control and valid_validator:
            matches = validator[0] == int(control["enabled"]) and (not control["clear"] or cleared)
            if matches:
                messages.append(self._legacy_message("acceptor", 0x4F, 0x4B, 0))
                self.pending_acceptor_control = None
        elif control and validator is not None:
            messages.append(self._acceptor_ng("invalid_validator"))
            self.pending_acceptor_control = None

        payout_counts = tlvs.get(0x15)
        if payout_counts is not None and len(payout_counts) == 4:
            self.last_payout_counts = list(payout_counts)
        else:
            payout_counts = None
        statuses = tlvs.get(0x16)
        if statuses is not None and len(statuses) == 4 and not statuses[self.BD1] & ~0x07:
            self.dispenser_statuses = list(statuses)
        else:
            statuses = None
        running = tlvs.get(0x17)
        if running is not None and len(running) == 1 and running[0] in (0, 1):
            self.dispenser_running = bool(running[0])
        else:
            running = None
        complete_dispenser = payout_counts is not None and statuses is not None and running is not None
        dispenser_idle = complete_dispenser and statuses[self.BD1] == 0 and running[0] == 0

        operation = self.pending_recovery
        if operation:
            acceptor_idle = valid_validator and valid_counts and validator[0] in (0, 1) and \
                not self.bill_codes and not self.unsupported_bill_detected
            relevant = 0x1B in tlvs if operation["target"] == "acceptor" else any(key in tlvs for key in (0x15, 0x16, 0x17))
            idle = acceptor_idle if operation["target"] == "acceptor" else dispenser_idle
            if relevant and not idle:
                source = "adapter"
                if operation["target"] == "acceptor":
                    reason = "queued_bills" if self.bill_codes else "unsupported_bill_latched" if self.unsupported_bill_detected else \
                        "invalid_validator" if not valid_validator or not valid_counts else "acceptor_board_error" if validator[0] & 4 else "acceptor_processing"
                    if reason in ("acceptor_board_error", "acceptor_processing"): source = "board_status"
                else:
                    reason = "incomplete_dispenser_status" if not complete_dispenser else \
                        "dispenser_board_error" if statuses[self.BD1] else "dispenser_running"
                    if complete_dispenser: source = "board_status"
                messages.append(self._recovery_result(operation, False, reason, source))
                self.pending_recovery = None
            elif relevant and operation.get("yield"):
                messages.append(self._recovery_result(operation, False, "recovery_yielded"))
                self.pending_recovery = None
            elif idle and operation["phase"] == "checking":
                # No acceptance enable, input-counter clear, payout or return in unattended recovery.
                success = self.control_acceptor(False) if operation["target"] == "acceptor" else self.reset_dispenser()
                if success:
                    operation["phase"] = "verifying"
                    # Let the server handle a queued yield before the next serial command.
                    operation["queryNeeded"] = True
                if not success:
                    messages.append(self._recovery_result(operation, False, "send_failed"))
                    self.pending_recovery = None
            elif idle and operation["phase"] == "verifying":
                verified = validator[0] == 0 if operation["target"] == "acceptor" else payout_counts[self.BD1] == 0
                messages.append(self._recovery_result(operation, verified, None if verified else "verification_failed", "board_status"))
                self.pending_recovery = None

        if self.pending_payout and complete_dispenser:
            count = self.pending_payout["count"]
            bd1_status = self.dispenser_statuses[self.BD1]
            if bd1_status & 0x07:
                logger.error("BD1 cannot dispense (status 0x%02X)", bd1_status)
                self.payout_uncertain |= self.pending_payout["phase"] == "dispensing"
                self.pending_payout = None
            elif self.pending_payout["phase"] == "checking" and dispenser_idle:
                command = self._command(0x73, 0x8C, [0x05, 0x00, 0, 0, count, 0])
                if self.send(command):
                    self.pending_payout["phase"] = "dispensing"
                    self.pending_payout["previous_count"] = self.last_payout_counts[self.BD1]
                    self.pending_payout["progress_observed"] = False
                    self.pending_payout["zero_observed"] = self.last_payout_counts[self.BD1] == 0
                else:
                    self.payout_uncertain = True  # A partial serial write might have reached the board.
                    self.pending_payout = None
            elif self.pending_payout["phase"] == "dispensing":
                # A cached total (or a status-only reply) is not evidence of this payout.
                if self.dispenser_running or (payout_counts and self.last_payout_counts[self.BD1] != self.pending_payout["previous_count"]):
                    self.pending_payout["progress_observed"] = True
                if self.last_payout_counts[self.BD1] == 0:
                    self.pending_payout["zero_observed"] = True
                if dispenser_idle and self.pending_payout["zero_observed"] and self.pending_payout["progress_observed"] and self.last_payout_counts[self.BD1] == count:
                    messages.append(self._legacy_message("dispenser", 0x64, count, 0x53))
                    self.pending_payout = None

        if self.pending_acceptor_connection and valid_validator and valid_counts:
            messages.append(self._legacy_message("acceptor", 0x6D, 0x65, 0))
            self.pending_acceptor_connection = False
        if self.pending_acceptor_status and validator is not None:
            messages.append(self._legacy_message("acceptor", 0x67, 0x61, self.acceptor_status))
            self.pending_acceptor_status = False
        if self.pending_dispenser_connection and complete_dispenser:
            messages.append(self._legacy_message("dispenser", 0x6D, 0x65, 0))
            self.pending_dispenser_connection = False
        if self.pending_dispenser_status and complete_dispenser:
            bd1_status = self.dispenser_statuses[self.BD1]
            state = 0x65 if bd1_status & 0x07 or self.payout_uncertain else 0x6F if self.dispenser_running or self.pending_payout else 0x62
            messages.append(self._legacy_message("dispenser", 0x73, 0x74, state))
            self.pending_dispenser_status = False

        return messages
