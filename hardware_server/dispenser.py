from serial_manager import SerialDevice
import logging

logger = logging.getLogger("Dispenser")


class OnePlusDispenser(SerialDevice):
    def __init__(self, port, baudrate=9600):
        super().__init__("Dispenser", port, baudrate)

    def _build_packet(self, d1, d2, d3):
        packet = bytearray(5)
        packet[0] = ord("$")
        packet[1] = d1 if isinstance(d1, int) else ord(d1)
        packet[2] = d2 if isinstance(d2, int) else ord(d2)
        packet[3] = d3 if isinstance(d3, int) else ord(d3)
        packet[4] = (packet[1] + packet[2] + packet[3]) & 0xFF
        return packet

    def initialize(self, new_kind=False):
        cmd = "i" if new_kind else "I"
        return self.send(self._build_packet(cmd, 0, 0))

    def check_status(self, new_kind=False):
        cmd = "s" if new_kind else "S"
        return self.send(self._build_packet(cmd, 0, 0))

    def dispense(self, count, new_kind=False):
        cmd = "d" if new_kind else "D"
        return self.send(self._build_packet(cmd, count, "s" if new_kind else "S"))

    def check_inhibit(self, new_kind=False):
        cmd = "h" if new_kind else "H"
        return self.send(self._build_packet(cmd, ord("C"), ord("?")))

    def set_inhibit(self, on, new_kind=False):
        cmd = "h" if new_kind else "H"
        if on:
            packet = self._build_packet(cmd, 0, 0)
        else:
            packet = self._build_packet(cmd, ord("C"), ord("?"))
        return self.send(packet)
