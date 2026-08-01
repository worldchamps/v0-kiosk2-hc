const { EventEmitter } = require("events")
const { createHmac, randomUUID, timingSafeEqual } = require("crypto")
const WebSocket = require("ws")

class TossFrontBridge extends EventEmitter {
  constructor() {
    super()
    this.url = process.env.TOSS_FRONT_WS_URL?.trim() || ""
    this.pairingKey = process.env.TOSS_FRONT_PAIRING_KEY?.trim() || ""
    this.ws = null
    this.authenticated = false
    this.reconnectTimer = null
    this.reconnectAttempts = 0
    this.pending = new Map()
    this.closed = false
  }

  get configured() {
    return Boolean(this.url && this.pairingKey)
  }

  get status() {
    return {
      configured: this.configured,
      connected: this.ws?.readyState === WebSocket.OPEN,
      authenticated: this.authenticated,
      url: this.url,
    }
  }

  emitStatus(error) {
    this.emit("status", { ...this.status, error })
  }

  connect() {
    if (!this.configured || this.closed) {
      this.emitStatus(this.configured ? undefined : "토스 프론트 연결 설정이 필요합니다.")
      return
    }
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return
    }

    try {
      const socket = new WebSocket(this.url, { handshakeTimeout: 10000, maxPayload: 1024 * 1024 })
      this.ws = socket
      socket.on("open", () => {
        if (this.ws !== socket) return
        this.reconnectAttempts = 0
        this.authenticated = false
        this.sendRaw({ type: "AUTH", pairingKey: this.pairingKey })
        this.emitStatus()
      })
      socket.on("message", (raw) => {
        if (this.ws === socket) this.handleMessage(raw)
      })
      socket.on("close", () => {
        if (this.ws !== socket) return
        this.authenticated = false
        this.rejectPending("토스 프론트 연결이 끊어졌습니다.")
        this.emitStatus()
        this.scheduleReconnect()
      })
      socket.on("error", (error) => {
        if (this.ws === socket) this.emitStatus(error.message)
      })
    } catch (error) {
      this.emitStatus(error.message)
      this.scheduleReconnect()
    }
  }

  reconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    const previousSocket = this.ws
    this.ws = null
    this.authenticated = false
    this.rejectPending("토스 프론트 연결을 다시 시작합니다.")
    previousSocket?.removeAllListeners()
    previousSocket?.close()
    this.closed = false
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
  }

  sendRaw(payload) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("토스 프론트가 연결되지 않았습니다.")
    }
    this.ws.send(JSON.stringify(payload))
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

  handleMessage(raw) {
    let message
    try {
      message = JSON.parse(raw.toString("utf8"))
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
          pending.reject(new Error("토스 프론트 응답이 요청한 결제와 일치하지 않습니다."))
          return
        }
      }
      pending.resolve(message)
      return
    }

    pending.reject(new Error(message.message || message.reason || "토스 프론트 결제가 완료되지 않았습니다."))
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
