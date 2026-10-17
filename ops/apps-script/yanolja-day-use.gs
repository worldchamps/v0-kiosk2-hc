/**
 * 야놀자 대실 메일 → Reservations 시트 등록
 *
 * 대실 메일은 본문 첫 줄에 "<대실>"이 붙어 숙박 메일보다 한 줄이 많다. 기존 숙박용 스크립트는
 * 줄 순서로 값을 읽기 때문에 A열에 "<대실>"이 들어가고 이름·연락처·입실 시각이 밀린 행을 만든다.
 * 이 스크립트는 대실 메일만 내용 패턴으로 다시 읽어 다음을 한다.
 *   - 행이 없으면 숙박 행과 같은 A~I 형식으로 추가한다.
 *   - 기존 스크립트가 만든 밀린 행이 있으면 A~I만 고친다(J열 이후 객실·비밀번호는 보존).
 *   - 정상 행이 이미 있으면 밀린 중복 행만 지운다.
 *   - "<대실 … 취소>" 메일은 체크인 전 행을 CancelledReservations로 옮긴다. 체크인한 행은 그대로 둔다.
 * 설치 시각 이후에 받은 메일만 처리하므로 설치 전 예약은 건드리지 않는다.
 *
 * 설치: Reservations 스프레드시트 → 확장 프로그램 → Apps Script → 파일 추가(스크립트)
 *       → 이 파일 내용을 붙여 넣고 저장 → installYanoljaDayUseTrigger 를 한 번 실행하고 권한 승인.
 * 원본: worldchamps/v0-kiosk2-hc ops/apps-script/yanolja-day-use.gs (tests/yanolja-day-use.test.cjs)
 */

var YDU_SPREADSHEET_ID = '1icmykHJ74WFaVGvMic5fElM8-J4f5sqbYTb_O4YgIeQ'
var YDU_RESERVATIONS = 'Reservations'
var YDU_CANCELLED = 'CancelledReservations'
var YDU_QUERY = 'subject:야놀자 대실 newer_than:2d'
var YDU_RECHECK_MS = 60 * 60 * 1000
var YDU_SINCE_KEY = 'YANOLJA_DAY_USE_SINCE'
var YDU_SEEN_KEY = 'YANOLJA_DAY_USE_SEEN'
var YDU_WIDTH = 17 // A:Q, CancelledReservations와 같은 폭

function installYanoljaDayUseTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() === 'processYanoljaDayUse') ScriptApp.deleteTrigger(trigger)
  })
  ScriptApp.newTrigger('processYanoljaDayUse').timeBased().everyMinutes(1).create()
  var props = PropertiesService.getScriptProperties()
  if (!props.getProperty(YDU_SINCE_KEY)) props.setProperty(YDU_SINCE_KEY, String(Date.now()))
  processYanoljaDayUse()
}

function processYanoljaDayUse() {
  var lock = LockService.getScriptLock()
  if (!lock.tryLock(30000)) return
  try {
    var props = PropertiesService.getScriptProperties()
    var now = Date.now()
    var since = Number(props.getProperty(YDU_SINCE_KEY))
    if (!since) { props.setProperty(YDU_SINCE_KEY, String(now)); return }
    var seen = {}
    try { seen = JSON.parse(props.getProperty(YDU_SEEN_KEY) || '{}') } catch (e) { seen = {} }

    // 처리 후 1시간 동안은 기존 스크립트가 늦게 만든 밀린 행을 다시 확인한다.
    var mails = []
    GmailApp.search(YDU_QUERY, 0, 50).forEach(function (thread) {
      var id = thread.getId()
      if (thread.getLastMessageDate().getTime() < since) return
      if (seen[id] && now - seen[id] >= YDU_RECHECK_MS) return
      thread.getMessages().forEach(function (message) {
        if (message.getDate().getTime() < since) return
        var parsed = parseYanoljaDayUse_(message.getPlainBody())
        if (parsed && parsed.error) console.error('야놀자 대실 메일 해석 실패: ' + parsed.error + ' (' + message.getId() + ')')
        else if (parsed) mails.push(parsed)
      })
      if (!seen[id]) seen[id] = now
    })
    if (mails.length) {
      var book = SpreadsheetApp.openById(YDU_SPREADSHEET_ID)
      var reservations = book.getSheetByName(YDU_RESERVATIONS)
      var cancelled = book.getSheetByName(YDU_CANCELLED)
      var actions = planYanoljaDayUse_(mails, readRows_(reservations), readIds_(cancelled))
      applyYanoljaDayUse_(actions, reservations, cancelled)
    }
    Object.keys(seen).forEach(function (id) { if (now - seen[id] > 3 * 24 * 60 * 60 * 1000) delete seen[id] })
    props.setProperty(YDU_SEEN_KEY, JSON.stringify(seen))
  } finally {
    lock.releaseLock()
  }
}

