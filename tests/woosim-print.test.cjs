const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { EventEmitter } = require('node:events')
const { spawnSync } = require('node:child_process')

test('B selects the Woosim text-and-cut script; Camp retains its GDI script; failure is never auto-retried', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../electron/main.js'), 'utf8')
  const block = source.slice(source.indexOf('function printSam4sWithWindows'), source.indexOf('const usesWoosim ='))
  const calls = []; let exitCode = 0
  const context = { path, __dirname: path.join(__dirname, '../electron'), process: { env: {} }, Buffer, setTimeout, clearTimeout,
    spawn(_command, args, options) {
      calls.push({ args, options })
      const child = new EventEmitter()
      child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.stdin = new EventEmitter()
      child.stdin.end = () => setImmediate(() => child.emit('close', exitCode))
      return child
    },
  }
  vm.runInNewContext(block, context)
  await context.printSam4sWithWindows('selected-Windows-queue', [{ text: 'TEST' }], 'woosim')
  await context.printSam4sWithWindows('selected-Windows-queue', [{ text: 'TEST' }])
  assert(calls[0].args.includes(path.join(context.__dirname, 'woosim-print.ps1')))
  assert(calls[1].args.includes(path.join(context.__dirname, 'sam4s-print.ps1')))
  assert(calls.every(c => c.options.windowsHide && c.args.at(-1) === 'selected-Windows-queue'))
  exitCode = 1
  await assert.rejects(context.printSam4sWithWindows('selected-Windows-queue', [], 'woosim'), /코드로 종료/)
  assert.equal(calls.length, 3)
})

test('Woosim CP949 Korean text and a single cut validate on x64 and ia32 without opening a printer', { skip: process.platform !== 'win32' }, () => {
  for (const system of ['System32', 'SysWOW64']) {
    const powershell = path.join(process.env.SystemRoot, system, 'WindowsPowerShell/v1.0/powershell.exe')
    if (!fs.existsSync(powershell)) continue
    const result = spawnSync(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', path.join(__dirname, '../electron/woosim-print.ps1'), '-CheckOnly'], {
      encoding: 'utf8', windowsHide: true, timeout: 20000, env: { ...process.env, WOOSIM_CUT_FEED_MM: '12' },
    })
    assert.equal(result.status, 0, `${system}: ${result.stderr || result.error}`)
    assert.match(result.stdout, /WOOSIM RAW self-check passed:.*cut=1 cp949=C7-D1-B1-DB \(no printer opened\)/)
    const bytes = Buffer.from(result.stdout.trim().split(/\r?\n/).at(-1), 'base64')
    assert(bytes.includes(Buffer.from('c7d1b1db', 'hex')), 'Korean must be encoded in CP949')
    assert(bytes.includes(Buffer.from([0x1b, 0x74, 255])), 'Select the installed DBCS font')
    assert(bytes.length < 200, 'Old two-line bitmap sample was 13883 bytes')
  }
})

test('same B321 room receipt shrinks from 100583 bitmap bytes and retains text hierarchy and one cut', { skip: process.platform !== 'win32' }, () => {
  const { buildSam4sPrintLines } = require('../electron/sam4s-receipt')
  const commands = buildSam4sPrintLines({ hotelName: 'THE BEACH STAY', roomNumber: 'B321', password: '1234',
    checkInDate: '2026-10-13', checkOutDate: '2026-10-14' })
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', path.join(__dirname, '../electron/woosim-print.ps1'), '-CheckOnly'], {
    input: Buffer.from(JSON.stringify(commands)).toString('base64'), encoding: 'utf8', windowsHide: true, timeout: 20000,
    env: { ...process.env, WOOSIM_CUT_FEED_MM: '12' },
  })
  assert.equal(result.status, 0, result.stderr || String(result.error))
  const bytes = Buffer.from(result.stdout.trim().split(/\r?\n/).at(-1), 'base64')
  assert(bytes.length < 2000, `Text receipt unexpectedly large: ${bytes.length}`)
  assert(bytes.includes(Buffer.from('THE BEACH STAY')))
  assert(bytes.includes(Buffer.from('1234*')))
  assert(bytes.includes(Buffer.from([0x1d, 0x21, 34])), 'Room and password remain large')
  assert.equal(bytes.toString('hex').match(/1d5600/g).length, 1)
  assert.equal(bytes.includes(Buffer.from([0x1b, 0x2a])), false, 'No full receipt bitmap')
  console.log(`B321 RAW size: bitmap=100583 text=${bytes.length} reduction=${(100*(1-bytes.length/100583)).toFixed(2)}%`)
})
