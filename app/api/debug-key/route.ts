import { NextResponse } from "next/server"
import { formatPrivateKey } from "@/lib/google-sheets"

export async function GET() {
  try {
    const privateKey = process.env.GOOGLE_SHEETS_PRIVATE_KEY || ""
    const formattedKey = formatPrivateKey(privateKey)

    // 개인 키 형식 확인 (민감한 정보는 마스킹)
    const privateKeyInfo = {
      originalLength: privateKey.length,
      formattedLength: formattedKey.length,
      originalStartsWithHeader: privateKey.startsWith("-----BEGIN PRIVATE KEY-----"),
      formattedStartsWithHeader: formattedKey.startsWith("-----BEGIN PRIVATE KEY-----"),
      originalEndsWithFooter: privateKey.endsWith("-----END PRIVATE KEY-----\n"),
      formattedEndsWithFooter: formattedKey.endsWith("-----END PRIVATE KEY-----\n"),
      originalContainsNewlines: privateKey.includes("\n"),
      formattedContainsNewlines: formattedKey.includes("\n"),
      originalContainsEscapedNewlines: privateKey.includes("\\n"),
      formattedContainsEscapedNewlines: formattedKey.includes("\\n"),
    }

    return NextResponse.json({
      timestamp: new Date().toISOString(),
      privateKeyInfo,
      clientEmailExists: !!process.env.GOOGLE_SHEETS_CLIENT_EMAIL,
      spreadsheetIdExists: !!process.env.GOOGLE_SHEETS_SPREADSHEET_ID,
    })
  } catch (error) {
    return NextResponse.json(
      {
        error: "Error checking private key",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    )
  }
}
