import asyncio
import json
import logging
import os

import websockets

from acceptor import OnePlusAcceptor
from dispenser import OnePlusDispenser
from printer import BixolonPrinter

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger("HardwareServer")

DISPENSER_PORT = os.environ.get("DISPENSER_PORT", "COM5")
ACCEPTOR_PORT = os.environ.get("ACCEPTOR_PORT", "COM4")
PRINTER_PORT = os.environ.get("PRINTER_PORT", "COM2")

dispenser = OnePlusDispenser(DISPENSER_PORT)
acceptor = OnePlusAcceptor(ACCEPTOR_PORT)
printer = BixolonPrinter(PRINTER_PORT, baud_rate=115200)

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


async def handle_client(websocket, *args):
    connected_clients.add(websocket)
    logger.info(f"Client connected. Total clients: {len(connected_clients)}")
    try:
        async for message in websocket:
            try:
                msg = json.loads(message)
                cmd_type = msg.get("type")

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
                elif cmd_type == "printer_print":
                    text = msg.get("text", "")
                    if text:
                        printer.print_text(
                            text,
                            alignment=msg.get("alignment", printer.ALIGNMENT_LEFT),
                            attribute=msg.get("attribute", printer.FONT_DEFAULT),
                            text_size=msg.get("text_size", printer.TEXT_SIZE_NORMAL),
                            code_page=msg.get("code_page", printer.CODE_PAGE_KS5601),
                        )
                elif cmd_type == "printer_cut":
                    printer.cut_paper()
                elif cmd_type == "printer_raw":
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

    dispenser.connect()
    dispenser.start(dispenser_callback)

    acceptor.connect()
    acceptor.start(acceptor_callback)

    printer.connect()

    logger.info("Starting WebSocket server on ws://localhost:8082")
    async with websockets.serve(handle_client, "localhost", 8082):
        await asyncio.Future()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logger.info("Server stopping...")
        dispenser.stop()
        acceptor.stop()
        printer.disconnect()
