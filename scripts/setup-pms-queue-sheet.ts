import { createSheetsClient } from "../lib/google-sheets"

/**
 * Google Sheets에 PMS Queue 시트를 생성하고 초기화하는 스크립트
 */
async function setupPMSQueueSheet() {
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID

  if (!spreadsheetId) {
    console.error("❌ GOOGLE_SHEETS_SPREADSHEET_ID 환경 변수가 설정되지 않았습니다.")
    process.exit(1)
  }

  try {
    const sheets = createSheetsClient()

    console.log("📋 PMS Queue 시트 설정 시작...")

    // 1. 기존 시트 목록 확인
    const spreadsheet = await sheets.spreadsheets.get({
      spreadsheetId,
    })

    const existingSheets = spreadsheet.data.sheets || []
    const pmsQueueSheet = existingSheets.find((sheet) => sheet.properties?.title === "PMS Queue")

    if (pmsQueueSheet) {
      console.log("✅ PMS Queue 시트가 이미 존재합니다.")
    } else {
      // 2. PMS Queue 시트 생성
      console.log("📝 PMS Queue 시트 생성 중...")
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [
            {
              addSheet: {
                properties: {
                  title: "PMS Queue",
                  gridProperties: {
                    rowCount: 1000,
                    columnCount: 7,
                    frozenRowCount: 1, // 헤더 행 고정
                  },
                },
              },
            },
          ],
        },
      })
      console.log("✅ PMS Queue 시트 생성 완료")
    }

    // 3. 헤더 행 설정
    console.log("📝 헤더 행 설정 중...")
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: "PMS Queue!A1:G1",
      valueInputOption: "RAW",
      requestBody: {
        values: [["ID", "객실번호", "투숙객명", "체크인날짜", "상태", "생성시간", "완료시간"]],
      },
    })

    // 4. 헤더 행 스타일 적용
    const sheetId = pmsQueueSheet?.properties?.sheetId || 0
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            repeatCell: {
              range: {
                sheetId: sheetId,
                startRowIndex: 0,
                endRowIndex: 1,
              },
              cell: {
                userEnteredFormat: {
                  backgroundColor: { red: 0.2, green: 0.2, blue: 0.2 },
                  textFormat: {
                    foregroundColor: { red: 1, green: 1, blue: 1 },
                    bold: true,
                  },
                  horizontalAlignment: "CENTER",
                },
              },
              fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)",
            },
          },
        ],
      },
    })

    console.log("✅ 헤더 행 설정 완료")
    console.log("\n🎉 PMS Queue 시트 설정이 완료되었습니다!")
    console.log(`📊 스프레드시트 URL: https://docs.google.com/spreadsheets/d/${spreadsheetId}`)
  } catch (error) {
    console.error("❌ 오류 발생:", error)
    if (error instanceof Error) {
      console.error("상세 오류:", error.message)
    }
    process.exit(1)
  }
}

// 스크립트 실행
setupPMSQueueSheet()
