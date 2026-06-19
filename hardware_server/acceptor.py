from serial_manager import SerialDevice
import logging

logger = logging.getLogger("Acceptor")


class OnePlusAcceptor(SerialDevice):
    def __init__(self, port, baudrate=9600):
        super().__init__("Acceptor", port, baudrate)
        self.packet_buffer = bytearray()

    def _build_packet(self, c1, c2, data):
        packet = bytearray(5)
        packet[0] = ord("$")
        packet[1] = c1 if isinstance(c1, int) else ord(c1)
        packet[2] = c2 if isinstance(c2, int) else ord(c2)
        packet[3] = data if isinstance(data, int) else ord(data)
        packet[4] = (packet[1] + packet[2] + packet[3]) & 0xFF
        return packet

    def check_connection(self):
        return self.send(self._build_packet("H", "i", "?"))

    def enable_acceptance(self):
        return self.send(self._build_packet("S", "A", 0x0D))

    def disable_acceptance(self):
        return self.send(self._build_packet("S", "A", 0x0E))

    def stack_bill(self):
        return self.send(self._build_packet("S", "A", 0x09))

    def return_bill(self):
        return self.send(self._build_packet("S", "A", 0x06))

    def get_bill_data(self):
        return self.send(self._build_packet("G", "B", "?"))

    def get_status(self):
        return self.send(self._build_packet("G", "A", "?"))

    def reset(self):
        return self.send(self._build_packet("R", "S", "T"))

    def send_ack(self, event_data):
        return self.send(self._build_packet("e", "s", event_data))

    def set_config(self, value):
        return self.send(self._build_packet("S", "C", value))

    def process_incoming(self, data, ws_callback):
        self.packet_buffer.extend(data)
        while len(self.packet_buffer) >= 5:
            try:
                start_idx = self.packet_buffer.index(ord("$"))
            except ValueError:
                self.packet_buffer.clear()
                break

            if start_idx + 5 > len(self.packet_buffer):
                self.packet_buffer = self.packet_buffer[start_idx:]
                break

            packet = self.packet_buffer[start_idx : start_idx + 5]
            self.packet_buffer = self.packet_buffer[start_idx + 5 :]

            if packet[4] == ((packet[1] + packet[2] + packet[3]) & 0xFF):
                self._handle_packet(packet, ws_callback)
            else:
                logger.warning(f"Invalid checksum in packet: {packet.hex()}")

    def _handle_packet(self, packet, ws_callback):
        cmd1, cmd2, data = packet[1], packet[2], packet[3]

        if cmd1 == ord("E") and cmd2 == ord("S"):
            logger.info(f"Event Received: 0x{data:02X}")
            self.send_ack(data)
            ws_callback({"type": "acceptor_event", "event": data})
        elif cmd1 == ord("g") and cmd2 == ord("b"):
            ws_callback({"type": "acceptor_bill_data", "value": data})
        elif cmd1 == ord("O") and cmd2 == ord("K"):
            ws_callback({"type": "acceptor_ok", "data": data})
        elif cmd1 == ord("N") and cmd2 == ord("G"):
            ws_callback({"type": "acceptor_ng", "data": data})
        else:
            ws_callback({"type": "acceptor_raw", "packet": list(packet)})
