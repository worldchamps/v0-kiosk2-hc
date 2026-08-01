(function () {
  const config = window.KIOSK_FRONT_CONFIG;
  const authenticatedConnections = new Set();
  const activePayments = new Set();
  let activeQrScan = null;
  let server = null;

  function setStatus(text, type) {
    const logger = type === "error" ? console.error : console.log;
    logger(`[Kiosk Front] ${text}`);
  }

  async function getPairingKey() {
    try {
      const stored = await sdk.storage.get({ key: "kioskPairingKey" });
      if (stored && stored.value) return stored.value;
    } catch (error) {
      console.warn("저장된 페어링 키를 읽지 못했습니다.", error);
    }
    return config.developmentPairingKey;
  }

  function renderIdle() {
    sdk.template.renderIdlePage();
  }

  async function send(connectionId, payload) {
    await server.send(connectionId, JSON.stringify(payload));
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
        await send(connectionId, { type: "PAYMENT_SUCCESS", requestId, payment: recovered, recovered: true });
        return;
      }

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
        title: "예약 QR 코드를 스캔해주세요",
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
              message: "QR 스캔을 취소했어요.",
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

  async function initialize() {
    try {
      renderIdle();
      server = await sdk.websocket.start({
        port: config.port,
        path: config.path,
        onConnection: () => setStatus("키오스크 인증 대기 중"),
        onMessage: (payload) => void handleMessage(payload),
        onDisconnection: (payload) => {
          authenticatedConnections.delete(payload.connectionId);
          if (activeQrScan?.connectionId === payload.connectionId) {
            activeQrScan = null;
            renderIdle();
          }
          setStatus("키오스크 연결 대기 중");
        },
        onError: (payload) => setStatus(payload.message || "WebSocket 오류", "error"),
      });
      console.log(`WebSocket server: ws://${server.host}:${server.port}${server.path}`);
    } catch (error) {
      setStatus(`서버 시작 실패: ${String(error)}`, "error");
    }
  }

  window.addEventListener("beforeunload", () => {
    if (server) void server.stop();
  });

  void initialize();
})();
