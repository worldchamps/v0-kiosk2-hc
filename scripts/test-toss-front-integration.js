const { WebSocketServer } = require("ws")
const { randomUUID } = require("crypto")

const port = 19000
const pairingKey = "test-pairing-key-123456789"
process.env.TOSS_FRONT_WS_URL = `ws://127.0.0.1:${port}/kiosk`
process.env.TOSS_FRONT_PAIRING_KEY = pairingKey

const payments = new Map()
let recoveryRequests = 0
const server = new WebSocketServer({ port, path: "/kiosk" })

server.on("connection", (socket) => {
  let authenticated = false
  socket.on("message", (raw) => {
    const message = JSON.parse(raw.toString("utf8"))
    if (message.type === "AUTH") {
      authenticated = message.pairingKey === pairingKey
      socket.send(JSON.stringify({ type: "AUTH_RESULT", success: authenticated }))
      return
    }
    if (!authenticated) return

    if (message.type === "PAYMENT_REQUEST") {
      if (message.paymentKey === "KIOSK-CANCELED-TEST") {
        socket.send(JSON.stringify({ type: "PAYMENT_FAILED", requestId: message.requestId, reason: "CANCELED" }))
        return
      }
      const payment = {
        paymentKey: message.paymentKey,
        amount: message.amount,
        tax: Math.floor(message.amount / 11),
        supplyValue: message.amount - Math.floor(message.amount / 11),
        paymentMethod: "CARD",
        tid: `TEST-${randomUUID()}`,
        approvalNumber: "12345678",
        timestamp: Date.now(),
        installment: 0,
        issuerName: "테스트카드",
        maskedCardNumber: "1234-****-****-5678",
        van: "TEST_VAN",
      }
      payments.set(message.paymentKey, payment)
      if (message.paymentKey === "KIOSK-DISCONNECT-RECOVERY-TEST") {
        socket.close()
      } else {
        socket.send(JSON.stringify({ type: "PAYMENT_SUCCESS", requestId: message.requestId, payment }))
      }
    } else if (message.type === "QR_SCAN_REQUEST") {
      socket.send(
        JSON.stringify({
          type: "QR_SCAN_SUCCESS",
          requestId: message.requestId,
          value: "AGAIN:RESERVATION:R20260728-8K4M2",
        }),
      )
    } else if (message.type === "RECOVER_PAYMENT") {
      recoveryRequests += 1
      const payment = payments.get(message.paymentKey)
      socket.send(
        JSON.stringify(
          payment
            ? { type: "RECOVERY_SUCCESS", requestId: message.requestId, payment }
            : { type: "RECOVERY_FAILED", requestId: message.requestId, message: "not found" },
        ),
      )
    } else if (message.type === "CANCEL_REQUEST") {
      socket.send(JSON.stringify({ type: "CANCEL_SUCCESS", requestId: message.requestId, cancel: message.payment }))
    }
  })
})

async function waitForAuthentication(bridge) {
  if (bridge.status.authenticated) return
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("authentication timeout")), 3000)
    bridge.on("status", (status) => {
      if (status.authenticated) {
        clearTimeout(timer)
        resolve()
      }
    })
  })
}

async function run() {
  const bridge = require("../electron/toss-front-bridge")
  bridge.connect()
  await waitForAuthentication(bridge)

  const payment = await bridge.requestPayment({ amount: 11000, paymentKey: "KIOSK-INTEGRATION-TEST" })
  if (payment.amount !== 11000 || payment.signature.length !== 64) {
    throw new Error("signed payment proof validation failed")
  }

  const recoveryRequestsBeforeCancel = recoveryRequests
  await bridge.requestPayment({ amount: 11000, paymentKey: "KIOSK-CANCELED-TEST" }).then(
    () => { throw new Error("canceled payment unexpectedly succeeded") },
    (error) => {
      if (error.message !== "결제가 취소되었습니다.") throw error
      if (error.code !== "PAYMENT_NOT_APPROVED") throw new Error("explicit terminal cancellation lost its non-approval status")
    },
  )
  if (recoveryRequests !== recoveryRequestsBeforeCancel) {
    throw new Error("canceled payment triggered recovery")
  }

  const recovered = await bridge.recoverPayment({ amount: 11000, paymentKey: payment.paymentKey })
  if (recovered.tid !== payment.tid) throw new Error("payment recovery validation failed")

  await bridge.cancelPayment(payment)

  const qrValue = await bridge.requestQrScan()
  if (qrValue !== "AGAIN:RESERVATION:R20260728-8K4M2") {
    throw new Error("QR scan integration failed")
  }

  const recoveredAfterDisconnect = await bridge.requestPayment({
    amount: 22000,
    paymentKey: "KIOSK-DISCONNECT-RECOVERY-TEST",
  })
  if (recoveredAfterDisconnect.amount !== 22000 || recoveredAfterDisconnect.signature.length !== 64) {
    throw new Error("automatic recovery after disconnect failed")
  }

  console.log("Toss Front integration test passed")
  bridge.close()
  await new Promise((resolve) => server.close(resolve))
}

run().catch(async (error) => {
  console.error(error)
  const bridge = require("../electron/toss-front-bridge")
  bridge.close()
  await new Promise((resolve) => server.close(resolve))
  process.exitCode = 1
})
