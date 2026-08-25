function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;")
}

function formatRoomNumber(value) {
  const room = String(value || "").trim()
  const campMatch = room.replace(/[\s-]/g, "").match(/^camp(\d+)$/i)
  if (campMatch) return `CAMP ${campMatch[1]}호`

  const buildingMatch = room.replace(/[\s-]/g, "").match(/^([A-Za-z])(\d+)$/)
  if (buildingMatch) return `${buildingMatch[1].toUpperCase()}동 ${buildingMatch[2]}호`
  return room
}

function formatDate(value) {
  if (!value) return ""
  const match = String(value).match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})/)
  return match ? `${match[1]}년 ${Number(match[2])}월 ${Number(match[3])}일` : String(value)
}

function formatPaymentDate(value) {
  const timestamp = Number(value) < 10_000_000_000 ? Number(value) * 1000 : Number(value)
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return String(value || "")
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date)
}

function formatAmount(value) {
  return `${Number(value || 0).toLocaleString("ko-KR")}원`
}

function detailRow(label, value) {
  if (value === undefined || value === null || value === "") return ""
  return `<div class="row"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`
}

function buildSam4sReceiptHtml(data = {}) {
  const password = data.password ? `${String(data.password).replace(/\*+$/, "")}*` : ""
  const payment = data.paymentReceipt
  const business = data.business || {}
  const checkInDate = formatDate(data.checkInDate)
  const checkOutDate = formatDate(data.checkOutDate)

  const paymentSection = payment
    ? `
      <section>
        <h2>카드 결제 영수증</h2>
        ${detailRow("상호", business.name)}
        ${detailRow("사업자번호", business.registrationNumber)}
        ${detailRow("대표자", business.representative)}
        ${detailRow("주소", business.address)}
        ${detailRow("전화", business.phone)}
        <div class="separator"></div>
        ${detailRow("승인일시", formatPaymentDate(payment.timestamp))}
        ${detailRow("승인번호", payment.approvalNumber)}
        ${detailRow("카드사", payment.issuerName)}
        ${detailRow("카드번호", payment.maskedCardNumber)}
        ${detailRow("할부", Number(payment.installment) > 0 ? `${payment.installment}개월` : "일시불")}
        ${detailRow("예약번호", data.reservationId)}
        <div class="separator"></div>
        ${detailRow("공급가액", formatAmount(payment.supplyValue))}
        ${detailRow("부가세", formatAmount(payment.tax))}
        <p class="total-label">결제금액</p>
        <p class="total">${escapeHtml(formatAmount(payment.amount))}</p>
        <p class="approved">카드 승인 완료</p>
      </section>`
    : ""

  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <title>SAM4S 영수증</title>
  <style>
    @page { size: 80mm 297mm; margin: 0; }
    * { box-sizing: border-box; }
    html, body { width: 80mm; margin: 0; padding: 0; background: #fff; color: #000; }
    body { font-family: "Malgun Gothic", "맑은 고딕", sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .receipt { width: 72mm; margin: 0 auto; padding: 4mm 0 7mm; }
    .hotel { margin: 0 0 4mm; text-align: center; font-size: 23pt; line-height: 1.15; font-weight: 800; }
    section { margin: 0; }
    h2 { margin: 3mm 0; text-align: center; font-size: 17pt; line-height: 1.2; font-weight: 800; }
    .separator { border-top: 0.35mm dashed #000; margin: 3mm 0; }
    .row { display: flex; gap: 2mm; justify-content: space-between; margin: 1.2mm 0; font-size: 10.5pt; line-height: 1.35; }
    .row span { flex: 0 0 23mm; }
    .row strong { flex: 1; text-align: right; overflow-wrap: anywhere; }
    .guide { margin: 0 0 3mm; text-align: center; font-size: 11pt; font-weight: 700; }
    .room { margin: 2mm 0; text-align: center; font-size: 29pt; line-height: 1.15; font-weight: 900; }
    .password-label { margin: 4mm 0 1mm; text-align: center; font-size: 12pt; }
    .password { margin: 0 0 4mm; text-align: center; font-size: 31pt; line-height: 1.15; font-weight: 900; text-decoration: underline; }
    ol { margin: 0 0 3mm; padding-left: 7mm; font-size: 10.5pt; line-height: 1.55; }
    .dates { font-size: 11pt; line-height: 1.6; }
    .total-label, .approved { margin: 2mm 0 0; text-align: center; font-size: 12pt; font-weight: 800; }
    .total { margin: 1mm 0 3mm; text-align: center; font-size: 25pt; line-height: 1.15; font-weight: 900; }
    .thanks { margin: 4mm 0 0; text-align: center; font-size: 12pt; line-height: 1.5; font-weight: 800; }
  </style>
</head>
<body>
  <main class="receipt">
    <h1 class="hotel">${escapeHtml(data.hotelName || "THE CAMP STAY")}</h1>
    ${paymentSection}
    <div class="separator"></div>
    <section>
      <h2>입실 안내</h2>
      <p class="guide">아래 비밀번호를 도어락에 입력하세요.</p>
      <p class="room">${escapeHtml(formatRoomNumber(data.roomNumber))}</p>
      ${password ? `<p class="password-label">객실 비밀번호</p><p class="password">${escapeHtml(password)}</p>` : ""}
    </section>
    <div class="separator"></div>
    <section>
      <h2>도어락 이용 방법</h2>
      <ol>
        <li>도어락 화면을 손으로 터치하세요.</li>
        <li>숫자 자판이 나타날 때까지 기다리세요.</li>
        ${password ? `<li>비밀번호 ${escapeHtml(password)}를 입력하세요.</li>` : ""}
        <li>문이 열리면 입실하세요.</li>
      </ol>
    </section>
    ${checkInDate || checkOutDate ? `<div class="separator"></div><div class="dates">${checkInDate ? `<div>체크인&nbsp;&nbsp; ${escapeHtml(checkInDate)}</div>` : ""}${checkOutDate ? `<div>체크아웃 ${escapeHtml(checkOutDate)}</div>` : ""}</div>` : ""}
    <p class="thanks">즐거운 시간 보내시기 바랍니다.<br>감사합니다.</p>
  </main>
</body>
</html>`
}

function buildSam4sPrintLines(data = {}) {
  const password = data.password ? `${String(data.password).replace(/\*+$/, "")}*` : ""
  const payment = data.paymentReceipt
  const business = data.business || {}
  const lines = []
  const text = (value, options = {}) => lines.push({ kind: "text", text: String(value), size: 10.5, ...options })
  const row = (label, value) => {
    if (value !== undefined && value !== null && value !== "") {
      lines.push({ kind: "columns", left: String(label), right: String(value), size: 9.5, gapAfter: 0.8 })
    }
  }
  const separator = () => lines.push({ kind: "separator", gapBefore: 1.5, gapAfter: 1.5 })

  text(data.hotelName || "THE CAMP STAY", { size: 22, bold: true, align: "center", gapAfter: 3 })

  if (payment) {
    text("카드 결제 영수증", { size: 16, bold: true, align: "center", gapAfter: 2 })
    row("상호", business.name)
    row("사업자번호", business.registrationNumber)
    row("대표자", business.representative)
    row("주소", business.address)
    row("전화", business.phone)
    separator()
    row("승인일시", formatPaymentDate(payment.timestamp))
    row("승인번호", payment.approvalNumber)
    row("카드사", payment.issuerName)
    row("카드번호", payment.maskedCardNumber)
    row("할부", Number(payment.installment) > 0 ? `${payment.installment}개월` : "일시불")
    row("예약번호", data.reservationId)
    separator()
    row("공급가액", formatAmount(payment.supplyValue))
    row("부가세", formatAmount(payment.tax))
    text("결제금액", { size: 12, bold: true, align: "center", gapBefore: 1 })
    text(formatAmount(payment.amount), { size: 24, bold: true, align: "center", gapAfter: 1 })
    text("카드 승인 완료", { size: 12, bold: true, align: "center", gapAfter: 2 })
  }

  separator()
  text("입실 안내", { size: 16, bold: true, align: "center", gapAfter: 2 })
  text("아래 비밀번호를 도어락에 입력하세요.", { size: 10.5, bold: true, align: "center", gapAfter: 2 })
  text(formatRoomNumber(data.roomNumber), { size: 28, bold: true, align: "center", gapAfter: 2 })
  if (password) {
    text("객실 비밀번호", { size: 12, align: "center" })
    text(password, { size: 30, bold: true, underline: true, align: "center", gapAfter: 2 })
  }

  separator()
  text("도어락 이용 방법", { size: 16, bold: true, align: "center", gapAfter: 1 })
  const steps = [
    "도어락 화면을 손으로 터치하세요.",
    "숫자 자판이 나타날 때까지 기다리세요.",
    ...(password ? [`비밀번호 ${password}를 입력하세요.`] : []),
    "문이 열리면 입실하세요.",
  ]
  steps.forEach((step, index) => text(`${index + 1}. ${step}`, { gapAfter: 0.5 }))

  const checkInDate = formatDate(data.checkInDate)
  const checkOutDate = formatDate(data.checkOutDate)
  if (checkInDate || checkOutDate) {
    separator()
    if (checkInDate) text(`체크인    ${checkInDate}`, { size: 11, gapAfter: 0.5 })
    if (checkOutDate) text(`체크아웃 ${checkOutDate}`, { size: 11, gapAfter: 0.5 })
  }
  text("즐거운 시간 보내시기 바랍니다.\n감사합니다.", {
    size: 12,
    bold: true,
    align: "center",
    gapBefore: 3,
    gapAfter: 5,
  })
  return lines
}

function findSam4sPrinter(printers, configuredName = "") {
  const wanted = configuredName.trim().toLowerCase()
  if (wanted) {
    return printers.find((printer) =>
      [printer.name, printer.displayName].some((name) => String(name || "").toLowerCase() === wanted),
    ) || null
  }

  return printers.find((printer) => {
    const name = `${printer.name || ""} ${printer.displayName || ""}`
    return /sam4s/i.test(name) && /g[- ]?cube|gcube/i.test(name)
  }) || null
}

if (typeof require !== "undefined" && require.main === module) {
  const html = buildSam4sReceiptHtml({ roomNumber: "Camp101", password: "12<34" })
  if (!html.includes("CAMP 101호") || !html.includes("12&lt;34*")) throw new Error("receipt HTML self-check failed")
  const lines = buildSam4sPrintLines({ roomNumber: "Camp101", password: "12<34" })
  if (!lines.some((line) => line.text === "CAMP 101호") || !lines.some((line) => line.text === "12<34*" && line.size === 30)) {
    throw new Error("native print lines self-check failed")
  }
  if (findSam4sPrinter([{ name: "SAM4S GCUBE-100" }])?.name !== "SAM4S GCUBE-100") throw new Error("printer selection self-check failed")
  console.log("SAM4S receipt self-check passed")
}

module.exports = { buildSam4sReceiptHtml, buildSam4sPrintLines, findSam4sPrinter }
