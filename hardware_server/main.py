import asyncio
import json
import logging
import os

import websockets

from acceptor import OnePlusAcceptor
from bac2400 import Bac2400
from dispenser import OnePlusDispenser
from printer import BixolonPrinter

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger("HardwareServer")


def load_local_hardware_env():
    env_path = os.path.join(os.path.dirname(__file__), "..", ".env.local")
    wanted = {
        "KIOSK_PROPERTY_ID", "KIOSK_PROPERTY", "NEXT_PUBLIC_KIOSK_PROPERTY_ID",
        "BAC2400_PORT", "BOARD3400_PORT", "PRINTER_PORT", "DISPENSER_PORT", "ACCEPTOR_PORT",
    }
    try:
        with open(env_path, encoding="utf-8-sig", errors="ignore") as env_file:
            for raw_line in env_file:
                key, separator, value = raw_line.strip().partition("=")
                if separator and key in wanted and key not in os.environ:
                    os.environ[key] = value.strip().strip("\"'")
    except FileNotFoundError:
        pass


load_local_hardware_env()

DISPENSER_PORT = os.environ.get("DISPENSER_PORT", "COM5")
ACCEPTOR_PORT = os.environ.get("ACCEPTOR_PORT", "COM4")
PRINTER_PORT = os.environ.get("PRINTER_PORT", "COM2")
PROPERTY_ID = (
    os.environ.get("KIOSK_PROPERTY_ID")
    or os.environ.get("KIOSK_PROPERTY")
    or os.environ.get("NEXT_PUBLIC_KIOSK_PROPERTY_ID")
    or "property3"
).lower()
USE_BAC2400 = PROPERTY_ID == "property4"

bac2400 = Bac2400(
    os.environ.get("BAC2400_PORT") or os.environ.get("BOARD3400_PORT", "COM5")
) if USE_BAC2400 else None
dispenser = None if USE_BAC2400 else OnePlusDispenser(DISPENSER_PORT)
acceptor = None if USE_BAC2400 else OnePlusAcceptor(ACCEPTOR_PORT)
printer = None if USE_BAC2400 else BixolonPrinter(PRINTER_PORT, baud_rate=115200)

connected_clients = set()


async def broadcast(message):
    if connected_clients:
        msg_str = json.dumps(message)
        await asyncio.gather(
            *[client.send(msg_str) for client in connected_clients]
        )


def dispenser_callback(data):
    asyncio.run_coroutine_threadsafe(
        broadcast({"type": "dispenser_data", "data": list(data)}),
        main_loop,
    )


def acceptor_callback(data):
    acceptor.process_incoming(
        data,
        lambda msg: asyncio.run_coroutine_threadsafe(broadcast(msg), main_loop),
    )


def bac2400_callback(data):
    for message in bac2400.process_incoming(data):
        asyncio.run_coroutine_threadsafe(broadcast(message), main_loop)


def legacy_packet(command1, command2, data):
    return bytes([0x24, command1, command2, data, (command1 + command2 + data) & 0xFF])


def handle_bac2400_message(message):
    command_type = message.get("type")
    if command_type == "raw_acceptor":
        return bac2400.handle_acceptor_command(bytes(message.get("data", [])))
    if command_type == "raw_dispenser":
        return bac2400.handle_dispenser_command(bytes(message.get("data", [])))

    acceptor_commands = {
        "acceptor_enable": (0x53, 0x41, 0x0D),
        "acceptor_disable": (0x53, 0x41, 0x0E),
        "acceptor_stack": (0x53, 0x41, 0x09),
        "acceptor_return": (0x53, 0x41, 0x06),
        "acceptor_get_bill": (0x47, 0x42, 0x3F),
        "acceptor_reset": (0x52, 0x53, 0x54),
    }
    if command_type in acceptor_commands:
        return bac2400.handle_acceptor_command(legacy_packet(*acceptor_commands[command_type]))
    if command_type == "acceptor_config":
        return bac2400.handle_acceptor_command(legacy_packet(0x53, 0x43, message.get("value", 0x3C)))
    if command_type == "dispense":
        return bac2400.handle_dispenser_command(legacy_packet(0x44, message.get("count", 1), 0x53))
    if command_type == "dispenser_status":
        return bac2400.handle_dispenser_command(legacy_packet(0x53, 0x74, 0x3F))
    if command_type == "dispenser_init":
        return bac2400.handle_dispenser_command(legacy_packet(0x49, 0, 0))
    return None


