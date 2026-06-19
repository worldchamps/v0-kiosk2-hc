import serial
import serial.tools.list_ports


def check_ports():
    print("\n" + "=" * 50)
    print("      AGAIN Kiosk Hardware Diagnostics")
    print("=" * 50 + "\n")

    ports = list(serial.tools.list_ports.comports())

    if not ports:
        print("[!] No COM ports detected. Check your USB connections and drivers.")
        return

    print(f"Found {len(ports)} ports:\n")

    for port in ports:
        print(f"Device: {port.device}")
        print(f"  Name: {port.name}")
        print(f"  Description: {port.description}")
        print(f"  HWID: {port.hwid}")

        try:
            ser = serial.Serial(port.device)
            ser.close()
            print("  Status: [OK] Port is accessible")
        except serial.SerialException as exc:
            if "PermissionError" in str(exc):
                print(
                    "  Status: [BUSY] Port is already in use "
                    "(by another program?)"
                )
            else:
                print(f"  Status: [ERROR] {exc}")
        print("-" * 30)

    print("\n[INFO] Look for USB-Serial, Bixolon, or generic COM ports.")
    print("[INFO] Use these COM names in hardware_server/main.py")


if __name__ == "__main__":
    check_ports()
