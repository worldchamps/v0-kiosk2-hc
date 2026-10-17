const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const source = fs.readFileSync(path.join(__dirname, '../ops/apps-script/yanolja-day-use.gs'), 'utf8')

// Real 2026-10-17 bodies forwarded to Gmail.
const BOOKING = '<대실>\n경주 더 비치스테이\n2610171304500126\n\n디럭스 (오션뷰)\n20,000\n\n조현준 / 050373314454\n2026-10-17(토) 17:00\n2026-10-17(토) 21:00 (4시간)'
const BOOKING2 = '<대실>\n경주 더 비치스테이\n2610171325580011\n\n디럭스 (오션뷰)\n20,000\n\n강영신 / 050350988279\n2026-10-17(토) 14:00\n2026-10-17(토) 18:00 (4시간)'
const CANCEL2 = '[Web발신]\nNOL 당일예약\n<대실 1시간 내 취소>\n경주 더 비치스테이\n2610171325580011\n\n디럭스 (오션뷰)\n20,000원\n\n강영신 / 050350988279\n2026-10-17(토) 14:00~\n2026-10-17(토) 18:00 (4시간)\n차량방문'
const OVERNIGHT = '경주 더 비치스테이\n2610171557330183\n\n디럭스 (오션뷰)\n60,000\n\n변일황 / 050718107618\n2026-10-17(토) 16:00\n2026-10-18(일) 10:00 (1박)'
// What the line-based overnight script wrote for BOOKING (Reservations row 183).
const SHIFTED = ['<대실>', '', '2610171304500126', '야놀자', ' 2610171304500126', '디럭스 (오션뷰)', '', '', '26.10.17/17:00']
const EXPECTED = ['경주 더 비치스테이', '조현준', '2610171304500126', '야놀자', ' 디럭스 (오션뷰)', '₩20,000', '050373314454', '26.10.17/17:00', '26.10.17/21:00']

function load(env = {}) {
  const context = { console: { log() {}, warn() {}, error() {} }, ...env }
  vm.runInNewContext(source, context)
  return context
}

const pad = values => [...values, ...Array(17 - values.length).fill('')]

function fakeSheet(rows) {
  const data = rows.map(row => pad(row.map(String)))
  const sheet = {
    data, formats: [],
    getLastRow: () => { for (let i = data.length; i > 0; i--) if (data[i - 1].some(Boolean)) return i; return 0 },
    getRange: (row, col, rowCount, colCount) => ({
      getDisplayValues: () => Array.from({ length: rowCount }, (_, r) =>
        Array.from({ length: colCount }, (_, c) => (data[row - 1 + r] || [])[col - 1 + c] ?? '')),
      setNumberFormat: format => sheet.formats.push([row, format]),
      setValues: values => values.forEach((items, r) => {
        while (data.length < row + r) data.push(pad([]))
        items.forEach((value, c) => { data[row - 1 + r][col - 1 + c] = value })
      }),
      clearContent: () => { for (let r = 0; r < rowCount; r++) for (let c = 0; c < colCount; c++) data[row - 1 + r][col - 1 + c] = '' },
    }),
  }
  return sheet
}

function fakeEnv({ mails, reservations, cancelled = [['place', 'guestName', 'reservationId']], since = 1000, lock = true, props = {} }) {
  const store = { YANOLJA_DAY_USE_SINCE: String(since), ...props }
  const sheets = { Reservations: fakeSheet(reservations), CancelledReservations: fakeSheet(cancelled) }
  let opened = 0
  const env = {
    Date: { now: () => 5000, UTC: Date.UTC },
    LockService: { getScriptLock: () => ({ tryLock: () => lock, releaseLock() {} }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: key => store[key] ?? null, setProperty: (key, value) => { store[key] = value } }) },
    GmailApp: { search: () => mails.map(([id, time, body]) => ({
      getId: () => id, getLastMessageDate: () => ({ getTime: () => time }),
      getMessages: () => [{ getId: () => id, getDate: () => ({ getTime: () => time }), getPlainBody: () => body }],
    })) },
    SpreadsheetApp: { openById: () => { opened++; return { getSheetByName: name => sheets[name] } } },
  }
  return { env, sheets, store, opened: () => opened }
}

test('day-use mail is parsed by content, not line position; overnight mail is ignored', () => {
  const { parseYanoljaDayUse_, dayUseRow_ } = load()
  assert.deepEqual([...dayUseRow_(parseYanoljaDayUse_(BOOKING))], EXPECTED)
  const cancel = parseYanoljaDayUse_(CANCEL2)
  assert.equal(cancel.cancel, true)
  assert.equal(cancel.reservationId, '2610171325580011')
  assert.equal(cancel.checkIn, '26.10.17/14:00')
  assert.equal(parseYanoljaDayUse_(OVERNIGHT), null)
  assert.equal(parseYanoljaDayUse_(BOOKING.replace('조현준 / 050373314454', '')).error, '이름·금액·시간 없음')
  assert.equal(parseYanoljaDayUse_(BOOKING.replace('21:00', '16:00')).error, '대실 시간 오류')
})

