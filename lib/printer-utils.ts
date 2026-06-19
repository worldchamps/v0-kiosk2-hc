/**
 * Bixolon 프린터 제어 유틸리티 (Hardware Server 연동)
 */

declare global {
  interface Window {
    electronAPI: any
  }
}

// --------------------------------------------------------
// ESC/POS Commands
// --------------------------------------------------------
const CMD = {
  INIT: [0x1b, 0x40], // ESC @ - Initialize (ASCII Mode)
  CUT: [0x1d, 0x56, 0x42, 0x00], // GS V B 0 (Feed & Cut)
  LF: [0x0a], // Line Feed
  ALIGN_LEFT: [0x1b, 0x61, 0x00],
  ALIGN_CENTER: [0x1b, 0x61, 0x01],
  ALIGN_RIGHT: [0x1b, 0x61, 0x02],
  BOLD_ON: [0x1b, 0x45, 0x01],
  BOLD_OFF: [0x1b, 0x45, 0x00],
  FONT_A: [0x1b, 0x4d, 0x00],
  FONT_B: [0x1b, 0x4d, 0x01],
  SIZE_NORMAL: [0x1d, 0x21, 0x00],
  SIZE_2X: [0x1d, 0x21, 0x11],
  SIZE_DOUBLE_HEIGHT: [0x1d, 0x21, 0x01],
  SIZE_DOUBLE_WIDTH: [0x1d, 0x21, 0x10],
}

// --------------------------------------------------------
// Helper Functions
// --------------------------------------------------------

async function sendRaw(data: number[]) {
  return await window.electronAPI.sendRawToBixolon(data)
}

export async function printText(text: string) {
  return await window.electronAPI.printToBixolon(text)
}

export async function cutPaper() {
  return await window.electronAPI.cutBixolonPaper()
}

export async function initializePrinter() {
  await sendRaw(CMD.INIT)
}

// --------------------------------------------------------
// High-Level Receipt Printing
// --------------------------------------------------------

export async function printReceipt(data: {
  hotelName: string
  roomNumber: string
  password?: string
  checkInDate?: string
  checkOutDate?: string
}) {
  console.log("[Bixolon] Printing receipt...", data)

  // 1. Initialize
  await sendRaw(CMD.INIT)

  // 2. Hotel Name (Center, 2x Size, Bold)
  await sendRaw(CMD.ALIGN_CENTER)
  await sendRaw(CMD.SIZE_2X)
  await sendRaw(CMD.BOLD_ON)
  await printText(data.hotelName + "\n\n")

  // 3. Separator
  await sendRaw(CMD.SIZE_NORMAL)
  await sendRaw(CMD.BOLD_OFF)
  await printText("------------------------------------------\n")

  // 4. Room Info (Left alignment, Double height)
  await sendRaw(CMD.ALIGN_LEFT)
  await sendRaw(CMD.SIZE_DOUBLE_HEIGHT)
  await printText(`Room: ${data.roomNumber}\n`)
  if (data.password) {
    await printText(`Pass: ${data.password}\n`)
  }

  // 5. Dates (Normal size)
  await sendRaw(CMD.SIZE_NORMAL)
  await printText("\n")
  if (data.checkInDate) await printText(`Check-in:  ${data.checkInDate}\n`)
  if (data.checkOutDate) await printText(`Check-out: ${data.checkOutDate}\n`)

  // 6. Footer
  await printText("------------------------------------------\n")
  await sendRaw(CMD.ALIGN_CENTER)
  await printText("Thank you!\n\n\n\n\n") // Feed lines

  // 7. Cut
  await cutPaper()

  console.log("[Bixolon] Print command sent.")
}

// --------------------------------------------------------
// Shim Functions for Compatibility
// --------------------------------------------------------

export async function autoConnectPrinter(): Promise<boolean> {
  // New hardware server architecture handles connection automatically on startup.
  // We just return true here to allow the dependent components to proceed.
  console.log("[Bixolon] autoConnectPrinter called (shim): Connection managed by Hardware Server.")
  return true;
}

export function isPrinterConnected(): boolean {
  // We can't synchronously check invalid hardware server status easily without an async call.
  // Ideally, we should check a cached status from the electron-IPC event listener.
  // For now, returning true is safe as the actual print call will fail gracefully if disconnected.
  // TODO: Hook into a global context or Redux/Zustand store for real-time status if needed.
  return true;
}

export async function printRoomInfoReceipt(data: {
  roomNumber: string;
  password: string;
  floor: string;
}): Promise<boolean> {
  console.log("[Bixolon] printRoomInfoReceipt called (shim).");
  try {
    const now = new Date();
    await printReceipt({
      hotelName: "THE BEACH STAY", // English Name
      roomNumber: data.roomNumber,
      password: data.password,
      checkInDate: now.toLocaleDateString(),
      checkOutDate: "Remote Print"
    });
    return true;
  } catch (error) {
    console.error("[Bixolon] printRoomInfoReceipt failed:", error);
    return false;
  }
}
