import unittest

from board3400 import Board3400


def response(status1=0, status2=0, input_counts=None, payout_counts=None):
    packet = bytearray(19)
    packet[0:3] = bytes([0xFE, 18, 0x13])
    packet[3:5] = bytes([status1, status2])
    packet[5:11] = bytes(input_counts or [0] * 6)
    packet[11:16] = bytes(payout_counts or [0] * 5)
    packet[17] = 0x15
    checksum = 0
    for value in packet[:-1]:
        checksum ^= value
    packet[-1] = checksum
    return bytes(packet)


class Board3400Test(unittest.TestCase):
    def setUp(self):
        self.board = Board3400("COM1")
        self.sent = []
        self.board.send = lambda packet: self.sent.append(packet) or True

    def test_vendor_frame_and_bill_translation(self):
        self.board.handle_acceptor_command(bytes([0x24, 0x53, 0x41, 0x0D, 0]))
        self.assertEqual(self.sent[-1][:4], bytes([0xFE, 13, 0x10, 0x09]))
        self.assertEqual(0, self.sent[-1][0] ^ self.sent[-1][1] ^ self.sent[-1][2] ^ self.sent[-1][3] ^ self.sent[-1][-1])

        self.board.pending_acceptor_status = True
        messages = self.board.process_incoming(response(input_counts=[0, 0, 0, 0, 1, 0]))
        self.assertTrue(any(message.get("event") == 0x0B for message in messages))
        status = next(message["packet"] for message in messages if message.get("type") == "acceptor_raw")
        self.assertEqual(status[1:4], [0x67, 0x61, 0x0B])
        bill = self.board.handle_acceptor_command(bytes([0x24, 0x47, 0x42, 0x3F, 0]))[0]["packet"]
        self.assertEqual(bill[1:4], [0x67, 0x62, 0x0A])

    def test_payout_completion_translation(self):
        self.assertTrue(self.board.dispense(2))
        self.assertEqual(self.board.pending_payout["phase"], "clearing")
        self.assertEqual(self.board.process_incoming(response()), [])
        self.assertEqual(self.board.pending_payout["phase"], "dispensing")
        messages = self.board.process_incoming(response(payout_counts=[0, 0, 2, 0, 0]))
        payout = next(message["data"] for message in messages if message.get("type") == "dispenser_data")
        self.assertEqual(payout[1:4], [0x64, 2, 0x53])


if __name__ == "__main__":
    unittest.main()
