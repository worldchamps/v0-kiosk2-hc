import argparse
import logging
import os
import sys

import serial.tools.list_ports

from printer import BixolonPrinter


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
        sections = [
            {
                "text": "THE BEACH STAY\n",
                "alignment": printer.ALIGNMENT_CENTER,
                "attribute": printer.FONT_BOLD,
                "text_size": printer.TEXT_SIZE_DOUBLE,
                "label": "hotel title",
            },
            {
                "text": "입실 안내\n\n",
                "alignment": printer.ALIGNMENT_CENTER,
                "attribute": printer.FONT_BOLD,
                "text_size": printer.TEXT_SIZE_DOUBLE_HEIGHT,
                "label": "Korean heading",
            },
            {
                "text": "아래 비밀번호를 도어락에 입력하세요.\n\n",
                "alignment": printer.ALIGNMENT_CENTER,
                "attribute": printer.FONT_BOLD,
                "text_size": printer.TEXT_SIZE_NORMAL,
                "label": "keyless entry notice",
            },
            {
                "text": "------------------------------------------\n",
                "alignment": printer.ALIGNMENT_CENTER,
                "attribute": printer.FONT_DEFAULT,
                "text_size": printer.TEXT_SIZE_NORMAL,
                "label": "separator",
            },
            {
                "text": "D동 203호\n\n",
                "alignment": printer.ALIGNMENT_CENTER,
                "attribute": printer.FONT_BOLD,
                "text_size": printer.TEXT_SIZE_DOUBLE,
                "label": "room number",
            },
            {
                "text": "객실 비밀번호\n",
                "alignment": printer.ALIGNMENT_CENTER,
                "attribute": printer.FONT_DEFAULT,
                "text_size": printer.TEXT_SIZE_NORMAL,
                "label": "password label",
            },
            {
                "text": "1234*\n\n",
                "alignment": printer.ALIGNMENT_CENTER,
                "attribute": printer.FONT_BOLD | printer.FONT_UNDERLINE,
                "text_size": printer.TEXT_SIZE_DOUBLE,
                "label": "password",
            },
            {
                "text": "------------------------------------------\n",
                "alignment": printer.ALIGNMENT_CENTER,
                "attribute": printer.FONT_DEFAULT,
                "text_size": printer.TEXT_SIZE_NORMAL,
                "label": "separator",
            },
            {
                "text": "도어락 이용 방법\n\n",
                "alignment": printer.ALIGNMENT_CENTER,
                "attribute": printer.FONT_BOLD,
                "text_size": printer.TEXT_SIZE_DOUBLE_HEIGHT,
                "label": "door lock instructions heading",
            },
            {
                "text": "1. 도어락 화면을 손으로 터치하세요.\n"
                "2. 숫자 자판이 나타날 때까지 기다리세요.\n"
                "3. 비밀번호 1234*를 입력하세요.\n"
                "4. 문이 열리면 입실하세요.\n\n",
                "alignment": printer.ALIGNMENT_LEFT,
                "attribute": printer.FONT_DEFAULT,
                "text_size": printer.TEXT_SIZE_NORMAL,
                "label": "door lock instructions",
            },
            {
                "text": "------------------------------------------\n",
                "alignment": printer.ALIGNMENT_CENTER,
                "attribute": printer.FONT_DEFAULT,
                "text_size": printer.TEXT_SIZE_NORMAL,
                "label": "separator",
            },
            {
                "text": "체크인    2026년 7월 25일\n"
                "체크아웃  2026년 7월 26일\n\n",
                "alignment": printer.ALIGNMENT_LEFT,
                "attribute": printer.FONT_DEFAULT,
                "text_size": printer.TEXT_SIZE_NORMAL,
                "label": "stay dates",
            },
            {
                "text": "즐거운 시간 보내시기 바랍니다.\n"
                "감사합니다.\n\n\n",
                "alignment": printer.ALIGNMENT_CENTER,
                "attribute": printer.FONT_BOLD,
                "text_size": printer.TEXT_SIZE_NORMAL,
                "label": "footer",
            },
        ]

        for section in sections:
            if not printer.print_text(
                section["text"],
                alignment=section["alignment"],
                attribute=section["attribute"],
                text_size=section["text_size"],
            ):
                print(f"FAILED: Could not print {section['label']}.")
                return 2

        if not args.no_cut and not printer.cut_paper():
            print("FAILED: Korean text was sent, but CutPaper returned an error.")
            return 3

        print("SUCCESS: Korean styled receipt was sent with KS5601 code page 949.")
        return 0
    finally:
        printer.disconnect()


if __name__ == "__main__":
    sys.exit(main())
