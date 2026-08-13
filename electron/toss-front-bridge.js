const { EventEmitter } = require("events")
const { createHmac, randomUUID, timingSafeEqual } = require("crypto")
const { SerialPort } = require("serialport")
const WebSocket = require("ws")

class TossFrontBridge extends EventEmitter {
  constructor() {
    super()
    this.url = process.env.TOSS_FRONT_WS_URL?.trim() || ""
    this.pairingKey = process.env.TOSS_FRONT_PAIRING_KEY?.trim() || ""
    this.transport = (process.env.TOSS_FRONT_TRANSPORT?.trim().toLowerCase() || "auto")
    this.serialPath = process.env.TOSS_FRONT_SERIAL_PATH?.trim() || ""
    this.serialBaudRate = Number.parseInt(process.env.TOSS_FRONT_SERIAL_BAUD_RATE || "115200", 10)
    this.ws = null
    this.serialPort = null
    this.serialBuffer = ""
    this.authenticated = false
    this.activeTransport = null
    this.reconnectTimer = null
    this.reconnectAttempts = 0
    this.pending = new Map()
    this.closed = false
  }

  get websocketConfigured() {
    return Boolean(this.url)
  }

  get serialConfigured() {
    return Boolean(this.serialPath)
  }

  get configured() {
    return Boolean(this.pairingKey) && (this.websocketConfigured || this.serialConfigured)
  }

  get status() {
    return {
      configured: this.configured,
      connected: this.isConnected(),
      authenticated: this.authenticated,
      transport: this.activeTransport || this.resolveTransportPreference(),
      transportPreference: this.transport,
      url: this.url,
      serialPath: this.serialPath,
      serialBaudRate: this.serialBaudRate,
    }
  }

  emitStatus(error) {
    this.emit("status", { ...this.status, error })
  }

  resolveTransportPreference() {
    if (this.transport === "websocket" || this.transport === "serial") {
      return this.transport
    }
    if (this.websocketConfigured) return "websocket"
    if (this.serialConfigured) return "serial"
    return "websocket"
  }

  isConnected() {
    if (this.activeTransport === "websocket") {
      return this.ws?.readyState === WebSocket.OPEN
    }
    if (this.activeTransport === "serial") {
      return Boolean(this.serialPort?.isOpen)
    }
    return false
  }

  connect() {
    if (this.closed) return
    if (!this.pairingKey) {
      this.emitStatus("토스 프론트 페어링 키 설정이 필요합니다.")
      return
    }

    const preferred = this.resolveTransportPreference()
    const error = this.connectTransport(preferred)
    if (error && this.transport === "auto") {
      const fallback = preferred === "websocket" ? "serial" : "websocket"
      if ((fallback === "websocket" && this.websocketConfigured) || (fallback === "serial" && this.serialConfigured)) {
        const fallbackError = this.connectTransport(fallback)
        this.emitStatus(fallbackError || error)
        return
      }
    }

    if (error) {
      this.emitStatus(error)
    }
  }

  connectTransport(transport) {
    if (transport === "websocket") {
      if (!this.websocketConfigured) {
        return "토스 프론트 웹소켓 주소 설정이 필요합니다."
      }
      if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
        return null
      }
      this.connectWebSocket()
      return null
    }

    if (transport === "serial") {
      if (!this.serialConfigured) {
        return "토스 프론트 시리얼 포트 설정이 필요합니다."
      }
      if (this.serialPort && this.serialPort.isOpen) {
        return null
      }
      this.connectSerial()
      return null
    }

