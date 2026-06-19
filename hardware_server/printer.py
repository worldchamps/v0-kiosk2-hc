import logging
import threading
import time

import serial

logger = logging.getLogger("BixolonPrinter")


class BixolonPrinter:
    def __init__(self, port, baud_rate=9600):
        self.port = port
        self.baud_rate = baud_rate
        self.serial = None
        self.is_connected = False
        self.lock = threading.Lock()

    def connect(self):
        try:
            if self.serial and self.serial.is_open:
                return True

            self.serial = serial.Serial(
                port=self.port,
                baudrate=self.baud_rate,
                parity=serial.PARITY_NONE,
                stopbits=serial.STOPBITS_ONE,
                bytesize=serial.EIGHTBITS,
                timeout=1,
            )
            self.is_connected = True
            logger.info(f"Printer connected on {self.port}")
            return True
        except Exception as exc:
            logger.error(f"Failed to connect to printer on {self.port}: {exc}")
            self.is_connected = False
            return False

    def disconnect(self):
        if self.serial and self.serial.is_open:
            self.serial.close()
            self.is_connected = False
            logger.info("Printer disconnected")

    def print_text(self, text):
        if not self.is_connected and not self.connect():
            return False

        try:
            with self.lock:
                prefix = b"\x1b\x74\x00"
                encoded_text = prefix + text.encode("ascii", errors="replace")
                self.serial.write(encoded_text)
                return True
        except Exception as exc:
            logger.error(f"Print error: {exc}")
            self.is_connected = False
            return False

    def send_command(self, command_bytes):
        if not self.is_connected and not self.connect():
            return False

        try:
            with self.lock:
                self.serial.write(command_bytes)
                return True
        except Exception as exc:
            logger.error(f"Command error: {exc}")
            self.is_connected = False
            return False

    def cut_paper(self):
        return self.send_command(bytes([0x1D, 0x56, 0x42, 0x00]))

    def initialize(self):
        return self.send_command(
            bytes([0x1B, 0x40, 0x1B, 0x52, 0x0D, 0x1C, 0x26])
        )

    def check_status(self):
        if not self.is_connected:
            return False

        try:
            with self.lock:
                self.serial.write(bytes([0x10, 0x04, 0x04]))
                time.sleep(0.1)
                if self.serial.in_waiting > 0:
                    self.serial.read(1)
                    return True
        except Exception:
            return False
        return True
