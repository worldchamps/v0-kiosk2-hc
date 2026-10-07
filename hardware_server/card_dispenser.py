"""K750 RS232 adapter. Card bytes and keys must never enter serial logs.

Wire format: vendor Communication Protocol of K750, pp. 1-9.
Movement commands have no P/N reply; AP returns SF + four ASCII hex digits.
"""
from collections import deque
from functools import reduce
import re
import threading
import time

from serial_manager import SerialDevice


class CardError(Exception):
    def __init__(self, reason, sectors=None):
        super().__init__(reason)
        self.reason = reason
        self.sectors = sectors or []


def card_enabled(env):
    prop = (env.get("KIOSK_PROPERTY_ID") or env.get("KIOSK_PROPERTY") or
            env.get("NEXT_PUBLIC_KIOSK_PROPERTY_ID") or "property3").lower()
    return env.get("CARD_DISPENSER_ENABLED", "").lower() == "true" and (
        prop == "property1" or prop == "property3" and env.get("KIOSK_BUILDING") == "A")


# ponytail: one device per PC, one operation lock; add per-device locks only if hardware expands.
class CardDispenser(SerialDevice):
    # Manual p.4 mappings. Bench verification of sensor positions is required before enabling.
    MOVES = {"read": b"FC7", "present": b"FC4", "capture": b"CP",
             "insert": b"FC8", "return": b"DB", "reset": b"RS"}
    ERROR_BITS = {0x8000: "capture_full", 0x4000: "command_rejected",
                  0x0200: "issue_error", 0x0100: "capture_error",
                  0x0040: "overlap", 0x0020: "jam"}

    def __init__(self, port, address=b"00", clock=time.monotonic, sleep=time.sleep):
        # A 27-byte write takes ~28 ms at 9600 baud. Keep writes bounded above that.
        super().__init__("K750", port, baudrate=9600, timeout=0.1)
        if not re.fullmatch(b"0[0-9]|1[0-5]", address):
            raise CardError("invalid_address")
        self.address, self.clock, self.sleep = address, clock, sleep
        self.lock = threading.Lock()
        self.packet_buffer = bytearray()
        self.replies = deque()
        self.last_status = -1.0
        self.desynchronized = False

    def start(self, callback=None):
        # Read synchronously under the operation lock. SerialDevice._run logs raw bytes.
        pass

    def send(self, data):
        try:
            return bool(self.ser and self.ser.is_open and self.ser.write(data) == len(data))
        except Exception:
            return False

    def frame(self, payload):
        body = b"\x02" + self.address + len(payload).to_bytes(2, "big") + payload + b"\x03"
        return body + bytes([reduce(int.__xor__, body, 0)])

    def process_incoming(self, data):
        self.packet_buffer.extend(data)
        while self.packet_buffer:
            marker = self.packet_buffer[0]
            if marker in (6, 21):
                if len(self.packet_buffer) < 3:
                    break
                packet = bytes(self.packet_buffer[:3])
                del self.packet_buffer[:3]
                if packet[1:] == self.address:
                    self.replies.append(("ack" if marker == 6 else "nak", b""))
            elif marker == 2:
                if len(self.packet_buffer) < 5:
                    break
                length = int.from_bytes(self.packet_buffer[3:5], "big")
                if not 2 <= length <= 293:
                    self.packet_buffer.clear()
                    raise CardError("invalid_frame")
                if len(self.packet_buffer) < length + 7:
                    break
                packet = bytes(self.packet_buffer[:length + 7])
                del self.packet_buffer[:length + 7]
                if packet[1:3] != self.address:
                    continue
                if packet[-2] != 3 or reduce(int.__xor__, packet, 0):
                    raise CardError("checksum")
                self.replies.append(("frame", packet[5:-2]))
            else:
                del self.packet_buffer[0]

    def _receive(self, expected, deadline):
        while self.clock() < deadline:
            if self.replies:
                kind, payload = self.replies.popleft()
                if kind == "nak":
                    raise CardError("nak")
                if kind != expected:
                    raise CardError("unexpected_response")
                return payload
            if not self.ser or not self.ser.is_open:
                raise CardError("disconnected")
            try:
                self.process_incoming(self.ser.read(max(1, min(self.ser.in_waiting, 300))))
            except CardError:
                raise
            except Exception:
                raise CardError("disconnected") from None
            self.sleep(0.001)
        raise CardError("timeout")

    def _command(self, command, deadline, response=True):
        if self.clock() >= deadline:
            raise CardError("timeout")
        if self.desynchronized:
            raise CardError("protocol_unsynchronized")
        try:
            if not self.send(self.frame(command)):
                raise CardError("disconnected")
            self._receive("ack", min(deadline, self.clock() + 1))
            if not self.send(b"\x05" + self.address):
                raise CardError("disconnected")
            if not response:
                return b""
            payload = self._receive("frame", min(deadline, self.clock() + 2))
            if command == b"AP":
                if not re.fullmatch(b"SF[0-9A-Fa-f]{4}", payload):
                    raise CardError("invalid_status")
                return payload[2:]
            if len(payload) < 3 or payload[1:3] != command[:2]:
                raise CardError("unexpected_response")
            if payload[0] == ord("N") and len(payload) == 4:
                raise CardError("card_command_failed")
            if payload[0] != ord("P"):
                raise CardError("invalid_frame")
            return payload[3:]
        except CardError as exc:
            # No wire request ID exists. Never let a late response satisfy a subsequent command.
            if exc.reason not in ("nak", "card_command_failed"):
                self.desynchronized = True
            raise

    def _status(self, deadline):
        self.sleep(max(0, 0.2 - (self.clock() - self.last_status)))
        self.last_status = self.clock()
        bits = int(self._command(b"AP", deadline), 16)
        return {"bits": bits, "sensors": bits & 7, "moving": bool(bits & 0x0c00),
                "empty": bool(bits & 8), "low": bool(bits & 0x10),
                "hopperFull": bool(bits & 0x80), "captureFull": bool(bits & 0x8000),
                "reason": next((name for mask, name in self.ERROR_BITS.items() if bits & mask), None)}

    def _wait(self, predicate, deadline, allow_errors=False):
        while self.clock() < deadline:
            status = self._status(deadline)
            if status["reason"] and not allow_errors:
                raise CardError(status["reason"])
            if not status["moving"] and predicate(status):
                return status
        raise CardError("timeout")

    def _move(self, name, predicate, deadline, allow_errors=False):
        self._command(self.MOVES[name], deadline, response=False)
        self.sleep(0.2)
        return self._wait(predicate, deadline, allow_errors)

    def _recover_channel(self, deadline):
        # EOT cancels a pending exchange. Require a quiet input window before sending CP.
        if not self.desynchronized:
            return
        if not self.send(b"\x04" + self.address):
            raise CardError("disconnected")
        quiet_since = self.clock()
        while self.clock() < min(deadline, quiet_since + 0.4):
            if self.ser.in_waiting:
                self.ser.read(self.ser.in_waiting)
                quiet_since = self.clock()
            self.sleep(0.02)
        self.packet_buffer.clear()
        self.replies.clear()
        self.desynchronized = False

    def _capture(self, deadline):
        self._recover_channel(deadline)
        status = self._status(deadline)
        if status["captureFull"]:
            raise CardError("capture_full")
        return self._move("capture", lambda state: state["sensors"] == 0, deadline, allow_errors=True)

    def _run_locked(self, action):
        if not self.lock.acquire(blocking=False):
            return {"success": False, "reason": "busy", "settled": False}
        try:
            return action()
        except CardError as exc:
            return {"success": False, "reason": exc.reason, "failedSectors": exc.sectors, "settled": False}
        except Exception:
            return {"success": False, "reason": "device_error", "settled": False}
        finally:
            self.lock.release()

    def status(self):
        return self._run_locked(lambda: {"success": True, **self._status(self.clock() + 3)})

    def capture(self):
        return self._run_locked(lambda: {"success": True, "settled": True,
                                         **self._capture(self.clock() + 5)})

    def reset(self):
        def run():
            deadline = self.clock() + 5
            self._recover_channel(deadline)
            status = self._status(deadline)
            if status["sensors"] or status["moving"]:
                raise CardError("card_present")
            self._move("reset", lambda state: state["sensors"] == 0, deadline)
            return {"success": True, "settled": True}
        return self._run_locked(run)

    def _authenticate(self, sector, key, key_type, deadline):
        if type(sector) is not int or not 0 <= sector < 16 or key_type not in ("A", "B") or \
                not isinstance(key, str) or not re.fullmatch(r"[a-fA-F0-9]{12}", key):
            raise CardError("invalid_profile")
        try:
            self._command(b";2" + bytes([sector * 4, 0x30 if key_type == "A" else 0x31]) + bytes.fromhex(key), deadline)
        except CardError as exc:
            if exc.reason == "card_command_failed":
                raise CardError("authentication_failed", [sector]) from None
            raise

    def _read_block(self, block, deadline):
        if type(block) is not int or not 0 <= block < 64:
            raise CardError("invalid_block")
        data = self._command(b";3" + bytes([block]), deadline)
        if len(data) != 16:
            raise CardError("invalid_block")
        return data.hex()

    def _write_block(self, block, value, deadline):
        if type(block) is not int or not 1 <= block < 64 or block % 4 == 3:
            raise CardError("protected_block")
        assert block != 0
        if not isinstance(value, str) or not re.fullmatch(r"[a-fA-F0-9]{32}", value):
            raise CardError("invalid_block")
        self._command(b";4" + bytes([block]) + bytes.fromhex(value), deadline)
