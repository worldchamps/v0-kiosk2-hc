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
    def __init__(self, reason, sectors=None, **details):
        super().__init__(reason)
        self.reason = reason
        self.sectors = sectors or []
        self.details = details


def card_enabled(env):
    prop = (env.get("KIOSK_PROPERTY_ID") or env.get("KIOSK_PROPERTY") or
            env.get("NEXT_PUBLIC_KIOSK_PROPERTY_ID") or "property3").lower()
    return env.get("CARD_DISPENSER_ENABLED", "").lower() == "true" and (
        prop == "property1" or prop == "property3" and env.get("KIOSK_BUILDING") == "A")


def validate_profile(profile):
    if not isinstance(profile, dict) or set(profile) != {"sectors"} or not isinstance(profile["sectors"], list):
        raise CardError("invalid_profile")
    sectors = profile["sectors"]
    if not 1 <= len(sectors) <= 16:
        raise CardError("invalid_profile")
    seen = set()
    for item in sectors:
        if not isinstance(item, dict) or set(item) != {"sector", "keyA", "keyB"} or \
                type(item["sector"]) is not int or not 0 <= item["sector"] < 16 or item["sector"] in seen or \
                any(not isinstance(item[k], str) or not re.fullmatch(r"[a-fA-F0-9]{12}", item[k]) for k in ("keyA", "keyB")):
            raise CardError("invalid_profile")
        seen.add(item["sector"])
    return sorted(sectors, key=lambda item: item["sector"])


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
        self.error_stage, self.received_bytes = "", 0
        self.last_failure = None

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
                data = self.ser.read(max(1, min(self.ser.in_waiting, 300)))
                self.received_bytes += len(data)
                self.process_incoming(data)
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
            self.error_stage, self.received_bytes = "write", 0
            if not self.send(self.frame(command)):
                raise CardError("disconnected")
            self.error_stage = "ack"
            self._receive("ack", min(deadline, self.clock() + 1))
            self.error_stage = "execute"
            if not self.send(b"\x05" + self.address):
                raise CardError("disconnected")
            if not response:
                return b""
            self.error_stage, self.received_bytes = "response", 0
            payload = self._receive("frame", min(deadline, self.clock() + 2))
            self.error_stage = "decode"
            if command == b"AP":
                if not re.fullmatch(b"SF[0-9A-Fa-f]{4}", payload):
                    raise CardError("invalid_status")
                return payload[2:]
            if len(payload) < 3 or payload[1:3] != command[:2]:
                raise CardError("unexpected_response")
            if payload[0] == ord("N") and len(payload) == 4:
                raise CardError("card_command_failed", deviceCode=payload[3])
            if payload[0] != ord("P"):
                raise CardError("invalid_frame")
            return payload[3:]
        except CardError as exc:
            # Command code and block index only; never expose key/card payloads.
            exc.details["failedCommand"] = command[:2].hex().upper()
            if command[:2] in (b";3", b";4") and len(command) > 2:
                exc.details["failedBlock"] = command[2]
            self.last_failure = exc.reason
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
        # EOT cancels a pending exchange. Drain replies for the full response timeout
        # before allowing a fresh request; a noisy/expired channel remains locked.
        if not self.desynchronized:
            return
        self.error_stage, self.received_bytes = "recovery", 0
        if not self.send(b"\x04" + self.address):
            raise CardError("disconnected")
        quiet_since = self.clock()
        while self.clock() - quiet_since < 2:
            if self.clock() >= deadline:
                raise CardError("timeout")
            if self.ser.in_waiting:
                self.ser.read(self.ser.in_waiting)
                quiet_since = self.clock()
            self.sleep(0.02)
        self.packet_buffer.clear()
        self.replies.clear()
        self.desynchronized = False

    def _capture(self, deadline):
        self._recover_channel(deadline)
        status = self._wait(lambda state: True, deadline, allow_errors=True)
        if status["captureFull"]:
            raise CardError("capture_full")
        return self._move("capture", lambda state: state["sensors"] == 0, deadline)

    def _run_locked(self, action):
        if not self.lock.acquire(blocking=False):
            return {"success": False, "reason": "busy", "settled": False}
        try:
            return action()
        except CardError as exc:
            return {"success": False, "reason": exc.reason, "failedSectors": exc.sectors, "settled": False, **exc.details}
        except Exception:
            return {"success": False, "reason": "device_error", "settled": False}
        finally:
            self.lock.release()

    def status(self):
        def run():
            deadline = self.clock() + 8
            self.error_stage, self.received_bytes = "port", 0
            try:
                # Explicit status requests may reopen this configured port. Never
                # reconnect/retry a card write or move automatically.
                if not self.ser or not self.ser.is_open or self.last_failure == "disconnected":
                    if self.ser:
                        self.ser.close()
                    if not self.connect():
                        raise CardError("disconnected")
                    self.desynchronized = True
                self._recover_channel(deadline)
                result = {"success": True, **self._status(deadline)}
                self.last_failure = None
            except CardError as exc:
                self.last_failure = exc.reason
                result = {"success": False, "reason": exc.reason, "settled": False,
                          "errorStage": self.error_stage, "receivedBytes": self.received_bytes, **exc.details}
            # Only transport metadata, never raw serial bytes/card data, is exposed.
            return {**result, "port": self.port, "baudRate": self.baudrate,
                    "address": self.address.decode("ascii")}
        return self._run_locked(run)

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
            # K720_S50LoadSecKey sends the sector (00..0F), unlike block read/write.
            self._command(b";2" + bytes([sector, 0x30 if key_type == "A" else 0x31]) + bytes.fromhex(key), deadline)
        except CardError as exc:
            if exc.reason == "card_command_failed":
                raise CardError("authentication_failed", [sector], **exc.details) from None
            raise

    def _read_block(self, block, deadline):
        if type(block) is not int or not 0 <= block < 64:
            raise CardError("invalid_block")
        data = self._command(b";3" + bytes([block]), deadline)
        if len(data) != 16:
            raise CardError("invalid_block", failedCommand="3B33", failedBlock=block, responseBytes=len(data))
        return data.hex()

    def _write_block(self, block, value, deadline):
        if type(block) is not int or not 1 <= block < 64:
            raise CardError("protected_block")
        assert block != 0
        if not isinstance(value, str) or not re.fullmatch(r"[a-fA-F0-9]{32}", value):
            raise CardError("invalid_block")
        # Bench release accepts only reusable transport access conditions. Never write
        # unknown/irreversible sector permissions or zeros returned for a hidden Key A.
        if block % 4 == 3 and value[12:18].lower() != "ff0780":
            raise CardError("unsupported_access")
        self._command(b";4" + bytes([block]) + bytes.fromhex(value), deadline)

    def _select_card(self, deadline):
        self._command(b";0", deadline)
        uid = self._command(b";1", deadline)
        # Vendor C# demo button8_Click uses CardId[0..3]. Some K750 firmware
        # returns one trailing byte; it is not part of that four-byte UID.
        # The transport frame's address, length and BCC are already checked.
        if len(uid) == 5:
            uid = uid[:4]
        if len(uid) not in (4, 7):
            raise CardError("invalid_uid_response", failedCommand="3B31", responseBytes=len(uid))
        return uid.hex()

    def _read_position(self, deadline):
        # Confirm RF selection instead of guessing which physical sensor is the reader.
        while self.clock() < deadline:
            state = self._status(deadline)
            if state["reason"]:
                raise CardError(state["reason"])
            if state["sensors"] and not state["moving"]:
                try:
                    return self._select_card(deadline)
                except CardError as exc:
                    if exc.reason != "card_command_failed":
                        raise
        raise CardError("timeout")

    def _present_and_wait(self, progress):
        self._move("present", lambda state: bool(state["sensors"]), self.clock() + 5)
        progress({"state": "presented"})
        deadline = self.clock() + 60
        while self.clock() < deadline:
            state = self._status(deadline)
            if state["reason"]:
                raise CardError(state["reason"])
            if not state["moving"] and not state["sensors"]:
                return {"success": True, "settled": True, "state": "taken"}
        self._capture(self.clock() + 5)
        return {"success": False, "settled": True, "state": "captured", "reason": "not_taken"}

    def _read_source(self, profile, deadline):
        blocks, failed = {}, []
        for item in validate_profile(profile):
            sector = item["sector"]
            try:
                self._authenticate(sector, item["keyA"], "A", deadline)
            except CardError as exc:
                if exc.reason != "authentication_failed":
                    raise
                failed.append(sector)
                self._select_card(deadline)
                continue
            for block in range(sector * 4, sector * 4 + 4):
                value = self._read_block(block, deadline)
                if block % 4 == 3:
                    if value[12:18] != "ff0780":
                        raise CardError("unsupported_access", [sector])
                    # Key B is readable in transport configuration; verify it instead of
                    # replacing an unknown secret with the configured/default value.
                    if value[20:].lower() != item["keyB"].lower():
                        raise CardError("profile_key_mismatch", [sector])
                    value = item["keyA"].lower() + value[12:]
                blocks[str(block)] = value
        if failed:
            raise CardError("authentication_failed", failed)
        return blocks

    def register(self, profile, progress=lambda _: None):
        def run():
            validate_profile(profile)
            deadline = self.clock() + 30
            state = self._status(deadline)
            if state["reason"] or state["moving"] or state["sensors"]:
                raise CardError(state["reason"] or "card_present")
            progress({"state": "insert_original"})
            self._command(self.MOVES["insert"], deadline, response=False)
            try:
                uid = self._read_position(deadline)
                progress({"state": "reading"})
                blocks = self._read_source(profile, deadline)
                # Four-byte S50 UID must agree with the read-only manufacturer
                # block when sector 0 is in this profile. Never write block 0.
                if len(uid) == 8 and "0" in blocks and blocks["0"][:8] != uid:
                    raise CardError("uid_mismatch", failedCommand="3B31", failedBlock=0)
            except CardError as exc:
                # Original cards are never written or deliberately sent to the stock hopper.
                try:
                    self._recover_channel(self.clock() + 2)
                    state = self._status(self.clock() + 3)
                    outcome = self._present_and_wait(progress) if state["sensors"] else {"settled": not state["moving"]}
                except CardError:
                    outcome = {"settled": False}
                return {"success": False, "reason": exc.reason, "failedSectors": exc.sectors,
                        "settled": outcome["settled"], **exc.details}
            outcome = self._present_and_wait(progress)
            if outcome["success"]:
                return {**outcome, "uid": uid, "blocks": blocks}
            return outcome
        return self._run_locked(run)

    def issue(self, record, progress=lambda _: None):
        def run():
            if not isinstance(record, dict) or not isinstance(record.get("blocks"), dict):
                raise CardError("invalid_record")
            sectors = validate_profile(record.get("profile"))
            expected = {str(block) for item in sectors for block in range(item["sector"] * 4, item["sector"] * 4 + 4)}
            blocks = record["blocks"]
            if set(blocks) != expected or any(not isinstance(value, str) or not re.fullmatch(r"[a-fA-F0-9]{32}", value) for value in blocks.values()):
                raise CardError("invalid_record")
            # Operator-approved CUID bench issuance only. Validate before moving a card.
            source_uid = record.get("uid")
            if not isinstance(source_uid, str) or not re.fullmatch(r"[a-fA-F0-9]{8}", source_uid) or "0" not in blocks:
                raise CardError("uid_copy_unsupported")
            source_uid = source_uid.lower()
            identity = bytes.fromhex(blocks["0"])
            if identity[:4].hex() != source_uid or identity[4] != reduce(int.__xor__, identity[:4], 0):
                raise CardError("invalid_source_identity")
            for item in sectors:
                trailer = blocks[str(item["sector"] * 4 + 3)].lower()
                if trailer[:12] != item["keyA"].lower() or trailer[20:] != item["keyB"].lower() or trailer[12:18] != "ff0780":
                    raise CardError("invalid_record")
            deadline = self.clock() + 30
            state = self._status(deadline)
            if state["reason"] or state["moving"] or state["sensors"] or state["empty"]:
                raise CardError(state["reason"] or ("empty" if state["empty"] else "card_present"))
            if any(item["keyA"].lower() != "ffffffffffff" or item["keyB"].lower() != "ffffffffffff" for item in sectors):
                # Returned cards must remain writable with the same known stock key.
                raise CardError("stock_key_mismatch")
            moved = False
            try:
                progress({"state": "issuing"})
                for attempt in range(2):
                    moved = True
                    self._command(self.MOVES["read"], deadline - 5, response=False)
                    uid = self._read_position(deadline - 5)
                    if len(uid) != 8:
                        raise CardError("stock_uid_unsupported")
                    try:
                        for item in sectors:
                            sector = item["sector"]
                            self._authenticate(sector, "ffffffffffff", "A", deadline - 5)
                            # Data first, permissions last; identity is written separately below.
                            for block in range(max(1, sector * 4), sector * 4 + 4):
                                self._write_block(block, blocks[str(block)], deadline - 5)
                                got = self._read_block(block, deadline - 5)
                                expected_value = blocks[str(block)].lower()
                                if (got[12:] if block % 4 == 3 else got) != (expected_value[12:] if block % 4 == 3 else expected_value):
                                    raise CardError("verify_failed")
                        break
                    except CardError as exc:
                        if exc.reason not in ("card_command_failed", "verify_failed") or attempt:
                            raise
                        self._capture(deadline - 1)
                        moved = False
                        state = self._status(deadline - 1)
                        if state["empty"]:
                            raise CardError("empty")
                # Only the card loaded from the stock hopper reaches this write.
                # Keep the general block writer and original registration read-only for block 0.
                self._authenticate(0, "ffffffffffff", "A", deadline - 5)
                try:
                    self._command(b";4\x00" + identity, deadline - 5)
                except CardError as exc:
                    if exc.reason == "card_command_failed":
                        raise CardError("uid_write_failed", **exc.details) from None
                    raise
                # Changing block 0 can invalidate RF selection/authentication. Select anew;
                # a successful write ACK or block read alone does not prove the RF UID changed.
                verified_uid = self._select_card(deadline - 5)
                if verified_uid != source_uid:
                    raise CardError("uid_verify_failed", failedCommand="3B31")
                self._authenticate(0, "ffffffffffff", "A", deadline - 5)
                if self._read_block(0, deadline - 5) != identity.hex():
                    raise CardError("uid_verify_failed", failedCommand="3B33", failedBlock=0)
                # Presentation must start inside the total 30s issue budget.
                self._move("present", lambda status: bool(status["sensors"]), deadline)
            except CardError as exc:
                settled = not moved
                if moved:
                    try:
                        self._capture(deadline)
                        settled = True
                    except CardError:
                        pass
                return {"success": False, "reason": exc.reason, "failedSectors": exc.sectors, "settled": settled, **exc.details}
            progress({"state": "presented"})
            pickup_deadline = self.clock() + 60
            try:
                self._wait(lambda status: status["sensors"] == 0, pickup_deadline)
                return {"success": True, "settled": True, "state": "taken", "uidChanged": uid != source_uid,
                        "uidMatchesSource": True}
            except CardError as exc:
                settled = False
                try:
                    self._capture(self.clock() + 5)
                    settled = True
                except CardError:
                    pass
                return {"success": False, "reason": "not_taken" if exc.reason == "timeout" else exc.reason,
                        "settled": settled, "state": "captured" if settled else "unresolved", **exc.details}
        return self._run_locked(run)

    def accept_return(self, progress=lambda _: None):
        def run():
            deadline = self.clock() + 30
            state = self._status(deadline)
            if state["reason"] or state["moving"] or state["sensors"] or state["hopperFull"]:
                raise CardError(state["reason"] or ("hopper_full" if state["hopperFull"] else "card_present"))
            progress({"state": "insert_return"})
            self._command(self.MOVES["insert"], deadline, response=False)
            try:
                self._read_position(deadline - 5)
                self._move("return", lambda status: status["sensors"] == 0, deadline)
                return {"success": True, "settled": True, "state": "returned"}
            except CardError as exc:
                settled = False
                try:
                    self._capture(deadline)
                    settled = True
                except CardError:
                    pass
                return {"success": False, "reason": exc.reason, "settled": settled, **exc.details}
        return self._run_locked(run)
