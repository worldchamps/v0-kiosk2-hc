import logging
import threading
import time

import serial

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger("SerialManager")


class SerialDevice:
    def __init__(self, name, port, baudrate=9600, timeout=1, parity=serial.PARITY_NONE):
        self.name = name
        self.port = port
        self.baudrate = baudrate
        self.timeout = timeout
        self.parity = parity
        self.ser = None
        self.running = False
        self.thread = None
        self.callback = None

    def connect(self):
        try:
            self.ser = serial.Serial(
                self.port,
                self.baudrate,
                timeout=self.timeout,
                write_timeout=self.timeout,
                parity=self.parity,
            )
            logger.info(
                f"[{self.name}] Connected to {self.port} at {self.baudrate} (parity={self.parity})"
            )
            return True
        except Exception as exc:
            logger.error(
                f"[{self.name}] Failed to connect to {self.port}: {exc}"
            )
            return False

    def start(self, callback):
        self.callback = callback
        self.running = True
        self.thread = threading.Thread(target=self._run, daemon=True)
        self.thread.start()

    def _run(self):
        while self.running:
            if self.ser and self.ser.is_open:
                try:
                    if self.ser.in_waiting > 0:
                        data = self.ser.read(self.ser.in_waiting)
                        logger.info(
                            f"[{self.name}] Received: {data.hex().upper()}"
                        )
                        if self.callback:
                            self.callback(data)
                except Exception as exc:
                    logger.error(f"[{self.name}] Read error: {exc}")
                    self.ser.close()
            else:
                logger.info(f"[{self.name}] Attempting to reconnect...")
                if self.connect():
                    time.sleep(1)
                else:
                    time.sleep(5)
            time.sleep(0.01)

    def send(self, data):
        if self.ser and self.ser.is_open:
            try:
                if self.ser.write(data) != len(data):
                    logger.error(f"[{self.name}] Incomplete serial write")
                    return False
                logger.info(f"[{self.name}] Sent: {data.hex().upper()}")
                return True
            except Exception as exc:
                logger.error(f"[{self.name}] Write error: {exc}")
                return False
        return False

    def stop(self):
        self.running = False
        if self.ser:
            self.ser.close()
        if self.thread:
            self.thread.join()
