import unittest

from bac2400 import Bac2400


def multi_frame(*tlvs):
    body = bytearray()
    for command, payload in tlvs:
        body.extend([len(payload) + 1, command, *payload])
    packet = bytearray([0x33, len(body), *body])
    checksum = 0
    for value in packet[1:]:
        checksum ^= value
    packet.append(checksum)
    return bytes(packet)


class Bac2400Test(unittest.TestCase):
    def setUp(self):
        self.board = Bac2400("COM5")
        self.sent = []
        self.board.send = lambda packet: self.sent.append(packet) or True

    def test_serial_settings(self):
        self.assertEqual((self.board.baudrate, self.board.parity), (9600, "E"))

    def test_real_dispenser_status_packet(self):
        packet = bytes.fromhex("33 0F 05 15 00 00 00 00 05 16 00 00 03 00 02 17 00 1A")
        self.board.pending_dispenser_status = True
        messages = self.board.process_incoming(packet[:7])
        messages.extend(self.board.process_incoming(packet[7:]))

        self.assertEqual(self.board.dispenser_statuses, [0, 0, 3, 0])
        status = next(message["data"] for message in messages if message.get("type") == "dispenser_data")
        self.assertEqual(status[1:4], [0x73, 0x74, 0x65])

    def test_bill_translation_and_bv1_control(self):
        replies = self.board.handle_acceptor_command(bytes([0x24, 0x53, 0x41, 0x0D, 0]))
        self.assertEqual(self.sent[-1], bytes.fromhex("5B A4 03 10 03 00 10"))
        self.assertEqual(replies[0]["packet"][1:4], [0x4F, 0x4B, 0])

        self.board.pending_acceptor_status = True
        messages = self.board.process_incoming(
            multi_frame((0x18, [0, 0, 1, 0]), (0x1B, [0x09, 0, 0x13]))
        )
        self.assertTrue(any(message.get("event") == 0x0B for message in messages))
        status = next(message["packet"] for message in messages if message.get("type") == "acceptor_raw")
        self.assertEqual(status[1:4], [0x67, 0x61, 0x0B])
        bill = self.board.handle_acceptor_command(bytes([0x24, 0x47, 0x42, 0x3F, 0]))[0]["packet"]
        self.assertEqual(bill[1:4], [0x67, 0x62, 0x0A])

    def test_bv1_rejects_non_10000_won_in_software(self):
        self.board.control_acceptor(True, clear=True)
        messages = self.board.process_incoming(
            multi_frame((0x18, [1, 0, 0, 0]), (0x1B, [0x09, 0, 0x13]))
        )

        self.assertTrue(any(message.get("event") == 0x0C for message in messages))
        self.assertFalse(self.board.acceptor_enabled)
        self.assertEqual(self.board.acceptor_status, 0x0C)
        self.assertEqual(list(self.board.bill_codes), [])
        self.assertEqual(self.sent[-1], bytes.fromhex("5B A4 03 10 00 00 13"))

    def test_bd1_payout_command_and_completion(self):
        self.assertTrue(self.board.dispense(2))
        self.assertEqual(self.sent[-1], bytes.fromhex("71 8E"))

        self.assertEqual(
            self.board.process_incoming(
                multi_frame((0x15, [0, 0, 0, 0]), (0x16, [0, 0, 0, 0]), (0x17, [0]))
            ),
            [],
        )
        self.assertEqual(self.sent[-1], bytes.fromhex("73 8C 05 00 00 00 02 00 07"))

        messages = self.board.process_incoming(
            multi_frame((0x15, [0, 0, 2, 0]), (0x16, [0, 0, 0, 0]), (0x17, [0]))
        )
        payout = next(message["data"] for message in messages if message.get("type") == "dispenser_data")
        self.assertEqual(payout[1:4], [0x64, 2, 0x53])


if __name__ == "__main__":
    unittest.main()
