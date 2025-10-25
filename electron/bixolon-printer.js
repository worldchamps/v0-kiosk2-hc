const { spawn } = require("child_process")
const path = require("path")

class BixolonPrinter {
  constructor() {
    this.connected = false
    this.wrapperPath = path.join(__dirname, "../bin/BixolonPrinterWrapper.exe")
  }

  // 래퍼 프로그램 실행
  async executeCommand(command, ...args) {
    return new Promise((resolve, reject) => {
      const process = spawn(this.wrapperPath, [command, ...args])
      let output = ""
      let error = ""

      process.stdout.on("data", (data) => {
        output += data.toString()
      })

      process.stderr.on("data", (data) => {
        error += data.toString()
      })

      process.on("close", (code) => {
        if (code !== 0 || error) {
          reject(new Error(error || `Process exited with code ${code}`))
        } else {
          resolve(output.trim())
        }
      })
    })
  }

  // COM 포트로 연결
  async connect(portName = "COM2", baudRate = 9600) {
    try {
      const result = await this.executeCommand("connect", portName, baudRate.toString())
      this.connected = result === "OK"
      console.log(`[BIXOLON] Connect result: ${result}`)
      return this.connected
    } catch (error) {
      console.error("[BIXOLON] Connection error:", error.message)
      this.connected = false
      return false
    }
  }

  // 연결 해제
  async disconnect() {
    try {
      await this.executeCommand("disconnect")
      this.connected = false
      console.log("[BIXOLON] Disconnected")
    } catch (error) {
      console.error("[BIXOLON] Disconnect error:", error.message)
    }
  }

  // 텍스트 인쇄
  async printText(text) {
    if (!this.connected) {
      console.error("[BIXOLON] Printer not connected")
      return false
    }

    try {
      const result = await this.executeCommand("print", text)
      return result === "OK"
    } catch (error) {
      console.error("[BIXOLON] Print error:", error.message)
      return false
    }
  }

  // 용지 절단
  async cutPaper() {
    if (!this.connected) return false

    try {
      const result = await this.executeCommand("cut")
      return result === "OK"
    } catch (error) {
      console.error("[BIXOLON] Cut paper error:", error.message)
      return false
    }
  }

  // 프린터 상태 확인
  async getStatus() {
    if (!this.connected) return null

    try {
      const result = await this.executeCommand("status")
      const match = result.match(/STATUS: (\d+)/)
      return match ? Number.parseInt(match[1]) : null
    } catch (error) {
      console.error("[BIXOLON] Get status error:", error.message)
      return null
    }
  }

  // 줄 바꿈
  async lineFeed(lines = 1) {
    if (!this.connected) return false

    try {
      const result = await this.executeCommand("linefeed", lines.toString())
      return result === "OK"
    } catch (error) {
      console.error("[BIXOLON] Line feed error:", error.message)
      return false
    }
  }
}

module.exports = new BixolonPrinter()
