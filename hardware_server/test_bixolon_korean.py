import argparse
import logging
import os
import sys

import serial.tools.list_ports

from printer import BixolonPrinter


TEST_TEXT = (
    "BIXOLON 한글 출력 테스트\n"
    "안녕하세요.\n"
    "객실 안내 프린터가 정상입니다.\n"
    "\n\n"
)


def main():
    parser = argparse.ArgumentParser(description="BIXOLON Korean print test")
    parser.add_argument(
        "--port",
        default=os.environ.get("PRINTER_PORT", "COM2"),
        help="Printer COM port (default: PRINTER_PORT or COM2)",
    )
    parser.add_argument(
        "--baud",
        type=int,
        default=int(os.environ.get("PRINTER_BAUD_RATE", "115200")),
        help="Serial baud rate (default: 115200)",
    )
    parser.add_argument(
        "--no-cut",
        action="store_true",
        help="Do not cut the paper after printing",
    )
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    )

    detected_ports = [port.device for port in serial.tools.list_ports.comports()]
    print(f"Detected COM ports: {', '.join(detected_ports) or '(none)'}")
    print(f"Testing BIXOLON printer on {args.port} at {args.baud} baud")

    printer = BixolonPrinter(args.port, args.baud)
    if not printer.connect():
        print("FAILED: Could not connect to the BIXOLON printer.")
        return 1

    try:
        if not printer.print_text(TEST_TEXT):
            print("FAILED: PrintTextW returned an error.")
            return 2

        if not args.no_cut and not printer.cut_paper():
            print("FAILED: Korean text was sent, but CutPaper returned an error.")
            return 3

        print("SUCCESS: Korean text was sent with KS5601 code page 949.")
        return 0
    finally:
        printer.disconnect()


if __name__ == "__main__":
    sys.exit(main())