test('shifted row from the overnight script is repaired in place and room columns are kept', () => {
  const { env, sheets } = fakeEnv({ mails: [['t1', 2000, BOOKING]], reservations: [['header'], [...SHIFTED, 'A231', '7548']] })
  load(env).processYanoljaDayUse()
  const row = sheets.Reservations.data[1]
  assert.deepEqual(row.slice(0, 9), EXPECTED)
  assert.deepEqual(row.slice(9, 11), ['A231', '7548'])
  assert.deepEqual(sheets.Reservations.formats, [[2, '@']])
})

test('missing day-use booking is appended as text; a late shifted duplicate is cleared, not the good row', () => {
  const { env, sheets, store } = fakeEnv({ mails: [['t1', 2000, BOOKING]], reservations: [['header'], ['경주 더 비치스테이', '정윤석', '2610170935190045']] })
  const script = load(env)
  script.processYanoljaDayUse()
  assert.deepEqual(sheets.Reservations.data[2].slice(0, 9), EXPECTED)
  assert.deepEqual(sheets.Reservations.formats, [[3, '@']])
  sheets.Reservations.data.push(pad(SHIFTED))
  script.processYanoljaDayUse()
  assert.deepEqual(sheets.Reservations.data[2].slice(0, 9), EXPECTED)
  assert.deepEqual(sheets.Reservations.data[3], pad([]))
  assert.deepEqual(sheets.Reservations.data[1].slice(0, 3), ['경주 더 비치스테이', '정윤석', '2610170935190045'])
  assert.ok(JSON.parse(store.YANOLJA_DAY_USE_SEEN).t1)
})

test('cancel mail archives once and clears the row; a cancelled booking is never re-created', () => {
  const { env, sheets } = fakeEnv({
    mails: [['t2', 2000, BOOKING2], ['t3', 2500, CANCEL2]],
    reservations: [['header'], [...SHIFTED.slice(0, 2), '2610171325580011', ...SHIFTED.slice(3)]],
  })
  const script = load(env)
  script.processYanoljaDayUse()
  assert.deepEqual(sheets.Reservations.data[1], pad([]))
  assert.equal(sheets.CancelledReservations.data.length, 2)
  assert.equal(sheets.CancelledReservations.data[1][2], '2610171325580011')
  assert.equal(sheets.CancelledReservations.data[1][1], '강영신')
  script.processYanoljaDayUse()
  assert.equal(sheets.CancelledReservations.data.length, 2)
  assert.equal(sheets.Reservations.getLastRow(), 1)
  // The overnight script re-inserts its shifted row later: cleared again, archived only once.
  sheets.Reservations.data.push(pad([...SHIFTED.slice(0, 2), '2610171325580011', ...SHIFTED.slice(3)]))
  script.processYanoljaDayUse()
  assert.equal(sheets.Reservations.getLastRow(), 1)
  assert.equal(sheets.CancelledReservations.data.length, 2)
})

test('booking already in CancelledReservations is not revived after the cancel mail is out of the window', () => {
  const cancelled = [['place', 'guestName', 'reservationId'], ['경주 더 비치스테이', '강영신', '2610171325580011']]
  for (const reservations of [[['header'], [...SHIFTED.slice(0, 2), '2610171325580011', ...SHIFTED.slice(3)]], [['header']]]) {
    const { env, sheets } = fakeEnv({ mails: [['t2', 2000, BOOKING2]], reservations, cancelled })
    load(env).processYanoljaDayUse()
    assert.equal(sheets.Reservations.getLastRow(), 1)
  }
})

test('cancel of a checked-in day-use is left for staff', () => {
  const checkedIn = ['경주 더 비치스테이', '강영신', '2610171325580011', '야놀자', ' 디럭스 (오션뷰)', '₩20,000', '050350988279', '26.10.17/14:00', '26.10.17/18:00', 'D211', '2111', 'Checked In']
  const { env, sheets } = fakeEnv({ mails: [['t3', 2500, CANCEL2]], reservations: [['header'], checkedIn] })
  load(env).processYanoljaDayUse()
  assert.deepEqual(sheets.Reservations.data[1], pad(checkedIn))
  assert.equal(sheets.CancelledReservations.data.length, 1)
})

test('mails before install, settled threads, held locks and moved rows make no sheet changes', () => {
  for (const options of [
    { mails: [['t1', 500, BOOKING]] },
    { mails: [['t1', 2000, BOOKING]], props: { YANOLJA_DAY_USE_SEEN: JSON.stringify({ t1: 5000 - 60 * 60 * 1000 }) } },
    { mails: [['t1', 2000, BOOKING]], lock: false },
  ]) {
    const fake = fakeEnv({ ...options, reservations: [['header'], [...SHIFTED]] })
    load(fake.env).processYanoljaDayUse()
    assert.deepEqual(fake.sheets.Reservations.data[1], pad(SHIFTED))
    assert.equal(fake.opened(), 0)
  }
  // Another writer replaced the row between planning and writing: the action is skipped.
  const fake = fakeEnv({ mails: [], reservations: [['header'], ['경주 더 비치스테이', '다른 손님', '9999999999']] })
  const script = load(fake.env)
  script.applyYanoljaDayUse_([{ type: 'rewrite', id: '2610171304500126', row: 2, values: EXPECTED },
    { type: 'clear', id: '2610171304500126', row: 2, malformedOnly: true }], fake.sheets.Reservations, fake.sheets.CancelledReservations)
  assert.deepEqual(fake.sheets.Reservations.data[1].slice(0, 3), ['경주 더 비치스테이', '다른 손님', '9999999999'])
})
