"""ONEPLUS MULTI3400 FE protocol, scoped to Beach building B (BV1/BV2/BD1)."""
import logging
import threading
import time
from collections import deque

import serial

from bac2400 import locked
from serial_manager import SerialDevice


logger = logging.getLogger("MULTI3400")


class Multi3400(SerialDevice):
    BILL_VALUES = (1000, 5000, 10000, 50000)
    BILL_CODES = (0x01, 0x05, 0x0A, 0x32)
    PAYOUT_VALUES = (1000, 5000, 10000, 50000)

    def __init__(self, port, bd1_value=5000):
        super().__init__("MULTI3400", port, 9600, parity=serial.PARITY_NONE)
        self.lock = threading.RLock()
        self.bd1_value = bd1_value
        self.packet_buffer = bytearray()
        self.bill_codes = deque()
        self.last_input_counts = None
        self.input_counts = [0] * 6
        self.payout_counts = [0] * 4
        self.status1 = self.status2 = 0
        self.counter_uncertain = False
        self.payout_uncertain = False
        self.session_active = False
        self.operation = None
        self.waiting = None
        self.quiet_until = 0
        self.failure_pending = False
        self.last_payout = None
        self.outbox = []

    @staticmethod
    def _command(command, ctrl1=0, ctrl2=0, bd1=0):
        frame = bytearray([0xFE, 13, command, ctrl1, ctrl2, bd1, 0, 0, 0, 0, 0, 0, 0])
        checksum = 0
        for value in frame:
            checksum ^= value
        return bytes(frame + bytes([checksum]))

    @staticmethod
    def _legacy(device, a, b, c):
        packet = [0x24, a, b, c, (a + b + c) & 0xFF]
        return {"type": "acceptor_raw", "packet": packet} if device == "acceptor" else \
            {"type": "dispenser_data", "data": packet}

    @staticmethod
    def _valid_packet(packet):
        return len(packet) == 5 and packet[0] == 0x24 and packet[4] == (sum(packet[1:4]) & 0xFF)

    def _acceptor_reply(self, ok):
        return self._legacy("acceptor", 0x4F if ok else 0x4E, 0x4B if ok else 0x47, 0)

    def _dispenser_reject(self):
        return self._legacy("dispenser", 0x6E, 0x73, 0x21)

    def _drain(self):
        messages, self.outbox = self.outbox, []
        return messages

    def _available(self):
        return not self.operation and not self.waiting and time.monotonic() >= self.quiet_until

    def _begin(self, kind, phase, **fields):
        self.operation = {"kind": kind, "phase": phase, "started": time.monotonic(), **fields}

    def _send(self, command, phase, **fields):
        # Every successor is sent only after the previous reply has been consumed.
        if self.waiting or time.monotonic() < self.quiet_until:
            return
        self.operation["phase"] = phase
        self.waiting = {"reply": "status" if command == 0x11 else "ack", "started": time.monotonic()}
        if not self.send(self._command(command, **fields)):
            self._quarantine()

    def _query(self, phase):
        self._send(0x11, phase)

    def _quarantine(self):
        self.packet_buffer.clear()
        if self.ser and self.ser.is_open:
            try:
                self.ser.reset_input_buffer()
            except Exception:
                logger.warning("Unable to discard serial input after failed command")
        self.waiting = None
        self.failure_pending = True
        self.quiet_until = time.monotonic() + 0.5

    def _finish(self, message=None):
        if message:
            self.outbox.append(message)
        self.operation = None

    def _recovery_result(self, operation, success):
        if operation.get("legacy"):
            return self._legacy("dispenser", 0x69, 0, 0x61) if success else self._dispenser_reject()
        return {"type": "cash_board_result", "requestId": operation["requestId"],
                "target": operation["target"], "success": success, "verified": success}

    def _finish_payout(self, success, uncertain=None):
        # Only an unknown count (timeout, jam, counter jump) is uncertain; a counted stop on empty is exact.
        uncertain = not success if uncertain is None else uncertain
        self.last_payout = {"count": self.payout_counts[2], "success": success, "uncertain": uncertain}
        self.payout_uncertain |= uncertain
        # No status reply for an unknown count: the renderer then records the change as unconfirmed.
        self._finish(None if uncertain else
                     self._legacy("dispenser", 0x73, self.last_payout["count"], 0x6F if success else 0x6E))

    def _payout_reply(self):
        if (self.operation and self.operation["kind"] == "payout") or self.status1 & 0x08:
            return self._legacy("dispenser", 0x73, 0x6F, 0x6E)
        if self.last_payout and self.last_payout["uncertain"]:
            return None
        if self.last_payout:
            return self._legacy("dispenser", 0x73, self.last_payout["count"],
                                0x6F if self.last_payout["success"] else 0x6E)
        return self._legacy("dispenser", 0x73, 0x74, 0x62)

    def _fail(self):
        operation = self.operation
        if not operation:
            return
        kind = operation["kind"]
        if kind == "payout" and operation.get("issued"):
            self._finish_payout(False)
        elif kind == "recover":
            self._finish(self._recovery_result(operation, False))
        elif kind == "startup":
            logger.critical("Connection-time cash input stop was not verified")
            self._finish()
        elif kind == "acceptor_status":
            self._finish(self._legacy("acceptor", 0x67, 0x61, 0x0C))
        elif kind.startswith("acceptor") or kind in ("enable", "stop", "reset"):
            self._finish(self._acceptor_reply(False))
        else:
            self._finish(self._dispenser_reject())

    @locked
    def connect(self):
        if not super().connect():
            return False
        # SerialDevice._run also calls this override after a dropped connection.
        self.waiting = None
        self._fail()
        self.packet_buffer.clear()
        self.failure_pending = False
        self.quiet_until = 0
        self.last_input_counts = None
        self.session_active = False
        self._begin("startup", "stop_ack")
        self._send(0x10, "stop_ack", ctrl1=0)
        return True

    def _acceptor_state(self):
        if self.bill_codes:
            return 0x0B
        if self.counter_uncertain or self.status1 & 0x30:
            return 0x0C
        return 0x04 if self.status2 & 0xC0 else 0x01

    def _input_idle(self):
        return not self.status1 & 0x30 and not self.status2 & 0xC0

    def _payout_safe(self):
        return not self.payout_uncertain and not self.counter_uncertain and not self.bill_codes and \
            not self.status1 & 0x0F and not self.status2 & 0xD1

    @locked
    def handle_acceptor_command(self, packet):
        self._expire()
        if not self._valid_packet(packet):
            return self._drain()
        a, b, c = packet[1:4]
        if (a, b, c) == (0x47, 0x42, 0x3F):
            self.outbox.append(self._legacy("acceptor", 0x67, 0x62,
                                           self.bill_codes.popleft() if self.bill_codes else 0))
            return self._drain()
        kind = {(0x48, 0x69, 0x3F): "acceptor_hello", (0x47, 0x41, 0x3F): "acceptor_status",
                (0x53, 0x41, 0x0D): "enable", (0x53, 0x43, 0x3C): "enable",
                (0x53, 0x41, 0x0E): "stop", (0x53, 0x43, 0x1C): "stop",
                (0x52, 0x53, 0x54): "reset"}.get((a, b, c))
        if not kind or not self._available() or (kind == "enable" and
                (self.payout_uncertain or self.counter_uncertain or self.bill_codes)):
            self.outbox.append(self._acceptor_reply(False))
        else:
            self._begin(kind, "checking")
            if kind in ("stop", "reset"):
                self._send(0x10, "stop_ack", ctrl1=0)
            else:
                self._query("checking")
        return self._drain()

    @locked
    def handle_dispenser_command(self, packet):
        self._expire()
        if not self._valid_packet(packet):
            return self._drain()
        a, b, c = packet[1:4]
        if (a, b, c) == (0x53, 0, 0):
            if not self._available():
                reply = self._payout_reply()
                if reply:
                    self.outbox.append(reply)
            else:
                self._begin("dispenser_status", "checking")
                self._query("checking")
        elif (a, b, c) in ((0x48, 0x49, 0x3F), (0x49, 0, 0)):
            if not self._available():
                self.outbox.append(self._dispenser_reject())
            else:
                self._begin("dispenser_hello" if a == 0x48 else "dispenser_init", "checking")
                self._query("checking")
        elif a == 0x44 and c == 0x53:
            if type(self.bd1_value) is not int or self.bd1_value not in self.PAYOUT_VALUES or \
                    not 1 <= b <= 60 or not self._available() or not self._payout_safe():
                self.outbox.append(self._dispenser_reject())
            else:
                self._begin("payout", "checking", count=b, issued=False)
                self._query("checking")
        return self._drain()

    @locked
    def recover(self, target, request_id, legacy=False):
        self._expire()
        if target not in ("acceptor", "dispenser") or not isinstance(request_id, str) or not 1 <= len(request_id) <= 80:
            return self._drain()
        operation = {"kind": "recover", "target": target, "requestId": request_id, "legacy": legacy}
        if not self._available() or self.payout_uncertain:
            self.outbox.append(self._recovery_result(operation, False))
        else:
            self._begin("recover", "checking", target=target, requestId=request_id, legacy=legacy)
            if target == "acceptor":
                if self.bill_codes:
                    amount = sum(self.BILL_VALUES[self.BILL_CODES.index(code)] for code in self.bill_codes)
                    logger.critical("PMS acceptor recovery discards queued received cash: %s won", amount)
                    self.bill_codes.clear()
                self._send(0x10, "clear_ack", ctrl1=0x08)
            else:
                self._query("checking")
        return self._drain()

    def _expire(self):
        now = time.monotonic()
        if self.failure_pending:
            if now >= self.quiet_until:
                self.failure_pending = False
                self._fail()
            return
        if self.waiting and now - self.waiting["started"] > 1.0:
            logger.error("Board response timed out; discarding input and waiting 0.5s")
            self._quarantine()
        elif self.operation and self.operation["kind"] == "recover" and now - self.operation["started"] > 6:
            self._quarantine()
        elif self.operation and self.operation["kind"] == "payout" and \
                now - self.operation["started"] > min(self.operation["count"] * 1.5 + 5, 40):
            if self.waiting:
                self._quarantine()
            else:
                self._fail()

    @locked
    def expire_operations(self):
        self._expire()
        return self._drain()

    @locked
    def poll(self):
        self._expire()
        if not self.failure_pending and not self.waiting and self.operation and \
                self.operation["kind"] == "payout" and self.operation["phase"] == "dispensing" and \
                time.monotonic() >= self.operation["next_query"]:
            self._query("dispensing")
        return self._drain()

    @locked
    def process_incoming(self, data):
        self._expire()
        if self.failure_pending or time.monotonic() < self.quiet_until:
            return self._drain()
        self.packet_buffer.extend(data)
        while self.packet_buffer and not self.failure_pending:
            marker = self.packet_buffer[0]
            if marker in (0x11, 0xEE):
                del self.packet_buffer[0]
                if self.waiting and self.waiting["reply"] == "ack":
                    self.waiting = None
                    if marker == 0xEE:
                        if self.operation["kind"] == "payout" and self.operation["phase"] == "payout_ack":
                            self._finish(self._dispenser_reject())
                        else:
                            self._fail()
                    else:
                        self._ack()
                continue
            if marker != 0xFE:
                del self.packet_buffer[0]
                continue
            if len(self.packet_buffer) < 2:
                break
            if self.packet_buffer[1] != 18:
                logger.error("Invalid MULTI3400 frame length")
                self._quarantine()
                break
            if len(self.packet_buffer) < 19:
                break
            frame = bytes(self.packet_buffer[:19])
            del self.packet_buffer[:19]
            checksum = 0
            for value in frame:
                checksum ^= value
            if checksum:
                logger.error("Invalid MULTI3400 frame XOR")
                self._quarantine()
                break
            if frame[2] != 0x13:
                logger.warning("Ignoring MULTI3400 response code 0x%02X", frame[2])
                continue
            expected = self.waiting and self.waiting["reply"] == "status"
            if expected:
                self.waiting = None
            self._update_status(frame)
            if expected and self.operation:
                self._status()
        return self._drain()

    def _update_status(self, frame):
        self.status1, self.status2 = frame[3:5]
        self.input_counts, self.payout_counts = list(frame[5:11]), list(frame[11:15])
        self.outbox.append({"type": "cash_board_info", "version": f"0x{frame[17]:02X}", "versionVerified": True,
                            "responseFields": {"0x13": frame[3:18].hex().upper()}, "protocol": "multi3400-fe"})
        cleared = self.operation and self.operation["phase"] == "clear_verify" and not any(self.input_counts)
        if self.last_input_counts is not None and not cleared:
            deltas = [max(0, new - old) for new, old in zip(self.input_counts, self.last_input_counts)]
            uncertain = any(deltas[:2]) or any(new < old for new, old in zip(self.input_counts, self.last_input_counts))
            if uncertain:
                logger.critical("Cash input counter uncertain: previous=%s current=%s", self.last_input_counts, self.input_counts)
                self.counter_uncertain = True
                self.outbox.append({"type": "acceptor_event", "event": 0x0C})
            for code, delta in zip(self.BILL_CODES, deltas[2:]):
                self.bill_codes.extend([code] * delta)
            if any(deltas[2:]):
                self.outbox.append({"type": "acceptor_event", "event": 0x0B})
        self.last_input_counts = self.input_counts[:]

    def _ack(self):
        phase = self.operation["phase"]
        if phase in ("stop_ack", "clear_ack", "enable_ack", "payout_clear_ack"):
            self._query({"stop_ack": "stop_verify", "clear_ack": "clear_verify",
                         "enable_ack": "enable_verify", "payout_clear_ack": "payout_clear_verify"}[phase])
        elif phase == "payout_ack":
            self.operation["phase"] = "dispensing"
            self.operation["next_query"] = time.monotonic() + 0.25
            self.outbox.append(self._legacy("dispenser", 0x64, self.operation["count"], 0x61))

    def _status(self):
        op = self.operation
        kind, phase = op["kind"], op["phase"]
        if kind == "startup":
            if self.status1 & 7:
                logger.critical("Cash input remains ON immediately after serial connection: 0x%02X", self.status1)
            self._finish()
        elif kind == "acceptor_hello":
            self._finish(self._legacy("acceptor", 0x6D, 0x65, 0))
        elif kind == "acceptor_status":
            self._finish(self._legacy("acceptor", 0x67, 0x61, self._acceptor_state()))
        elif kind in ("enable", "stop", "reset"):
            self._acceptor_control_status(kind, phase)
        elif kind == "dispenser_hello":
            self._finish(self._legacy("dispenser", 0x6D, 0x65, 0x21))
        elif kind == "dispenser_init":
            ready = not self.status1 & 8 and not self.status2 & 0x11
            self._finish(self._legacy("dispenser", 0x69, 0, 0x61) if ready else self._dispenser_reject())
        elif kind == "dispenser_status":
            self._finish(self._payout_reply())
        elif kind == "recover":
            if op["target"] == "acceptor":
                success = not self.status1 & 0x37 and not any(self.input_counts)
                if success:
                    self.counter_uncertain = False
                    self.session_active = False
            else:
                success = not self.status1 & 8 and not self.status2 & 0x11
            self._finish(self._recovery_result(op, success))
        elif kind == "payout":
            self._payout_status(phase)

    def _acceptor_control_status(self, kind, phase):
        if kind == "enable":
            if not self._input_idle() or self.counter_uncertain or self.bill_codes or self.payout_uncertain or self.status1 & 8:
                self._finish(self._acceptor_reply(False))
            elif phase == "checking":
                if self.session_active:
                    if self.status1 & 7 == 3:
                        self._finish(self._acceptor_reply(True))
                    else:
                        self._send(0x10, "enable_ack", ctrl1=3)
                else:
                    self._send(0x10, "clear_ack", ctrl1=8)
            elif phase == "clear_verify":
                if any(self.input_counts) or self.status1 & 7:
                    self._finish(self._acceptor_reply(False))
                else:
                    self._send(0x10, "enable_ack", ctrl1=3)
            elif phase == "enable_verify":
                success = self.status1 & 7 == 3
                self.session_active |= success
                self._finish(self._acceptor_reply(success))
        elif phase == "stop_verify":
            if self.status1 & 7 or self.status2 & 0xC0:
                self._finish(self._acceptor_reply(False))
            else:
                self.session_active = False
                if kind == "reset":
                    if self.bill_codes:
                        self._finish(self._acceptor_reply(False))
                    else:
                        self._send(0x10, "clear_ack", ctrl1=8)
                else:
                    self._finish(self._acceptor_reply(True))
        elif phase == "clear_verify":
            self._finish(self._acceptor_reply(not any(self.input_counts) and not self.status1 & 7 and self._input_idle()))

    def _payout_status(self, phase):
        op = self.operation
        if phase == "checking":
            if not self._payout_safe():
                self._finish(self._dispenser_reject())
            else:
                self._send(0x10, "payout_clear_ack", ctrl1=0x10)
        elif phase == "payout_clear_verify":
            if self.payout_counts[2] or not self._payout_safe():
                self._finish(self._dispenser_reject())
            else:
                self.last_payout = None
                op["issued"] = True  # A failed/partial write can already have moved money.
                self._send(0x12, "payout_ack", bd1=op["count"])
        elif phase == "dispensing":
            count = self.payout_counts[2]
            if self.status2 & 1 or count > op["count"] or count < op.get("observed", 0):
                self._finish_payout(False, uncertain=True)  # Jam/error or counter jump: count unknown.
            elif count == op["count"] and not self.status1 & 8:
                self._finish_payout(True)
            elif self.status2 & 0x10 and count < op["count"] and not self.status1 & 8:
                self._finish_payout(False, uncertain=False)  # Ran out: the board counted exactly `count`.
            else:
                op["observed"] = count
                op["next_query"] = time.monotonic() + 0.25
