(function () {
  const config = window.KIOSK_FRONT_CONFIG;
  const authenticatedConnections = new Set();
  const activePayments = new Set();
  const connections = new Map();
  let activeQrScan = null;
  let server = null;
  let serialPort = null;
  let serialReader = null;
  let serialWriter = null;
  let serialConnectionId = null;

  function setStatus(text, type) {
    const logger = type === "error" ? console.error : console.log;
    logger(`[Kiosk Front] ${text}`);
  }

  async function getPairingKey() {
    try {
      const stored = await sdk.storage.get({ key: "kioskPairingKey" });
      if (stored && stored.value) return stored.value;
    } catch (error) {
      console.warn("페어링 키를 읽지 못했습니다.", error);
    }
    return config.developmentPairingKey;
  }

  async function getSerialBaudRate() {
    try {
      const stored = await sdk.storage.get({ key: "kioskSerialBaudRate" });
      if (stored?.value) {
        const parsed = Number.parseInt(stored.value, 10);
        if (Number.isFinite(parsed) && parsed > 0) return parsed;
      }
    } catch (error) {
      console.warn("시리얼 속도 설정을 읽지 못했습니다.", error);
    }
    return config.serial?.baudRate || 115200;
  }

  function renderIdle() {
    sdk.template.renderIdlePage();
  }

  function buildOrder(amount) {
    return {
      items: [
        {
          label: "카드 결제",
          quantity: 1,
          value: amount,
        },
      ],
      summary: {
        totalAmount: amount,
      },
    };
  }

  function renderPaymentStart(amount) {
    sdk.template.renderOrderPage({
      order: buildOrder(amount),
      onClick: () => {},
      onBack: () => {},
    });
  }

  function renderPaymentResult(title, description) {
    sdk.template.renderResultPage({
      title,
      description,
      button: {
        text: "확인",
      },
      onClick: () => {},
    });
  }

  function trackConnection(connectionId, sendFn) {
    connections.set(connectionId, { send: sendFn });
  }

  function releaseConnection(connectionId) {
    connections.delete(connectionId);
    authenticatedConnections.delete(connectionId);
    if (activeQrScan?.connectionId === connectionId) {
      activeQrScan = null;
      renderIdle();
    }
  }

  async function send(connectionId, payload) {
    const connection = connections.get(connectionId);
    if (!connection) {
      throw new Error("연결을 찾을 수 없습니다.");
    }
    await connection.send(payload);
  }

  function normalizePayment(paymentKey, amount, response) {
    const detail = response.card || response.barcode || {};
    const tax = Math.floor(amount / 11);
    return {
      paymentKey,
      amount,
      tax,
      supplyValue: amount - tax,
      paymentMethod: response.paymentMethod,
      tid: response.tid || "",
      approvalNumber: detail.approvalNumber || "",
      timestamp: detail.timestamp || 0,
      installment: detail.installment || 0,
      issuerName: detail.issuerName || "",
      maskedCardNumber: detail.maskedCardNumber || "",
      van: detail.van || "",
      vanTransactionManagementId: response.extraData?.vanTransactionManagementId || "",
    };
  }

  async function findPayment(paymentKey, amount) {
    try {
      const result = await sdk.payment.getPayment({ paymentKey });
      if (result && result.type === "SUCCESS") {
        return normalizePayment(paymentKey, amount, result.response);
      }
    } catch (error) {
      if (!String(error).includes("PAYMENT_NOT_FOUND")) {
        console.warn("결제 복구 조회 실패", error);
      }
    }
    return null;
  }

  async function processPayment(connectionId, request) {
    const { requestId, paymentKey, amount } = request;
    if (!paymentKey || !Number.isInteger(amount) || amount <= 0) {
      await send(connectionId, { type: "PAYMENT_FAILED", requestId, message: "결제 요청값이 올바르지 않습니다." });
      return;
    }
    if (activePayments.has(paymentKey)) {
      await send(connectionId, { type: "PAYMENT_FAILED", requestId, message: "이미 처리 중인 결제입니다." });
      return;
    }

    activePayments.add(paymentKey);
    try {
      const recovered = await findPayment(paymentKey, amount);
      if (recovered) {
        renderPaymentResult("결제 승인 완료", "이전 승인 내역을 확인했습니다.");
        await send(connectionId, { type: "PAYMENT_SUCCESS", requestId, payment: recovered, recovered: true });
        return;
      }

      renderPaymentStart(amount);
      const tax = Math.floor(amount / 11);
      const result = await sdk.payment.requestPayment({
        paymentKey,
        tax,
        supplyValue: amount - tax,
        tip: 0,
        installment: 0,
        timeoutMs: 60000,
        localeCode: "ko",
        excludePaymentTypes: ["CASH"],
      });

      if (result.type !== "SUCCESS") {
        sdk.payment.resetBackupPaymentKey();
        await send(connectionId, { type: "PAYMENT_FAILED", requestId, reason: result.type });
        return;
      }

      const payment = normalizePayment(paymentKey, amount, result.response);
      renderPaymentResult("결제 승인 완료", `${amount.toLocaleString("ko-KR")}원 결제가 승인되었습니다.`);
      await send(connectionId, { type: "PAYMENT_SUCCESS", requestId, payment });
      sdk.payment.resetBackupPaymentKey();
    } catch (error) {
      await send(connectionId, {
        type: "PAYMENT_FAILED",
        requestId,
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      activePayments.delete(paymentKey);
      renderIdle();
    }
  }

  async function recoverPayment(connectionId, request) {
    const payment = await findPayment(request.paymentKey, request.amount);
    if (payment) {
      await send(connectionId, { type: "RECOVERY_SUCCESS", requestId: request.requestId, payment });
    } else {
      await send(connectionId, {
        type: "RECOVERY_FAILED",
        requestId: request.requestId,
        message: "복구할 승인 결과가 없습니다.",
      });
    }
  }

  async function cancelPayment(connectionId, request) {
    const payment = request.payment;
    try {
      const result = await sdk.payment.requestPaymentCancel({
        paymentKey: payment.paymentKey,
        paymentMethod: payment.paymentMethod,
        tax: payment.tax,
        supplyValue: payment.supplyValue,
        tip: 0,
        timestamp: payment.timestamp,
        approvalNumber: payment.approvalNumber,
        installment: payment.installment || 0,
        tid: payment.tid,
        timeoutMs: 60000,
        localeCode: "ko",
        extraData: payment.vanTransactionManagementId
          ? { vanTransactionManagementId: payment.vanTransactionManagementId }
          : undefined,
      });
      if (result.type !== "SUCCESS") {
        await send(connectionId, { type: "CANCEL_FAILED", requestId: request.requestId, reason: result.type });
        return;
      }
      renderPaymentResult("결제 취소 완료", `${payment.amount.toLocaleString("ko-KR")}원 결제가 취소되었습니다.`);
      await send(connectionId, {
        type: "CANCEL_SUCCESS",
        requestId: request.requestId,
        cancel: normalizePayment(payment.paymentKey, payment.amount, result.response),
      });
    } catch (error) {
      await send(connectionId, {
        type: "CANCEL_FAILED",
        requestId: request.requestId,
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      renderIdle();
    }
  }

  async function processQrScan(connectionId, request) {
    if (activeQrScan) {
      await send(connectionId, {
        type: "QR_SCAN_FAILED",
        requestId: request.requestId,
        message: "이미 QR 코드를 스캔하고 있어요.",
      });
      return;
    }

    activeQrScan = { connectionId, requestId: request.requestId };

    try {
      sdk.template.renderQRScanPage({
        title: "예약 QR 코드를 스캔해 주세요",
        onSuccess: async (data) => {
          const scan = activeQrScan;
          activeQrScan = null;
          if (!scan) return;

          try {
            await send(scan.connectionId, {
              type: "QR_SCAN_SUCCESS",
              requestId: scan.requestId,
              value: data.value,
            });
          } finally {
            renderIdle();
          }
        },
        onBack: async () => {
          const scan = activeQrScan;
          activeQrScan = null;
          if (!scan) return;

          try {
            await send(scan.connectionId, {
              type: "QR_SCAN_CANCELED",
              requestId: scan.requestId,
              message: "QR 스캔이 취소되었습니다.",
            });
          } finally {
            renderIdle();
          }
        },
      });
    } catch (error) {
      activeQrScan = null;
      await send(connectionId, {
        type: "QR_SCAN_FAILED",
        requestId: request.requestId,
        message: error instanceof Error ? error.message : String(error),
      });
      renderIdle();
    }
  }

  async function handleMessage(payload) {
    let request;
    try {
      request = JSON.parse(payload.data);
    } catch {
      return;
    }

    if (request.type === "AUTH") {
      const pairingKey = await getPairingKey();
      const success = pairingKey !== "CHANGE_ME" && request.pairingKey === pairingKey;
      if (success) authenticatedConnections.add(payload.connectionId);
      await send(payload.connectionId, { type: "AUTH_RESULT", success });
      setStatus(success ? "키오스크 연결됨" : "페어링 키 확인 필요", success ? "connected" : "error");
      return;
    }

    if (!authenticatedConnections.has(payload.connectionId)) {
      await send(payload.connectionId, { type: "ERROR", requestId: request.requestId, message: "인증되지 않은 연결입니다." });
      return;
    }

    if (request.type === "PAYMENT_REQUEST") {
      await processPayment(payload.connectionId, request);
    } else if (request.type === "RECOVER_PAYMENT") {
      await recoverPayment(payload.connectionId, request);
    } else if (request.type === "CANCEL_REQUEST") {
      await cancelPayment(payload.connectionId, request);
    } else if (request.type === "QR_SCAN_REQUEST") {
      await processQrScan(payload.connectionId, request);
    }
  }

  async function closeSerialConnection() {
    const connectionId = serialConnectionId;
    serialConnectionId = null;

    if (serialReader) {
      try {
        await serialReader.cancel();
      } catch {}
      try {
        serialReader.releaseLock();
      } catch {}
      serialReader = null;
    }

    if (serialWriter) {
      try {
        serialWriter.releaseLock();
      } catch {}
      serialWriter = null;
    }

    if (serialPort) {
      try {
        await serialPort.close();
      } catch {}
      serialPort = null;
    }

    if (connectionId) {
      releaseConnection(connectionId);
    }
  }

  async function readSerialLoop(port, reader, connectionId) {
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (serialPort === port) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        while (true) {
          const delimiterIndex = buffer.indexOf("\n");
          if (delimiterIndex === -1) break;
          const line = buffer.slice(0, delimiterIndex).trim();
          buffer = buffer.slice(delimiterIndex + 1);
          if (!line) continue;
          await handleMessage({ connectionId, data: line });
        }
      }
    } catch (error) {
      console.warn("시리얼 수신이 종료되었습니다.", error);
    } finally {
      if (serialConnectionId === connectionId) {
        await closeSerialConnection();
      }
    }
  }

  async function startSerial() {
    if (!("serial" in navigator)) {
      return;
    }

    try {
      const ports = await navigator.serial.getPorts();
      if (!ports.length) {
        setStatus("시리얼 포트 권한이 없어 네트워크 연결만 대기합니다.");
        return;
      }

      const port = ports[0];
      const baudRate = await getSerialBaudRate();
      await port.open({ baudRate });

      const writer = port.writable.getWriter();
      const reader = port.readable.getReader();
      const connectionId = "serial";
      const encoder = new TextEncoder();

      serialPort = port;
      serialWriter = writer;
      serialReader = reader;
      serialConnectionId = connectionId;

      trackConnection(connectionId, async (payload) => {
        await writer.write(encoder.encode(`${JSON.stringify(payload)}\n`));
      });

      setStatus(`시리얼 연결 대기 중 (${baudRate}bps)`);
      void readSerialLoop(port, reader, connectionId);
    } catch (error) {
      setStatus(`시리얼 연결 실패: ${String(error)}`, "error");
      await closeSerialConnection();
    }
  }

  async function initialize() {
    try {
      renderIdle();
      server = await sdk.websocket.start({
        port: config.port,
        path: config.path,
        onConnection: (payload) => {
          trackConnection(payload.connectionId, async (message) => {
            await server.send(payload.connectionId, JSON.stringify(message));
          });
          setStatus("키오스크 인증 대기 중");
        },
        onMessage: (payload) => void handleMessage(payload),
        onDisconnection: (payload) => {
          releaseConnection(payload.connectionId);
          setStatus("키오스크 연결 대기 중");
        },
        onError: (payload) => setStatus(payload.message || "WebSocket 오류", "error"),
      });
      console.log(`WebSocket server: ws://${server.host}:${server.port}${server.path}`);
      await startSerial();
    } catch (error) {
      setStatus(`서버 시작 실패: ${String(error)}`, "error");
    }
  }

  window.addEventListener("beforeunload", () => {
    if (server) void server.stop();
    void closeSerialConnection();
  });

  void initialize();
})();