function parseYanoljaDayUse_(body) {
  var text = String(body || '').replace(/\r/g, '')
  var marker = text.match(/<\s*대실([^>]*)>/)
  if (!marker) return null
  var lines = text.slice(marker.index + marker[0].length).split('\n')
    .map(function (line) { return line.trim() }).filter(Boolean)
  var idIndex = -1
  for (var i = 0; i < lines.length; i++) if (/^\d{10,20}$/.test(lines[i])) { idIndex = i; break }
  if (idIndex < 1) return { error: '예약번호 없음' }
  var price = null, guest = null
  lines.slice(idIndex + 1).forEach(function (line) {
    if (!price && /^[\d,]+\s*원?$/.test(line)) price = Number(line.replace(/[^\d]/g, ''))
    var match = line.match(/^(.+?)\s*\/\s*(0\d[\d-]{7,})$/)
    if (!guest && match) guest = { name: match[1].trim(), phone: match[2].replace(/-/g, '') }
  })
  var times = []
  var pattern = /(\d{4})-(\d{2})-(\d{2})\([^)]*\)\s*(\d{1,2}):(\d{2})/g, found
  while ((found = pattern.exec(text)) && times.length < 2) times.push(found)
  if (!guest || price === null || times.length < 2) return { error: '이름·금액·시간 없음' }
  var start = Date.UTC(+times[0][1], times[0][2] - 1, +times[0][3], +times[0][4], +times[0][5])
  var end = Date.UTC(+times[1][1], times[1][2] - 1, +times[1][3], +times[1][4], +times[1][5])
  if (!(end > start) || end - start > 24 * 60 * 60 * 1000) return { error: '대실 시간 오류' }
  return {
    cancel: /취소/.test(marker[1]),
    property: lines[idIndex - 1],
    reservationId: lines[idIndex],
    roomType: lines[idIndex + 1],
    price: price,
    name: guest.name,
    phone: guest.phone,
    checkIn: sheetTime_(times[0]),
    checkOut: sheetTime_(times[1]),
  }
}

function sheetTime_(match) {
  return match[1].slice(2) + '.' + match[2] + '.' + match[3] + '/' + ('0' + match[4]).slice(-2) + ':' + match[5]
}

// 기존 야놀자 숙박 행과 같은 A~I 형식(E열 앞 공백 포함)
function dayUseRow_(mail) {
  return [mail.property, mail.name, mail.reservationId, '야놀자', ' ' + mail.roomType,
    '₩' + String(mail.price).replace(/\B(?=(\d{3})+(?!\d))/g, ','), mail.phone, mail.checkIn, mail.checkOut]
}

function isMalformed_(values) {
  return /^\s*</.test(String(values[0] || '')) || !String(values[7] || '').trim()
}

/**
 * rows: [{ row, values }] Reservations 행(1-based row, A:Q 값). cancelledIds: CancelledReservations C열 집합.
 * 반환하는 작업은 applyYanoljaDayUse_가 시트에 반영한다.
 */