    return "지원하지 않는 토스 프론트 연결 방식입니다."
  }

  connectWebSocket() {
    try {
      const socket = new WebSocket(this.url, { handshakeTimeout: 10000, maxPayload: 1024 * 1024 })
      this.ws = socket
      this.activeTransport = "websocket"

      socket.on("open", () => {
        if (this.ws !== socket) return
        this.reconnectAttempts = 0
        this.authenticated = false
        this.sendRaw({ type: "AUTH", pairingKey: this.pairingKey })
        this.emitStatus()
      })

      socket.on("message", (raw) => {
        if (this.ws === socket) this.handleIncoming(raw.toString("utf8"))
      })

      socket.on("close", () => {
        if (this.ws !== socket) return
        this.ws = null
        this.authenticated = false
        this.activeTransport = null
        this.rejectPending("토스 프론트 연결이 끊어졌습니다.")
        this.emitStatus()
        this.scheduleReconnect()
      })

      socket.on("error", (error) => {
        if (this.ws === socket) this.emitStatus(error.message)
      })
    } catch (error) {
      this.activeTransport = null
      this.emitStatus(error.message)
      this.scheduleReconnect()
    }
  }

  connectSerial() {
    try {
      const port = new SerialPort({
        path: this.serialPath,
        baudRate: this.serialBaudRate,
        autoOpen: false,
      })

      this.serialPort = port
      this.activeTransport = "serial"
      this.serialBuffer = ""

      port.on("data", (chunk) => {
        if (this.serialPort === port) this.handleSerialData(chunk)
      })

      port.on("close", () => {
        if (this.serialPort !== port) return
        this.serialPort = null
        this.serialBuffer = ""
        this.authenticated = false
        this.activeTransport = null
        this.rejectPending("토스 프론트 시리얼 연결이 끊어졌습니다.")
        this.emitStatus()
        this.scheduleReconnect()
      })

      port.on("error", (error) => {
        if (this.serialPort === port) this.emitStatus(error.message)
      })

      port.open((error) => {
        if (error) {
          if (this.serialPort === port) {
            this.serialPort = null
            this.activeTransport = null
          }
          this.emitStatus(error.message)
          this.scheduleReconnect()
          return
        }

        this.reconnectAttempts = 0
        this.authenticated = false
        this.sendRaw({ type: "AUTH", pairingKey: this.pairingKey })
        this.emitStatus()
      })
    } catch (error) {
      this.activeTransport = null
      this.emitStatus(error.message)
      this.scheduleReconnect()
    }
  }

  reconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }

    this.closed = false
    this.authenticated = false
    this.rejectPending("토스 프론트 연결을 다시 시작합니다.")

    const previousSocket = this.ws
    this.ws = null
    previousSocket?.removeAllListeners()
    previousSocket?.close()

    const previousSerial = this.serialPort
    this.serialPort = null
    this.serialBuffer = ""
    previousSerial?.removeAllListeners()
    if (previousSerial?.isOpen) {
      previousSerial.close(() => {})
    }

    this.activeTransport = null
    this.connect()
  }

  scheduleReconnect() {
    if (this.closed || !this.configured || this.reconnectTimer) return
    const delay = Math.min(30000, 1000 * 2 ** Math.min(this.reconnectAttempts, 5))
    this.reconnectAttempts += 1
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, delay)
  }

  close() {
    this.closed = true
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
    this.rejectPending("토스 프론트 연결이 종료되었습니다.")
    this.ws?.close()
    this.ws = null
    if (this.serialPort?.isOpen) {
      this.serialPort.close(() => {})
    }
    this.serialPort = null
    this.serialBuffer = ""
    this.activeTransport = null
  }

  sendRaw(payload) {
    if (this.activeTransport === "websocket") {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        throw new Error("토스 프론트 웹소켓이 연결되지 않았습니다.")
      }
      this.ws.send(JSON.stringify(payload))
      return
    }

    if (this.activeTransport === "serial") {
      if (!this.serialPort || !this.serialPort.isOpen) {
        throw new Error("토스 프론트 시리얼 포트가 연결되지 않았습니다.")
      }
      this.serialPort.write(`${JSON.stringify(payload)}\n`)
      return
    }

    throw new Error("토스 프론트 연결이 준비되지 않았습니다.")
  }

  request(type, payload, timeoutMs = 75000) {
    if (!this.authenticated) {
      return Promise.reject(new Error("토스 프론트 인증 연결이 준비되지 않았습니다."))
    }

    const requestId = randomUUID()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId)
        reject(new Error("토스 프론트 응답 시간이 초과되었습니다."))
      }, timeoutMs)

      this.pending.set(requestId, { resolve, reject, timer, type, payload })

      try {
        this.sendRaw({ type, requestId, ...payload })
      } catch (error) {
        clearTimeout(timer)
        this.pending.delete(requestId)
        reject(error)
      }
    })
  }

  async requestPayment({ amount, paymentKey }) {
    if (!Number.isInteger(amount) || amount <= 0) throw new Error("결제 금액이 올바르지 않습니다.")
    const stablePaymentKey = paymentKey || `KIOSK-${Date.now()}-${randomUUID()}`

    try {
      const result = await this.request("PAYMENT_REQUEST", { amount, paymentKey: stablePaymentKey })
      return this.signPayment(result.payment)
    } catch (originalError) {
      if (originalError instanceof Error && originalError.code === "PAYMENT_FAILED") {
        throw new Error(originalError.message === "CANCELED" ? "결제가 취소되었습니다." : originalError.message)
      }
      try {
        await this.waitForAuthentication(15000)
        return await this.recoverPayment({ amount, paymentKey: stablePaymentKey })
      } catch (recoveryError) {
        const originalMessage = originalError instanceof Error ? originalError.message : String(originalError)
        const recoveryMessage = recoveryError instanceof Error ? recoveryError.message : String(recoveryError)
        throw new Error(`${originalMessage} 승인 복구 결과: ${recoveryMessage}`)
      }
    }
  }

  waitForAuthentication(timeoutMs) {
    if (this.authenticated) return Promise.resolve()
    this.connect()

    return new Promise((resolve, reject) => {
      const onStatus = (status) => {
        if (!status.authenticated) return
        cleanup()
        resolve()
      }

      const timer = setTimeout(() => {
        cleanup()
        reject(new Error("토스 프론트 재연결 시간이 초과되었습니다."))
      }, timeoutMs)

      const cleanup = () => {
        clearTimeout(timer)
        this.off("status", onStatus)
      }

      this.on("status", onStatus)
    })
  }

  async recoverPayment({ amount, paymentKey }) {
    const result = await this.request("RECOVER_PAYMENT", { amount, paymentKey }, 15000)
    return this.signPayment(result.payment)
  }

  async requestQrScan() {
    const result = await this.request("QR_SCAN_REQUEST", {}, 120000)
    if (typeof result.value !== "string" || !result.value.trim()) {
      throw new Error("토스 프론트에서 QR 값을 받지 못했습니다.")
    }
    return result.value
  }

  async cancelPayment(payment) {
    if (!this.verifySignedPayment(payment)) {
      throw new Error("취소할 결제 정보의 서명이 올바르지 않습니다.")
    }
    const result = await this.request("CANCEL_REQUEST", { payment }, 75000)
    return result.cancel
  }

  handleSerialData(chunk) {
    this.serialBuffer += chunk.toString("utf8")

    while (true) {
      const delimiterIndex = this.serialBuffer.indexOf("\n")
      if (delimiterIndex === -1) break

      const line = this.serialBuffer.slice(0, delimiterIndex).trim()
      this.serialBuffer = this.serialBuffer.slice(delimiterIndex + 1)
      if (!line) continue

      this.handleIncoming(line)
    }
  }

  handleIncoming(raw) {
    let message
    try {
      message = JSON.parse(raw)
    } catch {
      return
    }

    if (message.type === "AUTH_RESULT") {
      this.authenticated = message.success === true
      this.emitStatus(this.authenticated ? undefined : "토스 프론트 페어링 키가 일치하지 않습니다.")
      return
    }

    if (!message.requestId) return

    const pending = this.pending.get(message.requestId)
    if (!pending) return
    clearTimeout(pending.timer)
    this.pending.delete(message.requestId)

    if (
      message.type === "PAYMENT_SUCCESS" ||
      message.type === "RECOVERY_SUCCESS" ||
      message.type === "CANCEL_SUCCESS" ||
      message.type === "QR_SCAN_SUCCESS"
    ) {
      if (message.payment) {
        if (
          message.payment.paymentKey !== pending.payload.paymentKey ||
          message.payment.amount !== pending.payload.amount
        ) {
          pending.reject(new Error("토스 프론트 응답의 결제 정보가 요청과 일치하지 않습니다."))
          return
        }
      }
      pending.resolve(message)
      return
    }

    const error = new Error(message.message || message.reason || "토스 프론트 결제가 완료되지 않았습니다.")
    error.code = message.type
    pending.reject(error)
  }

  signPayment(payment) {
    const unsigned = {
      paymentKey: payment.paymentKey,
      amount: payment.amount,
      tax: payment.tax,
      supplyValue: payment.supplyValue,
      paymentMethod: payment.paymentMethod,
      tid: payment.tid,
      approvalNumber: payment.approvalNumber,
      timestamp: payment.timestamp,
      installment: payment.installment || 0,
      issuerName: payment.issuerName,
      maskedCardNumber: payment.maskedCardNumber,
      van: payment.van,
      vanTransactionManagementId: payment.vanTransactionManagementId,
    }

    const signature = createHmac("sha256", this.pairingKey)
      .update(this.proofPayload(unsigned))
      .digest("hex")

    return { ...unsigned, signature }
  }

  proofPayload(payment) {
    return JSON.stringify({
      paymentKey: payment.paymentKey,
      amount: payment.amount,
      tax: payment.tax,
      supplyValue: payment.supplyValue,
      paymentMethod: payment.paymentMethod,
      tid: payment.tid,
      approvalNumber: payment.approvalNumber,
      timestamp: payment.timestamp,
      installment: payment.installment,
      vanTransactionManagementId: payment.vanTransactionManagementId,
    })
  }

  verifySignedPayment(payment) {
    if (!payment?.signature) return false

    const signature = createHmac("sha256", this.pairingKey)
      .update(this.proofPayload(payment))
      .digest("hex")

    const actual = Buffer.from(payment.signature, "hex")
    const expected = Buffer.from(signature, "hex")
    return actual.length === expected.length && timingSafeEqual(actual, expected)
  }

  rejectPending(message) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(new Error(message))
    }
    this.pending.clear()
  }
}

module.exports = new TossFrontBridge()
