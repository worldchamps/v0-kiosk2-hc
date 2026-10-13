import logging
import time
from collections import deque

import serial

from serial_manager import SerialDevice


logger = logging.getLogger("BAC2400")


class Bac2400(SerialDevice):
    """Property4 BAC-2400 v1.3 adapter for BV1 and BD1."""

    BILL_AMOUNTS = (1000, 5000, 10000, 50000)
    ACCEPTED_BILLS = {2: 0x0A, 3: 0x32}
    BD1 = 2
    MARKERS = (0x11, 0x22, 0x33, 0x44, 0xEE)

    def __init__(self, port):
        super().__init__("BAC2400", port, 9600, parity=serial.PARITY_EVEN)
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

    def control_acceptor(self, enabled, clear=False):
        self.acceptor_enabled = enabled
        flags = (0x01 if enabled else 0) | (0x02 if clear else 0)
        if clear:
            self.bill_codes.clear()
            self.last_bill_counts = [0] * 4
            self.acceptor_status = 0x01
            self.unsupported_bill_detected = False
        return self.send(self._command(0x5B, 0xA4, [0x03, 0x10, flags, 0]))

    def query_acceptor(self):
        return self.send(bytes([0x59, 0xA6]))

    def query_dispenser(self):
        return self.send(bytes([0x71, 0x8E]))

    def reset_dispenser(self):
        return self.send(self._command(0x73, 0x8C, [0x05, 0x01, 0, 0, 1, 0]))

    def dispense(self, count):
        if type(count) is not int or count < 1 or count > 250 or self.pending_payout or self.dispenser_running:
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
    def payout_in_progress(self):
        if not self.pending_payout:
            return False
        if time.monotonic() - self.pending_payout["started"] > 12:
            logger.error("BD1 payout timed out")
            self.pending_payout = None
            return False
        return True

    def handle_acceptor_command(self, packet):
        if len(packet) < 4 or packet[0] != 0x24:
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

        success = False
        if (command1, command2, data) == (0x53, 0x41, 0x0D):
            success = self.control_acceptor(True, clear=not self.bill_codes)
        elif (command1, command2, data) == (0x53, 0x41, 0x0E):
            success = self.control_acceptor(False)
        elif (command1, command2) == (0x53, 0x43):
            success = self.control_acceptor(data != 0x1C, clear=data != 0x1C)
        elif (command1, command2) == (0x52, 0x53):
            success = self.control_acceptor(False, clear=True)
        elif (command1, command2) == (0x53, 0x41):
            success = True  # BAC-2400 stacks accepted notes automatically.

        if success:
            return [self._legacy_message("acceptor", 0x4F, 0x4B, 0)]
        return []

    def handle_dispenser_command(self, packet):
        if len(packet) < 4 or packet[0] != 0x24:
            return []
        command1, command2, data = packet[1:4]

        if command1 in (0x44, 0x64):
            self.dispense(command2)
            return []
        if (command1, command2) in ((0x48, 0x49), (0x68, 0x69)):
            self.pending_dispenser_connection = self.query_dispenser()
            return []
        if (command1, command2) in ((0x53, 0x74), (0x73, 0x74)):
            self.pending_dispenser_status = self.query_dispenser()
            return []
        if command1 in (0x49, 0x69):
            if self.reset_dispenser():
                return [self._legacy_message("dispenser", command1 ^ 0x20, 0, 0)]
            return []
        if command1 in (0x48, 0x68):
            if self.query_dispenser():
                return [self._legacy_message("dispenser", command1 ^ 0x20, command2 ^ 0x20, data)]
        return []

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
                logger.info("BAC-2400 V1.3 response confirmed on %s", self.port)
                self.response_confirmed = True

            body = frame[1:-1] if marker == 0x22 else frame[2:-1]
            messages.extend(self._translate_tlvs(self._parse_tlvs(body)))

        return messages

    @staticmethod
    def _parse_tlvs(body):
        tlvs = {}
        index = 0
        while index < len(body):
            count = body[index]
            end = index + count + 1
            if count < 1 or end > len(body):
                break
            tlvs[body[index + 1]] = bytes(body[index + 2:end])
            index = end
        return tlvs

    def _translate_tlvs(self, tlvs):
        messages = []
        has_acceptor_data = 0x18 in tlvs or 0x1B in tlvs
        has_dispenser_data = any(key in tlvs for key in (0x14, 0x15, 0x16, 0x17))

        counts = tlvs.get(0x18)
        if counts and len(counts) >= 4:
            current_counts = list(counts[:4])
            if self.last_bill_counts is None:
                self.last_bill_counts = current_counts
            else:
                deltas = [max(0, current - previous) for current, previous in zip(current_counts, self.last_bill_counts)]
                self.last_bill_counts = current_counts
                unsupported = [
                    self.BILL_AMOUNTS[index]
                    for index, delta in enumerate(deltas)
                    if index not in self.ACCEPTED_BILLS and delta
                ]
                if unsupported:
                    logger.critical("BV1 accepted unsupported denomination(s): %s", unsupported)
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

        validator = tlvs.get(0x1B)
        if validator:
            flags = validator[0]
            if self.unsupported_bill_detected:
                self.acceptor_enabled = False
                self.acceptor_status = 0x0C
            else:
                self.acceptor_enabled = bool(flags & 0x01)
                if self.bill_codes:
                    self.acceptor_status = 0x0B
                elif flags & 0x04:
                    self.acceptor_status = 0x0C
                elif flags & 0x02:
                    self.acceptor_status = 0x02
                else:
                    self.acceptor_status = 0x01

        payout_counts = tlvs.get(0x15)
        if payout_counts and len(payout_counts) >= 4:
            self.last_payout_counts = list(payout_counts[:4])
        else:
            payout_counts = None
        statuses = tlvs.get(0x16)
        if statuses and len(statuses) >= 4:
            self.dispenser_statuses = list(statuses[:4])
        else:
            statuses = None
        running = tlvs.get(0x17)
        if running:
            self.dispenser_running = bool(running[0] & 0x01)

        if self.pending_payout and has_dispenser_data:
            count = self.pending_payout["count"]
            bd1_status = self.dispenser_statuses[self.BD1]
            if bd1_status & 0x07:
                logger.error("BD1 cannot dispense (status 0x%02X)", bd1_status)
                self.pending_payout = None
            elif self.pending_payout["phase"] == "checking" and payout_counts and statuses and running and not self.dispenser_running:
                command = self._command(0x73, 0x8C, [0x05, 0x00, 0, 0, count, 0])
                if self.send(command):
                    self.pending_payout["phase"] = "dispensing"
                    self.pending_payout["started"] = time.monotonic()
                    self.pending_payout["previous_count"] = self.last_payout_counts[self.BD1]
                    self.pending_payout["progress_observed"] = False
                else:
                    self.pending_payout = None
            elif self.pending_payout["phase"] == "dispensing":
                # A cached total (or a status-only reply) is not evidence of this payout.
                if self.dispenser_running or (payout_counts and self.last_payout_counts[self.BD1] != self.pending_payout["previous_count"]):
                    self.pending_payout["progress_observed"] = True
                if payout_counts and running and not self.dispenser_running and self.pending_payout["progress_observed"] and self.last_payout_counts[self.BD1] == count:
                    messages.append(self._legacy_message("dispenser", 0x64, count, 0x53))
                    self.pending_payout = None

        if self.pending_acceptor_connection and has_acceptor_data:
            messages.append(self._legacy_message("acceptor", 0x6D, 0x65, 0x13))
            self.pending_acceptor_connection = False
        if self.pending_acceptor_status and has_acceptor_data:
            messages.append(self._legacy_message("acceptor", 0x67, 0x61, self.acceptor_status))
            self.pending_acceptor_status = False
        if self.pending_dispenser_connection and has_dispenser_data:
            messages.append(self._legacy_message("dispenser", 0x6D, 0x65, 0x13))
            self.pending_dispenser_connection = False
        if self.pending_dispenser_status and has_dispenser_data:
            bd1_status = self.dispenser_statuses[self.BD1]
            state = 0x65 if bd1_status & 0x07 else 0x6F if self.dispenser_running else 0x62
            messages.append(self._legacy_message("dispenser", 0x73, 0x74, state))
            self.pending_dispenser_status = False

        return messages
