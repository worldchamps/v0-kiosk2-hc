import { NextResponse } from "next/server"
import { validateSheetColumns } from "@/lib/google-sheets"

export async function GET() {
  try {
    const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID

    if (!spreadsheetId) {
      return NextResponse.json({ error: "Spreadsheet ID not configured" }, { status: 500 })
    }

    const validation = await validateSheetColumns(spreadsheetId)

    return NextResponse.json({
      validation,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error("Error validating columns:", error)
    return NextResponse.json(
      {
        error: "Failed to validate columns",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    )
  }
}
