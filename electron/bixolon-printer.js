const ffi = require("ffi-napi")
const ref = require("ref-napi")
const path = require("path")

// BXLPApi.dll 로드
const bxlApi = ffi.Library(path.join(__dirname, "../bin/BXLPApi.dll"), {
  ConnectSerial: ["int", ["string", "int"]],
  DisconnectSerial: ["int", []],
  PrintText: ["int", ["string", "int", "int", "int", "int"]],
  LineFeed: ["int", ["int"]],
  CutPaper: ["int", []],
  GetStatus: ["int", []],
})

class BixolonPrinter {
  constructor() {
    this.connected = false
  }

  // COM 포트로 연결
  connect(portName = "COM2", baudRate = 9600) {
    try {
      const result = bxlApi.ConnectSerial(portName, baudRate)
      this.connected = result === 0
      return this.connected
    } catch (error) {
      console.error("[BIXOLON] Connection error:", error)
      return false
    }
  }

  // 연결 해제
  disconnect() {
    try {
      bxlApi.DisconnectSerial()
      this.connected = false
    } catch (error) {
      console.error("[BIXOLON] Disconnect error:", error)
    }
  }

  // 텍스트 인쇄
  printText(text, alignment = 0, attribute = 0, textSize = 0) {
    if (!this.connected) {
      console.error("[BIXOLON] Printer not connected")
      return false
    }

    try {
      const result = bxlApi.PrintText(text, alignment, attribute, textSize, 0)
      return result === 0
    } catch (error) {
      console.error("[BIXOLON] Print error:", error)
      return false
    }
  }

  // 용지 절단
  cutPaper() {
    if (!this.connected) return false

    try {
      const result = bxlApi.CutPaper()
      return result === 0
    } catch (error) {
      console.error("[BIXOLON] Cut paper error:", error)
      return false
    }
  }

  // 프린터 상태 확인
  getStatus() {
    if (!this.connected) return null

    try {
      return bxlApi.GetStatus()
    } catch (error) {
      console.error("[BIXOLON] Get status error:", error)
      return null
    }
  }

  // 줄 바꿈
  lineFeed(lines = 1) {
    if (!this.connected) return false

    try {
      const result = bxlApi.LineFeed(lines)
      return result === 0
    } catch (error) {
      console.error("[BIXOLON] Line feed error:", error)
      return false
    }
  }
}

module.exports = new BixolonPrinter()