async def poll_bac2400_payout():
    while True:
        if bac2400.payout_in_progress:
            bac2400.query_dispenser()
        await asyncio.sleep(0.25)


async def handle_client(websocket, *args):
    connected_clients.add(websocket)
    logger.info(f"Client connected. Total clients: {len(connected_clients)}")
    try:
        async for message in websocket:
            try:
                msg = json.loads(message)
                cmd_type = msg.get("type")

                if bac2400:
                    responses = handle_bac2400_message(msg)
                    if responses is not None:
                        for response in responses:
                            await broadcast(response)
                        continue

                if cmd_type == "dispense":
                    dispenser.dispense(msg.get("count", 1))
                elif cmd_type == "dispenser_status":
                    dispenser.check_status()
                elif cmd_type == "dispenser_init":
                    dispenser.initialize()
                elif cmd_type == "acceptor_enable":
                    acceptor.enable_acceptance()
                elif cmd_type == "acceptor_disable":
                    acceptor.disable_acceptance()
                elif cmd_type == "acceptor_stack":
                    acceptor.stack_bill()
                elif cmd_type == "acceptor_return":
                    acceptor.return_bill()
                elif cmd_type == "acceptor_get_bill":
                    acceptor.get_bill_data()
                elif cmd_type == "acceptor_reset":
                    acceptor.reset()
                elif cmd_type == "acceptor_config":
                    acceptor.set_config(msg.get("value", 0x3C))
                elif cmd_type == "printer_print" and printer:
                    text = msg.get("text", "")
                    if text:
                        printer.print_text(
                            text,
                            alignment=msg.get("alignment", printer.ALIGNMENT_LEFT),
                            attribute=msg.get("attribute", printer.FONT_DEFAULT),
                            text_size=msg.get("text_size", printer.TEXT_SIZE_NORMAL),
                            code_page=msg.get("code_page", printer.CODE_PAGE_KS5601),
                        )
                elif cmd_type == "printer_cut" and printer:
                    printer.cut_paper()
                elif cmd_type == "printer_raw" and printer:
                    raw_data = msg.get("data", "")
                    if raw_data:
                        if isinstance(raw_data, list):
                            data = bytes(raw_data)
                        else:
                            data = bytes.fromhex(raw_data.replace(" ", ""))
                        printer.send_command(data)
                elif cmd_type == "raw_dispenser":
                    dispenser.send(bytes(msg.get("data", [])))
                elif cmd_type == "raw_acceptor":
                    acceptor.send(bytes(msg.get("data", [])))
                elif cmd_type == "ping":
                    await websocket.send(json.dumps({"type": "pong"}))
            except json.JSONDecodeError:
                logger.error("Invalid JSON received")
            except Exception as exc:
                logger.error(f"Error processing command({cmd_type}): {exc}")
    except websockets.exceptions.ConnectionClosed as exc:
        logger.info(
            f"Client disconnected (Code: {exc.code}, Reason: {exc.reason})"
        )
    except Exception as exc:
        logger.error(f"Unexpected error in client handler: {exc}")
    finally:
        connected_clients.remove(websocket)
        logger.info(f"Client removed. Total clients: {len(connected_clients)}")


async def main():
    global main_loop
    main_loop = asyncio.get_running_loop()

    if bac2400:
        logger.info("Property4 selected: using BAC-2400 V1.3 (BV1/BD1) on %s", bac2400.port)
        bac2400.connect()
        bac2400.start(bac2400_callback)
        asyncio.create_task(poll_bac2400_payout())
    else:
        dispenser.connect()
        dispenser.start(dispenser_callback)
        acceptor.connect()
        acceptor.start(acceptor_callback)

    if printer:
        printer.connect()
    else:
        logger.info("Property4 selected: SAM4S printer is managed by the Windows driver")

    logger.info("Starting WebSocket server on ws://localhost:8082")
    async with websockets.serve(handle_client, "localhost", 8082):
        await asyncio.Future()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logger.info("Server stopping...")
        if bac2400:
            bac2400.stop()
        else:
            dispenser.stop()
            acceptor.stop()
        if printer:
            printer.disconnect()
