import os
import time
from collections import deque

from serial_manager import SerialDevice


class Board3400(SerialDevice):
    """Property4 Multi3400 v1.5 board adapter."""

    BILL_CODES = (None, None, 0x01, 0x05, 0x0A, 0x32)
    PAYOUT_CHANNELS = {"HP1": 0, "HP2": 1, "BD1": 2, "BD2": 3, "BD3": 4}
    PAYOUT_RESET_MASKS = (0x01, 0x01, 0x02, 0x04, 0x08)

    def __init__(self, port):
        super().__init__("Multi3400", port, 9600)
        self.acceptor_bit = 0x02 if os.environ.get("BOARD3400_ACCEPTOR_CHANNEL", "BV1").upper() == "BV2" else 0x01
        channel = os.environ.get("BOARD3400_BILL_CHANNEL", "BD1").upper()
        self.payout_channel = self.PAYOUT_CHANNELS.get(channel, self.PAYOUT_CHANNELS["BD1"])
        self.acceptor_enabled = False
        self.acceptor_status = 0x01
        self.bill_codes = deque()
        self.last_input_counts = [0] * 6
        self.pending_acceptor_status = False
        self.pending_connection_check = False
        self.pending_dispenser_connection = False
        self.pending_dispenser_status = False
        self.pending_payout = None

    @staticmethod
    def _packet(command, payload=None):
        packet = bytearray(14)
        packet[0] = 0xFE
        packet[1] = 13
        packet[2] = command
        if payload:
            packet[3:3 + min(len(payload), 10)] = payload[:10]
        checksum = 0
        for value in packet[:-1]:
            checksum ^= value
        packet[-1] = checksum
        return bytes(packet)

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

    def control(self, enabled=None, clear_input=False, clear_output=False, reset_payout=False):
        if enabled is not None:
            self.acceptor_enabled = enabled
        control1 = self.acceptor_bit if self.acceptor_enabled else 0
        if clear_input:
            control1 |= 0x08
            self.last_input_counts = [0] * 6
        if clear_output:
            control1 |= 0x10
        control2 = self.PAYOUT_RESET_MASKS[self.payout_channel] if reset_payout else 0
        return self.send(self._packet(0x10, bytes([control1, control2])))

    def query_status(self):
        return self.send(self._packet(0x11))

    def dispense(self, count):
        if count < 1 or count > 250:
            return False
        self.pending_payout = {
            "count": count,
            "started": time.monotonic(),
            "phase": "clearing",
        }
        if self.control(clear_output=True):
            return True
        self.pending_payout = None
        return False

    @property
    def payout_in_progress(self):
        if not self.pending_payout:
            return False
        if time.monotonic() - self.pending_payout["started"] > 12:
            self.pending_payout = None
            return False
        return True

    def handle_acceptor_command(self, packet):
        if len(packet) < 4 or packet[0] != 0x24:
            return []
        command1, command2, data = packet[1:4]

        if (command1, command2) == (0x48, 0x69):
            self.pending_connection_check = self.query_status()
            return []
        if (command1, command2) == (0x47, 0x41):
            self.pending_acceptor_status = self.query_status()
            return []
        if (command1, command2) == (0x47, 0x42):
            bill_code = self.bill_codes.popleft() if self.bill_codes else 0
            self.acceptor_status = 0x0B if self.bill_codes else 0x01
            return [self._legacy_message("acceptor", 0x67, 0x62, bill_code)]

        success = False
        if (command1, command2, data) == (0x53, 0x41, 0x0D):
            success = self.control(enabled=True, clear_input=not self.bill_codes)
        elif (command1, command2, data) == (0x53, 0x41, 0x0E):
            success = self.control(enabled=False)
        elif (command1, command2) == (0x53, 0x43):
            success = self.control(enabled=data != 0x1C, clear_input=data != 0x1C)
        elif (command1, command2) == (0x52, 0x53):
            self.bill_codes.clear()
            self.acceptor_status = 0x01
            success = self.control(enabled=False, clear_input=True)
        elif (command1, command2) == (0x53, 0x41):
            success = True  # Multi3400 stacks accepted notes automatically.

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
            self.pending_dispenser_connection = self.query_status()
            return []
        if (command1, command2) in ((0x53, 0x74), (0x73, 0x74)):
            self.pending_dispenser_status = self.query_status()
            return []
        if command1 in (0x49, 0x69):
            if self.control(reset_payout=True):
                return [self._legacy_message("dispenser", command1 ^ 0x20, 0, 0)]
            return []
        if command1 in (0x48, 0x68):
            if self.query_status():
                return [self._legacy_message("dispenser", command1 ^ 0x20, command2 ^ 0x20, data)]
        return []

    def process_incoming(self, data):
        if not hasattr(self, "packet_buffer"):
            self.packet_buffer = bytearray()
        self.packet_buffer.extend(data)
        messages = []

        while len(self.packet_buffer) >= 19:
            try:
                start = self.packet_buffer.index(0xFE)
            except ValueError:
                self.packet_buffer.clear()
                break
            if start:
                del self.packet_buffer[:start]
            if len(self.packet_buffer) < 19:
                break
            if self.packet_buffer[1] != 18:
                del self.packet_buffer[0]
                continue

            packet = bytes(self.packet_buffer[:19])
            del self.packet_buffer[:19]
            checksum = 0
            for value in packet[:-1]:
                checksum ^= value
            if checksum != packet[-1] or packet[17] not in (0x13, 0x15):
                self.send(bytes([0xEE]))
                continue
            messages.extend(self._translate_status(packet))

        return messages

    def _translate_status(self, packet):
        messages = []
        if packet[2] != 0x13:
            return messages

        status1, status2 = packet[3], packet[4]
        input_counts = list(packet[5:11])
        new_bill = False
        for index, (current, previous) in enumerate(zip(input_counts, self.last_input_counts)):
            bill_code = self.BILL_CODES[index]
            if bill_code and current > previous:
                self.bill_codes.extend([bill_code] * (current - previous))
                new_bill = True
        self.last_input_counts = input_counts

        acceptor_error = bool(status1 & (0x20 if self.acceptor_bit == 0x02 else 0x10))
        acceptor_busy = bool(status2 & (0x80 if self.acceptor_bit == 0x02 else 0x40))
        self.acceptor_status = 0x0B if self.bill_codes else 0x0C if acceptor_error else 0x02 if acceptor_busy else 0x01

        if new_bill:
            messages.append({"type": "acceptor_event", "event": 0x0B})
        if self.pending_connection_check:
            messages.append(self._legacy_message("acceptor", 0x6D, 0x65, packet[17]))
            self.pending_connection_check = False
        if self.pending_acceptor_status:
            messages.append(self._legacy_message("acceptor", 0x67, 0x61, self.acceptor_status))
            self.pending_acceptor_status = False
        if self.pending_dispenser_connection:
            messages.append(self._legacy_message("dispenser", 0x6D, 0x65, packet[17]))
            self.pending_dispenser_connection = False

        payout_counts = packet[11:16]
        if self.pending_payout:
            count = self.pending_payout["count"]
            if self.pending_payout["phase"] == "clearing":
                payload = bytearray(10)
                payload[self.payout_channel] = count
                if self.send(self._packet(0x12, payload)):
                    self.pending_payout["phase"] = "dispensing"
                else:
                    self.pending_payout = None
            elif payout_counts[self.payout_channel] >= count:
                messages.append(self._legacy_message("dispenser", 0x64, count, 0x53))
                self.pending_payout = None

        if self.pending_dispenser_status:
            error_masks = ((0x40, 0), (0x80, 0), (0, 0x11), (0, 0x22), (0, 0x0C))
            mask1, mask2 = error_masks[self.payout_channel]
            has_error = bool(status1 & mask1 or status2 & mask2)
            state = 0x65 if has_error else 0x6F if self.pending_payout else 0x62
            messages.append(self._legacy_message("dispenser", 0x73, 0x74, state))
            self.pending_dispenser_status = False

        return messages
