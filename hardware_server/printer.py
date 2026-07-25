import ctypes
import logging
import os
import struct
import threading
from pathlib import Path


logger = logging.getLogger("BixolonPrinter")


class BixolonPrinter:
    """BIXOLON Windows POS SDK-backed printer connection."""

    INTERFACE_SERIAL = 0
    DATA_BITS_8 = 8
    PARITY_NONE = 0
    STOP_BITS_ONE = 0
    FLOW_CONTROL_NONE = 0

    ALIGNMENT_LEFT = 0
    FONT_DEFAULT = 0
    TEXT_SIZE_NORMAL = 0
    CODE_PAGE_KS5601 = 949

    def __init__(self, port, baud_rate=115200, sdk_dll_path=None):
        self.port = port
        self.baud_rate = baud_rate
        self.sdk_dll_path = sdk_dll_path
        self.sdk = None
        self.dll_directory = None
        self.is_connected = False
        self.lock = threading.Lock()

    def _find_sdk_dll(self):
        dll_name = "BXLPAPI_x64.dll" if struct.calcsize("P") == 8 else "BXLPAPI.dll"
        candidates = []

        configured_path = self.sdk_dll_path or os.environ.get("BIXOLON_SDK_DLL")
        if configured_path:
            candidates.append(Path(configured_path))

        module_dir = Path(__file__).resolve().parent
        candidates.extend(
            [
                module_dir / "bin" / dll_name,
                module_dir.parent.parent / "hardware_server" / "bin" / dll_name,
            ]
        )

        for candidate in candidates:
            if candidate.is_file():
                return candidate

        searched = ", ".join(str(path) for path in candidates)
        raise FileNotFoundError(f"{dll_name} not found. Searched: {searched}")

    def _load_sdk(self):
        if self.sdk is not None:
            return

        if os.name != "nt":
            raise OSError("BIXOLON Windows POS SDK is only available on Windows")

        dll_path = self._find_sdk_dll()
        if hasattr(os, "add_dll_directory"):
            self.dll_directory = os.add_dll_directory(str(dll_path.parent))

        sdk = ctypes.WinDLL(str(dll_path))
        int32 = ctypes.c_int32

        sdk.PrinterOpen.argtypes = [
            int32,
            ctypes.c_char_p,
            int32,
            int32,
            int32,
            int32,
            int32,
        ]
        sdk.PrinterOpen.restype = int32

        sdk.PrinterClose.argtypes = []
        sdk.PrinterClose.restype = int32

        sdk.InitializePrinter.argtypes = []
        sdk.InitializePrinter.restype = int32

        sdk.PrintTextW.argtypes = [
            ctypes.c_wchar_p,
            int32,
            int32,
            int32,
            int32,
        ]
        sdk.PrintTextW.restype = int32

        sdk.WriteBuff.argtypes = [
            ctypes.POINTER(ctypes.c_ubyte),
            int32,
            ctypes.POINTER(int32),
        ]
        sdk.WriteBuff.restype = int32

        sdk.CutPaper.argtypes = []
        sdk.CutPaper.restype = int32

        sdk.GetPrinterCurrentStatus.argtypes = []
        sdk.GetPrinterCurrentStatus.restype = int32

        self.sdk = sdk
        logger.info("Loaded BIXOLON Windows POS SDK: %s", dll_path)

    def connect(self):
        if self.is_connected:
            return True

        try:
            self._load_sdk()
            with self.lock:
                result = self.sdk.PrinterOpen(
                    self.INTERFACE_SERIAL,
                    self.port.encode("ascii"),
                    self.baud_rate,
                    self.DATA_BITS_8,
                    self.PARITY_NONE,
                    self.STOP_BITS_ONE,
                    self.FLOW_CONTROL_NONE,
                )
                if result != 0:
                    logger.error(
                        "BIXOLON PrinterOpen failed on %s (SDK result: %s)",
                        self.port,
                        result,
                    )
                    return False

                init_result = self.sdk.InitializePrinter()
                if init_result != 0:
                    logger.error(
                        "BIXOLON InitializePrinter failed (SDK result: %s)",
                        init_result,
                    )
                    self.sdk.PrinterClose()
                    return False

                self.is_connected = True
                logger.info(
                    "BIXOLON printer connected on %s at %s baud",
                    self.port,
                    self.baud_rate,
                )
                return True
        except Exception as exc:
            logger.exception("Failed to connect to BIXOLON printer: %s", exc)
            self.is_connected = False
            return False

    def disconnect(self):
        if self.sdk is None or not self.is_connected:
            return

        with self.lock:
            result = self.sdk.PrinterClose()
            self.is_connected = False
            if result == 0:
                logger.info("BIXOLON printer disconnected")
            else:
                logger.error("BIXOLON PrinterClose failed (SDK result: %s)", result)

    def print_text(self, text):
        if not self.is_connected and not self.connect():
            return False

        try:
            with self.lock:
                result = self.sdk.PrintTextW(
                    str(text),
                    self.ALIGNMENT_LEFT,
                    self.FONT_DEFAULT,
                    self.TEXT_SIZE_NORMAL,
                    self.CODE_PAGE_KS5601,
                )
            if result != 0:
                logger.error("BIXOLON PrintTextW failed (SDK result: %s)", result)
                return False
            return True
        except Exception as exc:
            logger.exception("BIXOLON PrintTextW error: %s", exc)
            return False

    def send_command(self, command_bytes):
        if not self.is_connected and not self.connect():
            return False

        data = bytes(command_bytes)
        if not data:
            return True

        try:
            buffer = (ctypes.c_ubyte * len(data)).from_buffer_copy(data)
            written = ctypes.c_int32(0)
            with self.lock:
                result = self.sdk.WriteBuff(buffer, len(data), ctypes.byref(written))
            if result != 0 or written.value != len(data):
                logger.error(
                    "BIXOLON WriteBuff failed (SDK result: %s, written: %s/%s)",
                    result,
                    written.value,
                    len(data),
                )
                return False
            return True
        except Exception as exc:
            logger.exception("BIXOLON WriteBuff error: %s", exc)
            return False

    def cut_paper(self):
        if not self.is_connected and not self.connect():
            return False

        try:
            with self.lock:
                result = self.sdk.CutPaper()
            if result != 0:
                logger.error("BIXOLON CutPaper failed (SDK result: %s)", result)
                return False
            return True
        except Exception as exc:
            logger.exception("BIXOLON CutPaper error: %s", exc)
            return False

    def initialize(self):
        if not self.is_connected and not self.connect():
            return False

        with self.lock:
            result = self.sdk.InitializePrinter()
        if result != 0:
            logger.error("BIXOLON InitializePrinter failed (SDK result: %s)", result)
            return False
        return True

    def check_status(self):
        if not self.is_connected and not self.connect():
            return False

        try:
            with self.lock:
                status = self.sdk.GetPrinterCurrentStatus()
            if status < 0:
                logger.error(
                    "BIXOLON GetPrinterCurrentStatus failed (SDK result: %s)",
                    status,
                )
                return False
            return True
        except Exception as exc:
            logger.exception("BIXOLON status check error: %s", exc)
            return False