function planYanoljaDayUse_(mails, rows, cancelledIds) {
  var byId = {}
  mails.forEach(function (mail) {
    var entry = byId[mail.reservationId] = byId[mail.reservationId] || { booking: null, cancel: null }
    entry[mail.cancel ? 'cancel' : 'booking'] = mail
  })
  var actions = []
  Object.keys(byId).forEach(function (id) {
    var entry = byId[id]
    var matching = rows.filter(function (item) { return String(item.values[2] || '').trim() === id })
    if (entry.cancel) {
      if (matching.some(function (item) { return String(item.values[11] || '').trim() })) {
        actions.push({ type: 'hold', id: id })
        return
      }
      var good = matching.filter(function (item) { return !isMalformed_(item.values) })[0]
      if (matching.length && !cancelledIds[id]) {
        actions.push({ type: 'archive', id: id, values: good ? good.values : dayUseRow_(entry.cancel) })
      }
      matching.forEach(function (item) { actions.push({ type: 'clear', id: id, row: item.row }) })
      return
    }
    var valid = matching.filter(function (item) { return !isMalformed_(item.values) })
    var broken = matching.filter(function (item) { return isMalformed_(item.values) })
    // 이미 취소 시트로 옮겨진 예약은 다시 살리지 않고 밀린 행만 정리한다.
    if (!valid.length && !broken.length && !cancelledIds[id]) actions.push({ type: 'append', id: id, values: dayUseRow_(entry.booking) })
    if (!valid.length && broken.length && !cancelledIds[id]) {
      actions.push({ type: 'rewrite', id: id, row: broken[0].row, values: dayUseRow_(entry.booking) })
      broken = broken.slice(1)
    }
    broken.forEach(function (item) {
      if (!String(item.values[11] || '').trim()) actions.push({ type: 'clear', id: id, row: item.row, malformedOnly: true })
    })
  })
  return actions
}

function readRows_(sheet) {
  var last = sheet.getLastRow()
  if (last < 2) return []
  return sheet.getRange(2, 1, last - 1, YDU_WIDTH).getDisplayValues()
    .map(function (values, index) { return { row: index + 2, values: values } })
    .filter(function (item) { return String(item.values[2] || '').trim() })
}

function readIds_(sheet) {
  var ids = {}
  var last = sheet.getLastRow()
  if (last < 2) return ids
  sheet.getRange(2, 3, last - 1, 1).getDisplayValues().forEach(function (value) { ids[String(value[0]).trim()] = true })
  return ids
}

function writeText_(sheet, row, values) {
  var range = sheet.getRange(row, 1, 1, values.length)
  range.setNumberFormat('@')
  range.setValues([values.map(function (value) { return value === null || value === undefined ? '' : String(value) })])
}

function applyYanoljaDayUse_(actions, reservations, cancelled) {
  // 행을 지우지 않고 비우므로 다른 행 번호는 바뀌지 않는다. 그래도 쓰기 직전에 같은 예약인지 다시 확인한다.
  actions.forEach(function (action) {
    if (action.type === 'hold') {
      console.warn('야놀자 대실 취소: 이미 체크인한 예약이라 그대로 둡니다 ' + action.id)
    } else if (action.type === 'append') {
      writeText_(reservations, reservations.getLastRow() + 1, action.values)
      console.log('야놀자 대실 등록 ' + action.id)
    } else if (action.type === 'archive') {
      writeText_(cancelled, cancelled.getLastRow() + 1, action.values)
    } else {
      var current = reservations.getRange(action.row, 1, 1, YDU_WIDTH).getDisplayValues()[0]
      if (String(current[2] || '').trim() !== action.id) return console.error('행이 바뀌어 건너뜀 ' + action.id)
      if (action.type === 'rewrite') {
        if (!isMalformed_(current)) return
        writeText_(reservations, action.row, action.values)
        console.log('야놀자 대실 밀린 행 수정 ' + action.id + ' (' + action.row + '행)')
      } else if (action.type === 'clear') {
        if (action.malformedOnly && !isMalformed_(current)) return
        reservations.getRange(action.row, 1, 1, YDU_WIDTH).clearContent()
        console.log('야놀자 대실 행 비움 ' + action.id + ' (' + action.row + '행)')
      }
    }
  })
}
